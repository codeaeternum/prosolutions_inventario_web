"use client"

import { CalendarClock, CalendarCheck, MapPin } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export type PlanForm = { scheduledAt: string; promisedAt: string; location: string }

const date = (value: string) => new Date(value).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" })
export const toLocalInput = (iso: string | null) => {
  if (!iso) return ""
  const value = new Date(iso)
  if (Number.isNaN(value.getTime())) return ""
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`
}
// mínimo de los datetime-local en hora LOCAL (toISOString daría UTC y el
// navegador compara literal: quedaría desfasado por la zona horaria).
const nowLocalInput = () => toLocalInput(new Date().toISOString())

export function WorkPlan(props: {
  scheduledAt: string | null; promisedAt?: string | null; location: string | null; editable: boolean; disabled: boolean
  form: PlanForm; onChange: (form: PlanForm) => void; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void
}) {
  const minDateTime = nowLocalInput()
  const changed =
    props.form.scheduledAt !== toLocalInput(props.scheduledAt) ||
    props.form.promisedAt !== toLocalInput(props.promisedAt ?? null) ||
    props.form.location !== (props.location ?? "")
  // Sección breve (3 campos): no se envuelve en colapsable, queda siempre
  // abierta — el acordeón solo aportaría un clic extra.
  return <section className="space-y-3 rounded-xl border bg-card p-4">
    <h2 className="text-sm font-semibold">Plan de trabajo</h2>
    {props.editable
      ? <form onSubmit={props.onSubmit} className="space-y-3">
        <fieldset disabled={props.disabled} className="grid gap-3 sm:grid-cols-3">
          <label className="text-xs">Entrega prometida<Input type="datetime-local" min={minDateTime} value={props.form.promisedAt} onChange={e => props.onChange({ ...props.form, promisedAt: e.target.value })} className="mt-1" /></label>
          <label className="text-xs">Reparación programada<Input type="datetime-local" min={minDateTime} value={props.form.scheduledAt} onChange={e => props.onChange({ ...props.form, scheduledAt: e.target.value })} className="mt-1" /></label>
          <label className="text-xs">Locación física<Input maxLength={80} value={props.form.location} onChange={e => props.onChange({ ...props.form, location: e.target.value })} placeholder="Mesa 2, Anaquel B…" className="mt-1" /></label>
        </fieldset>
        <Button size="sm" disabled={props.disabled || !changed}>{props.disabled ? "Guardando…" : "Guardar plan"}</Button>
      </form>
      : <dl className="grid gap-3 text-sm">
        <div><dt className="text-muted-foreground">Entrega prometida</dt><dd>{props.promisedAt ? <span className="flex items-center gap-1"><CalendarCheck size={14} />{date(props.promisedAt)}</span> : "Sin registrar"}</dd></div>
        <div><dt className="text-muted-foreground">Reparación programada</dt><dd>{props.scheduledAt ? <span className="flex items-center gap-1"><CalendarClock size={14} />{date(props.scheduledAt)}</span> : "Sin programar"}</dd></div>
        <div><dt className="text-muted-foreground">Locación física</dt><dd>{props.location ? <span className="flex items-center gap-1"><MapPin size={14} />{props.location}</span> : "Sin registrar"}</dd></div>
      </dl>}
  </section>
}
