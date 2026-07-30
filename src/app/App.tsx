import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import * as XLSX from "xlsx";
import defaultSkuCsv from "@/imports/sku-database-sample.csv?raw";
import packsizeCsv from "@/imports/Packsize.csv?raw";
import {
  ScanBarcode, Plus, Trash2, Settings, ChevronRight, ChevronLeft,
  AlertTriangle, CheckCircle2, Zap, ArrowRight, Package,
  Upload, RefreshCw, X, RotateCcw, Layers, BarChart3,
  Pencil, Save, Leaf, TrendingDown, Box,
} from "lucide-react";
import {
  type SKU,
  type Carton,
  type OrderItem,
  type FragilityLevel,
  type EngineeringScore,
  type FlexPackReport,
  type Placement,
  DUNNAGE_PCT,
  UTIL_MIN,
  UTIL_MAX,
  UTIL_IDEAL_LOW,
  UTIL_IDEAL_HIGH,
  vol,
  dimW,
  cubePack,
  calcAI,
  calcManhattan,
  scoreCarton,
  buildRationale,
  parseWorkbookToSKUs,
  parseWorkbookToCartons,
  readCsv,
} from "./lib/engine";
import { CubingDiagram } from "./lib/CubingDiagram";
import { ExecutiveDashboard } from "./ExecutiveDashboard";

// ── Brand palette ─────────────────────────────────────────────────────────────
const C = {
  navy:    "#003c71",
  violet:  "#bb33ff",
  purple:  "#8800cc",
  cyan:    "#00eeff",
  teal:    "#00becc",
  slate:   "#61737b",
  white:   "#ffffff",
  bg:      "#ffffff",
  bgSoft:  "#f4f6f8",
  bgMuted: "#edf0f3",
  border:  "rgba(0,60,113,0.12)",
};

const SERIF = "'ITC Officina Serif', 'Bitter', Georgia, serif";
const MONO  = "'JetBrains Mono', monospace";

// ── Local app types ───────────────────────────────────────────────────────────
type Screen = "home" | "order" | "recommendation" | "settings" | "analytics" | "executive";

interface AnalysisItemSnapshot {
  skuId: string;
  name: string;
  length: number;
  width: number;
  height: number;
  weight: number;
  fragility: FragilityLevel;
  rigidityClass?: string;
  category?: string;
  qty: number;
}

interface AnalysisCartonSnapshot {
  id: string;
  name: string;
  number?: string;
  length: number;
  width: number;
  height: number;
  cost: number;
  maxWeight: number;
}

interface AnalysisRecord {
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
  /** Carton volumes (in³) for ROI / corrugate / space-cost analytics */
  wmsVolume?: number;
  aiVolume?: number;
  wmsVoidPct?: number;
  /** Primary SKU category for executive filters */
  category?: string;
  /** Full breakdown snapshot — older history entries may omit this */
  breakdown?: {
    items: AnalysisItemSnapshot[];
    wms: AnalysisCartonSnapshot;
    ai: AnalysisCartonSnapshot;
    aiScore: EngineeringScore;
    wmsScore: EngineeringScore;
    rationale: string;
    layers: number;
    weightBalance: string;
    cgRel: { x: number; y: number; z: number };
    placements: Placement[];
    flexReports: FlexPackReport[];
    mechanicalReviewRequired: boolean;
    mechanicalWarnings: string[];
    fitStatus: EngineeringScore["fitStatus"];
    fitReasons: string[];
  };
}

const HISTORY_KEY = "cartoniq-analysis-history";

function loadHistory(): AnalysisRecord[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as AnalysisRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveHistory(records: AnalysisRecord[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(records.slice(0, 50)));
  } catch { /* ignore quota */ }
}

const skuParsed = parseWorkbookToSKUs(readCsv(defaultSkuCsv));
const cartonParsed = parseWorkbookToCartons(readCsv(packsizeCsv));
const DEFAULT_SKUS: SKU[] = skuParsed.rows;
const DEFAULT_CARTONS: Carton[] = cartonParsed.rows;

// ── Fragility helpers ─────────────────────────────────────────────────────────
const fragStyle = (f: FragilityLevel) =>
  f === "High"   ? { color: "#cc2200", bg: "rgba(204,34,0,0.07)",   border: "rgba(204,34,0,0.2)"   } :
  f === "Medium" ? { color: C.purple,  bg: "rgba(136,0,204,0.07)",  border: "rgba(136,0,204,0.2)"  } :
                   { color: C.teal,    bg: "rgba(0,190,204,0.07)",  border: "rgba(0,190,204,0.2)"  };

// ── Advancing Arrows SVG ──────────────────────────────────────────────────────
function AdvancingArrows({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fillRule="evenodd" strokeLinejoin="round"
      strokeMiterlimit="2" clipRule="evenodd" viewBox="0 0 320 240" className={className}
      style={style}
      aria-label="CartonIQ brand mark">
      <path fill="#003c71" fillRule="nonzero" d="M103 120 72.15 95.9V39.1L26.65 3.55C19.585-2.118 9.263-.985 3.595 6.08A16.4 16.4 0 0 0 0 15.7v80L30.85 120 0 144.05v80c.317 9.052 7.912 16.133 16.964 15.816a16.4 16.4 0 0 0 9.586-3.516l45.6-35.8v-56.5z"/>
      <g fillRule="nonzero">
        <path fill="#bb33ff" d="M72.15 200.75v23.55c.415 9.075 8.109 16.096 17.185 15.68a16.45 16.45 0 0 0 9.515-3.58l45.45-35.5v-56.7zm72.15-105V39.1L98.8 3.55C91.735-2.118 81.413-.985 75.745 6.08a16.4 16.4 0 0 0-3.595 9.62v23.4z"/>
        <path fill="#8800cc" d="M175.2 120 72.15 39.1v56.8L103 120l-30.85 24.1v56.65z"/>
      </g>
      <g fillRule="nonzero">
        <path fill="#00eeff" d="M171.2 3.5c-7.237-5.673-17.703-4.405-23.376 2.832a16.65 16.65 0 0 0-3.524 9.418V39.1L247.8 120l-103.5 80.9v23.4c.446 9.074 8.164 16.069 17.238 15.622a16.45 16.45 0 0 0 9.262-3.422L320 120.25z"/>
        <path fill="#00becc" d="M247.8 120 144.3 39.1v56.65L175.2 120l-30.9 24.2v56.65z"/>
      </g>
    </svg>
  );
}

// ── Shared UI primitives ──────────────────────────────────────────────────────
function Card({ children, className = "", style = {} }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <div className={`rounded-lg border ${className}`}
      style={{ borderColor: C.border, background: C.bg, boxShadow: "0 1px 6px rgba(0,60,113,0.07)", ...style }}>
      {children}
    </div>
  );
}

function ScoreRing({ score, size = 96 }: { score: number; size?: number }) {
  const color  = score >= 80 ? C.teal : score >= 55 ? C.violet : "#cc2200";
  const cx     = size / 2;
  const r      = cx - 8;
  const circ   = 2 * Math.PI * r;
  const dash   = (score / 100) * circ;
  const sw     = Math.max(4, size / 14);
  return (
    <div className="relative flex items-center justify-center shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={cx} cy={cx} r={r} fill="none" stroke={C.bgMuted} strokeWidth={sw} />
        <circle cx={cx} cy={cx} r={r} fill="none" stroke={color} strokeWidth={sw}
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" style={{ transition: "stroke-dasharray 0.8s ease" }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-semibold" style={{ fontFamily: MONO, color, fontSize: size < 70 ? 12 : 20 }}>{score}</span>
        {size >= 70 && <span className="text-[9px] uppercase tracking-widest" style={{ fontFamily: MONO, color: C.slate }}>score</span>}
      </div>
    </div>
  );
}

// ── Home Screen ───────────────────────────────────────────────────────────────
function HomeScreen({ onNewOrder }: { onNewOrder: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-full py-16 px-6">
      <div className="w-full max-w-lg flex flex-col items-center text-center gap-8"
        style={{ animation: "cartoniq-fade-up 0.7s ease both" }}>

        <AdvancingArrows className="w-48" style={{ animation: "cartoniq-drift 4s ease-in-out infinite" }} />

        <div>
          <h1 style={{ fontFamily: SERIF, color: C.navy, fontSize: 36, lineHeight: 1.15 }}>
            Smarter carton selection,<br />
            <span style={{ color: C.purple }}>driven by AI.</span>
          </h1>
          <p className="mt-3 text-base" style={{ color: C.slate }}>
            Compare your WMS carton recommendation against CartonIQ's optimized pick — and see exactly why it's better.
          </p>
        </div>

        <button
          onClick={onNewOrder}
          className="flex items-center gap-3 px-8 py-3.5 rounded-lg font-semibold text-base transition-all hover:opacity-90"
          style={{ background: C.navy, color: C.white, fontFamily: "'Inter', sans-serif", animation: "cartoniq-fade-up 0.7s ease 0.15s both" }}>
          <Plus size={16} />
          Create New Order
          <ArrowRight size={16} />
        </button>

        <div className="w-full grid grid-cols-3 gap-3 mt-4" style={{ animation: "cartoniq-fade-up 0.7s ease 0.28s both" }}>
          {[
            { label: "Reduce freight cost",       icon: "↓", color: C.teal   },
            { label: "Improve carton utilization", icon: "↑", color: C.violet },
            { label: "Cut packaging waste",        icon: "↓", color: C.teal   },
          ].map(({ label, icon, color }) => (
            <div key={label} className="rounded-lg border p-3 text-center"
              style={{ borderColor: C.border, background: C.bgSoft }}>
              <div className="text-lg font-bold mb-1" style={{ color }}>{icon}</div>
              <div className="text-xs" style={{ color: C.slate }}>{label}</div>
            </div>
          ))}
        </div>
      </div>
      <style>{`
        @keyframes cartoniq-fade-up {
          from { opacity: 0; transform: translateY(14px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes cartoniq-drift {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-6px); }
        }
      `}</style>
    </div>
  );
}

// ── WMS Carton Search ─────────────────────────────────────────────────────────
function WmsCartonSearch({ cartons, value, onChange, required = false }: {
  cartons: Carton[];
  value: string | null;
  onChange: (id: string | null) => void;
  required?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen]   = useState(false);

  const selected = value ? cartons.find((c) => c.id === value) ?? null : null;

  const matches = query.trim().length > 0
    ? cartons.filter((c) => {
        const q = query.toLowerCase();
        return (
          c.id.toLowerCase().includes(q) ||
          (c.name ?? "").toLowerCase().includes(q) ||
          (c.number ?? "").toLowerCase().includes(q)
        );
      }).slice(0, 8)
    : [];

  const pick = (c: Carton) => {
    onChange(c.id);
    setQuery("");
    setOpen(false);
  };

  const clear = () => {
    onChange(null);
    setQuery("");
  };

  return (
    <div className="relative">
      {selected ? (
        <div className="flex items-center gap-2 px-3 py-2.5 rounded text-sm"
          style={{ background: C.bg, border: `1px solid ${C.teal}60`, color: C.navy, fontFamily: "'Inter', sans-serif" }}>
          <span className="text-xs font-semibold shrink-0" style={{ fontFamily: MONO, color: C.teal }}>{selected.id}</span>
          {selected.number && selected.number !== selected.id && (
            <span className="text-xs shrink-0" style={{ fontFamily: MONO, color: C.purple }}>#{selected.number}</span>
          )}
          <span className="flex-1 truncate">{selected.name}</span>
          <span className="text-xs shrink-0" style={{ fontFamily: MONO, color: C.slate }}>
            {selected.length}×{selected.width}×{selected.height}"
          </span>
          {selected.cost > 0 && (
            <span className="text-xs font-semibold shrink-0" style={{ fontFamily: MONO, color: C.navy }}>
              ${selected.cost.toFixed(2)}
            </span>
          )}
          <button onClick={clear} className="shrink-0 ml-1" style={{ color: C.slate }} aria-label="Clear Manhattan carton">
            <X size={12} />
          </button>
        </div>
      ) : (
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          required={required}
          aria-required={required}
          placeholder="Search by carton ID, name, or Packsize number… (required)"
          className="w-full rounded px-3 py-2.5 text-sm focus:outline-none"
          style={{
            background: C.bg,
            border: `1px solid ${required ? "rgba(204,34,0,0.35)" : C.border}`,
            color: C.navy,
            fontFamily: "'Inter', sans-serif",
          }}
        />
      )}
      {open && matches.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 rounded-lg border overflow-hidden z-20"
          style={{ borderColor: C.border, background: C.bg, boxShadow: "0 4px 20px rgba(0,60,113,0.12)" }}>
          {matches.map((c, _i) => (
            <button key={`${c.id}-${_i}`} onMouseDown={() => pick(c)}
              className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-[#f4f6f8] transition-colors border-b last:border-0"
              style={{ borderColor: C.border }}>
              <div>
                <span className="text-xs font-semibold" style={{ fontFamily: MONO, color: C.teal }}>{c.id}</span>
                {c.number && c.number !== c.id && <span className="text-xs ml-1.5" style={{ fontFamily: MONO, color: C.purple }}>#{c.number}</span>}
                {c.name && <span className="text-sm ml-2" style={{ color: C.navy }}>{c.name}</span>}
              </div>
              <span className="text-xs shrink-0 ml-3" style={{ fontFamily: MONO, color: C.slate }}>
                {c.length}×{c.width}×{c.height}"
                {c.cost > 0 ? ` · $${c.cost.toFixed(2)}` : ""}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Order Builder ─────────────────────────────────────────────────────────────
function OrderScreen({ skuDb, cartons, onAnalyze }: {
  skuDb: SKU[];
  cartons: Carton[];
  onAnalyze: (items: OrderItem[], wmsCartonId: string | null) => void;
}) {
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<OrderItem[]>([]);
  const [wmsCartonId, setWmsCartonId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = search.trim().length > 0
    ? skuDb.filter((s) =>
        s.id.toLowerCase().includes(search.toLowerCase()) ||
        s.name.toLowerCase().includes(search.toLowerCase())
      ).slice(0, 6)
    : [];

  const addSku = (sku: SKU) => {
    setItems((prev) => {
      const ex = prev.find((i) => i.sku.id === sku.id);
      return ex ? prev.map((i) => i.sku.id === sku.id ? { ...i, qty: i.qty + 1 } : i) : [...prev, { sku, qty: 1 }];
    });
    setSearch("");
    inputRef.current?.focus();
  };

  const tryScanAdd = () => {
    const q = search.trim().toLowerCase();
    if (!q) return;
    const exact = skuDb.find((s) => s.id.toLowerCase() === q);
    if (exact) { addSku(exact); return; }
    if (results.length === 1) addSku(results[0]);
  };

  const updateQty = (id: string, qty: number) => {
    if (qty >= 1) setItems((p) => p.map((i) => i.sku.id === id ? { ...i, qty } : i));
  };

  const remove = (id: string) => setItems((p) => p.filter((i) => i.sku.id !== id));

  const totalWeight = items.reduce((a, { sku, qty }) => a + sku.weight * qty, 0);

  return (
    <div className="flex flex-col gap-5 max-w-2xl mx-auto w-full">
      <div>
        <h2 style={{ fontFamily: SERIF, color: C.navy, fontSize: 24 }} className="font-semibold mb-1">Order Builder</h2>
        <p className="text-sm" style={{ color: C.slate }}>Scan or search SKUs, set quantities, enter the Manhattan carton, then analyze.</p>
      </div>

      {/* SKU search */}
      <Card>
        <div className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <ScanBarcode size={14} style={{ color: C.teal }} />
            <span className="text-[10px] uppercase tracking-widest" style={{ fontFamily: MONO, color: C.slate }}>Search / Scan SKU</span>
          </div>
          <div className="relative">
            <input
              ref={inputRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); tryScanAdd(); } }}
              placeholder="Scan barcode or search by SKU / product name…"
              autoFocus
              className="w-full rounded px-3 py-2.5 text-sm focus:outline-none"
              style={{ background: C.bgSoft, border: `1px solid ${C.border}`, color: C.navy, fontFamily: "'Inter', sans-serif" }}
            />
            {results.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 rounded-lg border overflow-hidden z-10"
                style={{ borderColor: C.border, background: C.bg, boxShadow: "0 4px 20px rgba(0,60,113,0.12)" }}>
                {results.map((s, _i) => {
                  const fs = fragStyle(s.fragility);
                  return (
                    <button key={`${s.id}-${_i}`} onClick={() => addSku(s)}
                      className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-[#f4f6f8] transition-colors border-b last:border-0"
                      style={{ borderColor: C.border }}>
                      <div>
                        <div className="text-xs font-semibold" style={{ fontFamily: MONO, color: C.teal }}>{s.id}</div>
                        <div className="text-sm" style={{ color: C.navy }}>{s.name}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] px-1.5 py-0.5 rounded border"
                          style={{ fontFamily: MONO, color: fs.color, background: fs.bg, borderColor: fs.border }}>
                          {s.fragility}
                        </span>
                        <span className="text-xs" style={{ color: C.slate }}>{s.length}×{s.width}×{s.height}"</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          {skuDb.length === 0 && (
            <p className="mt-2 text-xs" style={{ color: "#cc2200" }}>No SKU database loaded. Upload one in Settings.</p>
          )}
        </div>
      </Card>

      {/* Order table */}
      {items.length > 0 ? (
        <Card>
          <div className="px-4 py-3 border-b flex items-center justify-between"
            style={{ borderColor: C.border, background: C.bgSoft }}>
            <span className="text-[10px] uppercase tracking-widest" style={{ fontFamily: MONO, color: C.slate }}>
              Order — {items.length} SKU{items.length !== 1 ? "s" : ""}
            </span>
            <span className="text-[10px]" style={{ fontFamily: MONO, color: C.slate }}>
              Total weight: <span style={{ color: C.navy, fontWeight: 600 }}>{totalWeight.toFixed(2)} lbs</span>
            </span>
          </div>
          <table className="w-full">
            <thead>
              <tr className="border-b" style={{ borderColor: C.border }}>
                {["SKU", "Product", "Dims (in)", "Weight", "Fragility", "Qty", ""].map((h) => (
                  <th key={h} className="text-left px-4 py-2 text-[10px] uppercase tracking-wider"
                    style={{ fontFamily: MONO, color: C.slate }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map(({ sku, qty }, _i) => {
                const fs = fragStyle(sku.fragility);
                return (
                  <tr key={`${sku.id}-${_i}`} className="border-b last:border-0 hover:bg-[#f4f6f8] transition-colors"
                    style={{ borderColor: C.border }}>
                    <td className="px-4 py-3 text-xs font-semibold" style={{ fontFamily: MONO, color: C.teal }}>{sku.id}</td>
                    <td className="px-4 py-3 text-sm" style={{ color: C.navy }}>{sku.name}</td>
                    <td className="px-4 py-3 text-xs" style={{ fontFamily: MONO, color: C.slate }}>{sku.length}×{sku.width}×{sku.height}</td>
                    <td className="px-4 py-3 text-xs" style={{ fontFamily: MONO, color: C.slate }}>{sku.weight} lb</td>
                    <td className="px-4 py-3">
                      <span className="text-[10px] px-1.5 py-0.5 rounded border"
                        style={{ fontFamily: MONO, color: fs.color, background: fs.bg, borderColor: fs.border }}>
                        {sku.fragility}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button onClick={() => updateQty(sku.id, qty - 1)}
                          className="w-6 h-6 flex items-center justify-center rounded border text-xs"
                          style={{ borderColor: C.border, color: C.slate, fontFamily: MONO }}>−</button>
                        <input type="number" value={qty} min={1}
                          onChange={(e) => updateQty(sku.id, parseInt(e.target.value) || 1)}
                          className="w-9 text-center bg-transparent text-sm focus:outline-none"
                          style={{ color: C.navy, fontFamily: MONO }} />
                        <button onClick={() => updateQty(sku.id, qty + 1)}
                          className="w-6 h-6 flex items-center justify-center rounded border text-xs"
                          style={{ borderColor: C.border, color: C.slate, fontFamily: MONO }}>+</button>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <button onClick={() => remove(sku.id)} style={{ color: C.slate }}
                        onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#cc2200")}
                        onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = C.slate)}>
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {/* WMS carton selector */}
          <div className="px-4 py-3 border-t" style={{ borderColor: C.border, background: C.bgSoft }}>
            <div className="flex items-center gap-3">
              <div className="flex-1 relative">
                <label className="block text-[10px] uppercase tracking-widest mb-1.5" style={{ fontFamily: MONO, color: C.slate }}>
                  Manhattan WMS Recommended Carton <span style={{ color: "#cc2200" }}>*</span>
                </label>
                <WmsCartonSearch cartons={cartons} value={wmsCartonId} onChange={setWmsCartonId} required />
                {!wmsCartonId && (
                  <p className="mt-1.5 text-[10px]" style={{ fontFamily: MONO, color: "#cc2200" }}>
                    Required before analysis
                  </p>
                )}
              </div>
              <button
                onClick={() => { if (wmsCartonId) onAnalyze(items, wmsCartonId); }}
                disabled={!wmsCartonId}
                className="flex items-center gap-2 px-6 py-2.5 rounded-lg font-semibold text-sm transition-all shrink-0 mt-5 disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: C.purple, color: C.white }}>
                <Zap size={14} />Analyze<ArrowRight size={14} />
              </button>
            </div>
          </div>
        </Card>
      ) : (
        <div className="rounded-lg border border-dashed p-12 text-center" style={{ borderColor: C.border }}>
          <Package size={28} className="mx-auto mb-2" style={{ color: C.bgMuted }} />
          <p className="text-sm" style={{ color: C.slate }}>Search for a SKU above to add it to the order.</p>
        </div>
      )}
    </div>
  );
}

// ── Recommendation Screen ─────────────────────────────────────────────────────
function RecommendationScreen({ items, cartons, wmsCartonId, onBack, onRecorded }: {
  items: OrderItem[]; cartons: Carton[]; wmsCartonId: string | null; onBack: () => void;
  onRecorded: (record: AnalysisRecord) => void;
}) {
  // Run expensive packing once per order — not on every re-render.
  const analysis = useMemo(() => {
    const manhattan =
      (wmsCartonId ? cartons.find((c) => c.id === wmsCartonId) : null) ??
      calcManhattan(items, cartons);
    const wmsIsManual = wmsCartonId != null && cartons.some((c) => c.id === wmsCartonId);
    const { carton: ai, score, noFit, candidateCount, minRequired, cubing, custom } = calcAI(items, cartons);
    const aiCubing = noFit ? null : cubing ?? cubePack(items, ai);
    const wmsCubing = cubePack(items, manhattan);
    const manhattanScore = scoreCarton(manhattan, items, wmsCubing);
    return {
      manhattan,
      wmsIsManual,
      ai,
      score,
      noFit,
      candidateCount,
      minRequired,
      aiCubing,
      wmsCubing,
      manhattanScore,
      custom,
    };
  }, [items, cartons, wmsCartonId]);

  const {
    manhattan,
    wmsIsManual,
    ai,
    score,
    noFit,
    candidateCount,
    minRequired,
    aiCubing,
    wmsCubing,
    manhattanScore,
    custom,
  } = analysis;

  const savings         = manhattan.cost - ai.cost;
  const savingsPct      = manhattan.cost > 0 ? Math.round((savings / manhattan.cost) * 100) : 0;
  const totalWeight     = items.reduce((a, { sku, qty }) => a + sku.weight * qty, 0);
  const totalItems      = items.reduce((a, { qty }) => a + qty, 0);
  const rationale       = !noFit && aiCubing
    ? buildRationale(manhattan, ai, score, aiCubing, items, wmsIsManual, candidateCount)
    : "No Packsize carton can physically accommodate this order after complete 3D cubing. Adjust SKUs, quantities, or the Packsize database.";
  const aiMatch         = !noFit && ai.id === manhattan.id;
  const scoresZero      = noFit || score.total === 0;
  const aiVol           = vol(ai.length, ai.width, ai.height);
  const wmsVol          = vol(manhattan.length, manhattan.width, manhattan.height);
  const corrugateDelta  = wmsVol - aiVol;
  const corrugatePct    = wmsVol > 0 ? Math.round((corrugateDelta / wmsVol) * 100) : 0;
  const dimWms          = dimW(manhattan.length, manhattan.width, manhattan.height);
  const dimAi           = dimW(ai.length, ai.width, ai.height);
  const dimDelta        = dimWms - dimAi;

  useEffect(() => {
    if (noFit || scoresZero) return;
    const snapCarton = (c: Carton): AnalysisCartonSnapshot => ({
      id: c.id,
      name: c.name,
      number: c.number,
      length: c.length,
      width: c.width,
      height: c.height,
      cost: c.cost,
      maxWeight: c.maxWeight,
    });
    onRecorded({
      id: `${Date.now()}`,
      at: new Date().toISOString(),
      skuCount: items.length,
      unitCount: totalItems,
      totalWeight,
      wmsCarton: manhattan.name || manhattan.id,
      aiCarton: ai.name || ai.id,
      wmsCost: manhattan.cost,
      aiCost: ai.cost,
      savings: Math.max(0, savings),
      utilization: score.utilization,
      voidPct: score.voidPct,
      dimWeightDelta: dimDelta,
      sustainability: score.sustainability,
      score: score.total,
      confirmedWms: aiMatch,
      wmsVolume: wmsVol,
      aiVolume: aiVol,
      wmsVoidPct: wmsCubing.fits ? wmsCubing.voidPct : undefined,
      category: items[0]?.sku.category,
      breakdown: {
        items: items.map(({ sku, qty }) => ({
          skuId: sku.id,
          name: sku.name,
          length: sku.length,
          width: sku.width,
          height: sku.height,
          weight: sku.weight,
          fragility: sku.fragility,
          rigidityClass: sku.rigidityClass ?? sku.mechanical?.rigidityClass,
          category: sku.category,
          qty,
        })),
        wms: snapCarton(manhattan),
        ai: snapCarton(ai),
        aiScore: score,
        wmsScore: manhattanScore,
        rationale,
        layers: aiCubing?.layers ?? 0,
        weightBalance: aiCubing?.weightBalance ?? "Unknown",
        cgRel: aiCubing?.cgRel ?? { x: 0.5, y: 0.5, z: 0.5 },
        placements: aiCubing?.placements ?? [],
        flexReports: aiCubing?.flexReports ?? [],
        mechanicalReviewRequired: !!aiCubing?.mechanicalReviewRequired,
        mechanicalWarnings: aiCubing?.mechanicalWarnings ?? [],
        fitStatus: score.fitStatus,
        fitReasons: score.fitReasons,
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col gap-5 max-w-4xl mx-auto w-full">

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 style={{ fontFamily: SERIF, color: C.navy, fontSize: 24 }} className="font-semibold mb-1">
            Carton Recommendation
          </h2>
          <p className="text-sm" style={{ color: C.slate }}>
            {totalItems} unit{totalItems !== 1 ? "s" : ""} · {items.length} SKU{items.length !== 1 ? "s" : ""} · {totalWeight.toFixed(1)} lbs total
          </p>
        </div>
        <button onClick={onBack}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border transition-colors"
          style={{ fontFamily: MONO, borderColor: C.border, color: C.slate }}>
          <RotateCcw size={11} />New Order
        </button>
      </div>

      {/* KPI strip */}
      {!scoresZero && aiCubing && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            {
              label: "Carton Cost Savings",
              value: savings > 0 ? `$${savings.toFixed(2)}` : aiMatch ? "Aligned" : "$0.00",
              sub: savingsPct > 0 ? `−${savingsPct}% vs WMS` : aiMatch ? "Confirms WMS" : "No cost delta",
              icon: <TrendingDown size={14} />,
              color: C.teal,
            },
            {
              label: "Cube Utilization",
              value: `${score.utilization}%`,
              sub: `Void ${score.voidPct}% · ${aiCubing.layers} layer${aiCubing.layers !== 1 ? "s" : ""}`,
              icon: <Box size={14} />,
              color: C.purple,
            },
            {
              label: "Dim Weight Impact",
              value: dimDelta > 0 ? `−${dimDelta.toFixed(1)} lb` : dimDelta < 0 ? `+${Math.abs(dimDelta).toFixed(1)} lb` : "0 lb",
              sub: `AI ${dimAi.toFixed(1)} vs WMS ${dimWms.toFixed(1)} lb`,
              icon: <Zap size={14} />,
              color: C.violet,
            },
            {
              label: "Corrugate / Sustainability",
              value: corrugateDelta > 0 ? `−${corrugatePct}%` : corrugateDelta < 0 ? `+${Math.abs(corrugatePct)}%` : "0%",
              sub: `Sustainability ${score.sustainability}/100`,
              icon: <Leaf size={14} />,
              color: C.teal,
            },
          ].map((k) => (
            <Card key={k.label} className="p-3.5">
              <div className="flex items-center gap-1.5 mb-1.5" style={{ color: k.color }}>
                {k.icon}
                <span className="text-[9px] uppercase tracking-widest" style={{ fontFamily: MONO }}>{k.label}</span>
              </div>
              <div className="text-xl font-semibold" style={{ fontFamily: SERIF, color: C.navy }}>{k.value}</div>
              <div className="text-[10px] mt-0.5" style={{ fontFamily: MONO, color: C.slate }}>{k.sub}</div>
            </Card>
          ))}
        </div>
      )}

      {/* Does Not Fit — only when zero Packsize cartons pass 3D cubing */}
      {noFit && (
        <div className="rounded-lg border px-4 py-3 flex items-start gap-3"
          style={{ borderColor: "#cc220050", background: "#cc220008" }}>
          <AlertTriangle size={14} className="mt-0.5 shrink-0" style={{ color: "#cc2200" }} />
          <div>
            <p className="text-sm font-semibold" style={{ color: "#cc2200" }}>Does Not Fit</p>
            <p className="text-sm mt-1" style={{ color: C.navy }}>
              No carton in the Packsize database can physically accommodate this order after complete 3D cubing.
              Required envelope ≥ {minRequired.itemEnvelope[0]}×{minRequired.itemEnvelope[1]}×{minRequired.itemEnvelope[2]}"
              · {Math.round(minRequired.totalVolume).toLocaleString()} in³ · {minRequired.totalWeight.toFixed(1)} lb.
            </p>
          </div>
        </div>
      )}

      {/* ── Side-by-side comparison ───────────────────────────────────────────── */}
      <div className={`grid grid-cols-1 gap-4 ${custom ? "md:grid-cols-2 xl:grid-cols-3" : "md:grid-cols-2"}`}>

        {/* WMS column — always shows raw cubing metrics, score if available */}
        <Card style={{ borderColor: C.violet + "40" }}>
          <div className="h-1 rounded-t-lg" style={{ background: C.violet }} />
          <div className="p-5">
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="text-[9px] uppercase tracking-widest mb-1" style={{ fontFamily: MONO, color: C.violet }}>
                  {wmsIsManual ? "Manhattan WMS" : "WMS (computed)"}
                </div>
                <div style={{ fontFamily: SERIF, fontSize: 18, color: C.navy, fontWeight: 600 }}>
                  {manhattan.name || manhattan.id}
                </div>
                <div className="text-[10px] mt-0.5" style={{ fontFamily: MONO, color: C.slate }}>
                  {manhattan.length} × {manhattan.width} × {manhattan.height} in · {vol(manhattan.length, manhattan.width, manhattan.height).toLocaleString()} in³
                </div>
                {manhattan.cost > 0 && (
                  <div className="text-sm font-semibold mt-1" style={{ fontFamily: MONO, color: C.navy }}>
                    Carton cost ${manhattan.cost.toFixed(2)}
                  </div>
                )}
              </div>
              <ScoreRing score={manhattanScore.total} size={52} />
            </div>

            {/* Fit status badge */}
            {wmsCubing.fits && (
              <div className="mb-3">
                {manhattanScore.fitStatus === "recommended" && (
                  <span className="text-[9px] px-2 py-0.5 rounded-full font-semibold" style={{ fontFamily: MONO, background: C.teal + "15", color: C.teal }}>
                    ✓ Fits — Recommended
                  </span>
                )}
                {manhattanScore.fitStatus === "not-recommended" && (
                  <span className="text-[9px] px-2 py-0.5 rounded-full font-semibold" style={{ fontFamily: MONO, background: "#f59e0b18", color: "#b45309" }}>
                    ⚠ Fits — Not Recommended
                  </span>
                )}
              </div>
            )}

            {/* Score bars or failure/not-recommended explanation */}
            <div className="space-y-2 mb-4">
              {wmsCubing.fits ? [
                { label: "Damage Prevention",  value: manhattanScore.damagePrevention },
                { label: "Movement Prevention", value: manhattanScore.movementPrevention },
                { label: "Dunnage Reduction",   value: manhattanScore.dunnageReduction },
                { label: "Carton Size Opt.",    value: manhattanScore.cartonSizeOpt },
                { label: "Pack Repeatability",  value: manhattanScore.packRepeatability },
                { label: "Labor Efficiency",    value: manhattanScore.laborEfficiency },
              ].map((b) => (
                <div key={b.label}>
                  <div className="flex justify-between mb-0.5">
                    <span className="text-[9px] uppercase tracking-wider" style={{ fontFamily: MONO, color: C.slate }}>{b.label}</span>
                    <span className="text-[9px]" style={{ fontFamily: MONO, color: C.slate }}>{b.value}</span>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: C.bgMuted }}>
                    <div className="h-full rounded-full" style={{ width: `${b.value}%`, background: C.violet }} />
                  </div>
                </div>
              )) : (
                <div className="rounded p-3 space-y-1.5" style={{ background: "#cc220008", border: "1px solid #cc220030" }}>
                  <div className="text-[9px] uppercase tracking-wider font-semibold" style={{ fontFamily: MONO, color: "#cc2200" }}>
                    Does Not Fit — Engineering Failure
                  </div>
                  <div className="text-[10px]" style={{ fontFamily: MONO, color: C.navy }}>
                    {wmsCubing.failReason ?? "No valid 3D arrangement found after evaluating all orientations and configurations."}
                  </div>
                </div>
              )}
            </div>

            {/* Not-recommended reasons */}
            {manhattanScore.fitStatus === "not-recommended" && manhattanScore.fitReasons.length > 0 && (
              <div className="rounded p-3 mb-3 space-y-1.5" style={{ background: "#f59e0b08", border: "1px solid #f59e0b30" }}>
                <div className="text-[9px] uppercase tracking-wider font-semibold mb-1" style={{ fontFamily: MONO, color: "#b45309" }}>
                  Engineering Concerns
                </div>
                {manhattanScore.fitReasons.map((r, i) => (
                  <div key={i} className="flex items-start gap-1.5">
                    <span style={{ color: "#b45309", fontSize: 10 }}>•</span>
                    <span className="text-[10px]" style={{ fontFamily: MONO, color: C.navy }}>{r}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Metrics — always from raw cubing */}
            <div className="grid grid-cols-2 gap-2 pt-3 border-t" style={{ borderColor: C.border }}>
              {[
                { label: "Cube Utilization", value: wmsCubing.fits ? `${Math.round(wmsCubing.utilization * 100)}%` : "Does Not Fit" },
                { label: "Dunnage Target",    value: "5%" },
                { label: "Total Void",        value: wmsCubing.fits ? `${wmsCubing.voidPct}%` : "—" },
                { label: "Weight Balance",    value: wmsCubing.fits ? wmsCubing.weightBalance : "—" },
                ...(manhattan.cost > 0 ? [{ label: "Carton Cost", value: `$${manhattan.cost.toFixed(2)}` }] : []),
                { label: "Dim. Weight", value: `${dimW(manhattan.length, manhattan.width, manhattan.height).toFixed(1)} lb` },
              ].map((m) => (
                <div key={m.label} className="rounded p-2" style={{ background: C.bgSoft }}>
                  <div className="text-[9px] uppercase tracking-wider mb-0.5" style={{ fontFamily: MONO, color: C.slate }}>{m.label}</div>
                  <div className="text-xs font-semibold" style={{ fontFamily: MONO, color: C.navy }}>{m.value}</div>
                </div>
              ))}
            </div>
          </div>
        </Card>

        {/* AI column */}
        <Card style={{ borderColor: C.teal + "60", boxShadow: `0 0 0 1px ${C.teal}20, 0 4px 20px ${C.teal}10` }}>
          <div className="h-1 rounded-t-lg" style={{ background: `linear-gradient(90deg, ${C.teal}, ${C.purple})` }} />
          <div className="p-5">
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                  <span className="text-[9px] uppercase tracking-widest" style={{ fontFamily: MONO, color: C.teal }}>CartonIQ AI · Packsize</span>
                  {noFit ? (
                    <span className="text-[8px] px-1.5 py-0.5 rounded-full font-semibold" style={{ fontFamily: MONO, background: "#cc220012", color: "#cc2200" }}>
                      Does Not Fit
                    </span>
                  ) : (
                    <>
                      <span className="text-[8px] px-1.5 py-0.5 rounded-full font-semibold" style={{ fontFamily: MONO, background: C.teal + "15", color: C.teal }}>
                        ✓ Highest Engineering Score
                      </span>
                      {score.fitStatus === "not-recommended" && (
                        <span className="text-[8px] px-1.5 py-0.5 rounded-full font-semibold" style={{ fontFamily: MONO, background: "#f59e0b18", color: "#b45309" }}>
                          Outside preferred targets
                        </span>
                      )}
                      {aiMatch && (
                        <span className="text-[8px] px-1.5 py-0.5 rounded" style={{ fontFamily: MONO, background: C.navy + "12", color: C.slate }}>
                          Confirms WMS
                        </span>
                      )}
                      {!aiMatch && savings > 0 && (
                        <span className="text-[8px] px-1.5 py-0.5 rounded" style={{ fontFamily: MONO, background: C.teal + "15", color: C.teal }}>
                          −{savingsPct}% carton cost
                        </span>
                      )}
                    </>
                  )}
                </div>
                <div style={{ fontFamily: SERIF, fontSize: 18, color: C.navy, fontWeight: 600 }}>
                  {noFit ? "—" : (ai.name || ai.id)}
                </div>
                <div className="text-[10px] mt-0.5" style={{ fontFamily: MONO, color: C.slate }}>
                  {noFit
                    ? "No Packsize carton accommodates this order"
                    : `${ai.number ? `#${ai.number} · ` : ""}${ai.length} × ${ai.width} × ${ai.height} in · ${aiVol.toLocaleString()} in³`}
                </div>
                {!noFit && ai.cost > 0 && (
                  <div className="text-sm font-semibold mt-1" style={{ fontFamily: MONO, color: C.navy }}>
                    Carton cost ${ai.cost.toFixed(2)}
                    {savings !== 0 && (
                      <span className="ml-2 font-normal" style={{ color: savings > 0 ? C.teal : "#b45309" }}>
                        ({savings > 0 ? "−" : "+"}${Math.abs(savings).toFixed(2)} vs WMS)
                      </span>
                    )}
                  </div>
                )}
              </div>
              <ScoreRing score={score.total} size={52} />
            </div>

            {/* Score bars with ▲/▼ vs WMS */}
            {!noFit && (
            <div className="space-y-2 mb-4">
              {[
                { label: "Damage Prevention",  value: score.damagePrevention,   wmsVal: manhattanScore.damagePrevention,   color: C.teal },
                { label: "Movement Prevention", value: score.movementPrevention, wmsVal: manhattanScore.movementPrevention, color: C.teal },
                { label: "Dunnage Reduction",   value: score.dunnageReduction,   wmsVal: manhattanScore.dunnageReduction,   color: C.purple },
                { label: "Carton Size Opt.",    value: score.cartonSizeOpt,      wmsVal: manhattanScore.cartonSizeOpt,      color: C.purple },
                { label: "Pack Repeatability",  value: score.packRepeatability,  wmsVal: manhattanScore.packRepeatability,  color: C.violet },
                { label: "Labor Efficiency",    value: score.laborEfficiency,    wmsVal: manhattanScore.laborEfficiency,    color: C.violet },
              ].map((b) => (
                <div key={b.label}>
                  <div className="flex justify-between mb-0.5">
                    <span className="text-[9px] uppercase tracking-wider" style={{ fontFamily: MONO, color: C.slate }}>{b.label}</span>
                    <span className="text-[9px]" style={{ fontFamily: MONO, color: b.value > b.wmsVal ? C.teal : b.value < b.wmsVal ? "#f59e0b" : C.slate }}>
                      {b.value}{b.value > b.wmsVal ? " ▲" : b.value < b.wmsVal ? " ▼" : ""}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: C.bgMuted }}>
                    <div className="h-full rounded-full" style={{ width: `${b.value}%`, background: b.color }} />
                  </div>
                </div>
              ))}
            </div>
            )}

            {/* Advisory engineering notes for AI carton (still recommended — best Packsize score) */}
            {!noFit && score.fitReasons.length > 0 && (
              <div className="rounded p-3 mb-3" style={{ background: "#f59e0b08", border: "1px solid #f59e0b30" }}>
                <div className="text-[9px] uppercase tracking-wider font-semibold mb-1.5" style={{ fontFamily: MONO, color: "#b45309" }}>
                  {custom
                    ? "Advisory — Packsize Primary; Custom Exceeds Thresholds"
                    : "Advisory — Best Packsize Score; Review Preferred Targets"}
                </div>
                {score.fitReasons.map((r, i) => (
                  <div key={i} className="flex items-start gap-1.5 mb-1 last:mb-0">
                    <span style={{ color: "#b45309", fontSize: 10 }}>•</span>
                    <span className="text-[10px]" style={{ fontFamily: MONO, color: C.navy }}>{r}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Metrics */}
            <div className="grid grid-cols-2 gap-2 pt-3 border-t" style={{ borderColor: C.border }}>
              {[
                { label: "Cube Utilization", value: noFit ? "Does Not Fit" : `${score.utilization}%` },
                { label: "Dunnage Target",    value: "5%" },
                { label: "Total Void",        value: noFit ? "—" : `${score.voidPct}%` },
                { label: "Weight Balance",    value: noFit || !aiCubing ? "—" : aiCubing.weightBalance },
                ...(!noFit && ai.cost > 0 ? [{ label: "Carton Cost", value: `$${ai.cost.toFixed(2)}` }] : []),
                { label: "Dim. Weight", value: noFit ? "—" : `${dimW(ai.length, ai.width, ai.height).toFixed(1)} lb` },
              ].map((m) => (
                <div key={m.label} className="rounded p-2" style={{ background: C.bgSoft }}>
                  <div className="text-[9px] uppercase tracking-wider mb-0.5" style={{ fontFamily: MONO, color: C.slate }}>{m.label}</div>
                  <div className="text-xs font-semibold" style={{ fontFamily: MONO, color: C.navy }}>{m.value}</div>
                </div>
              ))}
            </div>
          </div>
        </Card>

        {/* Custom carton — only when it beats Packsize by configured thresholds */}
        {custom && (
          <Card style={{ borderColor: C.cyan + "70", boxShadow: `0 0 0 1px ${C.cyan}25, 0 4px 20px ${C.cyan}12` }}>
            <div className="h-1 rounded-t-lg" style={{ background: `linear-gradient(90deg, ${C.cyan}, ${C.teal})` }} />
            <div className="p-5">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                    <span className="text-[9px] uppercase tracking-widest" style={{ fontFamily: MONO, color: C.cyan }}>
                      Custom Carton Recommendation
                    </span>
                    <span className="text-[8px] px-1.5 py-0.5 rounded-full font-semibold" style={{ fontFamily: MONO, background: C.cyan + "18", color: C.navy }}>
                      Exceeds Packsize
                    </span>
                    <span className="text-[8px] px-1.5 py-0.5 rounded" style={{ fontFamily: MONO, background: C.teal + "15", color: C.teal }}>
                      +{Math.round(custom.comparison.scoreDelta)} eng. pts
                    </span>
                  </div>
                  <div style={{ fontFamily: SERIF, fontSize: 18, color: C.navy, fontWeight: 600 }}>
                    {custom.carton.length} × {custom.carton.width} × {custom.carton.height} in
                  </div>
                  <div className="text-[10px] mt-0.5" style={{ fontFamily: MONO, color: C.slate }}>
                    {vol(custom.carton.length, custom.carton.width, custom.carton.height).toLocaleString()} in³ · made-to-order
                  </div>
                </div>
                <ScoreRing score={custom.score.total} size={52} />
              </div>

              <p className="text-[11px] mb-3 leading-relaxed" style={{ color: C.navy }}>
                {custom.reason}
              </p>

              <div className="grid grid-cols-2 gap-2 mb-4">
                {[
                  { label: "Engineering Score", value: `${custom.score.total} (+${Math.round(custom.comparison.scoreDelta)} vs Packsize)` },
                  { label: "Est. Packaging Cost", value: `$${custom.carton.cost.toFixed(2)}` },
                  {
                    label: "Est. Transportation Cost",
                    value: `$${custom.comparison.transportCostCustom.toFixed(2)}`,
                  },
                  {
                    label: "Est. Savings / Shipment",
                    value: `$${(custom.comparison.packagingCostSavings + custom.comparison.transportCostSavings).toFixed(2)}`,
                  },
                  {
                    label: "ROI vs Packsize",
                    value:
                      score.total > 0
                        ? `+${Math.round((custom.comparison.scoreDelta / score.total) * 100)}% eng. · $${(custom.comparison.packagingCostSavings + custom.comparison.transportCostSavings).toFixed(2)}`
                        : `+${Math.round(custom.comparison.scoreDelta)} pts`,
                  },
                  { label: "Cube Utilization", value: `${custom.score.utilization}% (Packsize ${score.utilization}%)` },
                ].map((m) => (
                  <div key={m.label} className="rounded p-2" style={{ background: C.bgSoft }}>
                    <div className="text-[9px] uppercase tracking-wider mb-0.5" style={{ fontFamily: MONO, color: C.slate }}>{m.label}</div>
                    <div className="text-xs font-semibold" style={{ fontFamily: MONO, color: C.navy }}>{m.value}</div>
                  </div>
                ))}
              </div>

              <div className="space-y-2">
                {[
                  { label: "Damage Prevention", value: custom.score.damagePrevention, packVal: score.damagePrevention, color: C.cyan },
                  { label: "Movement Prevention", value: custom.score.movementPrevention, packVal: score.movementPrevention, color: C.cyan },
                  { label: "Dunnage Reduction", value: custom.score.dunnageReduction, packVal: score.dunnageReduction, color: C.teal },
                  { label: "Carton Size Opt.", value: custom.score.cartonSizeOpt, packVal: score.cartonSizeOpt, color: C.teal },
                  { label: "Pack Repeatability", value: custom.score.packRepeatability, packVal: score.packRepeatability, color: C.purple },
                  { label: "Labor Efficiency", value: custom.score.laborEfficiency, packVal: score.laborEfficiency, color: C.purple },
                ].map((b) => (
                  <div key={b.label}>
                    <div className="flex justify-between mb-0.5">
                      <span className="text-[9px] uppercase tracking-wider" style={{ fontFamily: MONO, color: C.slate }}>{b.label}</span>
                      <span className="text-[9px]" style={{ fontFamily: MONO, color: b.value > b.packVal ? C.teal : b.value < b.packVal ? "#f59e0b" : C.slate }}>
                        {b.value}{b.value > b.packVal ? " ▲" : b.value < b.packVal ? " ▼" : ""}
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: C.bgMuted }}>
                      <div className="h-full rounded-full" style={{ width: `${b.value}%`, background: b.color }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        )}
      </div>

      {/* ── 3D Cubing — AI Recommendation ────────────────────────────────────── */}
      {aiCubing && aiCubing.fits && (
        <Card>
          <div className="px-5 py-3 border-b flex items-center gap-2" style={{ borderColor: C.border, background: C.bgSoft }}>
            <Layers size={12} style={{ color: C.purple }} />
            <span className="text-[10px] uppercase tracking-widest" style={{ fontFamily: MONO, color: C.slate }}>
              3D Cubing — {ai.name || ai.id}
            </span>
            <span className="ml-auto text-[10px]" style={{ fontFamily: MONO, color: C.slate }}>
              {aiCubing.layers} layer{aiCubing.layers !== 1 ? "s" : ""} · {Math.round(aiCubing.utilization * 100)}% utilization · {aiCubing.weightBalance}
            </span>
          </div>

          {/* Summary metrics */}
          <div className="px-5 py-4 border-b grid grid-cols-4 gap-4" style={{ borderColor: C.border }}>
            <div>
              <div className="text-[9px] uppercase tracking-wider mb-1" style={{ fontFamily: MONO, color: C.slate }}>Cube Utilization</div>
              <div className="h-1.5 rounded-full overflow-hidden mb-1" style={{ background: C.bgMuted }}>
                <div className="h-full rounded-full" style={{ width: `${Math.round(aiCubing.utilization * 100)}%`, background: C.teal }} />
              </div>
              <div className="text-xs font-bold" style={{ fontFamily: MONO, color: C.teal }}>{Math.round(aiCubing.utilization * 100)}%</div>
            </div>
            <div>
              <div className="text-[9px] uppercase tracking-wider mb-1" style={{ fontFamily: MONO, color: C.slate }}>5% Dunnage Target</div>
              <div className="text-xs font-bold" style={{ fontFamily: MONO, color: C.purple }}>{aiCubing.dunnage5Pct.toLocaleString()} in³</div>
              <div className="text-[9px] mt-0.5" style={{ fontFamily: MONO, color: C.slate }}>total void: {score.dunnageVolEst.toLocaleString()} in³</div>
            </div>
            <div>
              <div className="text-[9px] uppercase tracking-wider mb-1" style={{ fontFamily: MONO, color: C.slate }}>Center of Gravity</div>
              <div className="text-xs font-bold" style={{ fontFamily: MONO, color: C.navy }}>
                x{Math.round(aiCubing.cgRel.x * 100)}% y{Math.round(aiCubing.cgRel.y * 100)}% z{Math.round(aiCubing.cgRel.z * 100)}%
              </div>
            </div>
            <div>
              <div className="text-[9px] uppercase tracking-wider mb-1" style={{ fontFamily: MONO, color: C.slate }}>Weight Balance</div>
              <div className="text-xs font-semibold" style={{ color: aiCubing.weightBalance === "Well-balanced" ? C.teal : "#f59e0b" }}>
                {aiCubing.weightBalance}
              </div>
            </div>
          </div>

          {aiCubing.placements.length > 0 && (
            <CubingDiagram carton={ai} placements={aiCubing.placements} />
          )}

          {(aiCubing.mechanicalReviewRequired || score.fitStatus === "mechanical-review") && (
            <div className="px-5 py-3 border-b" style={{ borderColor: C.border, background: "#fef3c7" }}>
              <div className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ fontFamily: MONO, color: "#92400e" }}>
                Fits — Mechanical Review Required
              </div>
              <p className="text-[11px] leading-relaxed" style={{ color: "#78350f" }}>
                Physical fit succeeded, but the layout depends on flexible/soft package compression, soft packages supporting load, or shape-recovery risk. Engineering quality is scored separately from geometric fit.
              </p>
              {(aiCubing.mechanicalWarnings?.length ?? 0) > 0 && (
                <ul className="mt-2 space-y-0.5 text-[10px]" style={{ fontFamily: MONO, color: "#92400e" }}>
                  {aiCubing.mechanicalWarnings!.slice(0, 6).map((w, i) => (
                    <li key={i}>• {w}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {aiCubing.flexReports.length > 0 && (
            <div className="px-5 py-4 border-b" style={{ borderColor: C.border }}>
              <div className="text-[9px] uppercase tracking-widest mb-3" style={{ fontFamily: MONO, color: C.slate }}>
                Flexible / soft package pack-out
              </div>
              <div className="space-y-3">
                {aiCubing.flexReports.map((fr) => (
                  <div key={`${fr.skuId}-${fr.unit}`} className="rounded border px-3 py-2.5" style={{ borderColor: C.border, background: C.bgSoft }}>
                    <div className="flex flex-wrap items-center gap-2 mb-1.5">
                      <span className="text-xs font-semibold" style={{ color: C.navy }}>{fr.skuId}</span>
                      <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ fontFamily: MONO, background: C.purple + "18", color: C.purple }}>
                        {fr.rigidityClass}
                      </span>
                      <span className="text-[9px] px-1.5 py-0.5 rounded" style={{
                        fontFamily: MONO,
                        background: fr.compressionRisk === "high" ? "#fee2e2" : fr.compressionRisk === "medium" ? "#fef3c7" : "#d1fae5",
                        color: fr.compressionRisk === "high" ? "#b91c1c" : fr.compressionRisk === "medium" ? "#92400e" : "#065f46",
                      }}>
                        compression {fr.compressionRisk}
                      </span>
                      {fr.conformsToVoid && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ fontFamily: MONO, background: C.teal + "18", color: C.teal }}>
                          void conform
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]" style={{ fontFamily: MONO, color: C.slate }}>
                      <div>
                        <div className="text-[9px] uppercase">Original</div>
                        <div style={{ color: C.navy }}>{fr.originalDimensions.length}×{fr.originalDimensions.width}×{fr.originalDimensions.height}"</div>
                      </div>
                      <div>
                        <div className="text-[9px] uppercase">Packed</div>
                        <div style={{ color: C.navy }}>{fr.packedDimensions.length}×{fr.packedDimensions.width}×{fr.packedDimensions.height}"</div>
                      </div>
                      <div>
                        <div className="text-[9px] uppercase">Compression %</div>
                        <div style={{ color: C.navy }}>
                          L{fr.compressionPercent.length} W{fr.compressionPercent.width} H{fr.compressionPercent.height}
                        </div>
                      </div>
                      <div>
                        <div className="text-[9px] uppercase">Retained vol</div>
                        <div style={{ color: C.navy }}>{fr.retainedVolumePercent}%</div>
                      </div>
                      <div>
                        <div className="text-[9px] uppercase">Placement</div>
                        <div style={{ color: C.navy }}>x{fr.placement.x} y{fr.placement.y} z{fr.placement.z}</div>
                      </div>
                      <div>
                        <div className="text-[9px] uppercase">Top load</div>
                        <div style={{ color: C.navy }}>{fr.topLoadLb} lb</div>
                      </div>
                    </div>
                    {fr.warnings.length > 0 && (
                      <div className="mt-1.5 text-[10px]" style={{ color: "#92400e" }}>
                        {fr.warnings.join(" · ")}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <div className="mt-3 grid grid-cols-2 sm:grid-cols-5 gap-2 text-[10px]">
                {[
                  { label: "Flex compression risk", value: score.flexiblePackageCompressionRisk },
                  { label: "Soft top-load risk", value: score.softPackageTopLoadRisk },
                  { label: "Content migration", value: score.contentMigrationRisk },
                  { label: "Void conformity benefit", value: score.voidConformityBenefit },
                  { label: "Shape-recovery risk", value: score.shapeRecoveryMovementRisk },
                ].map((m) => (
                  <div key={m.label} className="rounded p-2" style={{ background: C.bgMuted }}>
                    <div className="text-[9px] uppercase tracking-wider mb-0.5" style={{ fontFamily: MONO, color: C.slate }}>{m.label}</div>
                    <div className="font-semibold" style={{ fontFamily: MONO, color: C.navy }}>{m.value}/100</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Layer breakdown */}
          <div className="px-5 py-2 border-b text-[10px]" style={{ borderColor: C.border, color: C.slate, fontFamily: MONO }}>
            Each unit may be placed horizontal (flat), vertical (on end), or on-side — all catalog rotations are tried unless a SKU is marked keep-flat / keep-upright. Soft/flexible packages may use controlled compression within SKU limits.
          </div>
          <div className="divide-y" style={{ borderColor: C.border }}>
            {aiCubing.layerGroups.map((lg) => (
              <div key={lg.layer} className="px-5 py-3">
                <div className="flex items-center gap-2 mb-2">
                  <div className="text-[9px] uppercase tracking-widest px-2 py-0.5 rounded-full font-semibold"
                    style={{ fontFamily: MONO, background: C.purple + "15", color: C.purple }}>
                    Layer {lg.layer}
                  </div>
                  <div className="text-[9px]" style={{ fontFamily: MONO, color: C.slate }}>
                    z = {lg.zStart}" · height {lg.height}"
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  {lg.items.map((item, i) => {
                    const postureColor =
                      item.posture === "vertical" ? C.teal :
                      item.posture === "horizontal" ? C.purple :
                      C.violet;
                    const postureWord =
                      item.posture === "vertical" ? "Vertical" :
                      item.posture === "horizontal" ? "Horizontal" :
                      "On-side";
                    return (
                      <div key={i} className="rounded border px-3 py-2"
                        style={{ borderColor: C.border, background: C.bgSoft }}>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-semibold" style={{ color: C.navy }}>{item.name}</span>
                          <span className="text-[9px] px-1.5 py-0.5 rounded font-semibold"
                            style={{ fontFamily: MONO, background: postureColor + "18", color: postureColor }}>
                            {postureWord}
                          </span>
                          <span className="text-[10px]" style={{ fontFamily: MONO, color: C.slate }}>
                            {item.orient}" · {item.weight} lb
                          </span>
                        </div>
                        <p className="text-[10px] mt-1 leading-relaxed" style={{ color: C.slate }}>
                          {item.orientLabel}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ── Order Contents ───────────────────────────────────────────────────── */}
      <Card>
        <div className="px-5 py-3 border-b flex items-center justify-between" style={{ borderColor: C.border, background: C.bgSoft }}>
          <span className="text-[10px] uppercase tracking-widest" style={{ fontFamily: MONO, color: C.slate }}>Order Contents</span>
          <span className="text-[10px]" style={{ fontFamily: MONO, color: C.slate }}>
            {totalItems} unit{totalItems !== 1 ? "s" : ""} · {totalWeight.toFixed(2)} lbs
          </span>
        </div>
        <table className="w-full">
          <thead>
            <tr className="border-b" style={{ borderColor: C.border }}>
              {["SKU", "Product", "Dims (L×W×H in)", "Unit Wt.", "Qty", "Total Vol."].map((h) => (
                <th key={h} className="text-left px-4 py-2 text-[10px] uppercase tracking-wider"
                  style={{ fontFamily: MONO, color: C.slate }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map(({ sku, qty }, _i) => {
              const fs = fragStyle(sku.fragility);
              const itemVol = vol(sku.length, sku.width, sku.height) * qty;
              return (
                <tr key={`${sku.id}-${_i}`} className="border-b last:border-0" style={{ borderColor: C.border }}>
                  <td className="px-4 py-2.5 text-xs font-semibold" style={{ fontFamily: MONO, color: C.teal }}>{sku.id}</td>
                  <td className="px-4 py-2.5">
                    <div className="text-sm" style={{ color: C.navy }}>{sku.name}</div>
                    <span className="text-[10px] px-1.5 py-0.5 rounded border"
                      style={{ fontFamily: MONO, color: fs.color, background: fs.bg, borderColor: fs.border }}>
                      {sku.fragility}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-xs" style={{ fontFamily: MONO, color: C.slate }}>
                    {sku.length} × {sku.width} × {sku.height}
                  </td>
                  <td className="px-4 py-2.5 text-xs" style={{ fontFamily: MONO, color: C.slate }}>{sku.weight} lb</td>
                  <td className="px-4 py-2.5 text-xs font-semibold" style={{ fontFamily: MONO, color: C.navy }}>×{qty}</td>
                  <td className="px-4 py-2.5 text-xs" style={{ fontFamily: MONO, color: C.slate }}>{itemVol.toLocaleString()} in³</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      {/* ── Engineering model ───────────────────────────────────────────────── */}
      <Card>
        <div className="px-5 py-3 border-b flex items-center gap-2" style={{ borderColor: C.border, background: C.bgSoft }}>
          <Zap size={12} style={{ color: C.purple }} />
          <span className="text-[10px] uppercase tracking-widest" style={{ fontFamily: MONO, color: C.slate }}>
            Engineering Model
          </span>
        </div>
        <div className="p-5">
          <div className="grid grid-cols-3 gap-3 text-[10px]" style={{ fontFamily: MONO, color: C.slate }}>
            <div>
              <div className="uppercase tracking-widest mb-1">Scoring Model</div>
              <div>Damage Prevention 35%</div>
              <div>Movement Prevention 25%</div>
              <div>Dunnage Reduction 15%</div>
              <div>Carton Size Opt. 10%</div>
              <div>Pack Repeatability 10%</div>
              <div>Labor Efficiency 5%</div>
            </div>
            <div>
              <div className="uppercase tracking-widest mb-1">Engineering Rules Applied</div>
              <div>6-direction movement analysis</div>
              <div>Dimensional fit verification</div>
              <div>Dunnage clearance check</div>
              <div>Void space optimization</div>
              <div>Fragility-adjusted scoring</div>
            </div>
            <div>
              <div className="uppercase tracking-widest mb-1">Distribution Standard</div>
              <div>Per ISTA/ASTM principles</div>
              <div>Dunnage reserve: {Math.round(DUNNAGE_PCT*100)}% of carton volume</div>
              <div>Ideal target: {Math.round(UTIL_IDEAL_LOW*100)}–{Math.round(UTIL_IDEAL_HIGH*100)}% utilization</div>
              <div>Acceptable range: {Math.round(UTIL_MIN*100)}–{Math.round(UTIL_MAX*100)}%</div>
              <div>Flag &gt;{Math.round(UTIL_MAX*100)}%: insufficient clearance</div>
              <div>Flag &lt;{Math.round(UTIL_MIN*100)}%: excessive void</div>
              <div>Weight limit verified</div>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

// ── Analytics Screen ──────────────────────────────────────────────────────────
function AnalysisDetailView({ record, onBack }: { record: AnalysisRecord; onBack: () => void }) {
  const b = record.breakdown;
  const aiCarton: Carton | null = b
    ? {
        id: b.ai.id,
        name: b.ai.name,
        number: b.ai.number,
        length: b.ai.length,
        width: b.ai.width,
        height: b.ai.height,
        cost: b.ai.cost,
        maxWeight: b.ai.maxWeight,
      }
    : null;

  return (
    <div className="flex flex-col gap-5 max-w-4xl mx-auto w-full">
      <div className="flex items-start justify-between gap-4">
        <div>
          <button
            onClick={onBack}
            className="flex items-center gap-1 text-xs mb-2 px-0"
            style={{ fontFamily: MONO, color: C.teal }}
          >
            <ChevronLeft size={14} /> Back to Analytics
          </button>
          <h2 style={{ fontFamily: SERIF, color: C.navy, fontSize: 24 }} className="font-semibold mb-1">
            Analysis Breakdown
          </h2>
          <p className="text-sm" style={{ color: C.slate }}>
            {new Date(record.at).toLocaleString()} · {record.unitCount} units · {record.skuCount} SKUs ·{" "}
            {record.totalWeight.toFixed(1)} lb
          </p>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[9px] uppercase tracking-widest" style={{ fontFamily: MONO, color: C.slate }}>
            Engineering score
          </div>
          <div className="text-3xl font-semibold" style={{ fontFamily: SERIF, color: C.navy }}>
            {record.score}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "WMS Carton", value: record.wmsCarton, sub: `$${record.wmsCost.toFixed(2)}` },
          { label: "AI Carton", value: record.aiCarton, sub: `$${record.aiCost.toFixed(2)}` },
          {
            label: "Savings",
            value: `$${record.savings.toFixed(2)}`,
            sub: record.confirmedWms ? "Confirmed WMS" : "AI override",
          },
          { label: "Utilization", value: `${record.utilization}%`, sub: `${record.voidPct}% void` },
        ].map((k) => (
          <Card key={k.label} className="p-3.5">
            <div className="text-[9px] uppercase tracking-widest mb-1" style={{ fontFamily: MONO, color: C.slate }}>
              {k.label}
            </div>
            <div className="text-sm font-semibold truncate" style={{ color: C.navy }} title={k.value}>
              {k.value}
            </div>
            <div className="text-[10px] mt-0.5" style={{ fontFamily: MONO, color: C.slate }}>
              {k.sub}
            </div>
          </Card>
        ))}
      </div>

      {!b ? (
        <Card className="p-6">
          <p className="text-sm" style={{ color: C.slate }}>
            This analysis was saved before detailed snapshots were available. Run a new analysis to capture the full
            cubing, scoring, and order breakdown.
          </p>
        </Card>
      ) : (
        <>
          {(b.mechanicalReviewRequired || b.fitStatus === "mechanical-review") && (
            <div className="rounded-lg border px-4 py-3" style={{ borderColor: "#f59e0b50", background: "#fef3c7" }}>
              <div className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ fontFamily: MONO, color: "#92400e" }}>
                Fits — Mechanical Review Required
              </div>
              {b.mechanicalWarnings.length > 0 && (
                <ul className="text-[10px] space-y-0.5" style={{ fontFamily: MONO, color: "#92400e" }}>
                  {b.mechanicalWarnings.slice(0, 6).map((w, i) => (
                    <li key={i}>• {w}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card className="p-5">
              <div className="text-[9px] uppercase tracking-widest mb-2" style={{ fontFamily: MONO, color: C.violet }}>
                Manhattan WMS
              </div>
              <div style={{ fontFamily: SERIF, fontSize: 18, color: C.navy, fontWeight: 600 }}>
                {b.wms.name || b.wms.id}
              </div>
              <div className="text-[10px] mt-0.5 mb-3" style={{ fontFamily: MONO, color: C.slate }}>
                {b.wms.length}×{b.wms.width}×{b.wms.height}" · score {b.wmsScore.total}
              </div>
              <div className="grid grid-cols-2 gap-2 text-[10px]" style={{ fontFamily: MONO, color: C.slate }}>
                <div>Damage {b.wmsScore.damagePrevention}</div>
                <div>Movement {b.wmsScore.movementPrevention}</div>
                <div>Dunnage {b.wmsScore.dunnageReduction}</div>
                <div>Repeatability {b.wmsScore.packRepeatability}</div>
              </div>
            </Card>
            <Card className="p-5" style={{ borderColor: C.teal + "50" }}>
              <div className="text-[9px] uppercase tracking-widest mb-2" style={{ fontFamily: MONO, color: C.teal }}>
                CartonIQ AI
              </div>
              <div style={{ fontFamily: SERIF, fontSize: 18, color: C.navy, fontWeight: 600 }}>
                {b.ai.name || b.ai.id}
              </div>
              <div className="text-[10px] mt-0.5 mb-3" style={{ fontFamily: MONO, color: C.slate }}>
                {b.ai.length}×{b.ai.width}×{b.ai.height}" · score {b.aiScore.total} · {b.layers} layer
                {b.layers !== 1 ? "s" : ""}
              </div>
              <div className="grid grid-cols-2 gap-2 text-[10px]" style={{ fontFamily: MONO, color: C.slate }}>
                <div>Damage {b.aiScore.damagePrevention}</div>
                <div>Movement {b.aiScore.movementPrevention}</div>
                <div>Dunnage {b.aiScore.dunnageReduction}</div>
                <div>Labor {b.aiScore.laborEfficiency}</div>
                <div>Flex compression {b.aiScore.flexiblePackageCompressionRisk ?? 0}</div>
                <div>Shape recovery {b.aiScore.shapeRecoveryMovementRisk ?? 0}</div>
              </div>
            </Card>
          </div>

          {aiCarton && b.placements.length > 0 && (
            <Card>
              <div className="px-5 py-3 border-b" style={{ borderColor: C.border, background: C.bgSoft }}>
                <span className="text-[10px] uppercase tracking-widest" style={{ fontFamily: MONO, color: C.slate }}>
                  3D Cubing — {b.ai.name || b.ai.id}
                </span>
                <span className="ml-3 text-[10px]" style={{ fontFamily: MONO, color: C.slate }}>
                  {b.layers} layers · {record.utilization}% util · {b.weightBalance}
                </span>
              </div>
              <CubingDiagram carton={aiCarton} placements={b.placements} />
            </Card>
          )}

          {b.flexReports.length > 0 && (
            <Card className="p-5">
              <div className="text-[9px] uppercase tracking-widest mb-3" style={{ fontFamily: MONO, color: C.slate }}>
                Flexible / soft package pack-out
              </div>
              <div className="space-y-2">
                {b.flexReports.map((fr) => (
                  <div key={`${fr.skuId}-${fr.unit}`} className="rounded border px-3 py-2 text-[10px]" style={{ borderColor: C.border }}>
                    <div className="font-semibold mb-1" style={{ color: C.navy }}>
                      {fr.skuId} · {fr.rigidityClass} · compression {fr.compressionRisk}
                    </div>
                    <div style={{ fontFamily: MONO, color: C.slate }}>
                      {fr.originalDimensions.length}×{fr.originalDimensions.width}×{fr.originalDimensions.height}" →{" "}
                      {fr.packedDimensions.length}×{fr.packedDimensions.width}×{fr.packedDimensions.height}" · retained{" "}
                      {fr.retainedVolumePercent}% · top load {fr.topLoadLb} lb
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <Card>
            <div className="px-5 py-3 border-b" style={{ borderColor: C.border, background: C.bgSoft }}>
              <span className="text-[10px] uppercase tracking-widest" style={{ fontFamily: MONO, color: C.slate }}>
                Order Contents
              </span>
            </div>
            <table className="w-full">
              <thead>
                <tr className="border-b" style={{ borderColor: C.border }}>
                  {["SKU", "Product", "Dims", "Wt", "Qty", "Rigidity"].map((h) => (
                    <th
                      key={h}
                      className="text-left px-4 py-2 text-[10px] uppercase tracking-wider"
                      style={{ fontFamily: MONO, color: C.slate }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.items.map((it) => (
                  <tr key={`${it.skuId}-${it.qty}`} className="border-b last:border-0" style={{ borderColor: C.border }}>
                    <td className="px-4 py-2.5 text-xs font-semibold" style={{ fontFamily: MONO, color: C.teal }}>
                      {it.skuId}
                    </td>
                    <td className="px-4 py-2.5 text-sm" style={{ color: C.navy }}>
                      {it.name}
                    </td>
                    <td className="px-4 py-2.5 text-xs" style={{ fontFamily: MONO, color: C.slate }}>
                      {it.length}×{it.width}×{it.height}
                    </td>
                    <td className="px-4 py-2.5 text-xs" style={{ fontFamily: MONO, color: C.slate }}>
                      {it.weight} lb
                    </td>
                    <td className="px-4 py-2.5 text-xs font-semibold" style={{ fontFamily: MONO, color: C.navy }}>
                      ×{it.qty}
                    </td>
                    <td className="px-4 py-2.5 text-xs" style={{ fontFamily: MONO, color: C.slate }}>
                      {it.rigidityClass ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {b.fitReasons.length > 0 && (
            <Card className="p-5">
              <div className="text-[9px] uppercase tracking-widest mb-2" style={{ fontFamily: MONO, color: C.slate }}>
                Fit notes
              </div>
              <ul className="space-y-1 text-[10px]" style={{ fontFamily: MONO, color: C.slate }}>
                {b.fitReasons.map((r, i) => (
                  <li key={i}>• {r}</li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function AnalyticsScreen({ history, onClear }: { history: AnalysisRecord[]; onClear: () => void }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = history.find((h) => h.id === selectedId) ?? null;

  if (selected) {
    return <AnalysisDetailView record={selected} onBack={() => setSelectedId(null)} />;
  }

  const n = history.length;
  const totalSavings = history.reduce((s, h) => s + h.savings, 0);
  const avgUtil = n ? Math.round(history.reduce((s, h) => s + h.utilization, 0) / n) : 0;
  const avgSustain = n ? Math.round(history.reduce((s, h) => s + h.sustainability, 0) / n) : 0;
  const avgDimDelta = n ? history.reduce((s, h) => s + h.dimWeightDelta, 0) / n : 0;
  const confirmRate = n ? Math.round((history.filter((h) => h.confirmedWms).length / n) * 100) : 0;
  const overrides = history.filter((h) => !h.confirmedWms).length;

  return (
    <div className="flex flex-col gap-5 max-w-4xl mx-auto w-full">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 style={{ fontFamily: SERIF, color: C.navy, fontSize: 24 }} className="font-semibold mb-1">Analytics</h2>
          <p className="text-sm" style={{ color: C.slate }}>
            Session KPIs from analyzed orders — click a row to open the full breakdown.
          </p>
        </div>
        {n > 0 && (
          <button onClick={onClear}
            className="text-xs px-3 py-1.5 rounded border shrink-0"
            style={{ fontFamily: MONO, borderColor: C.border, color: C.slate }}>
            Clear history
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {[
          { label: "Analyses", value: String(n), sub: "orders scored" },
          { label: "Carton Cost Saved", value: `$${totalSavings.toFixed(2)}`, sub: "vs WMS cartons" },
          { label: "Avg Utilization", value: `${avgUtil}%`, sub: "AI recommendations" },
          { label: "Avg Sustainability", value: `${avgSustain}/100`, sub: "dunnage efficiency" },
          { label: "Avg Dim-Wt Delta", value: `${avgDimDelta >= 0 ? "−" : "+"}${Math.abs(avgDimDelta).toFixed(1)} lb`, sub: `${overrides} AI overrides · ${confirmRate}% confirm` },
        ].map((k) => (
          <Card key={k.label} className="p-4">
            <div className="text-[9px] uppercase tracking-widest mb-1" style={{ fontFamily: MONO, color: C.slate }}>{k.label}</div>
            <div className="text-xl font-semibold" style={{ fontFamily: SERIF, color: C.navy }}>{k.value}</div>
            <div className="text-[10px] mt-0.5" style={{ fontFamily: MONO, color: C.slate }}>{k.sub}</div>
          </Card>
        ))}
      </div>

      {n === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center" style={{ borderColor: C.border }}>
          <BarChart3 size={28} className="mx-auto mb-2" style={{ color: C.bgMuted }} />
          <p className="text-sm" style={{ color: C.slate }}>Run an order analysis to populate analytics.</p>
        </div>
      ) : (
        <Card>
          <div className="px-5 py-3 border-b" style={{ borderColor: C.border, background: C.bgSoft }}>
            <span className="text-[10px] uppercase tracking-widest" style={{ fontFamily: MONO, color: C.slate }}>
              Recent Analyses
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b" style={{ borderColor: C.border }}>
                  {["When", "Order", "WMS", "AI", "Savings", "Util", "Score", ""].map((h) => (
                    <th key={h || "go"} className="text-left px-4 py-2 text-[10px] uppercase tracking-wider"
                      style={{ fontFamily: MONO, color: C.slate }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr
                    key={h.id}
                    onClick={() => setSelectedId(h.id)}
                    className="border-b last:border-0 cursor-pointer transition-colors"
                    style={{ borderColor: C.border }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = C.bgSoft; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                  >
                    <td className="px-4 py-2.5 text-xs" style={{ fontFamily: MONO, color: C.slate }}>
                      {new Date(h.at).toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5 text-xs" style={{ color: C.navy }}>
                      {h.unitCount} units · {h.skuCount} SKUs
                    </td>
                    <td className="px-4 py-2.5 text-xs" style={{ fontFamily: MONO, color: C.violet }}>{h.wmsCarton}</td>
                    <td className="px-4 py-2.5 text-xs" style={{ fontFamily: MONO, color: C.teal }}>{h.aiCarton}</td>
                    <td className="px-4 py-2.5 text-xs font-semibold" style={{ fontFamily: MONO, color: h.savings > 0 ? C.teal : C.slate }}>
                      ${h.savings.toFixed(2)}
                    </td>
                    <td className="px-4 py-2.5 text-xs" style={{ fontFamily: MONO, color: C.navy }}>{h.utilization}%</td>
                    <td className="px-4 py-2.5 text-xs font-semibold" style={{ fontFamily: MONO, color: C.navy }}>{h.score}</td>
                    <td className="px-4 py-2.5">
                      <ChevronRight size={14} style={{ color: C.teal }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

// ── Settings Screen ───────────────────────────────────────────────────────────
function SettingsScreen({ skuDb, setSkuDb }: {
  skuDb: SKU[]; setSkuDb: (s: SKU[]) => void;
}) {
  const [status, setStatus] = useState<{ type: "success" | "error"; msg: string } | null>(null);
  const [tab, setTab] = useState<"import" | "skus">("import");
  const [editSku, setEditSku] = useState<SKU | null>(null);
  const skuRef = useRef<HTMLInputElement>(null);

  const handleUpload = useCallback((
    e: React.ChangeEvent<HTMLInputElement>,
    parser: typeof parseWorkbookToSKUs,
    onSuccess: (rows: SKU[]) => void,
    emptyMsg: string,
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const wb = XLSX.read(new Uint8Array(ev.target?.result as ArrayBuffer), { type: "array" });
        const parsed = parser(wb);
        if (parsed.rows.length === 0) {
          const detail = parsed.issues.slice(0, 3).map((i) => `Row ${i.row}: ${i.message}`).join(" · ");
          setStatus({ type: "error", msg: detail || emptyMsg });
          return;
        }
        onSuccess(parsed.rows);
        const warn = parsed.issues.length ? ` (${parsed.issues.length} data-quality warning${parsed.issues.length !== 1 ? "s" : ""})` : "";
        setStatus({ type: "success", msg: `Imported ${parsed.rows.length} rows from "${file.name}".${warn}` });
      } catch {
        setStatus({ type: "error", msg: "Could not parse file. Please check the format and try again." });
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = "";
  }, []);

  const blankSku = (): SKU => ({
    id: "", name: "", category: "General", length: 0, width: 0, height: 0, weight: 0, fragility: "Low",
  });

  const saveSku = () => {
    if (!editSku) return;
    if (!editSku.id.trim() || !editSku.name.trim() || editSku.length <= 0) {
      setStatus({ type: "error", msg: "SKU requires ID, Name, and positive Length." });
      return;
    }
    const exists = skuDb.some((s) => s.id === editSku.id);
    setSkuDb(exists ? skuDb.map((s) => s.id === editSku.id ? editSku : s) : [...skuDb, editSku]);
    setEditSku(null);
    setStatus({ type: "success", msg: exists ? `Updated SKU ${editSku.id}.` : `Added SKU ${editSku.id}.` });
  };

  const tabs = [
    { id: "import" as const, label: "Import" },
    { id: "skus" as const, label: `SKUs (${skuDb.length})` },
  ];

  return (
    <div className="flex flex-col gap-6 max-w-4xl mx-auto w-full">
      <div>
        <h2 style={{ fontFamily: SERIF, color: C.navy, fontSize: 24 }} className="font-semibold mb-1">Admin / Settings</h2>
        <p className="text-sm" style={{ color: C.slate }}>Import Excel/CSV SKU data, or add and edit SKUs directly. Cartons load exclusively from the built-in Packsize database.</p>
      </div>

      {status && (
        <div className="rounded-lg border px-4 py-3 flex items-center justify-between"
          style={{ borderColor: status.type === "success" ? C.teal + "40" : "#cc220040",
            background: status.type === "success" ? C.teal + "08" : "#cc220008" }}>
          <div className="flex items-center gap-2 text-sm"
            style={{ color: status.type === "success" ? C.teal : "#cc2200" }}>
            {status.type === "success" ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
            {status.msg}
          </div>
          <button onClick={() => setStatus(null)} style={{ color: C.slate }}><X size={13} /></button>
        </div>
      )}

      <div className="flex gap-1 border-b" style={{ borderColor: C.border }}>
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className="px-4 py-2 text-xs transition-colors"
            style={{
              fontFamily: MONO,
              color: tab === t.id ? C.navy : C.slate,
              borderBottom: tab === t.id ? `2px solid ${C.teal}` : "2px solid transparent",
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "import" && (
        <>
          <Card>
            <input ref={skuRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
              onChange={(e) => handleUpload(e, parseWorkbookToSKUs, setSkuDb,
                "No valid SKU rows found. Check columns: SKU ID, Name, Length, Width, Height, Weight, Fragility.")} />
            <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: C.border, background: C.bgSoft }}>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full" style={{ background: C.teal }} />
                <span className="font-semibold text-sm" style={{ color: C.navy }}>SKU Database</span>
                <span className="text-[10px] px-2 py-0.5 rounded" style={{ fontFamily: MONO, background: C.teal + "15", color: C.teal }}>
                  {skuDb.length} loaded
                </span>
              </div>
            </div>
            <div className="p-5 flex flex-col gap-4">
              <div className="rounded-lg p-3" style={{ background: C.bgSoft }}>
                <div className="text-[10px] uppercase tracking-wider mb-1.5" style={{ fontFamily: MONO, color: C.slate }}>Required columns</div>
                <div className="text-xs" style={{ fontFamily: MONO, color: C.navy }}>SKU ID · Name · Description · Length · Width · Height · Weight · Fragility</div>
                <div className="text-[10px] mt-1.5" style={{ color: C.slate }}>
                  Default file: <span style={{ fontFamily: MONO }}>sku-database-sample.csv</span> in <span style={{ fontFamily: MONO }}>src/imports/</span>
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => skuRef.current?.click()}
                  className="flex items-center gap-2 px-4 py-2 rounded text-sm font-semibold transition-all"
                  style={{ background: C.teal, color: C.white }}>
                  <Upload size={13} />Upload Excel / CSV
                </button>
                <button onClick={() => { setSkuDb(DEFAULT_SKUS); setStatus({ type: "success", msg: "SKU database restored to default." }); }}
                  className="flex items-center gap-2 px-3 py-2 rounded text-sm border transition-all"
                  style={{ borderColor: C.border, color: C.slate }}>
                  <RefreshCw size={12} />Reset to Default
                </button>
              </div>
            </div>
          </Card>
          <div className="rounded-lg border border-dashed p-5" style={{ borderColor: C.border }}>
            <div className="text-xs leading-relaxed" style={{ color: C.slate }}>
              <span className="font-semibold" style={{ color: C.navy }}>Tip:</span> Column headers are matched flexibly —
              variations like "Dim Length", "OD Height", "Unit Weight", or "Part No" are all recognised automatically.
              Fragility accepts <span style={{ color: C.teal }}>Low</span>, <span style={{ color: C.purple }}>Medium</span>, or <span style={{ color: "#cc2200" }}>High</span>.
            </div>
          </div>
        </>
      )}

      {tab === "skus" && (
        <Card>
          <div className="px-5 py-3 border-b flex items-center justify-between" style={{ borderColor: C.border, background: C.bgSoft }}>
            <span className="text-[10px] uppercase tracking-widest" style={{ fontFamily: MONO, color: C.slate }}>SKU Database</span>
            <button onClick={() => setEditSku(blankSku())}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded font-semibold"
              style={{ background: C.teal, color: C.white }}>
              <Plus size={12} />Add SKU
            </button>
          </div>
          {editSku && (
            <div className="p-4 border-b grid grid-cols-2 sm:grid-cols-4 gap-3" style={{ borderColor: C.border, background: C.bgSoft }}>
              {([
                ["id", "SKU ID"], ["name", "Name"], ["category", "Category"],
                ["length", "Length"], ["width", "Width"], ["height", "Height"], ["weight", "Weight"],
              ] as const).map(([key, label]) => (
                <label key={key} className="text-[10px]" style={{ fontFamily: MONO, color: C.slate }}>
                  {label}
                  <input
                    value={String(editSku[key])}
                    onChange={(e) => setEditSku({
                      ...editSku,
                      [key]: key === "id" || key === "name" || key === "category"
                        ? e.target.value
                        : parseFloat(e.target.value) || 0,
                    })}
                    className="mt-1 w-full rounded px-2 py-1.5 text-sm"
                    style={{ border: `1px solid ${C.border}`, color: C.navy, background: C.bg }}
                  />
                </label>
              ))}
              <label className="text-[10px]" style={{ fontFamily: MONO, color: C.slate }}>
                Fragility
                <select value={editSku.fragility}
                  onChange={(e) => setEditSku({ ...editSku, fragility: e.target.value as FragilityLevel })}
                  className="mt-1 w-full rounded px-2 py-1.5 text-sm"
                  style={{ border: `1px solid ${C.border}`, color: C.navy, background: C.bg }}>
                  <option>Low</option><option>Medium</option><option>High</option>
                </select>
              </label>
              <div className="col-span-2 sm:col-span-4 flex gap-2">
                <button onClick={saveSku} className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold"
                  style={{ background: C.navy, color: C.white }}><Save size={12} />Save</button>
                <button onClick={() => setEditSku(null)} className="px-3 py-1.5 rounded text-xs border"
                  style={{ borderColor: C.border, color: C.slate }}>Cancel</button>
              </div>
            </div>
          )}
          <div className="overflow-x-auto max-h-96">
            <table className="w-full">
              <thead>
                <tr className="border-b" style={{ borderColor: C.border }}>
                  {["SKU", "Name", "Dims", "Wt", "Frag", ""].map((h) => (
                    <th key={h} className="text-left px-4 py-2 text-[10px] uppercase tracking-wider sticky top-0"
                      style={{ fontFamily: MONO, color: C.slate, background: C.bg }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {skuDb.map((s) => (
                  <tr key={s.id} className="border-b last:border-0" style={{ borderColor: C.border }}>
                    <td className="px-4 py-2 text-xs font-semibold" style={{ fontFamily: MONO, color: C.teal }}>{s.id}</td>
                    <td className="px-4 py-2 text-sm" style={{ color: C.navy }}>{s.name}</td>
                    <td className="px-4 py-2 text-xs" style={{ fontFamily: MONO, color: C.slate }}>{s.length}×{s.width}×{s.height}</td>
                    <td className="px-4 py-2 text-xs" style={{ fontFamily: MONO, color: C.slate }}>{s.weight}</td>
                    <td className="px-4 py-2 text-xs" style={{ fontFamily: MONO, color: C.slate }}>{s.fragility}</td>
                    <td className="px-4 py-2">
                      <div className="flex gap-2">
                        <button onClick={() => setEditSku({ ...s })} style={{ color: C.slate }}><Pencil size={12} /></button>
                        <button onClick={() => { setSkuDb(skuDb.filter((x) => x.id !== s.id)); setStatus({ type: "success", msg: `Removed ${s.id}.` }); }}
                          style={{ color: C.slate }}><Trash2 size={12} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

// ── App Shell ─────────────────────────────────────────────────────────────────
export default function App() {
  const [screen, setScreen]       = useState<Screen>("home");
  const [order,  setOrder]        = useState<OrderItem[] | null>(null);
  const [wmsCartonId, setWmsCartonId] = useState<string | null>(null);
  const [skuDb,  setSkuDb]        = useState<SKU[]>(DEFAULT_SKUS);
  const cartons                   = DEFAULT_CARTONS;
  const [history, setHistory]     = useState<AnalysisRecord[]>(() => loadHistory());
  const lastRecordedId = useRef<string | null>(null);

  const goOrder = () => { setOrder(null); setWmsCartonId(null); setScreen("order"); };
  const goHome  = () => { setOrder(null); setWmsCartonId(null); setScreen("home"); };

  const handleAnalyze = (items: OrderItem[], wmsId: string | null) => {
    setOrder(items);
    setWmsCartonId(wmsId);
    lastRecordedId.current = null;
    setScreen("recommendation");
  };

  const handleRecorded = (record: AnalysisRecord) => {
    if (lastRecordedId.current === record.id) return;
    lastRecordedId.current = record.id;
    setHistory((prev) => {
      const next = [record, ...prev].slice(0, 50);
      saveHistory(next);
      return next;
    });
  };

  const clearHistory = () => {
    setHistory([]);
    saveHistory([]);
  };

  const nav = [
    { id: "home" as Screen,      label: "Home" },
    { id: "order" as Screen,     label: "New Order" },
    { id: "executive" as Screen, label: "Executive Dashboard" },
    { id: "analytics" as Screen, label: "Analytics" },
    { id: "settings" as Screen,  label: "Admin" },
  ];

  return (
    <div className="min-h-screen flex flex-col" style={{ background: C.bgSoft, fontFamily: "'Inter', sans-serif" }}>

      {/* Topbar */}
      <header className="shrink-0 border-b" style={{ background: C.navy, borderColor: "rgba(255,255,255,0.08)" }}>
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">

          {/* Logo */}
          <button onClick={goHome} className="flex items-center gap-2.5">
            <AdvancingArrows className="h-6 w-auto" />
            <span style={{ fontFamily: SERIF, fontSize: 18, color: C.white, letterSpacing: "-0.01em" }}>CartonIQ</span>
          </button>

          {/* Nav */}
          <nav className="flex items-center gap-1">
            {nav.map(({ id, label }) => {
              const active = screen === id || (screen === "recommendation" && id === "order");
              return (
                <button key={id}
                  onClick={() => id === "order" ? goOrder() : setScreen(id)}
                  className="px-3 py-1.5 rounded text-sm transition-all"
                  style={{
                    fontFamily: MONO,
                    fontSize: 11,
                    background: active ? "rgba(0,238,255,0.12)" : "transparent",
                    color: active ? C.cyan : "rgba(255,255,255,0.5)",
                    borderLeft: active ? `2px solid ${C.cyan}` : "2px solid transparent",
                  }}>
                  {label}
                </button>
              );
            })}
            <button onClick={() => setScreen("settings")}
              className="ml-2 w-8 h-8 flex items-center justify-center rounded border transition-all"
              style={{ borderColor: "rgba(255,255,255,0.15)", color: screen === "settings" ? C.cyan : "rgba(255,255,255,0.4)" }}>
              <Settings size={14} />
            </button>
          </nav>
        </div>
      </header>

      {/* Breadcrumb (on non-home screens) */}
      {screen !== "home" && (
        <div className="border-b" style={{ background: C.white, borderColor: C.border }}>
          <div className="max-w-5xl mx-auto px-6 h-9 flex items-center gap-1.5">
            <button onClick={goHome} className="text-xs transition-colors"
              style={{ fontFamily: MONO, color: C.slate }}>Home</button>
            <ChevronRight size={10} style={{ color: C.slate }} />
            <span className="text-xs" style={{ fontFamily: MONO, color: C.navy }}>
              {screen === "order" ? "Order Builder"
                : screen === "recommendation" ? "Recommendation"
                : screen === "executive" ? "Executive Dashboard"
                : screen === "analytics" ? "Analytics"
                : "Admin / Settings"}
            </span>
          </div>
        </div>
      )}

      {/* Main */}
      <main className="flex-1 overflow-y-auto">
        <div className={`${screen === "executive" ? "max-w-6xl" : "max-w-5xl"} mx-auto px-6 py-8`}>
          {screen === "home"           && <HomeScreen onNewOrder={goOrder} />}
          {screen === "order"          && <OrderScreen skuDb={skuDb} cartons={cartons} onAnalyze={handleAnalyze} />}
          {screen === "recommendation" && order && (
            <RecommendationScreen items={order} cartons={cartons} wmsCartonId={wmsCartonId} onBack={goOrder} onRecorded={handleRecorded} />
          )}
          {screen === "executive"      && (
            <ExecutiveDashboard history={history} catalogCartonCount={cartons.length} />
          )}
          {screen === "analytics"      && <AnalyticsScreen history={history} onClear={clearHistory} />}
          {screen === "settings"       && (
            <SettingsScreen skuDb={skuDb} setSkuDb={setSkuDb} />
          )}
        </div>
      </main>
    </div>
  );
}

