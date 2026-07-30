import { useCallback, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as ReTooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertTriangle,
  Copy,
  Download,
  FileSpreadsheet,
  FileText,
  HelpCircle,
  Leaf,
  Printer,
  TrendingDown,
  TrendingUp,
  Truck,
} from "lucide-react";
import {
  buildExecutiveDashboard,
  DEFAULT_ROI_ASSUMPTIONS,
  formatMetricNumber,
  dashboardToKpiCsv,
  loadRoiAssumptions,
  opportunitiesToCsv,
  saveRoiAssumptions,
  sortOpportunities,
} from "./lib/roi";
import type {
  DashboardFilters,
  MetricValue,
  OpportunitySortKey,
  RoiAssumptions,
  RoiHistoryRecord,
  TimeRangePreset,
} from "./lib/roiTypes";

const C = {
  navy: "#003c71",
  violet: "#bb33ff",
  purple: "#8800cc",
  cyan: "#00eeff",
  teal: "#00becc",
  slate: "#61737b",
  white: "#ffffff",
  bgSoft: "#f4f6f8",
  bgMuted: "#edf0f3",
  border: "rgba(0,60,113,0.12)",
  green: "#0f7b4a",
  red: "#b42318",
};

const SERIF = "'ITC Officina Serif', 'Bitter', Georgia, serif";
const MONO = "'JetBrains Mono', monospace";

function Card({
  children,
  className = "",
  style,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={`rounded-lg border bg-white ${className}`}
      style={{ borderColor: C.border, boxShadow: "0 1px 2px rgba(0,60,113,0.04)", ...style }}
    >
      {children}
    </div>
  );
}

function IntegrityBadge({ integrity }: { integrity: MetricValue["integrity"] }) {
  const colors: Record<string, { bg: string; fg: string }> = {
    Actual: { bg: "rgba(15,123,74,0.12)", fg: C.green },
    Estimated: { bg: "rgba(0,190,204,0.12)", fg: C.teal },
    Projected: { bg: "rgba(136,0,204,0.1)", fg: C.purple },
    Sample: { bg: "rgba(245,158,11,0.15)", fg: "#b45309" },
  };
  const c = colors[integrity] ?? colors.Estimated!;
  return (
    <span
      className="text-[8px] px-1.5 py-0.5 rounded uppercase tracking-wider font-semibold"
      style={{ fontFamily: MONO, background: c.bg, color: c.fg }}
      title={`Data integrity: ${integrity}`}
    >
      {integrity}
    </span>
  );
}

function Tip({ text }: { text: string }) {
  return (
    <span className="inline-flex relative group ml-1 align-middle" title={text}>
      <HelpCircle size={11} style={{ color: C.slate, opacity: 0.7 }} />
      <span
        className="pointer-events-none absolute z-20 left-1/2 -translate-x-1/2 bottom-full mb-1 w-64 p-2 rounded text-[10px] leading-snug opacity-0 group-hover:opacity-100 transition-opacity"
        style={{ fontFamily: MONO, background: C.navy, color: C.white }}
      >
        {text}
      </span>
    </span>
  );
}

function TrendIcon({ trend }: { trend: MetricValue["trend"] }) {
  if (trend === "up") return <TrendingUp size={12} style={{ color: C.green }} />;
  if (trend === "down") return <TrendingDown size={12} style={{ color: C.red }} />;
  return null;
}

function KpiCard({ m }: { m: MetricValue }) {
  const delta =
    m.changeVsBaseline == null || !Number.isFinite(m.changeVsBaseline)
      ? null
      : m.unit === "percent"
        ? `${m.changeVsBaseline > 0 ? "+" : ""}${Math.round(m.changeVsBaseline * 10) / 10} pts vs baseline`
        : m.unit === "currency"
          ? `${m.changeVsBaseline >= 0 ? "+" : ""}$${Math.round(Math.abs(m.changeVsBaseline)).toLocaleString()} vs baseline`
          : `${m.changeVsBaseline >= 0 ? "+" : ""}${Math.round(m.changeVsBaseline).toLocaleString()} vs baseline`;

  return (
    <Card className="p-3.5">
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="text-[9px] uppercase tracking-widest" style={{ fontFamily: MONO, color: C.slate }}>
          {m.label}
          <Tip text={`${m.tooltip}\n\nSource: ${m.source}`} />
        </div>
        <IntegrityBadge integrity={m.integrity} />
      </div>
      <div className="flex items-center gap-2">
        <div className="text-xl font-semibold" style={{ fontFamily: SERIF, color: C.navy }}>
          {formatMetricNumber(m)}
        </div>
        <TrendIcon trend={m.trend} />
      </div>
      {delta && (
        <div className="text-[10px] mt-1" style={{ fontFamily: MONO, color: m.trend === "down" ? C.red : C.green }}>
          {delta}
        </div>
      )}
    </Card>
  );
}

function downloadText(filename: string, content: string, mime = "text/csv;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const emptyFilters = (): Partial<DashboardFilters> => ({
  timeRange: "year",
  businessUnit: "",
  productFamily: "",
  site: "",
  region: "",
  carrier: "",
  sku: "",
  packsizeCarton: "",
  recommendationStatus: "",
  validationStatus: "",
  dateFrom: null,
  dateTo: null,
});

export function ExecutiveDashboard({
  history,
  catalogCartonCount,
}: {
  history: RoiHistoryRecord[];
  catalogCartonCount: number;
}) {
  const [assumptions, setAssumptions] = useState<RoiAssumptions>(() => loadRoiAssumptions());
  const [filters, setFilters] = useState<Partial<DashboardFilters>>(emptyFilters);
  const [sortKey, setSortKey] = useState<OpportunitySortKey>("savings");
  const [showAssumptions, setShowAssumptions] = useState(false);
  const [showMethodology, setShowMethodology] = useState(false);
  const [copyMsg, setCopyMsg] = useState<string | null>(null);

  const model = useMemo(
    () =>
      buildExecutiveDashboard({
        history,
        assumptions,
        filters,
        catalogCartonCount,
      }),
    [history, assumptions, filters, catalogCartonCount],
  );

  const opportunities = useMemo(
    () => sortOpportunities(model.opportunities, sortKey),
    [model.opportunities, sortKey],
  );

  const updateAssumption = useCallback(<K extends keyof RoiAssumptions>(key: K, value: RoiAssumptions[K]) => {
    setAssumptions((prev) => {
      const next = { ...prev, [key]: value };
      saveRoiAssumptions(next);
      return next;
    });
  }, []);

  const onExportKpi = () => downloadText("cartoniq-executive-kpis.csv", dashboardToKpiCsv(model));
  const onExportOppCsv = () => downloadText("cartoniq-opportunities.csv", opportunitiesToCsv(opportunities));
  const onExportOppXlsx = () => {
    const rows = opportunities.map((r) => ({
      ID: r.id,
      "SKU/Order": r.skuOrOrderId,
      "Current Carton": r.currentCarton,
      Recommended: r.recommendedCarton,
      "Current Volume": r.currentVolume,
      "Recommended Volume": r.recommendedVolume,
      "Cube Reduction": r.cubeReduction,
      "Est. Annual Savings": r.estimatedAnnualSavings,
      "Dunnage Reduction": r.dunnageReduction,
      "Damage Risk Δ": r.damageRiskChange,
      Status: r.status,
      Integrity: r.integrity,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Opportunities");
    XLSX.writeFile(wb, "cartoniq-opportunities.xlsx");
  };
  const onCopySummary = async () => {
    try {
      await navigator.clipboard.writeText(model.executiveSummary);
      setCopyMsg("Summary copied");
      setTimeout(() => setCopyMsg(null), 2000);
    } catch {
      setCopyMsg("Copy failed");
      setTimeout(() => setCopyMsg(null), 2000);
    }
  };
  const onPrintPdf = () => window.print();

  const selectCls =
    "text-[11px] rounded border px-2 py-1.5 bg-white w-full";
  const selectStyle = { fontFamily: MONO, borderColor: C.border, color: C.navy };

  return (
    <div className="flex flex-col gap-5 max-w-6xl mx-auto w-full print:max-w-none" id="executive-dashboard">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 style={{ fontFamily: SERIF, color: C.navy, fontSize: 26 }} className="font-semibold mb-1">
            Executive Dashboard
          </h2>
          <p className="text-sm" style={{ color: C.slate }}>
            Financial impact, packaging efficiency, transportation space, sustainability, and ROI
          </p>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          <button
            type="button"
            onClick={onPrintPdf}
            className="flex items-center gap-1.5 text-[10px] px-2.5 py-1.5 rounded border"
            style={{ fontFamily: MONO, borderColor: C.border, color: C.navy }}
          >
            <Printer size={12} /> Export PDF
          </button>
          <button
            type="button"
            onClick={onExportKpi}
            className="flex items-center gap-1.5 text-[10px] px-2.5 py-1.5 rounded border"
            style={{ fontFamily: MONO, borderColor: C.border, color: C.navy }}
          >
            <Download size={12} /> KPI CSV
          </button>
          <button
            type="button"
            onClick={onExportOppCsv}
            className="flex items-center gap-1.5 text-[10px] px-2.5 py-1.5 rounded border"
            style={{ fontFamily: MONO, borderColor: C.border, color: C.navy }}
          >
            <FileText size={12} /> Opportunities CSV
          </button>
          <button
            type="button"
            onClick={onExportOppXlsx}
            className="flex items-center gap-1.5 text-[10px] px-2.5 py-1.5 rounded border"
            style={{ fontFamily: MONO, borderColor: C.border, color: C.navy }}
          >
            <FileSpreadsheet size={12} /> Opportunities Excel
          </button>
          <button
            type="button"
            onClick={onCopySummary}
            className="flex items-center gap-1.5 text-[10px] px-2.5 py-1.5 rounded border"
            style={{ fontFamily: MONO, borderColor: C.border, color: C.navy }}
          >
            <Copy size={12} /> {copyMsg ?? "Copy summary"}
          </button>
        </div>
      </div>

      {model.usingSampleData && (
        <div
          className="rounded-lg border px-4 py-3 flex items-start gap-3"
          style={{ borderColor: "#f59e0b55", background: "#f59e0b0c" }}
        >
          <AlertTriangle size={14} className="mt-0.5 shrink-0" style={{ color: "#b45309" }} />
          <div>
            <p className="text-sm font-semibold" style={{ color: "#b45309" }}>
              Showing labeled Sample data
            </p>
            <p className="text-xs mt-0.5" style={{ color: C.navy }}>
              No analysis history in range — figures are illustrative Sample / Estimated / Projected values, not live
              results. Run orders from New Order to populate Actual carton-cost and utilization metrics.
            </p>
          </div>
        </div>
      )}

      {/* Executive summary */}
      <Card className="p-5">
        <div className="text-[9px] uppercase tracking-widest mb-2" style={{ fontFamily: MONO, color: C.slate }}>
          Executive Summary
        </div>
        <p className="text-sm leading-relaxed" style={{ color: C.navy }}>
          {model.executiveSummary}
        </p>
      </Card>

      {/* Filters */}
      <Card className="p-4 print:hidden">
        <div className="text-[9px] uppercase tracking-widest mb-3" style={{ fontFamily: MONO, color: C.slate }}>
          Filters
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          <label className="text-[10px]" style={{ color: C.slate }}>
            Time range
            <select
              className={selectCls}
              style={selectStyle}
              value={filters.timeRange ?? "year"}
              onChange={(e) =>
                setFilters((f) => ({ ...f, timeRange: e.target.value as TimeRangePreset }))
              }
            >
              <option value="month">Month</option>
              <option value="quarter">Quarter</option>
              <option value="year">Year</option>
              <option value="custom">Custom</option>
            </select>
          </label>
          {filters.timeRange === "custom" && (
            <>
              <label className="text-[10px]" style={{ color: C.slate }}>
                From
                <input
                  type="date"
                  className={selectCls}
                  style={selectStyle}
                  onChange={(e) =>
                    setFilters((f) => ({
                      ...f,
                      dateFrom: e.target.value ? new Date(e.target.value).toISOString() : null,
                    }))
                  }
                />
              </label>
              <label className="text-[10px]" style={{ color: C.slate }}>
                To
                <input
                  type="date"
                  className={selectCls}
                  style={selectStyle}
                  onChange={(e) =>
                    setFilters((f) => ({
                      ...f,
                      dateTo: e.target.value ? new Date(e.target.value + "T23:59:59").toISOString() : null,
                    }))
                  }
                />
              </label>
            </>
          )}
          {(
            [
              ["businessUnit", "Business unit", model.availableFilterOptions.businessUnits],
              ["productFamily", "Product family", model.availableFilterOptions.productFamilies],
              ["site", "Site", model.availableFilterOptions.sites],
              ["region", "Region", model.availableFilterOptions.regions],
              ["carrier", "Carrier", model.availableFilterOptions.carriers],
              ["sku", "SKU", model.availableFilterOptions.skus],
              ["packsizeCarton", "Packsize carton", model.availableFilterOptions.cartons],
              ["recommendationStatus", "Recommendation status", model.availableFilterOptions.recommendationStatuses],
              ["validationStatus", "Validation status", model.availableFilterOptions.validationStatuses],
            ] as const
          ).map(([key, label, opts]) => (
            <label key={key} className="text-[10px]" style={{ color: C.slate }}>
              {label}
              <select
                className={selectCls}
                style={selectStyle}
                value={(filters[key] as string) ?? ""}
                onChange={(e) => setFilters((f) => ({ ...f, [key]: e.target.value }))}
              >
                <option value="">All</option>
                {opts.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
        <div className="flex gap-2 mt-3">
          <button
            type="button"
            className="text-[10px] px-2.5 py-1.5 rounded border"
            style={{ fontFamily: MONO, borderColor: C.border, color: C.navy }}
            onClick={() => setShowAssumptions((s) => !s)}
          >
            {showAssumptions ? "Hide" : "Configure"} ROI assumptions
          </button>
          <button
            type="button"
            className="text-[10px] px-2.5 py-1.5 rounded border"
            style={{ fontFamily: MONO, borderColor: C.border, color: C.navy }}
            onClick={() => setShowMethodology((s) => !s)}
          >
            {showMethodology ? "Hide" : "Show"} Methodology
          </button>
          <button
            type="button"
            className="text-[10px] px-2.5 py-1.5 rounded border"
            style={{ fontFamily: MONO, borderColor: C.border, color: C.slate }}
            onClick={() => {
              setAssumptions(DEFAULT_ROI_ASSUMPTIONS);
              saveRoiAssumptions(DEFAULT_ROI_ASSUMPTIONS);
            }}
          >
            Reset assumptions
          </button>
        </div>
      </Card>

      {showAssumptions && (
        <Card className="p-4 print:hidden">
          <div className="text-[9px] uppercase tracking-widest mb-3" style={{ fontFamily: MONO, color: C.slate }}>
            Configurable assumptions
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {(
              [
                ["softwareCost", "Software cost ($/yr)"],
                ["implementationCost", "Implementation cost ($/yr amortized)"],
                ["supportCost", "Support cost ($/yr)"],
                ["annualLaborCost", "Annual labor cost ($)"],
                ["annualShipmentVolume", "Annual shipment volume"],
                ["costPerDamagedShipment", "Cost per damaged shipment ($)"],
                ["baselineDamageRate", "Baseline damage rate (0–1)"],
                ["optimizedDamageRate", "Optimized damage rate (0–1)"],
                ["costPerEngineeringHour", "Cost per engineering hour ($)"],
                ["baselineEngineeringMinutes", "Baseline engineering minutes"],
                ["cartoniqEngineeringMinutes", "CartonIQ engineering minutes"],
                ["corrugatedCostPerSqFt", "Corrugated cost ($/sq ft)"],
                ["dunnageCostPerCuIn", "Dunnage cost ($/in³)"],
                ["transportationCostPerCuIn", "Transport cost per in³ ($ allocated)"],
                ["packTimeReductionMinutes", "Pack-time reduction (min)"],
                ["plasticLbEliminatedPerShipment", "Plastic lb eliminated / shipment"],
              ] as Array<[keyof RoiAssumptions, string]>
            ).map(([key, label]) => (
              <label key={key} className="text-[10px]" style={{ color: C.slate }}>
                {label}
                <input
                  type="number"
                  step="any"
                  className={selectCls}
                  style={selectStyle}
                  value={Number(assumptions[key])}
                  onChange={(e) => updateAssumption(key, Number(e.target.value) as never)}
                />
              </label>
            ))}
          </div>
        </Card>
      )}

      {showMethodology && (
        <Card className="p-4">
          <div className="text-[9px] uppercase tracking-widest mb-2" style={{ fontFamily: MONO, color: C.slate }}>
            Methodology
          </div>
          <ul className="text-[11px] space-y-1.5" style={{ fontFamily: MONO, color: C.navy }}>
            <li>• Annual Value = Transportation + Corrugated + Dunnage + Labor + Damage Avoidance</li>
            <li>• Allocated Trailer-Space Cost = Carton volume (in³) × configurable $/in³ (not invoice freight)</li>
            <li>• ROI % = (Annual Benefit − Annual Program Cost) ÷ Annual Program Cost × 100</li>
            <li>• Payback (months) = Annual Program Cost ÷ Annual Benefit × 12</li>
            <li>• Sustainability CO₂ / landfill use conversion assumptions — not measured emissions</li>
            <li>• Integrity badges: Actual (observed), Estimated (derived), Projected (assumptions), Sample (demo)</li>
          </ul>
          {model.missingFields.length > 0 && (
            <div className="mt-3">
              <div className="text-[9px] uppercase tracking-widest mb-1" style={{ fontFamily: MONO, color: C.slate }}>
                Missing live fields
              </div>
              <ul className="text-[10px] space-y-0.5" style={{ color: C.slate }}>
                {model.missingFields.map((f) => (
                  <li key={f}>• {f}</li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Object.values(model.kpis).map((m) => (
          <KpiCard key={m.label} m={m} />
        ))}
      </div>

      {/* Annual value created */}
      <Card className="p-5">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="text-[9px] uppercase tracking-widest mb-1" style={{ fontFamily: MONO, color: C.slate }}>
              Annual Value Created
            </div>
            <div className="text-3xl font-semibold" style={{ fontFamily: SERIF, color: C.navy }}>
              {formatMetricNumber(model.valueCreated.total)}
            </div>
            <IntegrityBadge integrity={model.valueCreated.total.integrity} />
          </div>
          <Tip text={model.valueCreated.total.tooltip} />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          {(
            [
              model.valueCreated.transportation,
              model.valueCreated.corrugated,
              model.valueCreated.dunnage,
              model.valueCreated.labor,
              model.valueCreated.damageAvoidance,
            ] as MetricValue[]
          ).map((m) => (
            <div key={m.label} className="rounded p-3" style={{ background: C.bgSoft }}>
              <div className="text-[9px] uppercase tracking-wider mb-1" style={{ fontFamily: MONO, color: C.slate }}>
                {m.label.replace(" Savings", "").replace(" Cost Avoidance", "")}
              </div>
              <div className="text-sm font-semibold" style={{ fontFamily: MONO, color: C.navy }}>
                {formatMetricNumber(m)}
              </div>
              <IntegrityBadge integrity={m.integrity} />
            </div>
          ))}
        </div>
      </Card>

      {/* Before vs after */}
      <Card>
        <div className="px-5 py-3 border-b" style={{ borderColor: C.border, background: C.bgSoft }}>
          <span className="text-[10px] uppercase tracking-widest" style={{ fontFamily: MONO, color: C.slate }}>
            Without CartonIQ vs. With CartonIQ
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b" style={{ borderColor: C.border }}>
                {["Metric", "Without", "With", "Integrity"].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-2 text-[10px] uppercase tracking-wider"
                    style={{ fontFamily: MONO, color: C.slate }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {model.beforeAfter.map((row) => (
                <tr key={row.metric} className="border-b last:border-0" style={{ borderColor: C.border }}>
                  <td className="px-4 py-2.5 text-sm" style={{ color: C.navy }}>
                    {row.metric}
                    <Tip text={row.with.tooltip} />
                  </td>
                  <td className="px-4 py-2.5 text-xs" style={{ fontFamily: MONO, color: C.slate }}>
                    {formatMetricNumber(row.without)}
                  </td>
                  <td className="px-4 py-2.5 text-xs font-semibold" style={{ fontFamily: MONO, color: C.green }}>
                    {formatMetricNumber(row.with)}
                  </td>
                  <td className="px-4 py-2.5">
                    <IntegrityBadge integrity={row.with.integrity} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Financial impact chart */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-4">
          <div className="text-[9px] uppercase tracking-widest mb-3" style={{ fontFamily: MONO, color: C.slate }}>
            Financial impact by category ({model.filters.timeRange})
          </div>
          {model.savingsByCategory.length === 0 ? (
            <p className="text-sm" style={{ color: C.slate }}>
              Data unavailable
            </p>
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={model.savingsByCategory}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                  <XAxis dataKey="period" tick={{ fontSize: 10, fill: C.slate }} />
                  <YAxis tick={{ fontSize: 10, fill: C.slate }} />
                  <ReTooltip />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Bar dataKey="transportation" stackId="a" fill={C.teal} name="Transportation" />
                  <Bar dataKey="corrugated" stackId="a" fill={C.navy} name="Corrugated" />
                  <Bar dataKey="dunnage" stackId="a" fill={C.purple} name="Paper dunnage" />
                  <Bar dataKey="labor" stackId="a" fill={C.cyan} name="Labor" />
                  <Bar dataKey="damageAvoidance" stackId="a" fill="#0f7b4a" name="Damage avoidance" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          <p className="text-[10px] mt-2" style={{ color: C.slate }}>
            Values inherit period integrity ({model.savingsByCategory[0]?.integrity ?? "—"}) — allocated space cost is
            Estimated, not invoice freight.
          </p>
        </Card>

        <Card className="p-4">
          <div className="text-[9px] uppercase tracking-widest mb-3" style={{ fontFamily: MONO, color: C.slate }}>
            Packaging performance trends
          </div>
          {model.trends.length === 0 ? (
            <p className="text-sm" style={{ color: C.slate }}>
              Data unavailable
            </p>
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={model.trends}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                  <XAxis dataKey="period" tick={{ fontSize: 10, fill: C.slate }} />
                  <YAxis tick={{ fontSize: 10, fill: C.slate }} />
                  <ReTooltip />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Line type="monotone" dataKey="cubeUtilization" stroke={C.teal} name="Cube util %" dot={false} />
                  <Line type="monotone" dataKey="voidPct" stroke={C.purple} name="Void %" dot={false} />
                  <Line type="monotone" dataKey="engineeringScore" stroke={C.navy} name="Eng. score" dot={false} />
                  <Line type="monotone" dataKey="acceptanceRate" stroke={C.cyan} name="Acceptance %" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>

      {/* Transportation */}
      <Card className="p-5">
        <div className="flex items-center gap-2 mb-3">
          <Truck size={14} style={{ color: C.teal }} />
          <span className="text-[10px] uppercase tracking-widest" style={{ fontFamily: MONO, color: C.slate }}>
            Transportation impact
          </span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Object.values(model.transportation).map((m) => (
            <KpiCard key={m.label} m={m} />
          ))}
        </div>
      </Card>

      {/* Sustainability */}
      <Card className="p-5">
        <div className="flex items-center gap-2 mb-3">
          <Leaf size={14} style={{ color: C.green }} />
          <span className="text-[10px] uppercase tracking-widest" style={{ fontFamily: MONO, color: C.slate }}>
            Material & sustainability impact
          </span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {Object.values(model.sustainability).map((m) => (
            <KpiCard key={m.label} m={m} />
          ))}
        </div>
      </Card>

      {/* Operations + ROI + Value score */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="p-4">
          <div className="text-[9px] uppercase tracking-widest mb-3" style={{ fontFamily: MONO, color: C.slate }}>
            Operational efficiency
          </div>
          <div className="space-y-2">
            {Object.values(model.operations).map((m) => (
              <div
                key={m.label}
                className="flex items-center justify-between gap-2 rounded px-2 py-1.5"
                style={{ background: C.bgSoft }}
              >
                <span className="text-[10px]" style={{ color: C.slate }}>
                  {m.label}
                  <Tip text={m.tooltip} />
                </span>
                <span className="text-xs font-semibold flex items-center gap-1" style={{ fontFamily: MONO, color: C.navy }}>
                  {formatMetricNumber(m)}
                  <IntegrityBadge integrity={m.integrity} />
                </span>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-4">
          <div className="text-[9px] uppercase tracking-widest mb-2" style={{ fontFamily: MONO, color: C.slate }}>
            ROI
          </div>
          <div className="text-3xl font-semibold mb-1" style={{ fontFamily: SERIF, color: C.navy }}>
            {formatMetricNumber(model.roi.roiPercent)}
          </div>
          <IntegrityBadge integrity={model.roi.roiPercent.integrity} />
          <p className="text-[10px] mt-2 mb-3" style={{ fontFamily: MONO, color: C.slate }}>
            {model.roi.roiPercent.tooltip}
          </p>
          <div className="space-y-2">
            {[model.roi.annualBenefit, model.roi.annualProgramCost, model.roi.paybackMonths].map((m) => (
              <div key={m.label} className="flex justify-between text-[11px]">
                <span style={{ color: C.slate }}>{m.label}</span>
                <span style={{ fontFamily: MONO, color: C.navy }}>{formatMetricNumber(m)}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-4">
          <div className="text-[9px] uppercase tracking-widest mb-2" style={{ fontFamily: MONO, color: C.slate }}>
            Packaging Value Score
          </div>
          <div className="text-3xl font-semibold mb-1" style={{ fontFamily: SERIF, color: C.navy }}>
            {formatMetricNumber(model.valueScore.overall)}
            <span className="text-base" style={{ color: C.slate }}>
              {" "}
              / 100
            </span>
          </div>
          <IntegrityBadge integrity={model.valueScore.overall.integrity} />
          <p className="text-[10px] mt-2 mb-3" style={{ color: C.slate }}>
            {model.valueScore.explanation}
          </p>
          <div className="space-y-1.5">
            {Object.values(model.valueScore.categories).map((m) => (
              <div key={m.label}>
                <div className="flex justify-between text-[10px] mb-0.5">
                  <span style={{ color: C.slate }}>{m.label}</span>
                  <span style={{ fontFamily: MONO, color: C.navy }}>{formatMetricNumber(m)}</span>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: C.bgMuted }}>
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${m.value ?? 0}%`, background: C.teal }}
                  />
                </div>
              </div>
            ))}
          </div>
          {model.valueScore.trend.length > 0 && (
            <div className="h-28 mt-3">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={model.valueScore.trend}>
                  <XAxis dataKey="period" hide />
                  <YAxis domain={[0, 100]} hide />
                  <ReTooltip />
                  <Line type="monotone" dataKey="score" stroke={C.teal} dot={false} name="Value score" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>

      {/* Opportunities */}
      <Card>
        <div
          className="px-5 py-3 border-b flex flex-wrap items-center justify-between gap-2"
          style={{ borderColor: C.border, background: C.bgSoft }}
        >
          <span className="text-[10px] uppercase tracking-widest" style={{ fontFamily: MONO, color: C.slate }}>
            Top optimization opportunities
          </span>
          <label className="text-[10px] flex items-center gap-1.5 print:hidden" style={{ color: C.slate }}>
            Sort by
            <select
              className={selectCls}
              style={{ ...selectStyle, width: "auto" }}
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as OpportunitySortKey)}
            >
              <option value="savings">Savings</option>
              <option value="cubeReduction">Cube reduction</option>
              <option value="shipmentVolume">Shipment volume</option>
              <option value="damageRisk">Damage risk</option>
              <option value="sustainability">Sustainability impact</option>
            </select>
          </label>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left min-w-[900px]">
            <thead>
              <tr className="border-b" style={{ borderColor: C.border }}>
                {[
                  "SKU / Order",
                  "Current",
                  "Recommended",
                  "Curr vol",
                  "Rec vol",
                  "Cube Δ",
                  "Est. annual $",
                  "Dunnage Δ",
                  "Damage risk Δ",
                  "Status",
                  "Integrity",
                ].map((h) => (
                  <th
                    key={h}
                    className="px-3 py-2 text-[9px] uppercase tracking-wider"
                    style={{ fontFamily: MONO, color: C.slate }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {opportunities.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-4 py-6 text-sm" style={{ color: C.slate }}>
                    Data unavailable
                  </td>
                </tr>
              ) : (
                opportunities.map((r) => (
                  <tr key={r.id} className="border-b last:border-0" style={{ borderColor: C.border }}>
                    <td className="px-3 py-2 text-xs font-semibold" style={{ fontFamily: MONO, color: C.teal }}>
                      {r.skuOrOrderId}
                    </td>
                    <td className="px-3 py-2 text-[11px]" style={{ color: C.navy }}>
                      {r.currentCarton}
                    </td>
                    <td className="px-3 py-2 text-[11px]" style={{ color: C.navy }}>
                      {r.recommendedCarton}
                    </td>
                    <td className="px-3 py-2 text-[11px]" style={{ fontFamily: MONO, color: C.slate }}>
                      {r.currentVolume == null ? "—" : Math.round(r.currentVolume).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-[11px]" style={{ fontFamily: MONO, color: C.slate }}>
                      {r.recommendedVolume == null ? "—" : Math.round(r.recommendedVolume).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-[11px]" style={{ fontFamily: MONO, color: C.green }}>
                      {r.cubeReduction == null ? "—" : Math.round(r.cubeReduction).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-[11px] font-semibold" style={{ fontFamily: MONO, color: C.navy }}>
                      {r.estimatedAnnualSavings == null
                        ? "—"
                        : `$${Math.round(r.estimatedAnnualSavings).toLocaleString()}`}
                    </td>
                    <td className="px-3 py-2 text-[11px]" style={{ fontFamily: MONO, color: C.slate }}>
                      {r.dunnageReduction == null ? "—" : Math.round(r.dunnageReduction).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-[11px]" style={{ fontFamily: MONO, color: C.slate }}>
                      {r.damageRiskChange == null ? "—" : r.damageRiskChange.toFixed(0)}
                    </td>
                    <td className="px-3 py-2 text-[11px]" style={{ color: C.navy }}>
                      {r.status}
                    </td>
                    <td className="px-3 py-2">
                      <IntegrityBadge integrity={r.integrity} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
