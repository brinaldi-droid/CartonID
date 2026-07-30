import type {
  BeforeAfterRow,
  DashboardFilters,
  DataIntegrity,
  ExecutiveDashboardModel,
  MetricValue,
  OptimizationOpportunity,
  OpportunitySortKey,
  PackagingValueScore,
  RoiAssumptions,
  RoiHistoryRecord,
  SavingsByCategoryPoint,
  TrendPoint,
  ValueCreatedBreakdown,
} from "./roiTypes";

export type * from "./roiTypes";

export const DEFAULT_ROI_ASSUMPTIONS: RoiAssumptions = {
  softwareCost: 48_000,
  implementationCost: 12_000,
  supportCost: 8_000,
  annualLaborCost: 15_000,
  annualShipmentVolume: 120_000,
  costPerDamagedShipment: 185,
  baselineDamageRate: 0.012,
  optimizedDamageRate: 0.007,
  costPerEngineeringHour: 95,
  baselineEngineeringMinutes: 18,
  cartoniqEngineeringMinutes: 2,
  corrugatedCostPerSqFt: 0.42,
  corrugatedSurfaceFactor: 6.5,
  dunnageCostPerCuIn: 0.0045,
  kraftLbPerCuIn: 0.0012,
  transportationCostPerCuIn: 0.00085,
  trailerVolumeCuIn: 3_050 * 1728, // ~53' dry van usable cu ft → in³
  baselineTrailerUtilization: 0.72,
  optimizedTrailerUtilization: 0.81,
  co2KgPerLbCorrugate: 0.95,
  co2KgPerLbKraft: 1.1,
  corrugateLbPerSqFt: 0.18,
  landfillM3PerLb: 0.0025,
  plasticLbEliminatedPerShipment: 0,
  packTimeReductionMinutes: 1.2,
  valueScoreWeights: {
    financialSavings: 0.4,
    transportationEfficiency: 0.2,
    damageReduction: 0.15,
    sustainability: 0.15,
    laborSavings: 0.1,
  },
};

export const ASSUMPTIONS_STORAGE_KEY = "cartoniq-roi-assumptions";

export function loadRoiAssumptions(): RoiAssumptions {
  try {
    const raw = localStorage.getItem(ASSUMPTIONS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_ROI_ASSUMPTIONS };
    const parsed = JSON.parse(raw) as Partial<RoiAssumptions>;
    return {
      ...DEFAULT_ROI_ASSUMPTIONS,
      ...parsed,
      valueScoreWeights: {
        ...DEFAULT_ROI_ASSUMPTIONS.valueScoreWeights,
        ...(parsed.valueScoreWeights ?? {}),
      },
    };
  } catch {
    return { ...DEFAULT_ROI_ASSUMPTIONS };
  }
}

export function saveRoiAssumptions(a: RoiAssumptions): void {
  try {
    localStorage.setItem(ASSUMPTIONS_STORAGE_KEY, JSON.stringify(a));
  } catch {
    /* ignore */
  }
}

export function annualProgramCost(a: RoiAssumptions): number {
  return a.softwareCost + a.implementationCost + a.supportCost + a.annualLaborCost;
}

/** ROI % = (Annual Benefit − Annual Program Cost) ÷ Annual Program Cost × 100 */
export function calculateRoiPercent(annualBenefit: number, programCost: number): number | null {
  if (!Number.isFinite(annualBenefit) || !Number.isFinite(programCost)) return null;
  if (programCost <= 0) return null;
  return ((annualBenefit - programCost) / programCost) * 100;
}

/** Payback months = Annual Program Cost ÷ Annual Benefit × 12 */
export function calculatePaybackMonths(annualBenefit: number, programCost: number): number | null {
  if (!Number.isFinite(annualBenefit) || !Number.isFinite(programCost)) return null;
  if (annualBenefit <= 0) return null;
  return (programCost / annualBenefit) * 12;
}

export function cartonVolume(l: number, w: number, h: number): number {
  return l * w * h;
}

export function cuInToCuFt(cuIn: number): number {
  return cuIn / 1728;
}

/** Approximate corrugated surface area (sq ft) from carton outer dimensions (in). */
export function corrugatedSqFt(l: number, w: number, h: number): number {
  const surfaceIn2 = 2 * (l * w + l * h + w * h);
  return surfaceIn2 / 144;
}

export function allocatedTrailerSpaceCost(volumeCuIn: number, costPerCuIn: number): number {
  return volumeCuIn * costPerCuIn;
}

export function annualizePerShipment(perShipment: number, annualShipments: number): number {
  return perShipment * annualShipments;
}

export function engineeringHoursSavedPerShipment(a: RoiAssumptions): number {
  const deltaMin = a.baselineEngineeringMinutes - a.cartoniqEngineeringMinutes;
  return Math.max(0, deltaMin) / 60;
}

export function damageCostAvoidanceAnnual(a: RoiAssumptions): number {
  const rateDelta = Math.max(0, a.baselineDamageRate - a.optimizedDamageRate);
  return rateDelta * a.annualShipmentVolume * a.costPerDamagedShipment;
}

export function normalize01(value: number, min: number, max: number): number {
  if (!Number.isFinite(value) || max <= min) return 0;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

export function packagingValueScore(
  parts: {
    financialSavings: number;
    transportationEfficiency: number;
    damageReduction: number;
    sustainability: number;
    laborSavings: number;
  },
  weights: RoiAssumptions["valueScoreWeights"],
): number {
  const wSum =
    weights.financialSavings +
    weights.transportationEfficiency +
    weights.damageReduction +
    weights.sustainability +
    weights.laborSavings;
  if (wSum <= 0) return 0;
  const score =
    (parts.financialSavings * weights.financialSavings +
      parts.transportationEfficiency * weights.transportationEfficiency +
      parts.damageReduction * weights.damageReduction +
      parts.sustainability * weights.sustainability +
      parts.laborSavings * weights.laborSavings) /
    wSum;
  return Math.round(Math.max(0, Math.min(100, score * 100)));
}

function metric(
  partial: Omit<MetricValue, "trend"> & { trend?: MetricValue["trend"] },
): MetricValue {
  return {
    trend: partial.trend ?? "unknown",
    ...partial,
  };
}

function avg(nums: number[]): number | null {
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function sum(nums: number[]): number {
  return nums.reduce((a, b) => a + b, 0);
}

function resolveVolumes(r: RoiHistoryRecord): { wms: number | null; ai: number | null } {
  if (r.wmsVolume != null && r.aiVolume != null) {
    return { wms: r.wmsVolume, ai: r.aiVolume };
  }
  const w = r.breakdown?.wms;
  const a = r.breakdown?.ai;
  if (w && a) {
    return {
      wms: cartonVolume(w.length, w.width, w.height),
      ai: cartonVolume(a.length, a.width, a.height),
    };
  }
  return { wms: null, ai: null };
}

function resolveDunnageVol(r: RoiHistoryRecord, which: "wms" | "ai"): number | null {
  const score = which === "ai" ? r.breakdown?.aiScore : r.breakdown?.wmsScore;
  if (score?.dunnageVolEst != null) return score.dunnageVolEst;
  const vols = resolveVolumes(r);
  const vol = which === "ai" ? vols.ai : vols.wms;
  const voidPct = which === "ai" ? r.voidPct : (r.wmsVoidPct ?? r.breakdown?.wmsScore?.voidPct);
  if (vol == null || voidPct == null) return null;
  return vol * (voidPct / 100);
}

export function filterHistory(
  records: RoiHistoryRecord[],
  filters: DashboardFilters,
): RoiHistoryRecord[] {
  return records.filter((r) => {
    const t = Date.parse(r.at);
    if (filters.dateFrom) {
      const from = Date.parse(filters.dateFrom);
      if (Number.isFinite(from) && Number.isFinite(t) && t < from) return false;
    }
    if (filters.dateTo) {
      const to = Date.parse(filters.dateTo);
      if (Number.isFinite(to) && Number.isFinite(t) && t > to) return false;
    }
    if (filters.category) {
      const recordCat = r.category ?? r.breakdown?.items?.find((i) => i.category)?.category ?? "";
      const itemCats = r.breakdown?.items?.map((i) => i.category).filter(Boolean) ?? [];
      if (recordCat !== filters.category && !itemCats.includes(filters.category)) return false;
    }
    if (filters.carrier && (r.carrier ?? "") !== filters.carrier) return false;
    if (filters.recommendationStatus) {
      const st = r.recommendationStatus ?? r.breakdown?.fitStatus ?? (r.confirmedWms ? "confirmed" : "override");
      if (st !== filters.recommendationStatus) return false;
    }
    if (filters.validationStatus && (r.validationStatus ?? "") !== filters.validationStatus) return false;
    return true;
  });
}

export function applyTimeRangePreset(
  filters: DashboardFilters,
  now = new Date(),
): DashboardFilters {
  if (filters.timeRange === "custom") return filters;
  const end = new Date(now);
  const start = new Date(now);
  if (filters.timeRange === "month") start.setMonth(start.getMonth() - 1);
  else if (filters.timeRange === "quarter") start.setMonth(start.getMonth() - 3);
  else start.setFullYear(start.getFullYear() - 1);
  return {
    ...filters,
    dateFrom: start.toISOString(),
    dateTo: end.toISOString(),
  };
}

export function sortOpportunities(
  rows: OptimizationOpportunity[],
  key: OpportunitySortKey,
): OptimizationOpportunity[] {
  const dir = -1; // largest first
  return [...rows].sort((a, b) => {
    const av =
      key === "savings"
        ? a.estimatedAnnualSavings
        : key === "cubeReduction"
          ? a.cubeReduction
          : key === "shipmentVolume"
            ? a.shipmentVolume
            : key === "damageRisk"
              ? a.damageRiskChange
              : a.sustainabilityImpact;
    const bv =
      key === "savings"
        ? b.estimatedAnnualSavings
        : key === "cubeReduction"
          ? b.cubeReduction
          : key === "shipmentVolume"
            ? b.shipmentVolume
            : key === "damageRisk"
              ? b.damageRiskChange
              : b.sustainabilityImpact;
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return (av - bv) * dir;
  });
}

/** Clearly labeled sample history for empty-state demos */
export function buildSampleHistory(now = new Date()): RoiHistoryRecord[] {
  const rows: RoiHistoryRecord[] = [];
  const skus = ["URO-210", "CV-440", "ORTH-112", "ENT-055", "GEN-901"];
  const wms = ["WMS-24x18x16", "WMS-22x16x14", "WMS-28x20x18"];
  const ai = ["PS-18x12x10", "PS-16x12x8", "PS-20x14x10", "PS-14x10x8"];
  const categories = ["Urology", "Cardiology", "Orthopedics", "ENT", "General"];
  for (let i = 0; i < 24; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i * 3);
    const wL = 22 + (i % 5);
    const wW = 16 + (i % 3);
    const wH = 14 + (i % 4);
    const aL = 16 + (i % 4);
    const aW = 11 + (i % 3);
    const aH = 8 + (i % 3);
    const wmsVol = wL * wW * wH;
    const aiVol = aL * aW * aH;
    const wmsCost = 18 + (i % 7);
    const aiCost = 11 + (i % 5);
    const category = categories[i % categories.length]!;
    rows.push({
      id: `sample-${i}`,
      at: d.toISOString(),
      skuCount: 1 + (i % 3),
      unitCount: 2 + (i % 4),
      totalWeight: 3 + (i % 6) * 0.5,
      wmsCarton: wms[i % wms.length]!,
      aiCarton: ai[i % ai.length]!,
      wmsCost,
      aiCost,
      savings: Math.max(0, wmsCost - aiCost),
      utilization: 78 + (i % 12),
      voidPct: 22 - (i % 10),
      dimWeightDelta: (wmsVol - aiVol) / 139,
      sustainability: 55 + (i % 30),
      score: 62 + (i % 28),
      confirmedWms: i % 5 === 0,
      wmsVolume: wmsVol,
      aiVolume: aiVol,
      wmsVoidPct: 35 + (i % 15),
      category,
      carrier: i % 2 === 0 ? "Parcel" : "LTL",
      validationStatus: i % 4 === 0 ? "validated" : "pending",
      recommendationStatus: i % 5 === 0 ? "confirmed" : "override",
      breakdown: {
        items: [{ skuId: skus[i % skus.length]!, name: `Sample SKU ${skus[i % skus.length]}`, qty: 1, category }],
        wms: { length: wL, width: wW, height: wH, cost: wmsCost, name: wms[i % wms.length], id: wms[i % wms.length] },
        ai: { length: aL, width: aW, height: aH, cost: aiCost, name: ai[i % ai.length], id: ai[i % ai.length] },
        aiScore: { damageRisk: 25 + (i % 20), voidPct: 22 - (i % 10), dunnageVolEst: aiVol * 0.12 },
        wmsScore: { damageRisk: 40 + (i % 25), voidPct: 35 + (i % 15), dunnageVolEst: wmsVol * 0.22 },
        fitStatus: i % 5 === 0 ? "recommended" : "not-recommended",
      },
    });
  }
  return rows;
}

function periodKey(iso: string, range: DashboardFilters["timeRange"]): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "Unknown";
  if (range === "month" || range === "custom") {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  if (range === "quarter") {
    const q = Math.floor(d.getMonth() / 3) + 1;
    return `${d.getFullYear()}-Q${q}`;
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function buildExecutiveDashboard(options: {
  history: RoiHistoryRecord[];
  assumptions?: RoiAssumptions;
  filters?: Partial<DashboardFilters>;
  catalogCartonCount?: number;
  forceSample?: boolean;
}): ExecutiveDashboardModel {
  const assumptions = options.assumptions ?? DEFAULT_ROI_ASSUMPTIONS;
  const baseFilters: DashboardFilters = {
    dateFrom: null,
    dateTo: null,
    timeRange: "year",
    category: "",
    carrier: "",
    recommendationStatus: "",
    validationStatus: "",
    ...options.filters,
  };
  const filters = applyTimeRangePreset(baseFilters);

  const live = options.history ?? [];
  const usingSample = options.forceSample === true || live.length === 0;
  const sourceIntegrity: DataIntegrity = usingSample ? "Sample" : "Estimated";
  const raw = usingSample ? buildSampleHistory() : live;
  const filtered = filterHistory(raw, filters);

  const missingFields: string[] = [];
  if (!usingSample) {
    if (!filtered.some((r) => resolveVolumes(r).wms != null)) {
      missingFields.push("wmsVolume / carton dimensions on history (corrugate & space cost partial)");
    }
    if (!filtered.some((r) => r.category || r.breakdown?.items?.some((i) => i.category))) {
      missingFields.push("category");
    }
    if (!filtered.some((r) => r.carrier)) missingFields.push("carrier");
    if (!filtered.some((r) => r.validationStatus)) missingFields.push("validationStatus (physical validation)");
    missingFields.push("actual freight invoices (using allocated trailer-space cost)");
    missingFields.push("actual damage claims (using configured damage rates)");
    missingFields.push("measured CO₂ / landfill (using conversion assumptions)");
  }

  const n = filtered.length;
  const volumes = filtered.map(resolveVolumes);
  const volDeltas = volumes
    .map((v) => (v.wms != null && v.ai != null ? v.wms - v.ai : null))
    .filter((x): x is number => x != null && x > 0);
  const avgVolDelta = avg(volDeltas);
  const avgSavings = avg(filtered.map((r) => r.savings));
  const avgUtilAi = avg(filtered.map((r) => r.utilization));
  const avgUtilWms = avg(
    filtered.map((r) => {
      const v = resolveVolumes(r);
      if (v.wms == null || v.ai == null || r.utilization <= 0) return null;
      // approximate WMS util from volume ratio
      return r.utilization * (v.ai / v.wms);
    }).filter((x): x is number => x != null),
  );
  const avgVoidAi = avg(filtered.map((r) => r.voidPct));
  const avgVoidWms = avg(
    filtered.map((r) => r.wmsVoidPct ?? r.breakdown?.wmsScore?.voidPct).filter((x): x is number => x != null),
  );
  const avgAiVol = avg(volumes.map((v) => v.ai).filter((x): x is number => x != null));
  const avgWmsVol = avg(volumes.map((v) => v.wms).filter((x): x is number => x != null));
  const avgPackCostAi = avg(filtered.map((r) => r.aiCost));
  const avgPackCostWms = avg(filtered.map((r) => r.wmsCost));
  const avgDimDelta = avg(filtered.map((r) => r.dimWeightDelta));
  // AI-driven change rate: share of analyses where AI carton differs from WMS
  const aiAdoptionRate = n ? (filtered.filter((r) => !r.confirmedWms).length / n) * 100 : null;
  const validationRate = (() => {
    const withVal = filtered.filter((r) => r.validationStatus);
    if (!withVal.length) return null;
    return (withVal.filter((r) => r.validationStatus === "validated").length / withVal.length) * 100;
  })();

  const perShipmentCorrugateSqFt =
    avgWmsVol != null && avgAiVol != null
      ? (() => {
          // Prefer real dims when available
          const diffs = filtered
            .map((r) => {
              const w = r.breakdown?.wms;
              const a = r.breakdown?.ai;
              if (!w || !a) return null;
              return Math.max(0, corrugatedSqFt(w.length, w.width, w.height) - corrugatedSqFt(a.length, a.width, a.height));
            })
            .filter((x): x is number => x != null);
          return avg(diffs);
        })()
      : null;

  const perShipmentDunnageCuIn = avg(
    filtered
      .map((r) => {
        const w = resolveDunnageVol(r, "wms");
        const a = resolveDunnageVol(r, "ai");
        if (w == null || a == null) return null;
        return Math.max(0, w - a);
      })
      .filter((x): x is number => x != null),
  );

  const ship = assumptions.annualShipmentVolume;
  const transportPerShip =
    avgVolDelta != null
      ? allocatedTrailerSpaceCost(avgVolDelta, assumptions.transportationCostPerCuIn)
      : null;
  const corrugatePerShip =
    perShipmentCorrugateSqFt != null ? perShipmentCorrugateSqFt * assumptions.corrugatedCostPerSqFt : null;
  const dunnagePerShip =
    perShipmentDunnageCuIn != null ? perShipmentDunnageCuIn * assumptions.dunnageCostPerCuIn : null;
  const laborPerShip =
    engineeringHoursSavedPerShipment(assumptions) * assumptions.costPerEngineeringHour +
    (assumptions.packTimeReductionMinutes / 60) * assumptions.costPerEngineeringHour * 0.45;

  const packagingPerShip =
    avgSavings != null
      ? avgSavings
      : corrugatePerShip != null && dunnagePerShip != null
        ? corrugatePerShip + dunnagePerShip
        : null;

  const annualTransport =
    transportPerShip != null ? annualizePerShipment(transportPerShip, ship) : null;
  const annualCorrugate =
    corrugatePerShip != null ? annualizePerShipment(corrugatePerShip, ship) : null;
  const annualDunnage =
    dunnagePerShip != null ? annualizePerShipment(dunnagePerShip, ship) : null;
  const annualLabor = annualizePerShipment(laborPerShip, ship);
  const annualDamage = damageCostAvoidanceAnnual(assumptions);
  const annualPackagingMaterial =
    annualCorrugate != null && annualDunnage != null
      ? annualCorrugate + annualDunnage
      : packagingPerShip != null
        ? annualizePerShipment(packagingPerShip, ship)
        : annualCorrugate ?? annualDunnage;

  const parts = [annualTransport, annualCorrugate, annualDunnage, annualLabor, annualDamage];
  const annualTotal =
    parts.every((p) => p == null)
      ? null
      : sum(parts.map((p) => p ?? 0));

  // Prefer composing total from known categories; include carton cost savings if material parts missing
  const annualCartonCost =
    avgSavings != null ? annualizePerShipment(avgSavings, ship) : null;
  const annualBenefit =
    annualTotal != null
      ? annualTotal + (annualCorrugate == null && annualDunnage == null && annualCartonCost != null ? annualCartonCost : 0)
      : annualCartonCost != null
        ? annualCartonCost + annualLabor + annualDamage + (annualTransport ?? 0)
        : null;

  const programCost = annualProgramCost(assumptions);
  const roiPct = annualBenefit != null ? calculateRoiPercent(annualBenefit, programCost) : null;
  const payback = annualBenefit != null ? calculatePaybackMonths(annualBenefit, programCost) : null;
  const engHoursAnnual =
    engineeringHoursSavedPerShipment(assumptions) * ship;

  const tip = (formula: string, source: string) => ({ tooltip: formula, source });

  const valueCreated: ValueCreatedBreakdown = {
    transportation: metric({
      label: "Transportation Savings",
      value: annualTransport,
      integrity: sourceIntegrity,
      unit: "currency",
      changeVsBaseline: annualTransport,
      trend: annualTransport != null && annualTransport > 0 ? "up" : "unknown",
      ...tip(
        "Allocated Trailer-Space Cost = Σ(max(0, WMS vol − AI vol)) × cost per in³, annualized. Not actual freight invoices.",
        "Assumptions.transportationCostPerCuIn × volume delta",
      ),
    }),
    corrugated: metric({
      label: "Corrugated Savings",
      value: annualCorrugate,
      integrity: sourceIntegrity,
      unit: "currency",
      changeVsBaseline: annualCorrugate,
      trend: annualCorrugate != null && annualCorrugate > 0 ? "up" : "unknown",
      ...tip(
        "Corrugate $ = Δ surface area (sq ft) × corrugatedCostPerSqFt × annual shipments",
        "Carton outer dimensions + Assumptions.corrugatedCostPerSqFt",
      ),
    }),
    dunnage: metric({
      label: "Dunnage Savings",
      value: annualDunnage,
      integrity: sourceIntegrity,
      unit: "currency",
      changeVsBaseline: annualDunnage,
      trend: annualDunnage != null && annualDunnage > 0 ? "up" : "unknown",
      ...tip(
        "Dunnage $ = Δ estimated void fill (in³) × dunnageCostPerCuIn × annual shipments",
        "Cubing void / dunnageVolEst + Assumptions.dunnageCostPerCuIn",
      ),
    }),
    labor: metric({
      label: "Labor Savings",
      value: annualLabor,
      integrity: "Projected",
      unit: "currency",
      changeVsBaseline: annualLabor,
      trend: "up",
      ...tip(
        "Labor $ = (engineering minutes saved + pack-time reduction) × labor rates × annual shipments",
        "Assumptions: engineering minutes, pack time, costPerEngineeringHour",
      ),
    }),
    damageAvoidance: metric({
      label: "Damage Cost Avoidance",
      value: annualDamage,
      integrity: "Projected",
      unit: "currency",
      changeVsBaseline: annualDamage,
      trend: "up",
      ...tip(
        "(baselineDamageRate − optimizedDamageRate) × annualShipmentVolume × costPerDamagedShipment",
        "Configurable damage-rate assumptions (not live claims data)",
      ),
    }),
    total: metric({
      label: "Annual Value Created",
      value: annualBenefit,
      integrity: sourceIntegrity,
      unit: "currency",
      changeVsBaseline: annualBenefit,
      trend: annualBenefit != null && annualBenefit > 0 ? "up" : "unknown",
      ...tip(
        "Transportation + Corrugated + Dunnage + Labor + Damage Avoidance (+ carton cost when surface/void unavailable)",
        "roi.buildExecutiveDashboard",
      ),
    }),
  };

  const beforeAfter: BeforeAfterRow[] = [
    {
      metric: "Average cube utilization",
      without: metric({
        label: "Without CartonIQ",
        value: avgUtilWms,
        integrity: sourceIntegrity,
        unit: "percent",
        changeVsBaseline: null,
        trend: "unknown",
        ...tip("Estimated from WMS carton volume vs packed item volume", "History volumes + AI util"),
      }),
      with: metric({
        label: "With CartonIQ",
        value: avgUtilAi,
        integrity: usingSample ? "Sample" : "Actual",
        unit: "percent",
        changeVsBaseline: avgUtilAi != null && avgUtilWms != null ? avgUtilAi - avgUtilWms : null,
        trend: avgUtilAi != null && avgUtilWms != null && avgUtilAi > avgUtilWms ? "up" : "flat",
        ...tip("Mean AI recommendation utilization from analyses", "AnalysisRecord.utilization"),
      }),
    },
    {
      metric: "Average carton volume",
      without: metric({
        label: "Without CartonIQ",
        value: avgWmsVol,
        integrity: sourceIntegrity,
        unit: "cu_in",
        changeVsBaseline: null,
        trend: "unknown",
        ...tip("Mean WMS / baseline carton L×W×H", "History carton dims"),
      }),
      with: metric({
        label: "With CartonIQ",
        value: avgAiVol,
        integrity: usingSample ? "Sample" : "Actual",
        unit: "cu_in",
        changeVsBaseline: avgWmsVol != null && avgAiVol != null ? avgAiVol - avgWmsVol : null,
        trend: avgWmsVol != null && avgAiVol != null && avgAiVol < avgWmsVol ? "up" : "flat",
        ...tip("Mean Packsize / AI carton volume", "History AI carton dims"),
      }),
    },
    {
      metric: "Average paper dunnage usage",
      without: metric({
        label: "Without CartonIQ",
        value: avg(
          filtered.map((r) => resolveDunnageVol(r, "wms")).filter((x): x is number => x != null),
        ),
        integrity: sourceIntegrity,
        unit: "cu_in",
        changeVsBaseline: null,
        trend: "unknown",
        ...tip("Estimated void fill volume in baseline carton", "void% × carton volume"),
      }),
      with: metric({
        label: "With CartonIQ",
        value: avg(
          filtered.map((r) => resolveDunnageVol(r, "ai")).filter((x): x is number => x != null),
        ),
        integrity: sourceIntegrity,
        unit: "cu_in",
        changeVsBaseline: perShipmentDunnageCuIn != null ? -perShipmentDunnageCuIn : null,
        trend: perShipmentDunnageCuIn != null && perShipmentDunnageCuIn > 0 ? "up" : "flat",
        ...tip("Estimated void fill in AI carton", "void% × carton volume / dunnageVolEst"),
      }),
    },
    {
      metric: "Average packaging cost per shipment",
      without: metric({
        label: "Without CartonIQ",
        value: avgPackCostWms,
        integrity: usingSample ? "Sample" : "Actual",
        unit: "currency",
        changeVsBaseline: null,
        trend: "unknown",
        ...tip("Mean WMS carton unit cost", "AnalysisRecord.wmsCost"),
      }),
      with: metric({
        label: "With CartonIQ",
        value: avgPackCostAi,
        integrity: usingSample ? "Sample" : "Actual",
        unit: "currency",
        changeVsBaseline: avgPackCostWms != null && avgPackCostAi != null ? avgPackCostAi - avgPackCostWms : null,
        trend: avgPackCostAi != null && avgPackCostWms != null && avgPackCostAi < avgPackCostWms ? "up" : "flat",
        ...tip("Mean AI / Packsize carton unit cost", "AnalysisRecord.aiCost"),
      }),
    },
    {
      metric: "Average allocated trailer-space cost",
      without: metric({
        label: "Without CartonIQ",
        value:
          avgWmsVol != null
            ? allocatedTrailerSpaceCost(avgWmsVol, assumptions.transportationCostPerCuIn)
            : null,
        integrity: "Estimated",
        unit: "currency",
        changeVsBaseline: null,
        trend: "unknown",
        ...tip("Carton volume × cost per cubic inch (allocated, not invoice freight)", "Assumptions.transportationCostPerCuIn"),
      }),
      with: metric({
        label: "With CartonIQ",
        value:
          avgAiVol != null
            ? allocatedTrailerSpaceCost(avgAiVol, assumptions.transportationCostPerCuIn)
            : null,
        integrity: "Estimated",
        unit: "currency",
        changeVsBaseline: transportPerShip != null ? -transportPerShip : null,
        trend: transportPerShip != null && transportPerShip > 0 ? "up" : "flat",
        ...tip("AI carton volume × cost per cubic inch", "Assumptions.transportationCostPerCuIn"),
      }),
    },
    {
      metric: "Damage rate",
      without: metric({
        label: "Without CartonIQ",
        value: assumptions.baselineDamageRate * 100,
        integrity: "Projected",
        unit: "percent",
        changeVsBaseline: null,
        trend: "unknown",
        ...tip("Configurable baseline damage rate assumption", "Assumptions.baselineDamageRate"),
      }),
      with: metric({
        label: "With CartonIQ",
        value: assumptions.optimizedDamageRate * 100,
        integrity: "Projected",
        unit: "percent",
        changeVsBaseline: (assumptions.optimizedDamageRate - assumptions.baselineDamageRate) * 100,
        trend: "up",
        ...tip("Configurable optimized damage rate assumption", "Assumptions.optimizedDamageRate"),
      }),
    },
    {
      metric: "Engineering time per recommendation",
      without: metric({
        label: "Without CartonIQ",
        value: assumptions.baselineEngineeringMinutes,
        integrity: "Projected",
        unit: "minutes",
        changeVsBaseline: null,
        trend: "unknown",
        ...tip("Manual engineering minutes assumption", "Assumptions.baselineEngineeringMinutes"),
      }),
      with: metric({
        label: "With CartonIQ",
        value: assumptions.cartoniqEngineeringMinutes,
        integrity: "Projected",
        unit: "minutes",
        changeVsBaseline: assumptions.cartoniqEngineeringMinutes - assumptions.baselineEngineeringMinutes,
        trend: "up",
        ...tip("CartonIQ recommendation minutes assumption", "Assumptions.cartoniqEngineeringMinutes"),
      }),
    },
    {
      metric: "Percentage of oversized cartons",
      without: metric({
        label: "Without CartonIQ",
        value: (() => {
          const vals = filtered.map((r) => r.wmsVoidPct ?? r.breakdown?.wmsScore?.voidPct).filter((x): x is number => x != null);
          if (!vals.length) return null;
          return (vals.filter((v) => v > 30).length / vals.length) * 100;
        })(),
        integrity: sourceIntegrity,
        unit: "percent",
        changeVsBaseline: null,
        trend: "unknown",
        ...tip("Share of baseline cartons with void > 30%", "History void metrics"),
      }),
      with: metric({
        label: "With CartonIQ",
        value: n ? (filtered.filter((r) => r.voidPct > 30).length / n) * 100 : null,
        integrity: usingSample ? "Sample" : "Actual",
        unit: "percent",
        changeVsBaseline: null,
        trend: "up",
        ...tip("Share of AI cartons with void > 30%", "AnalysisRecord.voidPct"),
      }),
    },
  ];

  // Savings by category over time
  const byPeriod = new Map<string, RoiHistoryRecord[]>();
  for (const r of filtered) {
    const k = periodKey(r.at, filters.timeRange);
    if (!byPeriod.has(k)) byPeriod.set(k, []);
    byPeriod.get(k)!.push(r);
  }
  const periodKeys = [...byPeriod.keys()].sort();
  const savingsByCategory: SavingsByCategoryPoint[] = periodKeys.map((period) => {
    const group = byPeriod.get(period)!;
    const gVol = avg(
      group
        .map((r) => {
          const v = resolveVolumes(r);
          return v.wms != null && v.ai != null ? Math.max(0, v.wms - v.ai) : null;
        })
        .filter((x): x is number => x != null),
    );
    const gSave = avg(group.map((r) => r.savings)) ?? 0;
    const scale = ship / Math.max(group.length, 1) / Math.max(periodKeys.length, 1);
    const transport =
      gVol != null ? allocatedTrailerSpaceCost(gVol, assumptions.transportationCostPerCuIn) * scale : 0;
    return {
      period,
      transportation: Math.round(transport),
      corrugated: Math.round((annualCorrugate ?? 0) / Math.max(periodKeys.length, 1)),
      dunnage: Math.round((annualDunnage ?? 0) / Math.max(periodKeys.length, 1)),
      labor: Math.round(annualLabor / Math.max(periodKeys.length, 1)),
      damageAvoidance: Math.round(annualDamage / Math.max(periodKeys.length, 1)),
      integrity: sourceIntegrity,
      // include carton material as corrugated proxy when needed
      ...(gSave > 0 && annualCorrugate == null
        ? { corrugated: Math.round(gSave * scale) }
        : {}),
    };
  });

  const trends: TrendPoint[] = periodKeys.map((period) => {
    const group = byPeriod.get(period)!;
    const vols = group.map(resolveVolumes);
    return {
      period,
      cubeUtilization: avg(group.map((r) => r.utilization)),
      voidPct: avg(group.map((r) => r.voidPct)),
      cartonVolume: avg(vols.map((v) => v.ai).filter((x): x is number => x != null)),
      dunnagePct: avg(group.map((r) => r.voidPct)),
      engineeringScore: avg(group.map((r) => r.score)),
      acceptanceRate: (group.filter((r) => !r.confirmedWms).length / group.length) * 100,
      validationRate: (() => {
        const v = group.filter((r) => r.validationStatus);
        if (!v.length) return null;
        return (v.filter((r) => r.validationStatus === "validated").length / v.length) * 100;
      })(),
      integrity: sourceIntegrity,
    };
  });

  const cuInEliminatedAnnual =
    avgVolDelta != null ? annualizePerShipment(avgVolDelta, ship) : null;
  const trailersAvoided =
    cuInEliminatedAnnual != null
      ? cuInEliminatedAnnual /
        (assumptions.trailerVolumeCuIn * assumptions.optimizedTrailerUtilization)
      : null;

  const kraftLbPerShip =
    perShipmentDunnageCuIn != null ? perShipmentDunnageCuIn * assumptions.kraftLbPerCuIn : null;
  const corrugateLbPerShip =
    perShipmentCorrugateSqFt != null ? perShipmentCorrugateSqFt * assumptions.corrugateLbPerSqFt : null;
  const wasteLb =
    kraftLbPerShip != null || corrugateLbPerShip != null
      ? (kraftLbPerShip ?? 0) + (corrugateLbPerShip ?? 0)
      : null;
  const co2 =
    kraftLbPerShip != null || corrugateLbPerShip != null
      ? (kraftLbPerShip ?? 0) * assumptions.co2KgPerLbKraft * ship +
        (corrugateLbPerShip ?? 0) * assumptions.co2KgPerLbCorrugate * ship
      : null;

  const opportunities: OptimizationOpportunity[] = sortOpportunities(
    filtered.map((r) => {
      const v = resolveVolumes(r);
      const cubeRed = v.wms != null && v.ai != null ? v.wms - v.ai : null;
      const dunnageRed = (() => {
        const w = resolveDunnageVol(r, "wms");
        const a = resolveDunnageVol(r, "ai");
        if (w == null || a == null) return null;
        return w - a;
      })();
      const dmg =
        r.breakdown?.wmsScore?.damageRisk != null && r.breakdown?.aiScore?.damageRisk != null
          ? r.breakdown.aiScore.damageRisk - r.breakdown.wmsScore.damageRisk
          : null;
      return {
        id: r.id,
        skuOrOrderId: r.breakdown?.items?.[0]?.skuId ?? r.id,
        currentCarton: r.wmsCarton,
        recommendedCarton: r.aiCarton,
        currentVolume: v.wms,
        recommendedVolume: v.ai,
        cubeReduction: cubeRed,
        estimatedAnnualSavings:
          r.savings * (ship / Math.max(n, 1)) +
          (cubeRed != null
            ? allocatedTrailerSpaceCost(cubeRed, assumptions.transportationCostPerCuIn) *
              (ship / Math.max(n, 1))
            : 0),
        dunnageReduction: dunnageRed,
        damageRiskChange: dmg,
        sustainabilityImpact: r.sustainability,
        shipmentVolume: v.wms,
        status: r.recommendationStatus ?? (r.confirmedWms ? "Confirms WMS" : "AI override"),
        integrity: usingSample ? "Sample" : "Estimated",
      };
    }),
    "savings",
  ).slice(0, 25);

  const finNorm = normalize01(annualBenefit ?? 0, 0, 2_500_000);
  const transportNorm = normalize01(annualTransport ?? 0, 0, 1_200_000);
  const damageNorm = normalize01(
    Math.max(0, assumptions.baselineDamageRate - assumptions.optimizedDamageRate),
    0,
    0.02,
  );
  const sustainNorm = normalize01(co2 ?? 0, 0, 500_000);
  const laborNorm = normalize01(annualLabor, 0, 400_000);
  const overallScore = packagingValueScore(
    {
      financialSavings: finNorm,
      transportationEfficiency: transportNorm,
      damageReduction: damageNorm,
      sustainability: sustainNorm,
      laborSavings: laborNorm,
    },
    assumptions.valueScoreWeights,
  );

  const valueScore: PackagingValueScore = {
    overall: metric({
      label: "Packaging Value Score",
      value: overallScore,
      integrity: sourceIntegrity,
      unit: "number",
      changeVsBaseline: null,
      trend: "up",
      ...tip(
        "Weighted normalized score: financial 40%, transport 20%, damage 15%, sustainability 15%, labor 10%",
        "Assumptions.valueScoreWeights",
      ),
    }),
    categories: {
      financialSavings: metric({
        label: "Financial",
        value: Math.round(finNorm * 100),
        integrity: sourceIntegrity,
        unit: "number",
        changeVsBaseline: null,
        trend: "up",
        ...tip("Normalized annual benefit", "annualBenefit"),
      }),
      transportationEfficiency: metric({
        label: "Transportation",
        value: Math.round(transportNorm * 100),
        integrity: "Estimated",
        unit: "number",
        changeVsBaseline: null,
        trend: "up",
        ...tip("Normalized allocated space savings", "annualTransport"),
      }),
      damageReduction: metric({
        label: "Damage reduction",
        value: Math.round(damageNorm * 100),
        integrity: "Projected",
        unit: "number",
        changeVsBaseline: null,
        trend: "up",
        ...tip("Normalized damage-rate improvement", "Assumptions damage rates"),
      }),
      sustainability: metric({
        label: "Sustainability",
        value: Math.round(sustainNorm * 100),
        integrity: "Estimated",
        unit: "number",
        changeVsBaseline: null,
        trend: "up",
        ...tip("Normalized estimated CO₂ reduction", "Conversion assumptions"),
      }),
      laborSavings: metric({
        label: "Labor",
        value: Math.round(laborNorm * 100),
        integrity: "Projected",
        unit: "number",
        changeVsBaseline: null,
        trend: "up",
        ...tip("Normalized labor $ savings", "Engineering + pack-time assumptions"),
      }),
    },
    trend: trends.map((t) => ({
      period: t.period,
      score: Math.round(
        ((t.engineeringScore ?? 50) / 100) * 40 +
          ((t.cubeUtilization ?? 70) / 100) * 30 +
          ((100 - (t.voidPct ?? 30)) / 100) * 30,
      ),
      integrity: t.integrity,
    })),
    explanation:
      overallScore >= 75
        ? "Value score is driven by strong annual benefit and transportation-space reduction."
        : overallScore >= 50
          ? "Value score is moderate — financial savings help, but damage/sustainability inputs remain assumption-based."
          : "Value score is limited by missing live freight/claims data or low measured savings in the selected range.",
  };

  const fmtPct = (v: number | null) => (v == null ? "—" : `${Math.round(v)}%`);
  const fmtMoney = (v: number | null) =>
    v == null ? "—" : `$${Math.round(v).toLocaleString()}`;

  const executiveSummary =
    annualBenefit == null
      ? "Data unavailable to compute an executive value summary for the selected filters. Run analyses or adjust assumptions."
      : `CartonIQ generated an ${sourceIntegrity.toLowerCase()} ${fmtMoney(annualBenefit)} in annual value by reducing carton volume, transportation space, dunnage, material use, engineering time, and damage-related costs. Average cube utilization improved from ${fmtPct(avgUtilWms)} to ${fmtPct(avgUtilAi)}, while ${sourceIntegrity.toLowerCase()} packaging cost per shipment decreased by ${
          avgPackCostWms != null && avgPackCostAi != null && avgPackCostWms > 0
            ? `${Math.round(((avgPackCostWms - avgPackCostAi) / avgPackCostWms) * 100)}%`
            : "—"
        }.`;

  const uniq = (xs: Array<string | undefined>) =>
    [...new Set(xs.filter((x): x is string => !!x))].sort();

  return {
    generatedAt: new Date().toISOString(),
    usingSampleData: usingSample,
    filters,
    assumptions,
    executiveSummary,
    kpis: {
      totalAnnualSavings: valueCreated.total,
      transportationSavings: valueCreated.transportation,
      packagingMaterialSavings: metric({
        label: "Packaging Material Savings",
        value: annualPackagingMaterial ?? annualCartonCost,
        integrity: sourceIntegrity,
        unit: "currency",
        changeVsBaseline: annualPackagingMaterial ?? annualCartonCost,
        trend: "up",
        ...tip(
          "Corrugated + dunnage $, or carton unit-cost savings when surface/void unavailable",
          "History costs + material assumptions",
        ),
      }),
      damageCostAvoidance: valueCreated.damageAvoidance,
      engineeringHoursSaved: metric({
        label: "Engineering Hours Saved",
        value: engHoursAnnual,
        integrity: "Projected",
        unit: "hours",
        changeVsBaseline: engHoursAnnual,
        trend: "up",
        ...tip(
          "(baselineEngineeringMinutes − cartoniqEngineeringMinutes) / 60 × annualShipmentVolume",
          "Assumptions",
        ),
      }),
      roiPercent: metric({
        label: "ROI %",
        value: roiPct,
        integrity: "Projected",
        unit: "percent",
        changeVsBaseline: roiPct,
        trend: roiPct != null && roiPct > 0 ? "up" : roiPct != null && roiPct < 0 ? "down" : "unknown",
        ...tip("(Annual Benefit − Annual Program Cost) ÷ Annual Program Cost × 100", "roi.calculateRoiPercent"),
      }),
      paybackPeriodMonths: metric({
        label: "Payback Period",
        value: payback,
        integrity: "Projected",
        unit: "months",
        changeVsBaseline: null,
        trend: payback != null && payback <= 12 ? "up" : "flat",
        ...tip("Annual Program Cost ÷ Annual Benefit × 12", "roi.calculatePaybackMonths"),
      }),
      packagesOptimized: metric({
        label: "Packages Optimized",
        value: usingSample ? ship : n > 0 ? Math.round((n / Math.max(raw.length, 1)) * ship) : n,
        integrity: usingSample ? "Sample" : "Projected",
        unit: "number",
        changeVsBaseline: null,
        trend: "up",
        ...tip(
          usingSample
            ? "Sample uses configured annualShipmentVolume"
            : "Projected from observed analyses scaled to annualShipmentVolume",
          "Assumptions.annualShipmentVolume + history",
        ),
      }),
    },
    valueCreated,
    beforeAfter,
    savingsByCategory,
    trends,
    transportation: {
      cuInEliminated: metric({
        label: "Cubic inches eliminated",
        value: cuInEliminatedAnnual,
        integrity: sourceIntegrity,
        unit: "cu_in",
        changeVsBaseline: cuInEliminatedAnnual,
        trend: "up",
        ...tip("Mean (WMS − AI) volume × annual shipments", "History volumes"),
      }),
      cuFtEliminated: metric({
        label: "Cubic feet eliminated",
        value: cuInEliminatedAnnual != null ? cuInToCuFt(cuInEliminatedAnnual) : null,
        integrity: sourceIntegrity,
        unit: "cu_ft",
        changeVsBaseline: null,
        trend: "up",
        ...tip("Cubic inches ÷ 1728", "Derived"),
      }),
      trailerUtilBefore: metric({
        label: "Trailer utilization before",
        value: assumptions.baselineTrailerUtilization * 100,
        integrity: "Projected",
        unit: "percent",
        changeVsBaseline: null,
        trend: "unknown",
        ...tip("Configurable baseline trailer fill", "Assumptions.baselineTrailerUtilization"),
      }),
      trailerUtilAfter: metric({
        label: "Trailer utilization after",
        value: assumptions.optimizedTrailerUtilization * 100,
        integrity: "Projected",
        unit: "percent",
        changeVsBaseline:
          (assumptions.optimizedTrailerUtilization - assumptions.baselineTrailerUtilization) * 100,
        trend: "up",
        ...tip("Configurable optimized trailer fill", "Assumptions.optimizedTrailerUtilization"),
      }),
      trailerEquivalentsAvoided: metric({
        label: "Trailer equivalents avoided",
        value: trailersAvoided,
        integrity: "Estimated",
        unit: "number",
        changeVsBaseline: trailersAvoided,
        trend: "up",
        ...tip(
          "Annual in³ eliminated ÷ (trailerVolumeCuIn × optimizedTrailerUtilization)",
          "Assumptions trailer volume",
        ),
      }),
      allocatedSpaceCostAvoided: metric({
        label: "Allocated Trailer-Space Cost avoided",
        value: annualTransport,
        integrity: "Estimated",
        unit: "currency",
        changeVsBaseline: annualTransport,
        trend: "up",
        ...tip(
          "Allocated Trailer-Space Cost = volume × cost per in³ (not actual freight unless carrier data is connected)",
          "Assumptions.transportationCostPerCuIn",
        ),
      }),
      costPerCuIn: metric({
        label: "Cost per cubic inch",
        value: assumptions.transportationCostPerCuIn,
        integrity: "Estimated",
        unit: "currency",
        changeVsBaseline: null,
        trend: "flat",
        ...tip("Configurable allocated space rate", "Assumptions.transportationCostPerCuIn"),
      }),
      dimWeightReductionLb: metric({
        label: "Dimensional-weight reduction",
        value: avgDimDelta != null ? annualizePerShipment(avgDimDelta, ship) : null,
        integrity: usingSample ? "Sample" : "Actual",
        unit: "lb",
        changeVsBaseline: avgDimDelta,
        trend: avgDimDelta != null && avgDimDelta > 0 ? "up" : "flat",
        ...tip("Mean dim-weight delta (WMS − AI) × annual shipments; dim wt = L×W×H/139", "AnalysisRecord.dimWeightDelta"),
      }),
    },
    sustainability: {
      corrugatedSqFtSaved: metric({
        label: "Corrugated sq ft saved",
        value:
          perShipmentCorrugateSqFt != null
            ? annualizePerShipment(perShipmentCorrugateSqFt, ship)
            : null,
        integrity: sourceIntegrity,
        unit: "sq_ft",
        changeVsBaseline: null,
        trend: "up",
        ...tip("Δ carton surface area × annual shipments", "Carton dimensions"),
      }),
      kraftLbSaved: metric({
        label: "Kraft paper pounds saved",
        value: kraftLbPerShip != null ? annualizePerShipment(kraftLbPerShip, ship) : null,
        integrity: "Estimated",
        unit: "lb",
        changeVsBaseline: null,
        trend: "up",
        ...tip("Δ dunnage in³ × kraftLbPerCuIn × annual shipments", "Assumptions.kraftLbPerCuIn"),
      }),
      plasticLbEliminated: metric({
        label: "Plastic packaging eliminated",
        value:
          assumptions.plasticLbEliminatedPerShipment > 0
            ? annualizePerShipment(assumptions.plasticLbEliminatedPerShipment, ship)
            : null,
        integrity: assumptions.plasticLbEliminatedPerShipment > 0 ? "Projected" : "Estimated",
        unit: "lb",
        changeVsBaseline: null,
        trend: assumptions.plasticLbEliminatedPerShipment > 0 ? "up" : "unknown",
        ...tip(
          assumptions.plasticLbEliminatedPerShipment > 0
            ? "plasticLbEliminatedPerShipment × annual shipments"
            : "Data unavailable — set Assumptions.plasticLbEliminatedPerShipment",
          "Assumptions.plasticLbEliminatedPerShipment",
        ),
      }),
      packagingWasteLbReduced: metric({
        label: "Packaging waste reduced",
        value: wasteLb != null ? annualizePerShipment(wasteLb, ship) : null,
        integrity: "Estimated",
        unit: "lb",
        changeVsBaseline: null,
        trend: "up",
        ...tip("Corrugate lb + kraft lb avoided", "Derived sustainability assumptions"),
      }),
      co2KgReduced: metric({
        label: "Estimated CO₂ reduction",
        value: co2,
        integrity: "Estimated",
        unit: "kg",
        changeVsBaseline: null,
        trend: "up",
        ...tip("Material lb × CO₂ factors (assumptions — not measured emissions)", "Assumptions co2KgPerLb*"),
      }),
      landfillM3Reduced: metric({
        label: "Estimated landfill reduction",
        value: wasteLb != null ? annualizePerShipment(wasteLb, ship) * assumptions.landfillM3PerLb : null,
        integrity: "Estimated",
        unit: "m3",
        changeVsBaseline: null,
        trend: "up",
        ...tip("Waste lb × landfillM3PerLb", "Assumptions.landfillM3PerLb"),
      }),
    },
    operations: {
      recommendationsGenerated: metric({
        label: "Recommendations generated",
        value: n,
        integrity: usingSample ? "Sample" : "Actual",
        unit: "number",
        changeVsBaseline: null,
        trend: "up",
        ...tip("Count of analyses in filtered range", "Analysis history"),
      }),
      avgRecommendationMinutes: metric({
        label: "Average recommendation time",
        value: assumptions.cartoniqEngineeringMinutes,
        integrity: "Projected",
        unit: "minutes",
        changeVsBaseline: null,
        trend: "up",
        ...tip("Configured CartonIQ recommendation minutes", "Assumptions.cartoniqEngineeringMinutes"),
      }),
      engineeringHoursAvoided: metric({
        label: "Manual engineering hours avoided",
        value: engHoursAnnual,
        integrity: "Projected",
        unit: "hours",
        changeVsBaseline: null,
        trend: "up",
        ...tip("Minutes saved × annual volume / 60", "Assumptions"),
      }),
      packTimeReductionMinutes: metric({
        label: "Average pack-time reduction",
        value: assumptions.packTimeReductionMinutes,
        integrity: "Projected",
        unit: "minutes",
        changeVsBaseline: null,
        trend: "up",
        ...tip("Configured pack-time reduction per shipment", "Assumptions.packTimeReductionMinutes"),
      }),
      skusAnalyzed: metric({
        label: "SKUs analyzed",
        value: uniq(filtered.flatMap((r) => r.breakdown?.items?.map((i) => i.skuId) ?? [])).length || sum(filtered.map((r) => r.skuCount)),
        integrity: usingSample ? "Sample" : "Actual",
        unit: "number",
        changeVsBaseline: null,
        trend: "up",
        ...tip("Distinct SKUs in history snapshots", "Analysis breakdown items"),
      }),
      cartonsEvaluated: metric({
        label: "Packsize cartons evaluated",
        value: options.catalogCartonCount ?? uniq(filtered.map((r) => r.aiCarton)).length,
        integrity: options.catalogCartonCount != null ? "Actual" : sourceIntegrity,
        unit: "number",
        changeVsBaseline: null,
        trend: "flat",
        ...tip("Packsize catalog size when provided, else distinct AI cartons in history", "Carton library / history"),
      }),
      acceptanceRate: metric({
        label: "Recommendation acceptance rate",
        value: aiAdoptionRate,
        integrity: usingSample ? "Sample" : "Actual",
        unit: "percent",
        changeVsBaseline: null,
        trend: "up",
        ...tip("Share of analyses where AI carton differs from WMS (AI-driven change)", "1 − confirmedWms rate"),
      }),
    },
    opportunities,
    roi: {
      annualBenefit: valueCreated.total,
      annualProgramCost: metric({
        label: "Annual Program Cost",
        value: programCost,
        integrity: "Projected",
        unit: "currency",
        changeVsBaseline: null,
        trend: "flat",
        ...tip("software + implementation + support + annual labor", "Assumptions program costs"),
      }),
      roiPercent: metric({
        label: "ROI %",
        value: roiPct,
        integrity: "Projected",
        unit: "percent",
        changeVsBaseline: null,
        trend: roiPct != null && roiPct > 0 ? "up" : "down",
        ...tip("(Annual Benefit − Annual Program Cost) ÷ Annual Program Cost × 100", "roi.calculateRoiPercent"),
      }),
      paybackMonths: metric({
        label: "Payback (months)",
        value: payback,
        integrity: "Projected",
        unit: "months",
        changeVsBaseline: null,
        trend: "up",
        ...tip("Annual Program Cost ÷ Annual Benefit × 12", "roi.calculatePaybackMonths"),
      }),
    },
    valueScore,
    availableFilterOptions: {
      categories: uniq([
        ...raw.map((r) => r.category),
        ...raw.flatMap((r) => r.breakdown?.items?.map((i) => i.category) ?? []),
      ]),
      carriers: uniq(raw.map((r) => r.carrier)),
      recommendationStatuses: uniq(
        raw.map((r) => r.recommendationStatus ?? (r.confirmedWms ? "confirmed" : "override")),
      ),
      validationStatuses: uniq(raw.map((r) => r.validationStatus)),
    },
    missingFields: [...new Set(missingFields)],
  };
}

export function formatMetricNumber(m: MetricValue): string {
  if (m.value == null || !Number.isFinite(m.value)) return "Data unavailable";
  const v = m.value;
  switch (m.unit) {
    case "currency":
      return v < 0.01 && v > 0
        ? `$${v.toFixed(4)}`
        : `$${Math.round(v).toLocaleString()}`;
    case "percent":
      return `${Math.round(v * 10) / 10}%`;
    case "months":
      return `${Math.round(v * 10) / 10} mo`;
    case "cu_in":
      return `${Math.round(v).toLocaleString()} in³`;
    case "cu_ft":
      return `${Math.round(v).toLocaleString()} ft³`;
    case "lb":
      return `${Math.round(v).toLocaleString()} lb`;
    case "sq_ft":
      return `${Math.round(v).toLocaleString()} ft²`;
    case "kg":
      return `${Math.round(v).toLocaleString()} kg`;
    case "m3":
      return `${(Math.round(v * 100) / 100).toLocaleString()} m³`;
    case "hours":
      return `${Math.round(v).toLocaleString()} h`;
    case "minutes":
      return `${Math.round(v * 10) / 10} min`;
    default:
      return Math.round(v).toLocaleString();
  }
}

export function dashboardToKpiCsv(model: ExecutiveDashboardModel): string {
  const rows: string[][] = [["KPI", "Value", "Integrity", "Unit", "Source", "Tooltip"]];
  const add = (m: MetricValue) => {
    rows.push([
      m.label,
      m.value == null ? "" : String(m.value),
      m.integrity,
      m.unit,
      m.source,
      m.tooltip.replace(/\n/g, " "),
    ]);
  };
  Object.values(model.kpis).forEach(add);
  add(model.valueCreated.total);
  Object.values(model.valueCreated).forEach((m) => {
    if (m !== model.valueCreated.total) add(m);
  });
  return rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
}

export function opportunitiesToCsv(rows: OptimizationOpportunity[]): string {
  const header = [
    "ID",
    "SKU/Order",
    "Current Carton",
    "Recommended Carton",
    "Current Volume",
    "Recommended Volume",
    "Cube Reduction",
    "Est. Annual Savings",
    "Dunnage Reduction",
    "Damage Risk Change",
    "Status",
    "Integrity",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.id,
        r.skuOrOrderId,
        r.currentCarton,
        r.recommendedCarton,
        r.currentVolume ?? "",
        r.recommendedVolume ?? "",
        r.cubeReduction ?? "",
        r.estimatedAnnualSavings ?? "",
        r.dunnageReduction ?? "",
        r.damageRiskChange ?? "",
        r.status,
        r.integrity,
      ]
        .map((c) => `"${String(c).replace(/"/g, '""')}"`)
        .join(","),
    );
  }
  return lines.join("\n");
}
