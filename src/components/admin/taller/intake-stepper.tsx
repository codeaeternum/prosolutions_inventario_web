import { Check } from "lucide-react"

// Los pasos ya completados son clicables: regresar a corregir un dato no
// debería costar tres clics en "Anterior". Los futuros siguen bloqueados —
// la validación corre al avanzar con "Siguiente".
export function IntakeStepper({ steps, current, onSelect }: { steps: string[]; current: number; onSelect?: (index: number) => void }) {
  return (
    <nav aria-label="Progreso de la recepción">
      <ol className="flex items-start">
        {steps.map((label, index) => {
          const done = index < current
          const active = index === current
          const clickable = done && Boolean(onSelect)
          return (
            <li key={label} className="flex flex-1 flex-col items-center gap-2 text-center">
              <button
                type="button"
                disabled={!clickable}
                onClick={() => clickable && onSelect?.(index)}
                aria-current={active ? "step" : undefined}
                aria-label={clickable ? `Volver al paso ${index + 1}: ${label}` : `Paso ${index + 1}: ${label}`}
                className={`flex h-9 w-9 items-center justify-center rounded-full border text-sm font-semibold transition ${done ? "border-primary bg-primary/15 text-primary" : active ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground"} ${clickable ? "cursor-pointer hover:bg-primary/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" : "cursor-default"}`}
              >
                {done ? <Check size={16} /> : index + 1}
              </button>
              <span className={`text-xs font-medium sm:text-sm ${active ? "text-foreground" : "text-muted-foreground"}`}>{label}</span>
            </li>
          )
        })}
      </ol>
      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={current + 1} aria-valuemin={1} aria-valuemax={steps.length} aria-label={`Paso ${current + 1} de ${steps.length}`}>
        <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${((current + 1) / steps.length) * 100}%` }} />
      </div>
    </nav>
  )
}
