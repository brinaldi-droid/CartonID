import * as XLSX from "xlsx";
import type { Carton, FragilityLevel, ParseIssue, ParseResult, RigidityClass, SKU } from "./types";

/** Exact header match first, then normalized equality — never substring-includes (avoids L→Length collisions). */
export function pickCol(r: Record<string, unknown>, ...candidates: string[]): unknown {
  for (const k of candidates) {
    if (r[k] !== undefined && r[k] !== "") return r[k];
  }
  const norm = (s: string) => s.toLowerCase().replace(/[\s_\-().]/g, "");
  const keys = Object.keys(r);
  for (const k of candidates) {
    const nk = norm(k);
    const found = keys.find((key) => norm(key) === nk);
    if (found && r[found] !== undefined && r[found] !== "") return r[found];
  }
  return undefined;
}

function parseNum(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = String(v ?? "")
    .trim()
    .replace(/[$,]/g, "")
    .replace(/^\((.*)\)$/, "-$1"); // accounting negatives
  if (!s) return NaN;
  return parseFloat(s);
}

function toFragility(v: unknown): FragilityLevel {
  const s = String(v ?? "").trim().toLowerCase();
  if (s.startsWith("h")) return "High";
  if (s.startsWith("m")) return "Medium";
  return "Low";
}

function toBool(v: unknown): boolean | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const s = String(v).trim().toLowerCase();
  if (["1", "true", "yes", "y"].includes(s)) return true;
  if (["0", "false", "no", "n"].includes(s)) return false;
  return undefined;
}

/** Map SKU-database labels (e.g. "Rigid Box", "Soft Bag") to engine rigidity classes. */
export function toRigidityClass(v: unknown): RigidityClass | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const raw = String(v).trim();
  // Ignore numeric bleed from misaligned CSV columns
  if (/^[\d.]+$/.test(raw)) return undefined;

  const s = raw.toLowerCase().replace(/[\s-]+/g, "_");

  if (s === "rigid" || s === "rigid_box" || s === "rigidbox" || s.startsWith("rigid_")) return "rigid";
  if (s === "semi_rigid" || s === "semirigid" || s === "semi_rigid_box" || s.startsWith("semi_rigid")) {
    return "semi_rigid";
  }
  if (
    s === "flexible" ||
    s === "flex" ||
    s === "flexible_pack" ||
    s === "flexible_pouch" ||
    s.startsWith("flexible_")
  ) {
    return "flexible";
  }
  if (
    s === "soft_bag" ||
    s === "softbag" ||
    s === "bag" ||
    s === "pouch" ||
    s === "polybag" ||
    s.startsWith("soft_")
  ) {
    return "soft_bag";
  }
  return undefined;
}

export function parseWorkbookToSKUs(wb: XLSX.WorkBook): ParseResult<SKU> {
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
  const issues: ParseIssue[] = [];
  const seen = new Set<string>();
  const out: SKU[] = [];

  rows.forEach((r, idx) => {
    const row = idx + 2; // header is row 1
    const id = String(pickCol(r, "SKU ID", "SKU", "SKUID", "Item ID", "Part No", "PartNo", "sku_id", "ID") ?? "").trim();
    const name = String(pickCol(r, "Name", "Description", "Desc", "Product", "Product Name", "Item Name") ?? "").trim();
    const length = parseNum(pickCol(r, "Length", "Len", "OD Length", "Outer Length", "L"));
    const width = parseNum(pickCol(r, "Width", "Wid", "OD Width", "Outer Width", "W"));
    const height = parseNum(pickCol(r, "Height", "Hgt", "Depth", "OD Height", "H"));
    const weight = parseNum(pickCol(r, "Weight", "Wt", "Unit Weight", "UnitWeight", "Item Weight"));

    if (!id && !name && !(length > 0)) return; // blank row

    if (!id) { issues.push({ row, message: "Missing SKU ID" }); return; }
    if (!name) { issues.push({ row, message: `SKU ${id}: missing Name` }); return; }
    if (!(length > 0) || !(width > 0) || !(height > 0)) {
      issues.push({ row, message: `SKU ${id}: invalid dimensions (need positive Length, Width, Height)` });
      return;
    }
    if (!(weight >= 0) || Number.isNaN(weight)) {
      issues.push({ row, message: `SKU ${id}: invalid Weight` });
      return;
    }
    if (seen.has(id)) {
      issues.push({ row, message: `Duplicate SKU ID "${id}" — skipped` });
      return;
    }
    seen.add(id);

    const rigidityClass = toRigidityClass(
      pickCol(r, "Rigidity Class", "Rigidity", "RigidityClass", "Package Rigidity", " Package Rigidity"),
    );
    const maxCompL = parseNum(pickCol(r, "Max Compression Length %", "MaxCompL", "Compression L %"));
    const maxCompW = parseNum(pickCol(r, "Max Compression Width %", "MaxCompW", "Compression W %"));
    const maxCompH = parseNum(pickCol(r, "Max Compression Height %", "MaxCompH", "Compression H %"));
    const minRetVol = parseNum(pickCol(r, "Min Retained Volume %", "MinimumRetainedVolumePercent", "MinRetainedVol"));
    const canConform = toBool(pickCol(r, "Can Conform To Void", "CanConformToVoid", "Conform Void"));
    const contentShift = String(pickCol(r, "Content Shift Risk", "ContentShiftRisk") ?? "").trim().toLowerCase();

    const mechanical: SKU["mechanical"] = {};
    if (rigidityClass) mechanical.rigidityClass = rigidityClass;
    if ([maxCompL, maxCompW, maxCompH].some((n) => Number.isFinite(n) && n >= 0)) {
      mechanical.maxCompressionPercent = {
        length: Number.isFinite(maxCompL) && maxCompL >= 0 ? maxCompL : 0,
        width: Number.isFinite(maxCompW) && maxCompW >= 0 ? maxCompW : 0,
        height: Number.isFinite(maxCompH) && maxCompH >= 0 ? maxCompH : 0,
      };
    }
    if (Number.isFinite(minRetVol) && minRetVol > 0) mechanical.minimumRetainedVolumePercent = minRetVol;
    if (canConform !== undefined) mechanical.canConformToVoid = canConform;
    if (contentShift === "low" || contentShift === "medium" || contentShift === "high") {
      mechanical.contentShiftRisk = contentShift;
    }
    const stackable = toBool(pickCol(r, "Stackable", "Can Stack"));
    if (stackable !== undefined) mechanical.stackable = stackable;

    out.push({
      id,
      name,
      category: String(pickCol(r, "Category", "Cat", "Type", "Class", "Group") ?? "General").trim() || "General",
      length,
      width,
      height,
      weight: weight || 0,
      fragility: toFragility(pickCol(r, "Fragility", "Frag", "Fragile", "Risk", "Fragility Level")),
      packageType: String(pickCol(r, "Package Type", "PackageType", "Pkg Type") ?? "").trim() || undefined,
      keepFlat: toBool(pickCol(r, "Keep Flat", "KeepFlat", "Flat Only")),
      keepUpright: toBool(pickCol(r, "Keep Upright", "KeepUpright", "Upright Only", "This Side Up")),
      stackable,
      rigidityClass,
      mechanical: Object.keys(mechanical).length ? mechanical : undefined,
    });
  });

  return { rows: out, issues };
}

export function parseWorkbookToCartons(wb: XLSX.WorkBook): ParseResult<Carton> {
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
  const issues: ParseIssue[] = [];
  const seen = new Set<string>();
  const out: Carton[] = [];

  rows.forEach((r, idx) => {
    const row = idx + 2;
    const rawNum = pickCol(
      r,
      "Packsize Number", "Packsize No", "Packsize ID", "Packsize SKU",
      "Manhattan Box ID", "Manhattan Carton Number", "Carton Number",
      "Box No", "Box Number", "Number",
    );
    const idRaw = String(pickCol(r, "ID", "Carton ID", "CartonID", "Carton Id", "Code") ?? "").trim();
    const name = String(pickCol(r, "Name", "Carton Name", "Description", "Desc") ?? "").trim();
    // Prefer explicit Length/Width/Height by name — never by column position
    const length = parseNum(pickCol(r, "Length", "length", "Len", "OD Length", "Outer Length", "Inside Length", "ID Length"));
    const width = parseNum(pickCol(r, "Width", "width", "Wid", "OD Width", "Outer Width", "Inside Width", "ID Width"));
    const height = parseNum(pickCol(r, "Height", "height", "Hgt", "Depth", "OD Height", "Inside Height", "ID Height"));
    const maxWeight = parseNum(pickCol(r, "Max Weight", "MaxWeight", "max_weight", "MaxWt", "Max Wt", "Weight Limit", "WeightLimit"));
    const cost = parseNum(
      pickCol(r, "Cost", "cost", "Carton Cost", "Unit Cost", "UnitCost", "Price", "Rate"),
    );

    if (!idRaw && !name && !(length > 0) && rawNum === undefined) return;

    const id = idRaw || (rawNum !== undefined ? `PS-${rawNum}` : "");
    if (!id) { issues.push({ row, message: "Missing carton ID / Packsize Number" }); return; }
    if (!(length > 0) || !(width > 0) || !(height > 0)) {
      issues.push({ row, message: `Carton ${id}: invalid dimensions (need positive Length, Width, Height)` });
      return;
    }
    if (seen.has(id)) {
      issues.push({ row, message: `Duplicate carton ID "${id}" — skipped` });
      return;
    }
    seen.add(id);

    out.push({
      id,
      name: name || id || (rawNum !== undefined ? `Packsize ${rawNum}` : `Carton ${row}`),
      number: rawNum !== undefined ? String(rawNum).trim() : undefined,
      length,
      width,
      height,
      maxWeight: Number.isFinite(maxWeight) && maxWeight > 0 ? maxWeight : 9999,
      cost: Number.isFinite(cost) && cost >= 0 ? cost : 0,
    });
  });

  return { rows: out, issues };
}

export function readCsv(csv: string): XLSX.WorkBook {
  return XLSX.read(csv, { type: "string" });
}
