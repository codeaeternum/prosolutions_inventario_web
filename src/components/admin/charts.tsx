"use client"

// Gráficas SVG ligeras para el panel de reportes — sin dependencias.
// Responsivas vía viewBox (className="w-full"), tooltips nativos con <title>
// y role="img" + aria-label para accesibilidad.

import { useId } from "react"

export type ChartDatum = {
  label: string
  value: number
  /** Texto extra solo para el tooltip (p. ej. importe formateado). */
  hint?: string
  color?: string
}

export type ChartFormat = (value: number) => string

const defaultFormat: ChartFormat = (v) => v.toLocaleString("es-MX")

const PALETTE = [
  "#2563eb", "#16a34a", "#f59e0b", "#dc2626", "#7c3aed",
  "#0891b2", "#db2777", "#65a30d", "#ea580c", "#4f46e5",
  "#0d9488", "#9333ea", "#64748b",
]

/** Color estable por posición para series categóricas (donas, rankings). */
export const chartColor = (i: number) => PALETTE[i % PALETTE.length]

const truncate = (s: string, n: number) =>
  s.length > n ? `${s.slice(0, Math.max(1, n - 1))}…` : s

const tooltip = (d: ChartDatum, format: ChartFormat) =>
  `${d.label}: ${format(d.value)}${d.hint ? ` · ${d.hint}` : ""}`

function EmptyChart() {
  return (
    <p className="py-8 text-center text-sm text-muted-foreground">
      Sin datos para graficar
    </p>
  )
}

/** Barras verticales con etiqueta de valor. */
export function BarChart({
  data,
  format = defaultFormat,
  color = "#2563eb",
}: {
  data: ChartDatum[]
  format?: ChartFormat
  color?: string
}) {
  if (data.length === 0) return <EmptyChart />
  const W = Math.max(300, data.length * 44)
  const H = 190
  const PAD = { top: 16, right: 8, bottom: 20, left: 8 }
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom
  const base = PAD.top + innerH
  const max = Math.max(1, ...data.map((d) => d.value))
  const step = innerW / data.length
  const bw = Math.min(step * 0.7, 34)
  const labelEvery = Math.ceil(data.length / 8)
  const showValues = step >= 30

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Gráfica de barras">
      <line x1={PAD.left} x2={W - PAD.right} y1={base} y2={base} stroke="currentColor" strokeOpacity={0.2} />
      {data.map((d, i) => {
        const h = (d.value / max) * innerH
        const bx = PAD.left + i * step + (step - bw) / 2
        return (
          <g key={i}>
            <title>{tooltip(d, format)}</title>
            <rect x={bx} y={base - h} width={bw} height={Math.max(h, d.value > 0 ? 2 : 0)} rx={2} fill={d.color ?? color} />
            {showValues && d.value > 0 && (
              <text x={bx + bw / 2} y={base - h - 4} textAnchor="middle" fontSize={9} fill="currentColor" fillOpacity={0.7}>
                {format(d.value)}
              </text>
            )}
            {i % labelEvery === 0 && (
              <text x={PAD.left + i * step + step / 2} y={H - 6} textAnchor="middle" fontSize={9} fill="currentColor" fillOpacity={0.6}>
                {truncate(d.label, 10)}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

/** Barras agrupadas (p. ej. ingresos vs egresos por día) con leyenda. */
export function GroupedBars({
  data,
  series,
  format = defaultFormat,
}: {
  data: Array<{ label: string; values: number[] }>
  series: Array<{ name: string; color: string }>
  format?: ChartFormat
}) {
  if (data.length === 0) return <EmptyChart />
  const W = Math.max(320, data.length * 30)
  const H = 200
  const PAD = { top: 16, right: 8, bottom: 20, left: 8 }
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom
  const base = PAD.top + innerH
  const max = Math.max(1, ...data.flatMap((d) => d.values))
  const step = innerW / data.length
  const bw = Math.min((step * 0.8) / series.length, 16)
  const labelEvery = Math.ceil(data.length / 10)

  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-3">
        {series.map((s) => (
          <span key={s.name} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
            {s.name}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Gráfica de barras agrupadas">
        <line x1={PAD.left} x2={W - PAD.right} y1={base} y2={base} stroke="currentColor" strokeOpacity={0.2} />
        {data.map((d, gi) => (
          <g key={gi}>
            {d.values.map((v, si) => {
              const h = (v / max) * innerH
              const bx = PAD.left + gi * step + (step - bw * series.length) / 2 + si * bw
              return (
                <rect key={si} x={bx} y={base - h} width={bw} height={Math.max(h, v > 0 ? 2 : 0)} rx={1.5} fill={series[si]?.color ?? chartColor(si)}>
                  <title>{`${d.label} · ${series[si]?.name ?? si}: ${format(v)}`}</title>
                </rect>
              )
            })}
            {gi % labelEvery === 0 && (
              <text x={PAD.left + gi * step + step / 2} y={H - 6} textAnchor="middle" fontSize={9} fill="currentColor" fillOpacity={0.6}>
                {truncate(d.label, 8)}
              </text>
            )}
          </g>
        ))}
      </svg>
    </div>
  )
}

/** Barras horizontales para rankings con etiquetas largas. */
export function HorizontalBars({
  data,
  format = defaultFormat,
  color = "#2563eb",
}: {
  data: ChartDatum[]
  format?: ChartFormat
  color?: string
}) {
  if (data.length === 0) return <EmptyChart />
  const rowH = 26
  const labelW = 140
  const W = 560
  const PAD = { top: 4, right: 60, bottom: 4, left: labelW }
  const H = PAD.top + PAD.bottom + data.length * rowH
  const innerW = W - PAD.left - PAD.right
  const max = Math.max(1, ...data.map((d) => d.value))

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Gráfica de barras horizontales">
      {data.map((d, i) => {
        const y = PAD.top + i * rowH
        const bw = Math.max((d.value / max) * innerW, d.value > 0 ? 2 : 0)
        return (
          <g key={i}>
            <title>{tooltip(d, format)}</title>
            <text x={PAD.left - 8} y={y + rowH / 2} textAnchor="end" dominantBaseline="central" fontSize={10} fill="currentColor">
              {truncate(d.label, 22)}
            </text>
            <rect x={PAD.left} y={y + 5} width={bw} height={rowH - 10} rx={2} fill={d.color ?? color} />
            <text x={PAD.left + bw + 5} y={y + rowH / 2} dominantBaseline="central" fontSize={10} fill="currentColor" fillOpacity={0.75}>
              {format(d.value)}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

// Catmull-Rom → Bézier cúbica para una curva suave que pasa por los puntos.
function smoothPath(pts: ReadonlyArray<{ x: number; y: number }>): string {
  if (pts.length === 0) return ""
  let d = `M ${pts[0].x} ${pts[0].y}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[Math.min(pts.length - 1, i + 2)]
    const c1x = p1.x + (p2.x - p0.x) / 6
    const c1y = p1.y + (p2.y - p0.y) / 6
    const c2x = p2.x - (p3.x - p1.x) / 6
    const c2y = p2.y - (p3.y - p1.y) / 6
    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`
  }
  return d
}

/** Línea suave con relleno de área y puntos en cada dato. */
export function LineChart({
  data,
  format = defaultFormat,
  color = "#2563eb",
}: {
  data: ChartDatum[]
  format?: ChartFormat
  color?: string
}) {
  const gid = useId()
  if (data.length === 0) return <EmptyChart />
  const W = 640
  const H = 190
  const PAD = { top: 14, right: 12, bottom: 20, left: 12 }
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom
  const base = PAD.top + innerH
  const max = Math.max(1, ...data.map((d) => d.value))
  const pts = data.map((d, i) => ({
    x: PAD.left + (data.length === 1 ? innerW / 2 : (i * innerW) / (data.length - 1)),
    y: base - (d.value / max) * innerH,
  }))
  const line = smoothPath(pts)
  const area = `${line} L ${pts[pts.length - 1].x} ${base} L ${pts[0].x} ${base} Z`
  const labelEvery = Math.ceil(data.length / 8)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Gráfica de línea">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.3} />
          <stop offset="100%" stopColor={color} stopOpacity={0.02} />
        </linearGradient>
      </defs>
      <line x1={PAD.left} x2={W - PAD.right} y1={base} y2={base} stroke="currentColor" strokeOpacity={0.2} />
      <path d={area} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {data.map((d, i) => (
        <g key={i}>
          <circle cx={pts[i].x} cy={pts[i].y} r={2.5} fill={color}>
            <title>{tooltip(d, format)}</title>
          </circle>
          {i % labelEvery === 0 && (
            <text x={pts[i].x} y={H - 6} textAnchor="middle" fontSize={9} fill="currentColor" fillOpacity={0.6}>
              {truncate(d.label, 8)}
            </text>
          )}
        </g>
      ))}
    </svg>
  )
}

/** Dona de participación del total con leyenda lateral. */
export function DonutChart({
  data,
  format = defaultFormat,
}: {
  data: Array<{ label: string; value: number; color?: string }>
  format?: ChartFormat
}) {
  const total = data.reduce((s, d) => s + d.value, 0)
  if (data.length === 0 || total <= 0) return <EmptyChart />
  const r = 54
  const C = 2 * Math.PI * r
  const c = 75

  // Segmentos precomputados: fracción del total y punto de inicio del arco.
  const segments: Array<{ frac: number; start: number }> = []
  let acc = 0
  for (const d of data) {
    const frac = d.value / total
    segments.push({ frac, start: acc })
    acc += frac
  }

  return (
    <div className="flex flex-wrap items-center gap-4">
      <svg viewBox="0 0 150 150" className="h-36 w-36 shrink-0" role="img" aria-label="Gráfica de dona">
        <circle cx={c} cy={c} r={r} fill="none" stroke="currentColor" strokeOpacity={0.08} strokeWidth={20} />
        {data.map((d, i) => (
          <circle
            key={i}
            cx={c}
            cy={c}
            r={r}
            fill="none"
            stroke={d.color ?? chartColor(i)}
            strokeWidth={20}
            strokeDasharray={`${segments[i].frac * C} ${C - segments[i].frac * C}`}
            strokeDashoffset={-segments[i].start * C}
            transform={`rotate(-90 ${c} ${c})`}
          >
            <title>{`${d.label}: ${format(d.value)} (${Math.round(segments[i].frac * 100)}%)`}</title>
          </circle>
        ))}
        <text x={c} y={c} textAnchor="middle" dominantBaseline="central" fontSize={16} fontWeight={600} fill="currentColor">
          {format(total)}
        </text>
      </svg>
      <ul className="min-w-[140px] flex-1 space-y-1 text-xs">
        {data.map((d, i) => (
          <li key={i} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: d.color ?? chartColor(i) }} />
            <span className="truncate">{d.label}</span>
            <span className="ml-auto text-muted-foreground">{format(d.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
