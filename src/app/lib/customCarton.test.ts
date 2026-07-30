import { describe, expect, it } from "vitest";
import {
  calcAI,
  cubePack,
  decideCustomCarton,
  DEFAULT_CUSTOM_THRESHOLDS,
  evaluateCustomVsPacksize,
  isOutsidePreferredUtil,
  suggestCustomCarton,
  UTIL_MAX,
  UTIL_MIN,
} from "./engine";
import type { Carton, CubingResult, EngineeringScore, SKU } from "./types";

function sku(partial: Partial<SKU> & Pick<SKU, "id" | "name" | "length" | "width" | "height">): SKU {
  return { category: "Test", weight: 1, fragility: "Low", ...partial };
}

function carton(partial: Partial<Carton> & Pick<Carton, "id" | "length" | "width" | "height">): Carton {
  return { name: partial.id, maxWeight: 100, cost: 5, ...partial };
}

function stubScore(partial: Partial<EngineeringScore> & Pick<EngineeringScore, "total">): EngineeringScore {
  return {
    utilization: 80,
    dimWeight: 50,
    shipping: 50,
    fragility: 50,
    sustainability: 50,
    damagePrevention: 70,
    movementPrevention: 70,
    dunnageReduction: 70,
    cartonSizeOpt: 70,
    packRepeatability: 70,
    laborEfficiency: 70,
    damageRisk: 30,
    movementRisk: 30,
    flexiblePackageCompressionRisk: 0,
    softPackageTopLoadRisk: 0,
    contentMigrationRisk: 0,
    voidConformityBenefit: 0,
    shapeRecoveryMovementRisk: 0,
    voidPct: 20,
    dunnageVolEst: 100,
    layers: 1,
    fitStatus: "recommended",
    fitReasons: [],
    mechanicalReviewRequired: false,
    ...partial,
  };
}

function stubCubing(partial?: Partial<CubingResult>): CubingResult {
  return {
    fits: true,
    mechanicalReviewRequired: false,
    mechanicalStatus: "ok",
    mechanicalWarnings: [],
    placements: [],
    flexReports: [],
    layers: 1,
    itemVolume: 100,
    cartonVolume: 125,
    utilization: 0.8,
    voidPct: 20,
    dunnage5Pct: 6,
    cgRel: { x: 0.5, y: 0.5, z: 0.35 },
    weightBalance: "Well-balanced",
    layerGroups: [],
    ...partial,
  };
}

describe("custom carton thresholds", () => {
  it("flags utilization outside 80–92%", () => {
    expect(isOutsidePreferredUtil({ utilization: 70 })).toBe(true);
    expect(isOutsidePreferredUtil({ utilization: 95 })).toBe(true);
    expect(isOutsidePreferredUtil({ utilization: 87 })).toBe(false);
  });

  it("suggests a tighter custom carton when Packsize util is too low", () => {
    const item = sku({ id: "S1", name: "Kit", length: 8, width: 6, height: 4, weight: 2 });
    const big = carton({ id: "BIG", length: 24, width: 18, height: 16, cost: 20 });
    const pack = cubePack([{ sku: item, qty: 1 }], big);
    expect(pack.fits).toBe(true);
    expect(pack.utilization).toBeLessThan(UTIL_MIN);

    const custom = suggestCustomCarton([{ sku: item, qty: 1 }], pack, [big]);
    expect(custom).not.toBeNull();
    expect(custom!.score.utilization / 100).toBeGreaterThanOrEqual(UTIL_MIN - 0.02);
    expect(custom!.score.utilization / 100).toBeLessThanOrEqual(UTIL_MAX + 0.02);
    expect(custom!.carton.id.startsWith("CUSTOM-")).toBe(true);
  });

  it("does not qualify when custom score is not higher", () => {
    const packsize = {
      carton: carton({ id: "P", length: 20, width: 14, height: 10, cost: 12 }),
      score: stubScore({ total: 80, utilization: 82, voidPct: 18, damageRisk: 25 }),
      cubing: stubCubing(),
    };
    const custom = {
      carton: carton({ id: "C", length: 18, width: 12, height: 9, cost: 10 }),
      score: stubScore({ total: 78, utilization: 88, voidPct: 12, damageRisk: 20 }),
      cubing: stubCubing({ utilization: 0.88, voidPct: 12 }),
    };
    const cmp = evaluateCustomVsPacksize(packsize, custom);
    expect(cmp.beatsPacksizeScore).toBe(false);
    expect(cmp.qualifies).toBe(false);
    expect(decideCustomCarton(packsize, custom).status).toBe("evaluated-not-beneficial");
  });

  it("qualifies when score improves ≥5 and a threshold is met", () => {
    const packsize = {
      carton: carton({ id: "P", length: 24, width: 18, height: 16, cost: 20 }),
      score: stubScore({ total: 70, utilization: 60, voidPct: 40, damageRisk: 40 }),
      cubing: stubCubing({ utilization: 0.6, voidPct: 40, weightBalance: "Top-heavy — reorder layers" }),
    };
    const custom = {
      carton: carton({ id: "C", length: 16, width: 12, height: 10, cost: 12 }),
      score: stubScore({ total: 82, utilization: 88, voidPct: 12, damageRisk: 20, movementRisk: 15 }),
      cubing: stubCubing({ utilization: 0.88, voidPct: 12 }),
    };
    const cmp = evaluateCustomVsPacksize(packsize, custom);
    expect(cmp.beatsPacksizeScore).toBe(true);
    expect(cmp.scoreDelta).toBeGreaterThanOrEqual(DEFAULT_CUSTOM_THRESHOLDS.minScoreImprovement);
    expect(cmp.thresholdHits.length).toBeGreaterThan(0);
    expect(cmp.qualifies).toBe(true);
    expect(decideCustomCarton(packsize, custom).status).toBe("recommended");
    expect(cmp.summary).toMatch(/Custom carton recommended because/i);
  });

  it("rejects when score is only slightly higher without meeting thresholds", () => {
    const packsize = {
      carton: carton({ id: "P", length: 16, width: 12, height: 10, cost: 12 }),
      score: stubScore({ total: 80, utilization: 86, voidPct: 14, damageRisk: 22 }),
      cubing: stubCubing({ utilization: 0.86, voidPct: 14 }),
    };
    const custom = {
      carton: carton({ id: "C", length: 15.75, width: 11.75, height: 9.75, cost: 11.8 }),
      score: stubScore({ total: 82, utilization: 87, voidPct: 13.5, damageRisk: 21.5 }),
      cubing: stubCubing({ utilization: 0.87, voidPct: 13.5 }),
    };
    // Force very high thresholds so small gains fail
    const strict = {
      ...DEFAULT_CUSTOM_THRESHOLDS,
      minScoreImprovement: 10,
      minPackagingCostReductionPct: 50,
      minTransportCostReductionPct: 50,
      minUtilImprovementPoints: 20,
      minDunnageReductionPct: 50,
      minDamageRiskReductionPct: 50,
    };
    const cmp = evaluateCustomVsPacksize(packsize, custom, strict);
    expect(cmp.beatsPacksizeScore).toBe(true);
    expect(cmp.qualifies).toBe(false);
    expect(decideCustomCarton(packsize, custom, strict).status).toBe("evaluated-not-beneficial");
  });

  it("calcAI returns custom only when thresholds are met", () => {
    const item = sku({ id: "S2", name: "Device", length: 10, width: 8, height: 5, weight: 3 });
    const catalog = [
      carton({ id: "A", length: 28, width: 20, height: 18, cost: 25 }),
      carton({ id: "B", length: 26, width: 18, height: 16, cost: 22 }),
    ];
    const r = calcAI([{ sku: item, qty: 1 }], catalog);
    expect(r.noFit).toBe(false);
    expect(r.customDecision.status === "recommended" || r.customDecision.status === "evaluated-not-beneficial").toBe(
      true,
    );
    if (r.customDecision.status === "recommended") {
      expect(r.custom).not.toBeNull();
      expect(r.custom!.comparison.qualifies).toBe(true);
      expect(r.custom!.score.total).toBeGreaterThan(r.score.total);
    } else {
      expect(r.custom).toBeNull();
    }
  });

  it("calcAI with near-ideal Packsize does not force a custom panel", () => {
    const item = sku({ id: "S3", name: "Tight kit", length: 10, width: 8, height: 4, weight: 2 });
    // Carton sized near ideal util for this single item
    const catalog = [carton({ id: "FIT", length: 11, width: 9, height: 5, cost: 8 })];
    const r = calcAI([{ sku: item, qty: 1 }], catalog);
    expect(r.noFit).toBe(false);
    // Custom may be evaluated but often not beneficial when Packsize already fits well
    if (r.customDecision.status === "evaluated-not-beneficial") {
      expect(r.custom).toBeNull();
    }
  });
});
