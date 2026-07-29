import type { ProductMechanicalProperties, RigidityClass, SKU } from "./types";

/** Conservative class defaults — used only when SKU omits mechanical data. */
export const RIGIDITY_DEFAULTS: Record<
  RigidityClass,
  Omit<ProductMechanicalProperties, "rigidityClass"> & {
    minimumRetainedVolumePercent: number;
  }
> = {
  rigid: {
    maxCompressionPercent: { length: 0, width: 0, height: 0 },
    canConformToVoid: false,
    stackable: true,
    minimumRetainedVolumePercent: 100,
  },
  semi_rigid: {
    maxCompressionPercent: { length: 2, width: 2, height: 5 },
    canConformToVoid: false,
    stackable: true,
    minimumRetainedVolumePercent: 95,
  },
  flexible: {
    maxCompressionPercent: { length: 5, width: 5, height: 15 },
    canConformToVoid: true,
    stackable: false,
    maxTopLoadLb: 0,
    contentShiftRisk: "medium",
    minimumRetainedVolumePercent: 85,
  },
  soft_bag: {
    maxCompressionPercent: { length: 10, width: 10, height: 30 },
    canConformToVoid: true,
    stackable: false,
    maxTopLoadLb: 0,
    contentShiftRisk: "high",
    minimumRetainedVolumePercent: 70,
  },
};

/** Compression search increments (% of catalog axis). */
export const COMPRESSION_STEP_PCT = 5;
/** Finer step near zero for modest-compression fits. */
export const COMPRESSION_FINE_STEPS = [0, 2, 5];

export function inferRigidityClass(sku: Pick<SKU, "rigidityClass" | "packageType" | "mechanical">): RigidityClass {
  if (sku.mechanical?.rigidityClass) return sku.mechanical.rigidityClass;
  if (sku.rigidityClass) return sku.rigidityClass;
  const pt = (sku.packageType ?? "").toLowerCase();
  if (/\b(soft\s*bag|pouch|polybag|mailer)\b/.test(pt)) return "soft_bag";
  if (/\b(flex|flexible|bag|film|wrap)\b/.test(pt)) return "flexible";
  if (/\b(semi[- ]?rigid|clamshell|blister|tray)\b/.test(pt)) return "semi_rigid";
  return "rigid";
}

/**
 * Resolve full mechanical properties with SKU overrides on top of class defaults.
 * Missing soft/flexible maxTopLoadLb defaults to 0 and is flagged by callers for review.
 */
export function resolveMechanical(sku: SKU): ProductMechanicalProperties & {
  minimumRetainedVolumePercent: number;
  missingTopLoadDefaulted: boolean;
} {
  const rigidityClass = inferRigidityClass(sku);
  const base = RIGIDITY_DEFAULTS[rigidityClass];
  const m = sku.mechanical;

  const maxCompressionPercent = {
    length: m?.maxCompressionPercent?.length ?? base.maxCompressionPercent.length,
    width: m?.maxCompressionPercent?.width ?? base.maxCompressionPercent.width,
    height: m?.maxCompressionPercent?.height ?? base.maxCompressionPercent.height,
  };

  const stackable =
    m?.stackable ??
    sku.stackable ??
    base.stackable;

  const explicitTopLoad =
    m?.maxTopLoadLb !== undefined || sku.maxTopLoad !== undefined;
  let maxTopLoadLb = m?.maxTopLoadLb ?? sku.maxTopLoad ?? base.maxTopLoadLb;
  let missingTopLoadDefaulted = false;
  if (
    (rigidityClass === "soft_bag" || rigidityClass === "flexible") &&
    !explicitTopLoad
  ) {
    maxTopLoadLb = maxTopLoadLb ?? 0;
    missingTopLoadDefaulted = true;
  }

  return {
    rigidityClass,
    maxCompressionPercent,
    minimumDimensions: m?.minimumDimensions,
    canConformToVoid: m?.canConformToVoid ?? base.canConformToVoid,
    stackable,
    maxTopLoadLb,
    contentShiftRisk: m?.contentShiftRisk ?? base.contentShiftRisk,
    minimumRetainedVolumePercent:
      m?.minimumRetainedVolumePercent ?? base.minimumRetainedVolumePercent,
    missingTopLoadDefaulted,
  };
}

export function isDeformable(classOrSku: RigidityClass | SKU): boolean {
  const c =
    typeof classOrSku === "string" ? classOrSku : inferRigidityClass(classOrSku);
  return c === "flexible" || c === "soft_bag" || c === "semi_rigid";
}

export function isSoftLike(classOrSku: RigidityClass | SKU): boolean {
  const c =
    typeof classOrSku === "string" ? classOrSku : inferRigidityClass(classOrSku);
  return c === "flexible" || c === "soft_bag";
}

export function compressAxis(original: number, compressionPercent: number): number {
  return original * (1 - compressionPercent / 100);
}

export function retainedVolumePercent(
  originalVol: number,
  compressedVol: number,
): number {
  if (originalVol <= 0) return 100;
  return (compressedVol / originalVol) * 100;
}

export function compressionWithinLimits(
  pct: { length: number; width: number; height: number },
  max: { length: number; width: number; height: number },
): boolean {
  return (
    pct.length >= -1e-9 &&
    pct.width >= -1e-9 &&
    pct.height >= -1e-9 &&
    pct.length <= max.length + 1e-9 &&
    pct.width <= max.width + 1e-9 &&
    pct.height <= max.height + 1e-9
  );
}

export function meetsMinimumDims(
  dims: { length: number; width: number; height: number },
  minimum?: { length: number; width: number; height: number },
): boolean {
  if (!minimum) return true;
  return (
    dims.length + 1e-9 >= minimum.length &&
    dims.width + 1e-9 >= minimum.width &&
    dims.height + 1e-9 >= minimum.height
  );
}

export function meetsRetainedVolume(
  originalVol: number,
  compressedVol: number,
  minimumRetainedVolumePercent: number,
): boolean {
  return compressedVol + 1e-9 >= (originalVol * minimumRetainedVolumePercent) / 100;
}

/** Build discrete compression % triples within per-axis caps and volume floor. */
export function enumerateCompressionTriples(
  maxPct: { length: number; width: number; height: number },
  originalVol: number,
  minRetainedPct: number,
  original: { length: number; width: number; height: number },
  minimumDimensions?: { length: number; width: number; height: number },
): Array<{ length: number; width: number; height: number }> {
  const axisSteps = (max: number): number[] => {
    if (max <= 0) return [0];
    const set = new Set<number>([0]);
    for (const s of COMPRESSION_FINE_STEPS) {
      if (s <= max) set.add(s);
    }
    for (let s = COMPRESSION_STEP_PCT; s <= max + 1e-9; s += COMPRESSION_STEP_PCT) {
      set.add(Math.min(max, Math.round(s * 10) / 10));
    }
    set.add(max);
    return [...set].sort((a, b) => a - b);
  };

  const Ls = axisSteps(maxPct.length);
  const Ws = axisSteps(maxPct.width);
  const Hs = axisSteps(maxPct.height);
  const out: Array<{ length: number; width: number; height: number }> = [];

  for (const length of Ls) {
    for (const width of Ws) {
      for (const height of Hs) {
        const dims = {
          length: compressAxis(original.length, length),
          width: compressAxis(original.width, width),
          height: compressAxis(original.height, height),
        };
        const cVol = dims.length * dims.width * dims.height;
        if (!meetsRetainedVolume(originalVol, cVol, minRetainedPct)) continue;
        if (!meetsMinimumDims(dims, minimumDimensions)) continue;
        out.push({ length, width, height });
      }
    }
  }

  // Prefer less total compression first
  out.sort(
    (a, b) => a.length + a.width + a.height - (b.length + b.width + b.height),
  );
  return out;
}

export type CompressionRisk = "none" | "low" | "medium" | "high";

export function rateCompressionRisk(
  pct: { length: number; width: number; height: number },
  max: { length: number; width: number; height: number },
): CompressionRisk {
  const ratios = (
    [
      ["length", pct.length, max.length],
      ["width", pct.width, max.width],
      ["height", pct.height, max.height],
    ] as const
  ).map(([, p, m]) => (m <= 0 ? 0 : p / m));
  const peak = Math.max(0, ...ratios);
  if (peak <= 0) return "none";
  if (peak < 0.4) return "low";
  if (peak < 0.75) return "medium";
  return "high";
}

/**
 * Minimum catalog envelope after max legal compression (for soft pre-filter only).
 * Physical fit still requires full 3D cubing.
 */
export function minCompressedCatalogDims(sku: SKU): {
  length: number;
  width: number;
  height: number;
  volume: number;
} {
  const mech = resolveMechanical(sku);
  const pct = mech.maxCompressionPercent;
  let length = compressAxis(sku.length, pct.length);
  let width = compressAxis(sku.width, pct.width);
  let height = compressAxis(sku.height, pct.height);
  if (mech.minimumDimensions) {
    length = Math.max(length, mech.minimumDimensions.length);
    width = Math.max(width, mech.minimumDimensions.width);
    height = Math.max(height, mech.minimumDimensions.height);
  }
  let volume = length * width * height;
  const orig = sku.length * sku.width * sku.height;
  const floor = (orig * mech.minimumRetainedVolumePercent) / 100;
  if (volume < floor) {
    // Scale up uniformly to meet volume floor without exceeding originals
    const scale = Math.cbrt(floor / Math.max(volume, 1e-9));
    length = Math.min(sku.length, length * scale);
    width = Math.min(sku.width, width * scale);
    height = Math.min(sku.height, height * scale);
    volume = length * width * height;
  }
  return { length, width, height, volume };
}
