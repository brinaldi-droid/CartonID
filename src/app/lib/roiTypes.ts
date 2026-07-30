/** Executive ROI dashboard domain types — calculations live in roi.ts */

export type DataIntegrity = "Actual" | "Estimated" | "Projected" | "Sample";

export type TimeRangePreset = "month" | "quarter" | "year" | "custom";

export type OpportunitySortKey =
  | "savings"
  | "cubeReduction"
  | "shipmentVolume"
  | "damageRisk"
  | "sustainability";

export interface RoiAssumptions {
  /** Annual software license / subscription ($) */
  softwareCost: number;
  /** One-time implementation amortized annually ($) */
  implementationCost: number;
  /** Annual support ($) */
  supportCost: number;
  /** Annual program labor overhead ($) */
  annualLaborCost: number;
  /** Shipments per year used to annualize per-shipment savings */
  annualShipmentVolume: number;
  /** Cost avoided per prevented damage event ($) */
  costPerDamagedShipment: number;
  /** Baseline damage rate (fraction 0–1) without CartonIQ */
  baselineDamageRate: number;
  /** Expected damage rate with CartonIQ */
  optimizedDamageRate: number;
  /** Engineering hour cost ($) */
  costPerEngineeringHour: number;
  /** Minutes per manual engineering recommendation (baseline) */
  baselineEngineeringMinutes: number;
  /** Minutes per CartonIQ recommendation */
  cartoniqEngineeringMinutes: number;
  /** Corrugated cost per square foot ($) */
  corrugatedCostPerSqFt: number;
  /** Approximate corrugated area factor: surface ≈ factor × volume^(2/3) — used when only volume known */
  corrugatedSurfaceFactor: number;
  /** Dunnage (kraft) cost per cubic inch of void filled ($) */
  dunnageCostPerCuIn: number;
  /** Kraft paper density lb / in³ of packed dunnage */
  kraftLbPerCuIn: number;
  /** Allocated trailer-space cost per cubic inch ($/in³) — NOT actual freight unless wired to carrier data */
  transportationCostPerCuIn: number;
  /** Trailer usable volume (in³) for equivalent-truck estimates */
  trailerVolumeCuIn: number;
  /** Baseline trailer fill fraction without optimization */
  baselineTrailerUtilization: number;
  /** Optimized trailer fill fraction */
  optimizedTrailerUtilization: number;
  /** CO₂ kg per lb of corrugate avoided (assumption) */
  co2KgPerLbCorrugate: number;
  /** CO₂ kg per lb of kraft avoided (assumption) */
  co2KgPerLbKraft: number;
  /** Corrugate lb per sq ft (assumption) */
  corrugateLbPerSqFt: number;
  /** Landfill m³ per lb packaging waste (assumption) */
  landfillM3PerLb: number;
  /** Plastic packaging lb eliminated per optimized shipment (assumption; 0 if unknown) */
  plasticLbEliminatedPerShipment: number;
  /** Pack-time reduction minutes per shipment (assumption) */
  packTimeReductionMinutes: number;
  /** Packaging Value Score weights (must sum ≈ 1) */
  valueScoreWeights: {
    financialSavings: number;
    transportationEfficiency: number;
    damageReduction: number;
    sustainability: number;
    laborSavings: number;
  };
}

export interface MetricValue {
  value: number | null;
  integrity: DataIntegrity;
  /** Human-readable formula / assumption */
  tooltip: string;
  /** Where the number came from */
  source: string;
  /** Absolute or % change vs baseline; null if unknown */
  changeVsBaseline: number | null;
  /** "up" = improvement for this metric's polarity */
  trend: "up" | "down" | "flat" | "unknown";
  unit: "currency" | "percent" | "number" | "months" | "cu_in" | "cu_ft" | "lb" | "sq_ft" | "kg" | "m3" | "hours" | "minutes";
  label: string;
}

export interface ValueCreatedBreakdown {
  transportation: MetricValue;
  corrugated: MetricValue;
  dunnage: MetricValue;
  labor: MetricValue;
  damageAvoidance: MetricValue;
  total: MetricValue;
}

export interface BeforeAfterRow {
  metric: string;
  without: MetricValue;
  with: MetricValue;
}

export interface SavingsByCategoryPoint {
  period: string;
  transportation: number;
  corrugated: number;
  dunnage: number;
  labor: number;
  damageAvoidance: number;
  integrity: DataIntegrity;
}

export interface TrendPoint {
  period: string;
  cubeUtilization: number | null;
  voidPct: number | null;
  cartonVolume: number | null;
  dunnagePct: number | null;
  engineeringScore: number | null;
  acceptanceRate: number | null;
  validationRate: number | null;
  integrity: DataIntegrity;
}

export interface TransportationImpact {
  cuInEliminated: MetricValue;
  cuFtEliminated: MetricValue;
  trailerUtilBefore: MetricValue;
  trailerUtilAfter: MetricValue;
  trailerEquivalentsAvoided: MetricValue;
  allocatedSpaceCostAvoided: MetricValue;
  costPerCuIn: MetricValue;
  dimWeightReductionLb: MetricValue;
}

export interface SustainabilityImpact {
  corrugatedSqFtSaved: MetricValue;
  kraftLbSaved: MetricValue;
  plasticLbEliminated: MetricValue;
  packagingWasteLbReduced: MetricValue;
  co2KgReduced: MetricValue;
  landfillM3Reduced: MetricValue;
}

export interface OperationalEfficiency {
  recommendationsGenerated: MetricValue;
  avgRecommendationMinutes: MetricValue;
  engineeringHoursAvoided: MetricValue;
  packTimeReductionMinutes: MetricValue;
  skusAnalyzed: MetricValue;
  cartonsEvaluated: MetricValue;
  acceptanceRate: MetricValue;
}

export interface OptimizationOpportunity {
  id: string;
  skuOrOrderId: string;
  currentCarton: string;
  recommendedCarton: string;
  currentVolume: number | null;
  recommendedVolume: number | null;
  cubeReduction: number | null;
  estimatedAnnualSavings: number | null;
  dunnageReduction: number | null;
  damageRiskChange: number | null;
  sustainabilityImpact: number | null;
  shipmentVolume: number | null;
  status: string;
  integrity: DataIntegrity;
}

export interface RoiMetrics {
  annualBenefit: MetricValue;
  annualProgramCost: MetricValue;
  roiPercent: MetricValue;
  paybackMonths: MetricValue;
}

export interface PackagingValueScore {
  overall: MetricValue;
  categories: {
    financialSavings: MetricValue;
    transportationEfficiency: MetricValue;
    damageReduction: MetricValue;
    sustainability: MetricValue;
    laborSavings: MetricValue;
  };
  trend: Array<{ period: string; score: number; integrity: DataIntegrity }>;
  explanation: string;
}

export interface DashboardFilters {
  dateFrom: string | null;
  dateTo: string | null;
  timeRange: TimeRangePreset;
  businessUnit: string;
  productFamily: string;
  site: string;
  region: string;
  carrier: string;
  sku: string;
  packsizeCarton: string;
  recommendationStatus: string;
  validationStatus: string;
}

export interface ExecutiveDashboardModel {
  generatedAt: string;
  usingSampleData: boolean;
  filters: DashboardFilters;
  assumptions: RoiAssumptions;
  executiveSummary: string;
  kpis: {
    totalAnnualSavings: MetricValue;
    transportationSavings: MetricValue;
    packagingMaterialSavings: MetricValue;
    damageCostAvoidance: MetricValue;
    engineeringHoursSaved: MetricValue;
    roiPercent: MetricValue;
    paybackPeriodMonths: MetricValue;
    packagesOptimized: MetricValue;
  };
  valueCreated: ValueCreatedBreakdown;
  beforeAfter: BeforeAfterRow[];
  savingsByCategory: SavingsByCategoryPoint[];
  trends: TrendPoint[];
  transportation: TransportationImpact;
  sustainability: SustainabilityImpact;
  operations: OperationalEfficiency;
  opportunities: OptimizationOpportunity[];
  roi: RoiMetrics;
  valueScore: PackagingValueScore;
  availableFilterOptions: {
    businessUnits: string[];
    productFamilies: string[];
    sites: string[];
    regions: string[];
    carriers: string[];
    skus: string[];
    cartons: string[];
    recommendationStatuses: string[];
    validationStatuses: string[];
  };
  missingFields: string[];
}

/** Minimal analysis history shape accepted by the ROI builder */
export interface RoiHistoryRecord {
  id: string;
  at: string;
  skuCount: number;
  unitCount: number;
  totalWeight: number;
  wmsCarton: string;
  aiCarton: string;
  wmsCost: number;
  aiCost: number;
  savings: number;
  utilization: number;
  voidPct: number;
  dimWeightDelta: number;
  sustainability: number;
  score: number;
  confirmedWms: boolean;
  /** Optional extended fields when present on live records */
  wmsVolume?: number;
  aiVolume?: number;
  wmsVoidPct?: number;
  businessUnit?: string;
  productFamily?: string;
  site?: string;
  region?: string;
  carrier?: string;
  validationStatus?: string;
  recommendationStatus?: string;
  breakdown?: {
    items?: Array<{ skuId: string; name: string; qty: number; category?: string }>;
    wms?: { length: number; width: number; height: number; cost: number; name?: string; id?: string };
    ai?: { length: number; width: number; height: number; cost: number; name?: string; id?: string };
    aiScore?: { damageRisk?: number; voidPct?: number; dunnageVolEst?: number };
    wmsScore?: { damageRisk?: number; voidPct?: number; dunnageVolEst?: number };
    fitStatus?: string;
  };
}
