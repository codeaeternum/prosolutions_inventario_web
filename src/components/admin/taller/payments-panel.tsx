"use client"

import { Banknote, PackageCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export type WorkshopPayment = {
  id: string; amount: number; method: string; purpose: string | null
  notes: string | null; createdAt: string; createdBy: { name: string }
}
export type PaymentForm = { amount: string; method: string; note: string }
export type SettleForm = { method: string; receivedBy: string }
export const emptyPaymentForm: PaymentForm = { amount: "", method: "", note: "" }
export const emptySettleForm: SettleForm = { method: "", receivedBy: "" }

const inputClass = "w-full rounded-lg border bg-background px-3 py-2 text-sm"
const money = (value: number) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(value / 100)
const date = (value: string) => new Date(value).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" })
const methodLabels: Record<string, string> = { CASH: "Efectivo", CARD: "Tarjeta", TRANSFER: "Transferencia" }
const purposeLabels: Record<string, string> = { ADVANCE: "Anticipo", ABONO: "Abono", SETTLEMENT: "Liquidación" }
const purposeStyles: Record<string, string> = {
  ADVANCE: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  ABONO: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  SETTLEMENT: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
}
export const paidCents = (payments: { amount: number }[] | undefined) => (payments ?? []).reduce((sum, payment) => sum + Math.round(payment.amount * 100), 0)
export const orderBalanceCents = (order: { quoteCents: number | null; approvedQuoteCents: number | null; payments?: { amount: number }[] }) =>
  Math.max(0, (order.approvedQuoteCents ?? order.quoteCents ?? 0) - paidCents(order.payments))

export function PaymentsPanel(props: {
  quoteCents: number | null; approvedQuoteCents: number | null; payments: WorkshopPayment[] | undefined
  canCharge: boolean; canDeliver: boolean; disabled: boolean
  paymentForm: PaymentForm; onPaymentChange: (form: PaymentForm) => void; onPaymentSubmit: (event: React.FormEvent<HTMLFormElement>) => void
  settleOpen: boolean; onSettleOpenChange: (open: boolean) => void
  settleForm: SettleForm; onSettleChange: (form: SettleForm) => void; onSettleSubmit: (event: React.FormEvent<HTMLFormElement>) => void
}) {
  const payments = props.payments ?? []
  const quoted = props.approvedQuoteCents ?? props.quoteCents
  const total = quoted ?? 0
  const paid = paidCents(payments)
  const balance = Math.max(0, total - paid)
  return <section className="space-y-4 rounded-xl border bg-card p-5">
    <div className="flex justify-between"><h2 className="font-semibold">Presupuesto y pagos</h2><span className="text-sm text-muted-foreground">{payments.length} {payments.length === 1 ? "cobro" : "cobros"}</span></div>
    <dl className="grid grid-cols-3 gap-3 text-sm">
      <div><dt className="text-xs text-muted-foreground">Total</dt><dd className="text-lg font-semibold">{quoted === null ? "Sin cotizar" : money(total)}</dd></div>
      <div><dt className="text-xs text-muted-foreground">Abonado</dt><dd className="text-lg font-semibold">{money(paid)}</dd></div>
      <div><dt className="text-xs text-muted-foreground">Saldo</dt><dd className={`text-lg font-semibold ${balance > 0 ? "text-rose-600 dark:text-rose-400" : ""}`}>{money(balance)}</dd></div>
    </dl>
    {payments.length === 0 ? <p className="text-sm text-muted-foreground">Sin cobros registrados.</p>
      : <ul className="space-y-2">{payments.map(payment => <li key={payment.id} className="rounded-lg border p-3 text-sm">
        <p className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${purposeStyles[payment.purpose ?? ""] ?? "bg-muted text-muted-foreground"}`}>{purposeLabels[payment.purpose ?? ""] ?? "Pago"}</span>
          <span className="font-medium">{money(Math.round(payment.amount * 100))}</span>
          <span className="text-xs text-muted-foreground">{methodLabels[payment.method] ?? payment.method}</span>
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{payment.createdBy.name} · {date(payment.createdAt)}</p>
        {payment.notes && <p className="mt-1 text-xs">{payment.notes}</p>}
      </li>)}</ul>}
    {props.canCharge && <form onSubmit={props.onPaymentSubmit} className="space-y-3 rounded-lg border border-dashed p-3">
      <p className="flex items-center gap-1.5 text-xs font-medium"><Banknote size={14} />Registrar abono</p>
      <fieldset disabled={props.disabled} className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs">Monto MXN<Input type="number" min={0} step="0.01" required value={props.paymentForm.amount} onChange={e => props.onPaymentChange({ ...props.paymentForm, amount: e.target.value })} placeholder="0.00" className="mt-1" /></label>
        <label className="text-xs">Método de cobro<select required value={props.paymentForm.method} onChange={e => props.onPaymentChange({ ...props.paymentForm, method: e.target.value })} className={`${inputClass} mt-1`}><option value="">Selecciona</option><option value="CASH">Efectivo</option><option value="CARD">Tarjeta</option><option value="TRANSFER">Transferencia</option></select></label>
        <label className="text-xs sm:col-span-2">Nota (opcional)<Input maxLength={500} value={props.paymentForm.note} onChange={e => props.onPaymentChange({ ...props.paymentForm, note: e.target.value })} placeholder="Referencia o comprobante…" className="mt-1" /></label>
      </fieldset>
      <Button size="sm" disabled={props.disabled || !props.paymentForm.amount || !props.paymentForm.method}>{props.disabled ? "Guardando…" : "Registrar abono"}</Button>
    </form>}
    {props.canDeliver && (props.settleOpen
      ? <form onSubmit={props.onSettleSubmit} className="space-y-3 rounded-lg border border-emerald-300/70 bg-emerald-50/60 p-3 dark:border-emerald-800 dark:bg-emerald-950/30">
        <p className="text-sm font-medium">{balance > 0 ? <>Saldo a cobrar: <strong>{money(balance)}</strong></> : "Sin saldo pendiente — la entrega queda liquidada."}</p>
        <fieldset disabled={props.disabled} className="space-y-3">
          {balance > 0 && <label className="block text-xs">Método de cobro del saldo<select required value={props.settleForm.method} onChange={e => props.onSettleChange({ ...props.settleForm, method: e.target.value })} className={`${inputClass} mt-1`}><option value="">Selecciona el método</option><option value="CASH">Efectivo</option><option value="CARD">Tarjeta</option><option value="TRANSFER">Transferencia</option></select></label>}
          <label className="block text-xs">¿A quién se entrega el equipo?<Input required maxLength={200} value={props.settleForm.receivedBy} onChange={e => props.onSettleChange({ ...props.settleForm, receivedBy: e.target.value })} placeholder="Nombre de quien recibe" className="mt-1" /></label>
        </fieldset>
        <div className="flex gap-2">
          <Button size="sm" disabled={props.disabled || !props.settleForm.receivedBy.trim() || (balance > 0 && !props.settleForm.method)}>{props.disabled ? "Guardando…" : "Confirmar entrega"}</Button>
          <Button size="sm" variant="outline" type="button" disabled={props.disabled} onClick={() => props.onSettleOpenChange(false)}>Cancelar</Button>
        </div>
      </form>
      : <Button type="button" className="w-full" disabled={props.disabled} onClick={() => props.onSettleOpenChange(true)}><PackageCheck className="mr-2 h-4 w-4" />Entregar y liquidar{balance > 0 ? ` · ${money(balance)}` : ""}</Button>)}
  </section>
}
