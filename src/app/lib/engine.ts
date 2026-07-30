import type {
  Carton,
  CubingResult,
  EngineeringScore,
  FragilityLevel,
  MinRequired,
  OrderItem,
  RankedOption,
} from "./types";
import { cubePack, DUNNAGE_PCT, FIT_TOL, vol, minCompressedCatalogDims } from "./packing";
import { isSoftLike, resolveMechanical } from "./rigidity";

export { DUNNAGE_PCT, FIT_TOL, cubePack, vol, describeOrientation, orientations3, resolveMechanical, inferRigidityClass, minCompressedCatalogDims } from "./packing";
export { parseWorkbookToSKUs, parseWorkbookToCartons, readCsv, pickCol } from "./parsers";
export type * from "./types";

export const FRAGILITY_MULT: Record<FragilityLevel, number> = { Low: 1.0, Medium: 1.2, High: 1.5 };

export const UTIL_MIN = 0.8;
export const UTIL_MAX = 0.92;
export const UTIL_IDEAL_LOW = 0.85;
export const UTIL_IDEAL_HIGH = 0.9;

const W = {
  damagePrevention: 0.28,
  movementPrevention: 0.18,
  dunnageReduction: 0.12,
  cartonSizeOpt: 0.08,
  packRepeatability: 0.08,
  laborEfficiency: 0.04,
  /** Inverse of risk scores (100 - risk) */
  flexMechanical: 0.12,
  voidConformity: 0.05,
  shapeRecovery: 0.05,
};

function emptyScore(partial?: Partial<EngineeringScore>): EngineeringScore {
  return {
    utilization: 0,
    dimWeight: 0,
    shipping: 0,
    fragility: 0,
    sustainability: 0,
    total: 0,
    damagePrevention: 0,
    movementPrevention: 0,
    dunnageReduction: 0,
    cartonSizeOpt: 0,
    packRepeatability: 0,
    laborEfficiency: 0,
    damageRisk: 100,
    movementRisk: 100,
    flexiblePackageCompressionRisk: 0,
    softPackageTopLoadRisk: 0,
    contentMigrationRisk: 0,
    voidConformityBenefit: 0,
    shapeRecoveryMovementRisk: 0,
    voidPct: 100,
    dunnageVolEst: 0,
    layers: 0,
    fitStatus: "no-fit",
    fitReasons: [],
    mechanicalReviewRequired: false,
    ...partial,
  };
}

export const dimW = (l: number, w: number, h: number) => (l * w * h) / 139;

export function orderTotals(items: OrderItem[]) {
  let tv = 0;
  let tw = 0;
  let maxF: FragilityLevel = "Low";
  items.forEach(({ sku, qty }) => {
    tv += vol(sku.length, sku.width, sku.height) * qty;
    tw += sku.weight * qty;
    if (FRAGILITY_MULT[sku.fragility] > FRAGILITY_MULT[maxF]) maxF = sku.fragility;
  });
  return { tv, tw, maxF };
}

export const sortedByVol = (cartons: Carton[]) =>
  [...cartons].sort((a, b) => vol(a.length, a.width, a.height) - vol(b.length, b.width, b.height));

export function minRequiredDims(items: OrderItem[]): MinRequired {
  let e0 = 0;
  let e1 = 0;
  let e2 = 0;
  let tv = 0;
  let tw = 0;
  let units = 0;
  for (const { sku, qty } of items) {
    // Soft pre-filter uses minimum legal compressed envelope so deformable SKUs
    // are not falsely excluded; physical fit still requires cubePack.
    const min = minCompressedCatalogDims(sku);
    const d = [min.length, min.width, min.height].sort((a, b) => b - a) as [number, number, number];
    e0 = Math.max(e0, d[0]);
    e1 = Math.max(e1, d[1]);
    e2 = Math.max(e2, d[2]);
    tv += min.volume * qty;
    tw += sku.weight * qty;
    units += qty;
  }
  return { itemEnvelope: [e0, e1, e2], totalVolume: tv, totalWeight: tw, unitCount: units };
}

/** Soft pre-filter only — never the sole fit decision. */
export function cartonPassesEnvelope(c: Carton, req: MinRequired): boolean {
  if (c.maxWeight > 0 && req.totalWeight > c.maxWeight) return false;
  const cd = [c.length, c.width, c.height].sort((a, b) => b - a);
  if (
    cd[0] + FIT_TOL < req.itemEnvelope[0] ||
    cd[1] + FIT_TOL < req.itemEnvelope[1] ||
    cd[2] + FIT_TOL < req.itemEnvelope[2]
  ) {
    return false;
  }
  if (vol(c.length, c.width, c.height) + 1e-9 < req.totalVolume) return false;
  return true;
}

export function cartonFits(c: Carton, items: OrderItem[], _tv: number, tw: number): boolean {
  if (c.maxWeight > 0 && tw > c.maxWeight) return false;
  return cubePack(items, c).fits;
}

export function calcManhattan(items: OrderItem[], cartons: Carton[]): Carton {
  const { tv, tw } = orderTotals(items);
  const sorted = sortedByVol(cartons);
  return (
    sorted.find((c) => {
      if (!cartonFits(c, items, tv, tw)) return false;
      const r = cubePack(items, c);
      return r.utilization >= UTIL_MIN && r.utilization <= UTIL_MAX;
    }) ??
    sorted.find((c) => cartonFits(c, items, tv, tw)) ??
    sorted[sorted.length - 1]
  );
}

export interface CustomCartonThresholds {
  /** Minimum engineering score points above Packsize (absolute) */
  minScoreImprovement: number;
  /** Minimum total packaging cost reduction (%) */
  minPackagingCostReductionPct: number;
  /** Minimum allocated transportation-space cost reduction (%) */
  minTransportCostReductionPct: number;
  /** Minimum cube utilization improvement (percentage points) */
  minUtilImprovementPoints: number;
  /** Minimum paper dunnage / void reduction (%) */
  minDunnageReductionPct: number;
  /** Minimum damage-risk score reduction (%) */
  minDamageRiskReductionPct: number;
  /** $/in³ used to estimate allocated trailer-space cost (not invoice freight) */
  transportCostPerCuIn: number;
}

export const DEFAULT_CUSTOM_THRESHOLDS: CustomCartonThresholds = {
  minScoreImprovement: 5,
  minPackagingCostReductionPct: 5,
  minTransportCostReductionPct: 5,
  minUtilImprovementPoints: 5,
  minDunnageReductionPct: 10,
  minDamageRiskReductionPct: 10,
  transportCostPerCuIn: 0.00085,
};

export interface CustomVsPacksizeComparison {
  scoreDelta: number;
  packagingCostSavings: number;
  packagingCostReductionPct: number | null;
  transportCostPacksize: number;
  transportCostCustom: number;
  transportCostSavings: number;
  transportCostReductionPct: number | null;
  utilImprovementPoints: number;
  dunnageReductionPct: number | null;
  damageRiskReductionPct: number | null;
  movementRiskReduction: number;
  cgImproved: boolean;
  weightBalanceImproved: boolean;
  corrugatedAreaReductionPct: number | null;
  meaningfulImprovements: string[];
  thresholdHits: string[];
  /** custom.total > packsize.total */
  beatsPacksizeScore: boolean;
  /** Passes score gate + at least one threshold */
  qualifies: boolean;
  summary: string;
}

export interface CustomCartonRecommendation {
  carton: Carton;
  score: EngineeringScore;
  cubing: CubingResult;
  /** Why a custom size was proposed / why it wins */
  reason: string;
  comparison: CustomVsPacksizeComparison;
}

export type CustomCartonDecision =
  | { status: "recommended"; recommendation: CustomCartonRecommendation }
  | { status: "evaluated-not-beneficial"; candidate: CustomCartonRecommendation | null }
  | { status: "not-evaluated" };

/** True when cube utilization is outside the 80–92% preferred band. */
export function isOutsidePreferredUtil(score: Pick<EngineeringScore, "utilization">): boolean {
  const u = score.utilization / 100;
  return u < UTIL_MIN - 1e-9 || u > UTIL_MAX + 1e-9;
}

function cartonSurfaceIn2(c: Pick<Carton, "length" | "width" | "height">): number {
  const { length: l, width: w, height: h } = c;
  return 2 * (l * w + l * h + w * h);
}

function pctReduction(before: number, after: number): number | null {
  if (!Number.isFinite(before) || before <= 0) return null;
  return ((before - after) / before) * 100;
}

/**
 * Compare a custom carton against the best Packsize pick.
 * Custom is recommended only when its engineering score is strictly higher
 * AND at least one configurable improvement threshold is met.
 */
export function evaluateCustomVsPacksize(
  packsize: { carton: Carton; score: EngineeringScore; cubing: CubingResult },
  custom: { carton: Carton; score: EngineeringScore; cubing: CubingResult },
  thresholds: CustomCartonThresholds = DEFAULT_CUSTOM_THRESHOLDS,
): CustomVsPacksizeComparison {
  const ps = packsize.score;
  const cs = custom.score;
  const scoreDelta = cs.total - ps.total;
  const beatsPacksizeScore = scoreDelta > 0;

  const packagingCostSavings = Math.max(0, packsize.carton.cost - custom.carton.cost);
  const packagingCostReductionPct = pctReduction(packsize.carton.cost, custom.carton.cost);

  const volPs = vol(packsize.carton.length, packsize.carton.width, packsize.carton.height);
  const volCu = vol(custom.carton.length, custom.carton.width, custom.carton.height);
  const transportCostPacksize = volPs * thresholds.transportCostPerCuIn;
  const transportCostCustom = volCu * thresholds.transportCostPerCuIn;
  const transportCostSavings = Math.max(0, transportCostPacksize - transportCostCustom);
  const transportCostReductionPct = pctReduction(transportCostPacksize, transportCostCustom);

  const utilImprovementPoints = cs.utilization - ps.utilization;
  const dunnageReductionPct = pctReduction(ps.voidPct, cs.voidPct);
  const damageRiskReductionPct = pctReduction(ps.damageRisk, cs.damageRisk);
  const movementRiskReduction = ps.movementRisk - cs.movementRisk;

  const cgZPs = packsize.cubing.cgRel.z;
  const cgZCu = custom.cubing.cgRel.z;
  // Prefer CG closer to ~0.35 (same target used in scoring)
  const cgImproved = Math.abs(cgZCu - 0.35) + 1e-9 < Math.abs(cgZPs - 0.35);
  const weightBalanceImproved =
    custom.cubing.weightBalance === "Well-balanced" &&
    packsize.cubing.weightBalance !== "Well-balanced";

  const surfPs = cartonSurfaceIn2(packsize.carton);
  const surfCu = cartonSurfaceIn2(custom.carton);
  const corrugatedAreaReductionPct = pctReduction(surfPs, surfCu);

  const meaningfulImprovements: string[] = [];
  if (packagingCostSavings > 0.01) meaningfulImprovements.push("lower packaging cost");
  if (transportCostSavings > 1e-9) meaningfulImprovements.push("lower transportation-space cost");
  if ((corrugatedAreaReductionPct ?? 0) > 0.5) meaningfulImprovements.push("lower corrugated cost");
  if ((dunnageReductionPct ?? 0) > 0.5) meaningfulImprovements.push("lower paper dunnage usage");
  if (movementRiskReduction > 0.5) meaningfulImprovements.push("lower movement risk");
  if ((damageRiskReductionPct ?? 0) > 0.5) meaningfulImprovements.push("lower damage risk");
  if (weightBalanceImproved) meaningfulImprovements.push("better weight distribution");
  if (cgImproved) meaningfulImprovements.push("better center of gravity");
  if (custom.cubing.layers < packsize.cubing.layers) meaningfulImprovements.push("better load path");
  if (utilImprovementPoints > 0.5) meaningfulImprovements.push("better cube utilization");

  const thresholdHits: string[] = [];
  if (scoreDelta >= thresholds.minScoreImprovement) {
    thresholdHits.push(`engineering score +${Math.round(scoreDelta)} pts`);
  }
  if (
    packagingCostReductionPct != null &&
    packagingCostReductionPct >= thresholds.minPackagingCostReductionPct
  ) {
    thresholdHits.push(`packaging cost −${Math.round(packagingCostReductionPct)}%`);
  }
  if (
    transportCostReductionPct != null &&
    transportCostReductionPct >= thresholds.minTransportCostReductionPct
  ) {
    thresholdHits.push(`transportation cost −${Math.round(transportCostReductionPct)}%`);
  }
  if (utilImprovementPoints >= thresholds.minUtilImprovementPoints) {
    thresholdHits.push(`cube utilization +${Math.round(utilImprovementPoints)} pts`);
  }
  if (dunnageReductionPct != null && dunnageReductionPct >= thresholds.minDunnageReductionPct) {
    thresholdHits.push(`paper dunnage −${Math.round(dunnageReductionPct)}%`);
  }
  if (
    damageRiskReductionPct != null &&
    damageRiskReductionPct >= thresholds.minDamageRiskReductionPct
  ) {
    thresholdHits.push(`damage risk −${Math.round(damageRiskReductionPct)}%`);
  }

  const qualifies =
    beatsPacksizeScore &&
    thresholdHits.length > 0 &&
    meaningfulImprovements.length > 0;

  const parts: string[] = [];
  if (scoreDelta > 0) parts.push(`improves the engineering score by ${Math.round(scoreDelta)} points`);
  if (transportCostReductionPct != null && transportCostReductionPct > 0.5) {
    parts.push(`reduces transportation cost by ${Math.round(transportCostReductionPct)}%`);
  }
  if (dunnageReductionPct != null && dunnageReductionPct > 0.5) {
    parts.push(`reduces paper dunnage by ${Math.round(dunnageReductionPct)}%`);
  }
  if (packagingCostSavings > 0.01) {
    parts.push(`lowers total packaging cost by $${packagingCostSavings.toFixed(2)} per shipment`);
  }
  if (utilImprovementPoints > 0.5) {
    parts.push(`improves cube utilization by ${Math.round(utilImprovementPoints)} points`);
  }
  if (damageRiskReductionPct != null && damageRiskReductionPct > 0.5) {
    parts.push(`lowers damage risk by ${Math.round(damageRiskReductionPct)}%`);
  }

  const summary =
    parts.length === 0
      ? "Custom carton was evaluated against the Packsize recommendation."
      : `Custom carton recommended because it ${parts.join(", ")}.`;

  return {
    scoreDelta,
    packagingCostSavings,
    packagingCostReductionPct,
    transportCostPacksize,
    transportCostCustom,
    transportCostSavings,
    transportCostReductionPct,
    utilImprovementPoints,
    dunnageReductionPct,
    damageRiskReductionPct,
    movementRiskReduction,
    cgImproved,
    weightBalanceImproved,
    corrugatedAreaReductionPct,
    meaningfulImprovements,
    thresholdHits,
    beatsPacksizeScore,
    qualifies,
    summary,
  };
}

/**
 * Decide whether to present a custom carton vs the best Packsize pick.
 */
export function decideCustomCarton(
  packsize: { carton: Carton; score: EngineeringScore; cubing: CubingResult },
  customCandidate: { carton: Carton; score: EngineeringScore; cubing: CubingResult } | null,
  thresholds: CustomCartonThresholds = DEFAULT_CUSTOM_THRESHOLDS,
): CustomCartonDecision {
  if (!customCandidate) return { status: "not-evaluated" };

  const sameDims =
    Math.abs(customCandidate.carton.length - packsize.carton.length) < 0.05 &&
    Math.abs(customCandidate.carton.width - packsize.carton.width) < 0.05 &&
    Math.abs(customCandidate.carton.height - packsize.carton.height) < 0.05;
  if (sameDims) {
    return {
      status: "evaluated-not-beneficial",
      candidate: {
        ...customCandidate,
        reason: "Custom size matched Packsize dimensions — no advantage.",
        comparison: evaluateCustomVsPacksize(packsize, customCandidate, thresholds),
      },
    };
  }

  const comparison = evaluateCustomVsPacksize(packsize, customCandidate, thresholds);
  const recommendation: CustomCartonRecommendation = {
    ...customCandidate,
    reason: comparison.summary,
    comparison,
  };

  if (comparison.qualifies) {
    return { status: "recommended", recommendation };
  }
  return { status: "evaluated-not-beneficial", candidate: recommendation };
}

function roundCartonDim(inches: number, step = 0.25): number {
  return Math.max(step, Math.ceil(inches / step - 1e-9) * step);
}

function estimateCustomCost(volumeIn3: number, catalog: Carton[]): number {
  const priced = catalog.filter((c) => c.cost > 0 && vol(c.length, c.width, c.height) > 0);
  if (priced.length === 0) return 0;
  const rates = priced.map((c) => c.cost / vol(c.length, c.width, c.height)).sort((a, b) => a - b);
  const mid = rates[Math.floor(rates.length / 2)]!;
  return Math.round(mid * volumeIn3 * 100) / 100;
}

function makeCustomCarton(
  length: number,
  width: number,
  height: number,
  items: OrderItem[],
  catalog: Carton[],
): Carton {
  const L = roundCartonDim(length);
  const W = roundCartonDim(width);
  const H = roundCartonDim(height);
  const { tw } = orderTotals(items);
  const v = vol(L, W, H);
  return {
    id: `CUSTOM-${L}x${W}x${H}`,
    name: `Custom ${L}×${W}×${H}`,
    number: "CUSTOM",
    length: L,
    width: W,
    height: H,
    maxWeight: Math.max(tw * 1.5, 50),
    cost: estimateCustomCost(v, catalog),
  };
}

/**
 * Derive a made-to-order carton sized into the ideal 85–90% utilization band
 * from a successful 3D pack-out (typically the Packsize AI arrangement).
 */
export function suggestCustomCarton(
  items: OrderItem[],
  seedCubing: CubingResult,
  catalog: Carton[] = [],
): CustomCartonRecommendation | null {
  if (!seedCubing.fits || seedCubing.placements.length === 0) return null;

  const needL = Math.max(...seedCubing.placements.map((p) => p.x + p.iL));
  const needW = Math.max(...seedCubing.placements.map((p) => p.y + p.iW));
  const needH = Math.max(...seedCubing.placements.map((p) => p.z + p.iH));
  // Manufacturing / loading clearance beyond tight AABB
  const clearance = Math.max(FIT_TOL, 0.125);

  let L = needL + clearance;
  let W = needW + clearance;
  let H = needH + clearance;

  const itemVol = seedCubing.itemVolume;
  const targetUtil = (UTIL_IDEAL_LOW + UTIL_IDEAL_HIGH) / 2;
  const targetVol = itemVol / targetUtil;
  const curVol = L * W * H;

  if (curVol + 1e-9 < targetVol) {
    const scale = Math.cbrt(targetVol / curVol);
    L *= scale;
    W *= scale;
    H *= scale;
  }

  let carton = makeCustomCarton(L, W, H, items, catalog);
  let cubing = cubePack(items, carton);

  // Expand until physical fit succeeds
  for (let i = 0; i < 24 && !cubing.fits; i++) {
    L = carton.length + 0.25;
    W = carton.width + 0.25;
    H = carton.height + 0.25;
    carton = makeCustomCarton(L, W, H, items, catalog);
    cubing = cubePack(items, carton);
  }
  if (!cubing.fits) return null;

  // Pull utilization into preferred band when geometry allows
  for (let i = 0; i < 32 && cubing.utilization > UTIL_MAX; i++) {
    // Prefer height growth (dunnage / cushioning headroom), then footprint
    if (i % 3 === 0) H = carton.height + 0.25;
    else if (i % 3 === 1) L = carton.length + 0.25;
    else W = carton.width + 0.25;
    carton = makeCustomCarton(L, W, H, items, catalog);
    const next = cubePack(items, carton);
    if (!next.fits) break;
    cubing = next;
  }

  // If still below preferred floor, try modest shrink toward OBB (never below packed need)
  for (let i = 0; i < 24 && cubing.utilization < UTIL_MIN; i++) {
    const minL = roundCartonDim(needL + clearance);
    const minW = roundCartonDim(needW + clearance);
    const minH = roundCartonDim(needH + clearance);
    const nL = Math.max(minL, roundCartonDim(carton.length - 0.25));
    const nW = Math.max(minW, roundCartonDim(carton.width - 0.25));
    const nH = Math.max(minH, roundCartonDim(carton.height - 0.25));
    if (nL === carton.length && nW === carton.width && nH === carton.height) break;
    const candidate = makeCustomCarton(nL, nW, nH, items, catalog);
    const next = cubePack(items, candidate);
    if (!next.fits) break;
    carton = candidate;
    cubing = next;
    L = nL;
    W = nW;
    H = nH;
  }

  const score = scoreCarton(carton, items, cubing);
  return {
    carton,
    score,
    cubing,
    reason: `Custom size targeting ~${Math.round(targetUtil * 100)}% cube utilization from 3D pack-out.`,
    comparison: {
      scoreDelta: 0,
      packagingCostSavings: 0,
      packagingCostReductionPct: null,
      transportCostPacksize: 0,
      transportCostCustom: 0,
      transportCostSavings: 0,
      transportCostReductionPct: null,
      utilImprovementPoints: 0,
      dunnageReductionPct: null,
      damageRiskReductionPct: null,
      movementRiskReduction: 0,
      cgImproved: false,
      weightBalanceImproved: false,
      corrugatedAreaReductionPct: null,
      meaningfulImprovements: [],
      thresholdHits: [],
      beatsPacksizeScore: false,
      qualifies: false,
      summary: "",
    },
  };
}

export function scoreCarton(
  c: Carton,
  items: OrderItem[],
  precomputed?: CubingResult,
): EngineeringScore {
  const { tw, maxF } = orderTotals(items);
  if (c.maxWeight > 0 && tw > c.maxWeight) return emptyScore();

  const r = precomputed?.fits ? precomputed : cubePack(items, c);
  if (!r.fits) return emptyScore();

  const u = r.utilization;
  const voidPct = r.voidPct;
  const fM = FRAGILITY_MULT[maxF];
  const actualVoid = r.cartonVolume - r.itemVolume;
  const targetVoid = r.dunnage5Pct;
  const voidOverflow = Math.max(0, actualVoid - targetVoid * 4);

  const fitReasons: string[] = [];
  if (u < UTIL_MIN) {
    fitReasons.push(
      `Excessive void space (${voidPct}% void) — below 80% preferred floor; excessive dunnage required and movement risk elevated`,
    );
  }
  if (u > UTIL_MAX) {
    fitReasons.push(
      `Insufficient cushioning or loading clearance (${voidPct}% void) — above 92% preferred ceiling`,
    );
  }
  if (r.cgRel.z > 0.6) {
    fitReasons.push(`Top-heavy center of gravity (z=${Math.round(r.cgRel.z * 100)}%) — increased tip-over risk`);
  }
  if (Math.abs(r.cgRel.x - 0.5) > 0.25) {
    fitReasons.push(`Lateral weight bias (x=${Math.round(r.cgRel.x * 100)}%) — uneven load on carrier`);
  }
  if (r.layers > 3) {
    fitReasons.push(`${r.layers} stacking layers required — reduced packing repeatability at pack station`);
  }
  if (r.mechanicalReviewRequired) {
    fitReasons.push("Fits — Mechanical Review Required (flexible/soft package compression or top-load uncertainty)");
    for (const w of r.mechanicalWarnings ?? []) fitReasons.push(w);
  }

  // Separate decisions: physical fit (already true), mechanical feasibility, engineering quality
  let fitStatus: EngineeringScore["fitStatus"] = "recommended";
  if (r.mechanicalReviewRequired) fitStatus = "mechanical-review";
  else if (fitReasons.length > 0) fitStatus = "not-recommended";

  const idealVoid = maxF === "High" ? 0.1 : maxF === "Medium" ? 0.07 : 0.05;
  const voidDev = Math.abs(1 - u - idealVoid);
  const damagePreventionScore = Math.max(0, 100 - voidDev * 300 - (fM - 1) * 15);
  const damageRisk = Math.max(0, 100 - damagePreventionScore);

  const cgScore =
    (1 - Math.abs(r.cgRel.z - 0.35) * 3) * 0.4 +
    (1 - Math.abs(r.cgRel.x - 0.5) * 2) * 0.3 +
    (1 - Math.abs(r.cgRel.y - 0.5) * 2) * 0.3;
  const movementScore = Math.max(0, Math.min(100, Math.round(cgScore * 70 + (1 - voidPct / 100) * 30)));
  const movementRisk = Math.max(0, 100 - movementScore);

  const dunnageScore = Math.max(0, 100 - (voidOverflow / Math.max(targetVoid, 1)) * 25 - voidPct * 0.4);
  const dw = dimW(c.length, c.width, c.height);
  const sizeScore = Math.max(0, 100 - dw * 2.5);
  const idealMid = (UTIL_IDEAL_LOW + UTIL_IDEAL_HIGH) / 2;
  const repeatScore = Math.max(0, 100 - Math.abs(u - idealMid) * 300 - (r.layers - 1) * 8);
  const laborScore = Math.max(0, 100 - (r.layers - 1) * 20 - voidPct * 0.25);

  // —— Flexible / soft package mechanical factors ——
  let compressionRiskAcc = 0;
  let topLoadRiskAcc = 0;
  let migrationRiskAcc = 0;
  let shapeRecoveryAcc = 0;
  let voidBenefitAcc = 0;
  let flexCount = 0;
  for (const p of r.placements) {
    if (p.rigidityClass === "rigid") continue;
    flexCount++;
    const riskMap = { none: 0, low: 25, medium: 55, high: 90 };
    compressionRiskAcc += riskMap[p.compressionRisk];
    const mech = resolveMechanical(p.sku);
    topLoadRiskAcc +=
      isSoftLike(p.sku) && p.topLoadLb > 0
        ? 100
        : !mech.stackable && p.topLoadLb > 0
          ? 90
          : p.topLoadLb > 0
            ? 25
            : 5;
    const shift = mech.contentShiftRisk ?? "low";
    migrationRiskAcc += shift === "high" ? 80 : shift === "medium" ? 45 : 15;
    if (p.conformsToVoid && (p.compressionRisk === "medium" || p.compressionRisk === "high")) {
      shapeRecoveryAcc += 70;
    } else if (p.conformsToVoid) {
      shapeRecoveryAcc += 25;
    }
    // Moderate void conformity that reduces dunnage without high stress
    if (p.conformsToVoid && (p.compressionRisk === "low" || p.compressionRisk === "none")) {
      voidBenefitAcc += 70;
    } else if (p.conformsToVoid && p.compressionRisk === "medium") {
      voidBenefitAcc += 35;
    }
  }
  const n = Math.max(1, flexCount);
  const flexiblePackageCompressionRisk = flexCount ? Math.round(compressionRiskAcc / n) : 0;
  const softPackageTopLoadRisk = flexCount ? Math.round(topLoadRiskAcc / n) : 0;
  const contentMigrationRisk = flexCount ? Math.round(migrationRiskAcc / n) : 0;
  const shapeRecoveryMovementRisk = flexCount ? Math.round(shapeRecoveryAcc / n) : 0;
  const voidConformityBenefit = flexCount ? Math.round(voidBenefitAcc / n) : 0;

  const flexMechanicalScore = Math.max(
    0,
    100 -
      flexiblePackageCompressionRisk * 0.45 -
      softPackageTopLoadRisk * 0.35 -
      contentMigrationRisk * 0.2,
  );

  const total = Math.round(
    damagePreventionScore * W.damagePrevention +
      movementScore * W.movementPrevention +
      dunnageScore * W.dunnageReduction +
      sizeScore * W.cartonSizeOpt +
      repeatScore * W.packRepeatability +
      laborScore * W.laborEfficiency +
      flexMechanicalScore * W.flexMechanical +
      voidConformityBenefit * W.voidConformity +
      (100 - shapeRecoveryMovementRisk) * W.shapeRecovery,
  );

  return {
    utilization: Math.round(u * 100),
    dimWeight: Math.round(sizeScore),
    shipping: c.cost > 0 ? Math.max(0, Math.min(100, Math.round(100 - c.cost))) : 60,
    fragility: Math.round(damagePreventionScore),
    sustainability: Math.round(dunnageScore),
    total,
    damagePrevention: Math.round(damagePreventionScore),
    movementPrevention: Math.round(movementScore),
    dunnageReduction: Math.round(dunnageScore),
    cartonSizeOpt: Math.round(sizeScore),
    packRepeatability: Math.round(repeatScore),
    laborEfficiency: Math.round(laborScore),
    damageRisk,
    movementRisk,
    flexiblePackageCompressionRisk,
    softPackageTopLoadRisk,
    contentMigrationRisk,
    voidConformityBenefit,
    shapeRecoveryMovementRisk,
    voidPct,
    dunnageVolEst: Math.round(actualVoid),
    layers: r.layers,
    fitStatus,
    fitReasons,
    mechanicalReviewRequired: !!r.mechanicalReviewRequired,
  };
}

/**
 * Physical fit (3D cubing) is separate from engineering quality.
 * Rank every Packsize carton that physically fits; recommend highest score.
 * noFit only when zero cartons pass complete 3D cubing.
 * Always evaluate an optimal custom size; present it only when it beats Packsize
 * by configurable engineering / financial thresholds.
 */
export function calcAI(
  items: OrderItem[],
  cartons: Carton[],
  thresholds: CustomCartonThresholds = DEFAULT_CUSTOM_THRESHOLDS,
): {
  carton: Carton;
  score: EngineeringScore;
  ranked: RankedOption[];
  noFit: boolean;
  candidateCount: number;
  minRequired: MinRequired;
  cubing: CubingResult | null;
  /** Present only when custom qualifies vs Packsize */
  custom: CustomCartonRecommendation | null;
  /** Full custom decision (recommended / evaluated-not-beneficial / not-evaluated) */
  customDecision: CustomCartonDecision;
} {
  const req = minRequiredDims(items);
  const FALLBACK = emptyScore();

  // Prefer cartons that clear the soft envelope first (faster wins), then the rest.
  const scored: Array<{ carton: Carton; score: EngineeringScore; cubing: CubingResult }> = [];
  const tried = new Set<string>();
  const consider = (c: Carton) => {
    if (tried.has(c.id)) return;
    tried.add(c.id);
    const cubing = cubePack(items, c);
    if (!cubing.fits) return;
    scored.push({ carton: c, score: scoreCarton(c, items, cubing), cubing });
  };

  const envelopeHits = cartons.filter((c) => cartonPassesEnvelope(c, req));
  for (const c of envelopeHits) consider(c);
  for (const c of cartons) {
    if (c.maxWeight > 0 && req.totalWeight > c.maxWeight) continue;
    consider(c);
  }

  if (scored.length === 0) {
    const last = sortedByVol(cartons)[cartons.length - 1] ?? cartons[0];
    return {
      carton: last,
      score: FALLBACK,
      ranked: [],
      noFit: true,
      candidateCount: 0,
      minRequired: req,
      cubing: null,
      custom: null,
      customDecision: { status: "not-evaluated" },
    };
  }

  // Ranking: engineering quality first; prefer layouts that do not need mechanical review
  scored.sort(
    (a, b) =>
      Number(a.score.mechanicalReviewRequired) - Number(b.score.mechanicalReviewRequired) ||
      b.score.total - a.score.total ||
      vol(a.carton.length, a.carton.width, a.carton.height) -
        vol(b.carton.length, b.carton.width, b.carton.height),
  );

  const best = scored[0]!;
  const ranked: RankedOption[] = scored.slice(0, 8).map((x, i) => ({
    carton: x.carton,
    score: x.score,
    rank: i + 1,
  }));

  // Always size an optimal custom carton from the best Packsize pack-out, then gate display.
  const customCandidate = suggestCustomCarton(items, best.cubing, cartons);
  const customDecision = decideCustomCarton(best, customCandidate, thresholds);
  const custom =
    customDecision.status === "recommended" ? customDecision.recommendation : null;

  return {
    carton: best.carton,
    score: best.score,
    ranked,
    noFit: false,
    candidateCount: scored.length,
    minRequired: req,
    cubing: best.cubing,
    custom,
    customDecision,
  };
}

export function buildRationale(
  manhattan: Carton,
  ai: Carton,
  score: EngineeringScore,
  cubing: CubingResult,
  items: OrderItem[],
  wmsIsManual: boolean,
  candidateCount: number,
): string {
  const maxF = items.reduce(
    (acc, { sku }) => (FRAGILITY_MULT[sku.fragility] > FRAGILITY_MULT[acc] ? sku.fragility : acc),
    "Low" as FragilityLevel,
  );
  const wmsLabel = wmsIsManual ? "Manhattan WMS" : "WMS";
  const utilBand =
    score.utilization >= Math.round(UTIL_IDEAL_LOW * 100) &&
    score.utilization <= Math.round(UTIL_IDEAL_HIGH * 100)
      ? ` — within the 85–90% ideal target band`
      : score.utilization < Math.round(UTIL_MIN * 100)
        ? ` — below the 80% preferred floor (excessive void); still the best Packsize option by engineering score`
        : score.utilization > Math.round(UTIL_MAX * 100)
          ? ` — above the 92% preferred ceiling (tight clearance); still the best Packsize option by engineering score`
          : ` — within the 80–92% preferred range`;
  const packsizeNote = `Selected from ${candidateCount} Packsize carton${candidateCount !== 1 ? "s" : ""} that passed full 3D cubing.`;
  const cubingNote = `3D cubing placed ${cubing.layers} layer${cubing.layers !== 1 ? "s" : ""} at ${score.utilization}% cube utilization${utilBand}. 5% of carton volume (${cubing.dunnage5Pct} in³) is reserved for kraft paper dunnage. Weight balance: ${cubing.weightBalance}.`;
  if (ai.id === manhattan.id) {
    return `CartonIQ confirms the ${wmsLabel} selection of ${ai.name} (#${ai.number ?? ai.id}). ${packsizeNote} ${cubingNote} Damage Prevention ${score.damagePrevention}/100 · Movement Prevention ${score.movementPrevention}/100.`;
  }
  const savPct = manhattan.cost > 0 ? Math.round(((manhattan.cost - ai.cost) / manhattan.cost) * 100) : 0;
  return `CartonIQ selected Packsize ${ai.name || ai.id}${ai.number ? ` (#${ai.number})` : ""} over the ${wmsLabel}-recommended ${manhattan.name || manhattan.id}${savPct > 0 ? ` (${savPct}% freight reduction)` : ""}. ${packsizeNote} ${cubingNote} Center of gravity is at ${Math.round(cubing.cgRel.z * 100)}% carton height — optimized for ${maxF.toLowerCase()}-fragility medical devices. Damage Prevention ${score.damagePrevention}/100 · Movement Prevention ${score.movementPrevention}/100 · Pack Repeatability ${score.packRepeatability}/100.`;
}

export function cartonAdv(
  _c: Carton,
  score: EngineeringScore,
  rank: number,
  best: EngineeringScore,
): { advantages: string[]; disadvantages: string[]; useCase: string } {
  const advantages: string[] = [];
  const disadvantages: string[] = [];

  if (score.damagePrevention >= 75) advantages.push(`Strong damage prevention (${score.damagePrevention}/100)`);
  if (score.movementPrevention >= 75) advantages.push(`Excellent movement control (${score.movementPrevention}/100)`);
  if (score.dunnageReduction >= 65) advantages.push(`Minimal dunnage requirement (${score.voidPct}% void)`);
  if (score.cartonSizeOpt >= 60) advantages.push("Compact footprint reduces dim weight charges");
  if (score.packRepeatability >= 70) advantages.push("Highly repeatable pack configuration");
  if (score.laborEfficiency >= 70) advantages.push("Fast to assemble at pack station");

  if (score.damagePrevention < 60) disadvantages.push(`Lower damage protection (${score.damagePrevention}/100)`);
  if (score.movementPrevention < 60) disadvantages.push("Higher movement risk — more dunnage discipline required");
  if (score.voidPct > 55) disadvantages.push(`Larger void (${score.voidPct}%) increases dunnage cost and waste`);
  if (score.cartonSizeOpt < 40) disadvantages.push("Larger carton footprint — higher dimensional weight surcharges");
  if (score.packRepeatability < 50) disadvantages.push("Variable void pattern may reduce packing consistency");
  if (rank > 1) disadvantages.push(`Overall score ${score.total} vs. top pick ${best.total} (−${best.total - score.total} pts)`);

  if (advantages.length === 0) advantages.push("Eligible dimensional fit for this order");
  if (disadvantages.length === 0) disadvantages.push("No significant engineering trade-offs identified");

  const useCase =
    rank === 1
      ? "Recommended for standard distribution — optimal balance of protection, movement control, and shipping efficiency."
      : rank === 2
        ? "Use when primary carton is unavailable; performance comparable with minor trade-offs."
        : "Emergency alternative only — acceptable protection but suboptimal efficiency.";

  return { advantages, disadvantages, useCase };
}
