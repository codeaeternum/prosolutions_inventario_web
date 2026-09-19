import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react"
import { Eraser } from "lucide-react"

const DOT_COUNT = 9
const dotPosition = (index: number) => ({
  left: `${(index % 3) * (100 / 3) + 100 / 6}%`,
  top: `${Math.floor(index / 3) * (100 / 3) + 100 / 6}%`,
})

export function PatternPad({ value, onChange, disabled = false }: { value: number[]; onChange: (points: number[]) => void; disabled?: boolean }) {
  const drawing = useRef(false)
  // El patrón del gesto en curso vive en un ref: value llega por prop y puede
  // quedar stale dentro del mismo gesto (arrastre o taps seguidos), y hacer
  // onChange([...value, i]) desde el prop perdía puntos intermedios.
  const draft = useRef<number[]>([])

  useEffect(() => {
    const stop = () => { drawing.current = false }
    window.addEventListener("pointerup", stop)
    window.addEventListener("pointercancel", stop)
    return () => {
      window.removeEventListener("pointerup", stop)
      window.removeEventListener("pointercancel", stop)
    }
  }, [])

  const addPoint = (index: number) => {
    if (!disabled && Number.isInteger(index) && index >= 0 && index < DOT_COUNT && !draft.current.includes(index)) {
      draft.current.push(index)
      onChange([...draft.current])
    }
  }

  const beginStroke = (event: ReactPointerEvent<HTMLElement>) => {
    drawing.current = true
    draft.current = [...value]
    trackPointer(event)
  }

  const trackPointer = (event: ReactPointerEvent<HTMLElement>) => {
    if (!drawing.current) return
    const dot = document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-pattern-dot]")
    if (dot) addPoint(Number(dot.getAttribute("data-pattern-dot")))
  }

  return (
    <div>
      <div
        role="group"
        aria-label="Dibuja el patrón de desbloqueo"
        className="relative mx-auto aspect-square w-full max-w-[240px] touch-none select-none"
        onPointerDown={beginStroke}
        onPointerMove={trackPointer}
        onPointerUp={() => { drawing.current = false }}
      >
        <svg className="pointer-events-none absolute inset-0 h-full w-full text-primary" aria-hidden="true">
          {value.slice(1).map((point, index) => {
            const from = dotPosition(value[index])
            const to = dotPosition(point)
            return <line key={index} x1={from.left} y1={from.top} x2={to.left} y2={to.top} stroke="currentColor" strokeWidth={3} strokeLinecap="round" opacity={0.6} />
          })}
        </svg>
        {Array.from({ length: DOT_COUNT }, (_, index) => {
          const order = value.indexOf(index)
          const selected = order >= 0
          return (
            <button
              key={index}
              type="button"
              data-pattern-dot={index}
              disabled={disabled}
              aria-pressed={selected}
              aria-label={`Punto ${index + 1}${selected ? `, posición ${order + 1} del patrón` : ""}`}
              onPointerDown={event => { event.preventDefault(); drawing.current = true; draft.current = [...value]; addPoint(index) }}
              className={`absolute flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border text-sm font-semibold transition ${selected ? "border-primary bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:border-primary/60"} disabled:opacity-50`}
              style={dotPosition(index)}
            >
              {selected ? order + 1 : ""}
            </button>
          )
        })}
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {value.length ? `Se guardará como: ${value.map(i => i + 1).join("-")}` : "Toca o arrastra por los puntos en el orden del patrón."}
        </p>
        <button type="button" onClick={() => onChange([])} disabled={disabled || value.length === 0} className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-muted-foreground transition hover:text-foreground disabled:opacity-50">
          <Eraser size={13} />Limpiar
        </button>
      </div>
    </div>
  )
}
