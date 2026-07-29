export type FragilityLevel = "Low" | "Medium" | "High";

export type RigidityClass =
  | "rigid"
  | "semi_rigid"
  | "flexible"
  | "soft_bag";

export type ContentShiftRisk = "low" | "medium" | "high";
export type CompressionRisk = "none" | "low" | "medium" | "high";

/**
 * Package mechanical / deformability model.
 * SKU-specific values override class defaults from resolveMechanical().
 */
export interface ProductMechanicalProperties {
  rigidityClass: RigidityClass;

  /** Maximum permitted dimensional reduction under packing pressure (%). */
  maxCompressionPercent: {
    length: number;
    width: number;
    height: number;
  };

  /** Minimum retained dimension after compression (catalog axes). */
  minimumDimensions?: {
    length: number;
    width: number;
    height: number;
  };

  /** Whether the package may conform into nearby voids (deformable envelope). */
  canConformToVoid: boolean;

  /** Whether another product may be placed above it. */
  stackable: boolean;

  /** Whether the contents may shift internally. */
  contentShiftRisk?: ContentShiftRisk;

  /**
   * Minimum retained-volume ratio after compression (% of original AABB volume).
   * Prevents unrealistic independent axis shrinkage.
   */
  minimumRetainedVolumePercent?: number;
}

export interface SKU {
  id: string;
  name: string;
  category: string;
  length: number;
  width: number;
  height: number;
  weight: number;
  fragility: FragilityLevel;
  /** Optional handling — default allows all 6 rotations */
  keepFlat?: boolean;
  keepUpright?: boolean;
  packageType?: string;
  /** @deprecated Prefer mechanical.stackable — still honored as override */
  stackable?: boolean;
  /** Explicit rigidity class; if omitted, inferred from packageType or defaults to rigid */
  rigidityClass?: RigidityClass;
  /** Full mechanical overrides (SKU-specific wins over class defaults) */
  mechanical?: Partial<ProductMechanicalProperties>;
}

export interface OrderItem {
  sku: SKU;
  qty: number;
}

export interface Carton {
  id: string;
  name: string;
  number?: string;
  length: number;
  width: number;
  height: number;
  maxWeight: number;
  cost: number;
}

export type Orient3 = [number, number, number];

export interface Dim3 {
  length: number;
  width: number;
  height: number;
}

export interface FlexPackReport {
  skuId: string;
  unit: number;
  rigidityClass: RigidityClass;
  originalDimensions: Dim3;
  packedDimensions: Dim3;
  compressionPercent: Dim3;
  retainedVolumePercent: number;
  topLoadLb: number;
  conformsToVoid: boolean;
  compressionRisk: CompressionRisk;
  placement: { x: number; y: number; z: number };
  warnings: string[];
}

export interface Placement {
  sku: SKU;
  unit: number;
  iL: number;
  iW: number;
  iH: number;
  x: number;
  y: number;
  z: number;
  layer: number;
  orientation: string;
  /** Horizontal (flat) | Vertical (on end) | On-side */
  posture: "horizontal" | "vertical" | "on-side";
  /** Human-readable placement explanation */
  orientLabel: string;
  rigidityClass: RigidityClass;
  originalDimensions: Dim3;
  packedDimensions: Dim3;
  /** Catalog-axis compression used for this placement */
  compressionPercent: Dim3;
  retainedVolumePercent: number;
  topLoadLb: number;
  conformsToVoid: boolean;
  compressionRisk: CompressionRisk;
  engineeringWarnings: string[];
}

export interface CubingResult {
  fits: boolean;
  failReason?: string;
  /**
   * Physical AABB fit succeeded, but layout depends on high compression,
   * uncertain soft-package behavior, or soft packages supporting load.
   */
  mechanicalReviewRequired?: boolean;
  mechanicalStatus?: "ok" | "review_required";
  mechanicalWarnings?: string[];
  placements: Placement[];
  flexReports: FlexPackReport[];
  layers: number;
  itemVolume: number;
  cartonVolume: number;
  utilization: number;
  voidPct: number;
  dunnage5Pct: number;
  cgRel: { x: number; y: number; z: number };
  weightBalance: string;
  layerGroups: Array<{
    layer: number;
    items: Array<{
      name: string;
      orient: string;
      posture: "horizontal" | "vertical" | "on-side";
      orientLabel: string;
      weight: number;
      rigidityClass: RigidityClass;
      compressionRisk: CompressionRisk;
    }>;
    zStart: number;
    height: number;
  }>;
}

/**
 * recommended — physical fit + engineering quality ok
 * not-recommended — physical fit but quality concerns (void band, CG, etc.)
 * mechanical-review — physical fit but flexible-package mechanical concerns
 * no-fit — does not physically / mechanically fit within allowed limits
 */
export type FitStatus = "recommended" | "not-recommended" | "mechanical-review" | "no-fit";

export interface EngineeringScore {
  utilization: number;
  dimWeight: number;
  shipping: number;
  fragility: number;
  sustainability: number;
  total: number;
  damagePrevention: number;
  movementPrevention: number;
  dunnageReduction: number;
  cartonSizeOpt: number;
  packRepeatability: number;
  laborEfficiency: number;
  damageRisk: number;
  movementRisk: number;
  /** 0–100, higher = more risk */
  flexiblePackageCompressionRisk: number;
  /** 0–100, higher = more risk */
  softPackageTopLoadRisk: number;
  /** 0–100, higher = more risk */
  contentMigrationRisk: number;
  /** 0–100, higher = better (dunnage reduction via conformity) */
  voidConformityBenefit: number;
  /** 0–100, higher = more risk of bag recovering shape and shifting load */
  shapeRecoveryMovementRisk: number;
  voidPct: number;
  dunnageVolEst: number;
  layers: number;
  fitStatus: FitStatus;
  fitReasons: string[];
  mechanicalReviewRequired: boolean;
}

export interface RankedOption {
  carton: Carton;
  score: EngineeringScore;
  rank: number;
}

export interface MinRequired {
  itemEnvelope: [number, number, number];
  totalVolume: number;
  totalWeight: number;
  unitCount: number;
}

export interface ParseIssue {
  row: number;
  message: string;
}

export interface ParseResult<T> {
  rows: T[];
  issues: ParseIssue[];
}
