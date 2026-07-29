import type { Carton, Placement } from "./types";

const ITEM_COLORS = [
  "#00becc",
  "#8800cc",
  "#003c71",
  "#bb33ff",
  "#00eeff",
  "#61737b",
  "#cc2200",
  "#0d9488",
];

const KRAFT = "#c4a06a";
const KRAFT_DARK = "#a67c4a";
const KRAFT_LIGHT = "#d4b896";

function KraftFill({
  id,
  x,
  y,
  width,
  height,
}: {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}) {
  return (
    <g>
      <defs>
        <pattern id={id} width="10" height="8" patternUnits="userSpaceOnUse">
          <rect width="10" height="8" fill={KRAFT} />
          <path
            d="M0 2 Q2.5 0 5 2 T10 2 M0 6 Q2.5 4 5 6 T10 6"
            fill="none"
            stroke={KRAFT_DARK}
            strokeWidth="0.7"
            strokeOpacity="0.45"
          />
          <path
            d="M1 0 Q3 3 1 8 M6 0 Q8 4 6 8"
            fill="none"
            stroke={KRAFT_LIGHT}
            strokeWidth="0.6"
            strokeOpacity="0.55"
          />
        </pattern>
      </defs>
      <rect x={x} y={y} width={width} height={height} fill={`url(#${id})`} />
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill="none"
        stroke={KRAFT_DARK}
        strokeWidth={1.5}
        strokeOpacity={0.5}
      />
    </g>
  );
}

export function CubingDiagram({
  carton,
  placements,
}: {
  carton: Carton;
  placements: Placement[];
}) {
  const CL = carton.length;
  const CW = carton.width;
  const CH = carton.height;

  const colorBySku = new Map<string, string>();
  let colorIdx = 0;
  for (const p of placements) {
    if (!colorBySku.has(p.sku.id)) {
      colorBySku.set(p.sku.id, ITEM_COLORS[colorIdx % ITEM_COLORS.length]);
      colorIdx++;
    }
  }

  const pad = 14;
  const topScale = Math.min(280 / CL, 200 / CW);
  const topW = CL * topScale + pad * 2;
  const topH = CW * topScale + pad * 2;

  const frontScale = Math.min(280 / CL, 180 / CH);
  const frontW = CL * frontScale + pad * 2;
  const frontH = CH * frontScale + pad * 2;

  return (
    <div className="px-5 py-4 border-b space-y-3" style={{ borderColor: "rgba(0,60,113,0.12)" }}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Top view */}
        <div>
          <div
            className="text-[9px] uppercase tracking-widest mb-2"
            style={{ fontFamily: "JetBrains Mono, monospace", color: "#61737b" }}
          >
            Top view (X–Y)
          </div>
          <svg
            viewBox={`0 0 ${topW} ${topH}`}
            className="w-full h-52 rounded-lg"
            style={{ background: "#f4f6f8" }}
            role="img"
            aria-label="Top-down carton packing with kraft paper dunnage"
          >
            <KraftFill id="kraft-top" x={pad} y={pad} width={CL * topScale} height={CW * topScale} />
            <rect
              x={pad}
              y={pad}
              width={CL * topScale}
              height={CW * topScale}
              fill="none"
              stroke="#003c71"
              strokeWidth={1.5}
              strokeOpacity={0.45}
            />
            {[...placements]
              .sort((a, b) => a.z - b.z)
              .map((p, i) => (
                <g key={`top-${p.sku.id}-${p.unit}-${i}`}>
                  <rect
                    x={pad + p.x * topScale}
                    y={pad + p.y * topScale}
                    width={Math.max(1, p.iL * topScale)}
                    height={Math.max(1, p.iW * topScale)}
                    fill={colorBySku.get(p.sku.id)}
                    fillOpacity={0.72}
                    stroke="#003c71"
                    strokeWidth={1}
                    strokeOpacity={0.35}
                  />
                  <text
                    x={pad + (p.x + p.iL / 2) * topScale}
                    y={pad + (p.y + p.iW / 2) * topScale}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize={9}
                    fill="#003c71"
                    fontFamily="JetBrains Mono, monospace"
                    fontWeight={600}
                  >
                    {p.posture === "vertical" ? "V" : p.posture === "horizontal" ? "H" : "S"}
                  </text>
                </g>
              ))}
          </svg>
        </div>

        {/* Front view */}
        <div>
          <div
            className="text-[9px] uppercase tracking-widest mb-2"
            style={{ fontFamily: "JetBrains Mono, monospace", color: "#61737b" }}
          >
            Front view (X–Z)
          </div>
          <svg
            viewBox={`0 0 ${frontW} ${frontH}`}
            className="w-full h-52 rounded-lg"
            style={{ background: "#f4f6f8" }}
            role="img"
            aria-label="Front elevation carton packing with kraft paper dunnage"
          >
            <KraftFill id="kraft-front" x={pad} y={pad} width={CL * frontScale} height={CH * frontScale} />
            <rect
              x={pad}
              y={pad}
              width={CL * frontScale}
              height={CH * frontScale}
              fill="none"
              stroke="#003c71"
              strokeWidth={1.5}
              strokeOpacity={0.45}
            />
            {[...placements]
              .sort((a, b) => a.y - b.y)
              .map((p, i) => (
                <g key={`front-${p.sku.id}-${p.unit}-${i}`}>
                  <rect
                    x={pad + p.x * frontScale}
                    y={pad + (CH - p.z - p.iH) * frontScale}
                    width={Math.max(1, p.iL * frontScale)}
                    height={Math.max(1, p.iH * frontScale)}
                    fill={colorBySku.get(p.sku.id)}
                    fillOpacity={0.78}
                    stroke="#003c71"
                    strokeWidth={1}
                    strokeOpacity={0.35}
                  />
                  <text
                    x={pad + (p.x + p.iL / 2) * frontScale}
                    y={pad + (CH - p.z - p.iH / 2) * frontScale}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize={9}
                    fill="#003c71"
                    fontFamily="JetBrains Mono, monospace"
                    fontWeight={600}
                  >
                    {p.posture === "vertical" ? "V" : p.posture === "horizontal" ? "H" : "S"}
                  </text>
                </g>
              ))}
          </svg>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[10px]">
        <div className="flex items-center gap-1.5">
          <span
            className="w-3.5 h-3.5 rounded-sm shrink-0 border"
            style={{
              background: `repeating-linear-gradient(135deg, ${KRAFT}, ${KRAFT} 3px, ${KRAFT_DARK} 3px, ${KRAFT_DARK} 4px)`,
              borderColor: KRAFT_DARK,
            }}
          />
          <span style={{ fontFamily: "JetBrains Mono, monospace", color: "#61737b" }}>
            Brown kraft paper dunnage (void fill)
          </span>
        </div>
        {[...colorBySku.entries()].map(([id, color]) => {
          const sample = placements.find((p) => p.sku.id === id)!;
          return (
            <div key={id} className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: color }} />
              <span style={{ color: "#003c71" }}>{sample.sku.name}</span>
            </div>
          );
        })}
        <span className="ml-auto" style={{ fontFamily: "JetBrains Mono, monospace", color: "#61737b" }}>
          H = horizontal · V = vertical · S = on-side · carton {CL}×{CW}×{CH}"
        </span>
      </div>
    </div>
  );
}
