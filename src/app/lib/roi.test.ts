import { describe, expect, it } from "vitest";
import {
  allocatedTrailerSpaceCost,
  annualProgramCost,
  buildExecutiveDashboard,
  buildSampleHistory,
  calculatePaybackMonths,
  calculateRoiPercent,
  corrugatedSqFt,
  cuInToCuFt,
  damageCostAvoidanceAnnual,
  DEFAULT_ROI_ASSUMPTIONS,
  engineeringHoursSavedPerShipment,
  filterHistory,
  formatMetricNumber,
  normalize01,
  packagingValueScore,
  sortOpportunities,
} from "./roi";
import type { DashboardFilters, OptimizationOpportunity, RoiHistoryRecord } from "./roiTypes";

describe("ROI core formulas", () => {
  it("calculates ROI %", () => {
    expect(calculateRoiPercent(250_000, 50_000)).toBeCloseTo(400);
    expect(calculateRoiPercent(40_000, 50_000)).toBeCloseTo(-20);
    expect(calculateRoiPercent(100_000, 0)).toBeNull();
    expect(calculateRoiPercent(NaN, 50_000)).toBeNull();
  });

  it("calculates payback months", () => {
    expect(calculatePaybackMonths(120_000, 60_000)).toBeCloseTo(6);
    expect(calculatePaybackMonths(0, 60_000)).toBeNull();
    expect(calculatePaybackMonths(-1, 60_000)).toBeNull();
  });

  it("sums annual program cost", () => {
    const a = {
      ...DEFAULT_ROI_ASSUMPTIONS,
      softwareCost: 10,
      implementationCost: 20,
      supportCost: 30,
      annualLaborCost: 40,
    };
    expect(annualProgramCost(a)).toBe(100);
  });

  it("allocates trailer-space cost from volume × rate", () => {
    expect(allocatedTrailerSpaceCost(10_000, 0.001)).toBeCloseTo(10);
  });

  it("converts cu in to cu ft and corrugate area", () => {
    expect(cuInToCuFt(1728)).toBeCloseTo(1);
    expect(corrugatedSqFt(12, 12, 12)).toBeCloseTo((2 * (144 + 144 + 144)) / 144);
  });

  it("computes damage avoidance and engineering hours", () => {
    const a = {
      ...DEFAULT_ROI_ASSUMPTIONS,
      baselineDamageRate: 0.02,
      optimizedDamageRate: 0.01,
      annualShipmentVolume: 1000,
      costPerDamagedShipment: 100,
      baselineEngineeringMinutes: 30,
      cartoniqEngineeringMinutes: 6,
    };
    expect(damageCostAvoidanceAnnual(a)).toBeCloseTo(1000);
    expect(engineeringHoursSavedPerShipment(a)).toBeCloseTo(0.4);
  });

  it("normalizes and scores packaging value", () => {
    expect(normalize01(50, 0, 100)).toBeCloseTo(0.5);
    expect(normalize01(200, 0, 100)).toBe(1);
    const score = packagingValueScore(
      {
        financialSavings: 1,
        transportationEfficiency: 1,
        damageReduction: 1,
        sustainability: 1,
        laborSavings: 1,
      },
      DEFAULT_ROI_ASSUMPTIONS.valueScoreWeights,
    );
    expect(score).toBe(100);
  });
});

describe("missing-data behavior", () => {
  it("returns Data unavailable for null metrics", () => {
    expect(
      formatMetricNumber({
        label: "x",
        value: null,
        integrity: "Estimated",
        tooltip: "",
        source: "",
        changeVsBaseline: null,
        trend: "unknown",
        unit: "currency",
      }),
    ).toBe("Data unavailable");
  });

  it("does not invent volumes when history lacks dimensions", () => {
    const history: RoiHistoryRecord[] = [
      {
        id: "1",
        at: new Date().toISOString(),
        skuCount: 1,
        unitCount: 1,
        totalWeight: 1,
        wmsCarton: "A",
        aiCarton: "B",
        wmsCost: 10,
        aiCost: 8,
        savings: 2,
        utilization: 85,
        voidPct: 15,
        dimWeightDelta: 1,
        sustainability: 70,
        score: 80,
        confirmedWms: false,
      },
    ];
    const model = buildExecutiveDashboard({ history, forceSample: false });
    // Without dims, corrugate sq ft may be unavailable
    expect(model.sustainability.corrugatedSqFtSaved.value).toBeNull();
    expect(model.missingFields.length).toBeGreaterThan(0);
    expect(model.usingSampleData).toBe(false);
  });

  it("uses labeled sample data when history is empty", () => {
    const model = buildExecutiveDashboard({ history: [] });
    expect(model.usingSampleData).toBe(true);
    expect(model.kpis.totalAnnualSavings.integrity).toBe("Sample");
    expect(model.kpis.totalAnnualSavings.value).not.toBeNull();
  });
});

describe("filters, sort, sample", () => {
  it("filters by category and date", () => {
    const history = buildSampleHistory();
    const filters: DashboardFilters = {
      dateFrom: null,
      dateTo: null,
      timeRange: "year",
      category: "Urology",
      carrier: "",
      recommendationStatus: "",
      validationStatus: "",
    };
    const out = filterHistory(history, filters);
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((r) => r.category === "Urology")).toBe(true);
  });

  it("sorts opportunities by savings descending", () => {
    const rows: OptimizationOpportunity[] = [
      {
        id: "a",
        skuOrOrderId: "a",
        currentCarton: "x",
        recommendedCarton: "y",
        currentVolume: 1,
        recommendedVolume: 1,
        cubeReduction: 1,
        estimatedAnnualSavings: 10,
        dunnageReduction: 1,
        damageRiskChange: 0,
        sustainabilityImpact: 1,
        shipmentVolume: 1,
        status: "ok",
        integrity: "Sample",
      },
      {
        id: "b",
        skuOrOrderId: "b",
        currentCarton: "x",
        recommendedCarton: "y",
        currentVolume: 1,
        recommendedVolume: 1,
        cubeReduction: 5,
        estimatedAnnualSavings: 50,
        dunnageReduction: 1,
        damageRiskChange: 0,
        sustainabilityImpact: 1,
        shipmentVolume: 1,
        status: "ok",
        integrity: "Sample",
      },
    ];
    expect(sortOpportunities(rows, "savings")[0]!.id).toBe("b");
    expect(sortOpportunities(rows, "cubeReduction")[0]!.id).toBe("b");
  });
});
