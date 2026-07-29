/**
 * 3D cubing with package rigidity / controlled deformability.
 *
 * DEFORMABLE-SHAPE APPROXIMATION
 * ------------------------------
 * The engine still places axis-aligned rectangular prisms (AABB). Flexible and
 * soft packages are modeled as a *deformable bounding envelope*: catalog L×W×H
 * may shrink independently within per-axis compression caps and a minimum
 * retained-volume ratio. Void conformity means the compressed envelope may
 * occupy irregular leftover AABB gaps; we do NOT simulate true free-form
 * bag folding, multi-lobed shapes, or penetration around obstacles.
 *
 * Rigid SKUs use exact rectangular-prism collision (zero compression).
 * Flexible/soft SKUs never overlap any placed SKU (rigid or soft).
 */

import type {
  Carton,
  CompressionRisk,
  CubingResult,
  Dim3,
  FlexPackReport,
  OrderItem,
  Orient3,
  Placement,
  RigidityClass,
  SKU,
} from "./types";
import {
  compressAxis,
  isSoftLike,
  meetsRetainedVolume,
  minCompressedCatalogDims,
  rateCompressionRisk,
  resolveMechanical,
  retainedVolumePercent,
} from "./rigidity";

export const DUNNAGE_PCT = 0.05;
/** Manufacturing / measurement give */
export const FIT_TOL = 0.1;

export const vol = (l: number, w: number, h: number) => l * w * h;

export function orientations3(sku: SKU, dims?: Dim3): Orient3[] {
  const l = dims?.length ?? sku.length;
  const w = dims?.width ?? sku.width;
  const h = dims?.height ?? sku.height;
  let raw: Orient3[] = [
    [l, w, h], [l, h, w], [w, l, h], [w, h, l], [h, l, w], [h, w, l],
  ];

  const catL = sku.length;
  const catW = sku.width;
  const catH = sku.height;
  if (sku.keepFlat) {
    const shortest = Math.min(catL, catW, catH);
    const mapUpright = (iH: number) => {
      if (Math.abs(h - iH) < 1e-6) return Math.abs(catH - shortest) < 1e-9;
      if (Math.abs(l - iH) < 1e-6) return Math.abs(catL - shortest) < 1e-9;
      if (Math.abs(w - iH) < 1e-6) return Math.abs(catW - shortest) < 1e-9;
      return false;
    };
    raw = raw.filter(([, , iH]) => mapUpright(iH));
  }
  if (sku.keepUpright) {
    raw = raw.filter(([, , iH]) => Math.abs(iH - h) < 1e-9);
  }

  const seen = new Set<string>();
  return raw.filter((p) => {
    const k = p.map((n) => n.toFixed(4)).join(",");
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function describeOrientation(
  sku: SKU,
  iL: number,
  iW: number,
  iH: number,
): { posture: "horizontal" | "vertical" | "on-side"; orientLabel: string; orientation: string } {
  const dims = [sku.length, sku.width, sku.height];
  const shortest = Math.min(...dims);
  const longest = Math.max(...dims);
  const orientation = `${fmt(iL)}×${fmt(iW)}×${fmt(iH)}`;
  const near = (a: number, b: number) =>
    Math.abs(a - b) < 0.051 || Math.abs(a - b) / Math.max(b, 0.01) < 0.08;

  let posture: "horizontal" | "vertical" | "on-side";
  if (near(iH, shortest) || iH <= Math.min(iL, iW) + 1e-6) posture = "horizontal";
  else if (near(iH, longest) || iH >= Math.max(iL, iW) - 1e-6) posture = "vertical";
  else posture = "on-side";

  const postureWord =
    posture === "horizontal" ? "Horizontal (flat)" :
    posture === "vertical" ? "Vertical (on end)" :
    "On-side";

  const baseNote =
    posture === "horizontal"
      ? `lying flat on its ${fmt(iL)}×${fmt(iW)}" face`
      : posture === "vertical"
        ? `standing on its ${fmt(iL)}×${fmt(iW)}" face`
        : `resting on its ${fmt(iL)}×${fmt(iW)}" face`;

  const orientLabel = `${postureWord} — ${baseNote}; packed height ${fmt(iH)}". Placed dims L×W×H ${orientation}"`;
  return { posture, orientLabel, orientation };
}

function fmt(n: number) {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

type Box = {
  x1: number; y1: number; z1: number;
  x2: number; y2: number; z2: number;
  weight: number;
  stackable: boolean;
  maxTopLoad?: number;
  rigidityClass: RigidityClass;
  placementIdx: number;
};

function boxOverlaps(boxes: Box[], x: number, y: number, z: number, iL: number, iW: number, iH: number) {
  return boxes.some(
    (b) =>
      x < b.x2 - 1e-9 &&
      x + iL > b.x1 + 1e-9 &&
      y < b.y2 - 1e-9 &&
      y + iW > b.y1 + 1e-9 &&
      z < b.z2 - 1e-9 &&
      z + iH > b.z1 + 1e-9,
  );
}

function supportZ(boxes: Box[], x: number, y: number, iL: number, iW: number) {
  let z = 0;
  for (const b of boxes) {
    if (x < b.x2 - 1e-9 && x + iL > b.x1 + 1e-9 && y < b.y2 - 1e-9 && y + iW > b.y1 + 1e-9) {
      z = Math.max(z, b.z2);
    }
  }
  return z;
}

function supportingBoxes(boxes: Box[], x: number, y: number, z: number, iL: number, iW: number) {
  return boxes.filter(
    (b) =>
      Math.abs(b.z2 - z) < 1e-6 &&
      x < b.x2 - 1e-9 &&
      x + iL > b.x1 + 1e-9 &&
      y < b.y2 - 1e-9 &&
      y + iW > b.y1 + 1e-9,
  );
}

function topLoadOk(
  boxes: Box[],
  x: number,
  y: number,
  z: number,
  iL: number,
  iW: number,
  itemWeight: number,
): boolean {
  if (z <= 1e-9) return true;
  const below = supportingBoxes(boxes, x, y, z, iL, iW);
  if (below.length === 0) return false;
  for (const b of below) {
    if (!b.stackable) return false;
    if (b.maxTopLoad !== undefined && itemWeight > b.maxTopLoad + 1e-9) return false;
    if (isSoftLike(b.rigidityClass) && (b.maxTopLoad === undefined || b.maxTopLoad <= 0) && itemWeight > 1e-9) {
      return false;
    }
  }
  return true;
}

type Cand = {
  x: number;
  y: number;
  z: number;
  iL: number;
  iW: number;
  iH: number;
  packed: Dim3;
  compressionPercent: Dim3;
  retainedVolumePercent: number;
  conformsToVoid: boolean;
  compressionRisk: CompressionRisk;
  totalCompression: number;
};

function buildCompressedCatalogVariants(sku: SKU): Array<{
  packed: Dim3;
  compressionPercent: Dim3;
  retainedVolumePercent: number;
}> {
  const mech = resolveMechanical(sku);
  const original = { length: sku.length, width: sku.width, height: sku.height };
  const originalVol = vol(sku.length, sku.width, sku.height);
  const max = mech.maxCompressionPercent;

  // Rigid: uncompressed only. Soft/flex: lean axis-preferring set (not full L×W×H grid).
  const rawPct: Array<{ length: number; width: number; height: number }> = [
    { length: 0, width: 0, height: 0 },
  ];
  if (mech.rigidityClass !== "rigid") {
    for (const h of [2, 5, 10, 15, 20, 25, 30]) {
      if (h <= max.height) rawPct.push({ length: 0, width: 0, height: h });
    }
    if (max.height > 0) rawPct.push({ length: 0, width: 0, height: max.height });
    for (const a of [5, 10]) {
      if (a <= max.length) rawPct.push({ length: a, width: 0, height: 0 });
      if (a <= max.width) rawPct.push({ length: 0, width: a, height: 0 });
    }
    if (mech.canConformToVoid) {
      rawPct.push(
        {
          length: Math.min(max.length, 5),
          width: Math.min(max.width, 5),
          height: Math.min(max.height, 15),
        },
        {
          length: Math.min(max.length, 10),
          width: Math.min(max.width, 10),
          height: Math.min(max.height, 20),
        },
      );
    }
  }

  const seen = new Set<string>();
  const out: Array<{
    packed: Dim3;
    compressionPercent: Dim3;
    retainedVolumePercent: number;
  }> = [];

  for (const pct of rawPct) {
    const key = `${pct.length}|${pct.width}|${pct.height}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const packed = {
      length: compressAxis(sku.length, pct.length),
      width: compressAxis(sku.width, pct.width),
      height: compressAxis(sku.height, pct.height),
    };
    const cVol = vol(packed.length, packed.width, packed.height);
    if (!meetsRetainedVolume(originalVol, cVol, mech.minimumRetainedVolumePercent)) continue;
    if (mech.minimumDimensions) {
      if (
        packed.length + 1e-9 < mech.minimumDimensions.length ||
        packed.width + 1e-9 < mech.minimumDimensions.width ||
        packed.height + 1e-9 < mech.minimumDimensions.height
      ) {
        continue;
      }
    }
    out.push({
      packed,
      compressionPercent: pct,
      retainedVolumePercent: retainedVolumePercent(originalVol, cVol),
    });
  }

  out.sort(
    (a, b) =>
      a.compressionPercent.length +
      a.compressionPercent.width +
      a.compressionPercent.height -
      (b.compressionPercent.length + b.compressionPercent.width + b.compressionPercent.height),
  );
  return out.slice(0, 12);
}

function collectCandidates(
  sku: SKU,
  boxes: Box[],
  eps: Array<[number, number, number]>,
  CL: number,
  CW: number,
  CH: number,
  tol: number,
  allowCompression: boolean,
): Cand[] {
  const mech = resolveMechanical(sku);
  const allVariants = buildCompressedCatalogVariants(sku);
  const variants = allowCompression
    ? allVariants
    : allVariants.filter(
        (v) =>
          v.compressionPercent.length +
            v.compressionPercent.width +
            v.compressionPercent.height <
          1e-9,
      );
  if (variants.length === 0) return [];

  const xySet = new Map<string, [number, number]>();
  for (const [ex, ey] of eps) xySet.set(`${ex.toFixed(4)},${ey.toFixed(4)}`, [ex, ey]);

  const baseOrients = orientations3(sku, variants[0]?.packed);

  // Extreme-point + carton-corner anchors only (no dense grid — keeps Analyze interactive)
  for (const [iL, iW] of baseOrients.map(([a, b]) => [a, b] as [number, number])) {
    for (const [ex, ey] of [
      [0, 0],
      [Math.max(0, CL - iL), 0],
      [0, Math.max(0, CW - iW)],
      [Math.max(0, CL - iL), Math.max(0, CW - iW)],
      [Math.max(0, CL / 2 - iL / 2), 0],
      [0, Math.max(0, CW / 2 - iW / 2)],
      [Math.max(0, CL / 2 - iL / 2), Math.max(0, CW / 2 - iW / 2)],
    ] as [number, number][]) {
      xySet.set(`${ex.toFixed(4)},${ey.toFixed(4)}`, [ex, ey]);
    }
  }

  const cands: Cand[] = [];
  const seen = new Set<string>();

  for (const variant of variants) {
    const orients = orientations3(sku, variant.packed).filter(
      ([iL, iW, iH]) => iL <= CL + tol && iW <= CW + tol && iH <= CH + tol,
    );
    const risk = rateCompressionRisk(variant.compressionPercent, mech.maxCompressionPercent);
    const totalCompression =
      variant.compressionPercent.length +
      variant.compressionPercent.width +
      variant.compressionPercent.height;
    const uncompressed = totalCompression < 1e-9;
    const conformsToVoid = mech.canConformToVoid && !uncompressed;

    for (const [ex, ey] of xySet.values()) {
      for (const [iL, iW, iH] of orients) {
        if (ex + iL > CL + tol || ey + iW > CW + tol) continue;
        const z = supportZ(boxes, ex, ey, iL, iW);
        if (z + iH > CH + tol) continue;
        if (boxOverlaps(boxes, ex, ey, z, iL, iW, iH)) continue;
        if (!topLoadOk(boxes, ex, ey, z, iL, iW, sku.weight)) continue;

        const key = [ex, ey, z, iL, iW, iH, totalCompression].map((n) => n.toFixed(3)).join("|");
        if (seen.has(key)) continue;
        seen.add(key);
        cands.push({
          x: ex,
          y: ey,
          z,
          iL,
          iW,
          iH,
          packed: variant.packed,
          compressionPercent: variant.compressionPercent,
          retainedVolumePercent: Math.round(variant.retainedVolumePercent * 10) / 10,
          conformsToVoid,
          compressionRisk: risk,
          totalCompression,
        });
      }
    }
  }

  return cands;
}

function rankCandidates(
  cands: Cand[],
  sku: SKU,
  mode: "stable" | "compact" | "vertical",
  CL: number,
  CW: number,
): Cand[] {
  const soft = isSoftLike(sku);
  const scored = cands.map((c) => {
    let score = c.z * 1e6 + c.y * 1e3 + c.x;
    score += c.totalCompression * 5e5;
    if (mode === "stable") score += c.iH * 10;
    if (mode === "vertical") score -= c.iH * 100;
    if (mode === "compact") score += c.iL * c.iW * 0.01;

    if (soft) {
      score -= c.z * 50;
      const corner =
        (c.x < 0.5 || c.x + c.iL > CL - 0.5) &&
        (c.y < 0.5 || c.y + c.iW > CW - 0.5);
      if (corner && c.conformsToVoid) score += 8000;
    } else {
      score += c.z * 20;
    }
    return { c, score };
  });
  scored.sort((a, b) => a.score - b.score);
  return scored.map((s) => s.c);
}

type Unit = { sku: SKU; unit: number };

function tryBacktrack(
  units: Unit[],
  CL: number,
  CW: number,
  CH: number,
  tol: number,
  mode: "stable" | "compact" | "vertical",
  branchLimit: number,
  nodeBudget: { left: number },
): Placement[] | null {
  const placements: Placement[] = [];
  const boxes: Box[] = [];
  let eps: Array<[number, number, number]> = [[0, 0, 0]];

  const placeAt = (idx: number): boolean => {
    if (nodeBudget.left-- <= 0) return false;
    if (idx >= units.length) return true;

    const { sku, unit } = units[idx];
    const mech = resolveMechanical(sku);
    // Uncompressed first — only expand deformable variants when needed
    let raw = collectCandidates(sku, boxes, eps, CL, CW, CH, tol, false);
    if (raw.length === 0 && mech.rigidityClass !== "rigid") {
      raw = collectCandidates(sku, boxes, eps, CL, CW, CH, tol, true);
    }
    const uncompressed = raw.filter((c) => c.totalCompression < 1e-9);
    const compressed = raw.filter((c) => c.totalCompression >= 1e-9);
    const rankedUnc = rankCandidates(uncompressed, sku, mode, CL, CW);
    const rankedCmp = rankCandidates(compressed, sku, mode, CL, CW);
    const cands = [...rankedUnc, ...rankedCmp].slice(0, branchLimit);
    if (cands.length === 0) return false;

    for (const cand of cands) {
      const { x, y, z, iL, iW, iH } = cand;
      const desc = describeOrientation(sku, iL, iW, iH);
      const warnings: string[] = [];
      if (mech.missingTopLoadDefaulted) {
        warnings.push("Missing maxTopLoadLb — defaulted to 0 lb; flag for engineering review");
      }
      if (cand.compressionRisk === "high") {
        warnings.push("Compression near configured maximum — product stress risk");
      }
      if (
        cand.conformsToVoid &&
        (mech.contentShiftRisk === "high" || mech.contentShiftRisk === "medium")
      ) {
        warnings.push(
          "Void conformity with content-shift risk — layout may need dunnage stabilization",
        );
      }

      placements.push({
        sku,
        unit,
        iL,
        iW,
        iH,
        x,
        y,
        z,
        layer: 0,
        orientation: desc.orientation,
        posture: desc.posture,
        orientLabel: desc.orientLabel,
        rigidityClass: mech.rigidityClass,
        originalDimensions: { length: sku.length, width: sku.width, height: sku.height },
        packedDimensions: { length: iL, width: iW, height: iH },
        compressionPercent: cand.compressionPercent,
        retainedVolumePercent: cand.retainedVolumePercent,
        topLoadLb: 0,
        conformsToVoid: cand.conformsToVoid,
        compressionRisk: cand.compressionRisk,
        engineeringWarnings: warnings,
      });

      const nb: Box = {
        x1: x,
        y1: y,
        z1: z,
        x2: x + iL,
        y2: y + iW,
        z2: z + iH,
        weight: sku.weight,
        stackable: mech.stackable,
        maxTopLoad: mech.maxTopLoadLb,
        rigidityClass: mech.rigidityClass,
        placementIdx: placements.length - 1,
      };
      boxes.push(nb);

      const prevEps = eps;
      const newEPs: Array<[number, number, number]> = [
        [nb.x2, nb.y1, nb.z1],
        [nb.x1, nb.y2, nb.z1],
        [nb.x1, nb.y1, nb.z2],
        [nb.x2, nb.y2, nb.z1],
        [nb.x2, nb.y1, nb.z2],
        [nb.x1, nb.y2, nb.z2],
        [nb.x2, nb.y2, nb.z2],
      ];
      eps = [...eps, ...newEPs].filter(
        ([px, py, pz], i, arr) =>
          px <= CL + tol &&
          py <= CW + tol &&
          pz <= CH + tol &&
          arr.findIndex(
            ([qx, qy, qz]) =>
              Math.abs(qx - px) < 1e-6 && Math.abs(qy - py) < 1e-6 && Math.abs(qz - pz) < 1e-6,
          ) === i,
      );

      if (placeAt(idx + 1)) return true;

      placements.pop();
      boxes.pop();
      eps = prevEps;
    }
    return false;
  };

  return placeAt(0) ? placements : null;
}

function buildOrderStrategies(allUnits: Unit[]): Unit[][] {
  const rigidFirst = [...allUnits].sort((a, b) => {
    const sa = isSoftLike(a.sku) ? 1 : 0;
    const sb = isSoftLike(b.sku) ? 1 : 0;
    return sa - sb || b.sku.weight - a.sku.weight;
  });
  const byVol = [...allUnits].sort(
    (a, b) =>
      vol(b.sku.length, b.sku.width, b.sku.height) - vol(a.sku.length, a.sku.width, a.sku.height),
  );
  const byWeight = [...allUnits].sort((a, b) => b.sku.weight - a.sku.weight);
  return [rigidFirst, byVol, byWeight];
}

function computeTopLoads(placements: Placement[]): void {
  for (let i = 0; i < placements.length; i++) {
    const p = placements[i];
    let load = 0;
    for (let j = 0; j < placements.length; j++) {
      if (i === j) continue;
      const q = placements[j];
      if (Math.abs(q.z - (p.z + p.iH)) > 1e-4) continue;
      const overlap =
        p.x < q.x + q.iL - 1e-9 &&
        p.x + p.iL > q.x + 1e-9 &&
        p.y < q.y + q.iW - 1e-9 &&
        p.y + p.iW > q.y + 1e-9;
      if (overlap) load += q.sku.weight;
    }
    p.topLoadLb = Math.round(load * 100) / 100;
    const mech = resolveMechanical(p.sku);
    if (isSoftLike(p.sku) && load > (mech.maxTopLoadLb ?? 0) + 1e-9) {
      p.engineeringWarnings.push(
        `Top load ${load.toFixed(1)} lb exceeds maxTopLoadLb ${mech.maxTopLoadLb ?? 0} lb`,
      );
    }
    if (isSoftLike(p.sku) && load > 0 && p.rigidityClass === "soft_bag") {
      p.engineeringWarnings.push(
        "Soft package supporting load — prefer rigid base under soft bags",
      );
    }
  }
}

function shapeRecoveryRisk(p: Placement): boolean {
  return (
    isSoftLike(p.sku) &&
    p.compressionRisk !== "none" &&
    p.compressionRisk !== "low" &&
    p.conformsToVoid
  );
}

function emptyFail(cv: number, failReason: string): CubingResult {
  return {
    fits: false,
    failReason,
    mechanicalReviewRequired: false,
    mechanicalStatus: "ok",
    mechanicalWarnings: [],
    placements: [],
    flexReports: [],
    layers: 0,
    itemVolume: 0,
    cartonVolume: Math.round(cv),
    utilization: 0,
    voidPct: 100,
    dunnage5Pct: Math.round(cv * DUNNAGE_PCT),
    cgRel: { x: 0.5, y: 0.5, z: 0.5 },
    weightBalance: "Unknown",
    layerGroups: [],
  };
}

export function cubePack(
  orderItems: OrderItem[],
  c: Carton,
  options?: { nodeBudget?: number },
): CubingResult {
  const CL = c.length;
  const CW = c.width;
  const CH = c.height;
  const cv = CL * CW * CH;
  const tol = FIT_TOL;

  const allUnits: Unit[] = [];
  for (const { sku, qty } of orderItems) {
    for (let u = 0; u < qty; u++) allUnits.push({ sku, unit: u });
  }
  if (allUnits.length === 0) {
    return {
      ...emptyFail(cv, "Empty order"),
      fits: true,
      utilization: 0,
      voidPct: 100,
      failReason: undefined,
    };
  }

  const totalWeight = allUnits.reduce((s, u) => s + u.sku.weight, 0);
  if (c.maxWeight > 0 && totalWeight > c.maxWeight) {
    return emptyFail(
      cv,
      `Weight exceeded — order ${totalWeight.toFixed(1)} lb exceeds ${c.maxWeight} lb carton limit`,
    );
  }

  // Fast volume reject using minimum retained volumes
  const minItemVol = allUnits.reduce((s, u) => s + minCompressedCatalogDims(u.sku).volume, 0);
  if (minItemVol > cv + 1e-6) {
    return emptyFail(
      cv,
      `Combined item volume (${Math.round(minItemVol).toLocaleString()} in³) exceeds carton capacity (${Math.round(cv).toLocaleString()} in³)`,
    );
  }

  for (const { sku } of allUnits) {
    const minDims = minCompressedCatalogDims(sku);
    const valid = orientations3(sku, minDims).filter(
      ([iL, iW, iH]) => iL <= CL + tol && iW <= CW + tol && iH <= CH + tol,
    );
    if (valid.length === 0) {
      return emptyFail(
        cv,
        `Dimension exceeded — "${sku.name}" cannot fit even at max allowed compression / retained volume`,
      );
    }
  }

  const nodeBudgetTotal =
    options?.nodeBudget ?? Math.min(4500, 450 * allUnits.length * 3);
  const modes: Array<"stable" | "compact" | "vertical"> =
    nodeBudgetTotal < 1000 ? ["vertical", "stable"] : ["vertical", "stable", "compact"];
  const strategies = buildOrderStrategies(allUnits);
  const branchLimit = Math.min(5, Math.max(3, 7 - Math.floor(allUnits.length / 4)));

  let rawPlacements: Placement[] | null = null;
  const budget = { left: nodeBudgetTotal };

  outer: for (const mode of modes) {
    for (const order of strategies) {
      const found = tryBacktrack(order, CL, CW, CH, tol, mode, branchLimit, budget);
      if (found) {
        rawPlacements = found;
        break outer;
      }
      if (budget.left <= 0) break outer;
    }
  }

  if (!rawPlacements) {
    const itemVol = allUnits.reduce((s, u) => s + vol(u.sku.length, u.sku.width, u.sku.height), 0);
    return emptyFail(
      cv,
      itemVol > cv
        ? `Combined item volume (${Math.round(itemVol).toLocaleString()} in³) exceeds carton capacity (${Math.round(cv).toLocaleString()} in³)`
        : "No valid arrangement within allowed compression, retained volume, orientation, and top-load limits",
    );
  }

  computeTopLoads(rawPlacements);

  for (const p of rawPlacements) {
    const mech = resolveMechanical(p.sku);
    if (!mech.stackable && p.topLoadLb > 1e-9) {
      return emptyFail(
        cv,
        `Non-stackable package "${p.sku.name}" cannot support ${p.topLoadLb} lb top load`,
      );
    }
    if (mech.maxTopLoadLb !== undefined && p.topLoadLb > mech.maxTopLoadLb + 1e-9) {
      return emptyFail(
        cv,
        `Top-load limit exceeded on "${p.sku.name}" — ${p.topLoadLb} lb > ${mech.maxTopLoadLb} lb`,
      );
    }
  }

  const uniqueZs = [...new Set(rawPlacements.map((p) => Math.round(p.z * 1000) / 1000))].sort(
    (a, b) => a - b,
  );
  const zToLayer = new Map(uniqueZs.map((z, i) => [z, i]));
  const placements = rawPlacements.map((p) => ({
    ...p,
    layer: zToLayer.get(Math.round(p.z * 1000) / 1000) ?? 0,
  }));

  const itemVolume = placements.reduce((s, p) => s + p.iL * p.iW * p.iH, 0);
  const utilization = itemVolume / cv;
  const voidPct = Math.round((1 - utilization) * 100);
  const layers = uniqueZs.length;

  const wTotal = placements.reduce((s, p) => s + p.sku.weight, 0);
  const cgRel =
    wTotal > 0
      ? {
          x: placements.reduce((s, p) => s + p.sku.weight * (p.x + p.iL / 2), 0) / wTotal / CL,
          y: placements.reduce((s, p) => s + p.sku.weight * (p.y + p.iW / 2), 0) / wTotal / CW,
          z: placements.reduce((s, p) => s + p.sku.weight * (p.z + p.iH / 2), 0) / wTotal / CH,
        }
      : { x: 0.5, y: 0.5, z: 0.5 };

  const weightBalance =
    cgRel.z > 0.6
      ? "Top-heavy — reorder layers"
      : Math.abs(cgRel.x - 0.5) > 0.2
        ? cgRel.x < 0.5
          ? "Left-biased"
          : "Right-biased"
        : Math.abs(cgRel.y - 0.5) > 0.2
          ? cgRel.y < 0.5
            ? "Front-biased"
            : "Back-biased"
          : "Well-balanced";

  const mechanicalWarnings: string[] = [];
  for (const p of placements) {
    for (const w of p.engineeringWarnings) {
      if (!mechanicalWarnings.includes(w)) mechanicalWarnings.push(w);
    }
    if (p.compressionRisk === "high") {
      mechanicalWarnings.push(`High compression on ${p.sku.id} unit ${p.unit + 1}`);
    }
    if (shapeRecoveryRisk(p)) {
      mechanicalWarnings.push(
        `Shape-recovery movement risk on ${p.sku.id} — compressed void fill may expand under vibration`,
      );
    }
  }

  const mechanicalReviewRequired =
    placements.some(
      (p) =>
        p.compressionRisk === "high" ||
        p.compressionRisk === "medium" ||
        resolveMechanical(p.sku).missingTopLoadDefaulted ||
        shapeRecoveryRisk(p) ||
        (isSoftLike(p.sku) && p.topLoadLb > 0),
    ) || mechanicalWarnings.some((w) => /defaulted|High compression|Shape-recovery|Top load/i.test(w));

  const flexReports: FlexPackReport[] = placements
    .filter((p) => p.rigidityClass !== "rigid")
    .map((p) => ({
      skuId: p.sku.id,
      unit: p.unit,
      rigidityClass: p.rigidityClass,
      originalDimensions: p.originalDimensions,
      packedDimensions: { length: p.iL, width: p.iW, height: p.iH },
      compressionPercent: p.compressionPercent,
      retainedVolumePercent: p.retainedVolumePercent,
      topLoadLb: p.topLoadLb,
      conformsToVoid: p.conformsToVoid,
      compressionRisk: p.compressionRisk,
      placement: { x: p.x, y: p.y, z: p.z },
      warnings: p.engineeringWarnings,
    }));

  const lMap = new Map<number, CubingResult["layerGroups"][0]["items"]>();
  const lZ = new Map<number, number>();
  const lH = new Map<number, number>();
  for (const p of placements) {
    if (!lMap.has(p.layer)) lMap.set(p.layer, []);
    lMap.get(p.layer)!.push({
      name: p.sku.name,
      orient: p.orientation,
      posture: p.posture,
      orientLabel: p.orientLabel,
      weight: p.sku.weight,
      rigidityClass: p.rigidityClass,
      compressionRisk: p.compressionRisk,
    });
    if (!lZ.has(p.layer)) lZ.set(p.layer, p.z);
    lH.set(p.layer, Math.max(lH.get(p.layer) ?? 0, p.iH));
  }
  const layerGroups = [...lMap.entries()]
    .sort(([a], [b]) => a - b)
    .map(([layer, items]) => ({
      layer: layer + 1,
      items,
      zStart: Math.round((lZ.get(layer) ?? 0) * 10) / 10,
      height: Math.round((lH.get(layer) ?? 0) * 10) / 10,
    }));

  return {
    fits: true,
    mechanicalReviewRequired,
    mechanicalStatus: mechanicalReviewRequired ? "review_required" : "ok",
    mechanicalWarnings,
    placements,
    flexReports,
    layers,
    itemVolume: Math.round(itemVolume),
    cartonVolume: Math.round(cv),
    utilization,
    voidPct,
    dunnage5Pct: Math.round(cv * DUNNAGE_PCT),
    cgRel,
    weightBalance,
    layerGroups,
  };
}

export { inferRigidityClass, resolveMechanical, minCompressedCatalogDims } from "./rigidity";
