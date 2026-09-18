"use client"

import { Banknote, PackageCheck, Stethoscope, Undo2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  approvedPartsTotal,
  orderBalanceCents as balanceOf,
  orderHeldCents,
  orderTotalCents,
  type OrderMoneyLike,
  type PartLike,
  type PaymentLike,
} from "@/lib/workshop-money"
import { SignaturePad } from "@/components/admin/taller/signature-pad"

export type WorkshopPayment = {
  id: string; amount: number; method: string; purpose: string | null
  status?: string | null; notes: string | null; createdAt: string; createdBy: { name: string }
}
export type PaymentForm = { amount: string; method: string; note: string }
// Entrega estructurada: nombre de quien recoge (obligatorio, puede no ser el
// titular), identificación opcional y firma de quien recibe (PNG data URL).
export type SettleForm = { method: string; deliveredTo: string; deliveredToDoc: string; deliverySignatureData: string | null }
export type RefundForm = { amount: string; method: string; note: string }
export const emptyPaymentForm: PaymentForm = { amount: "", method: "", note: "" }
export const emptySettleForm: SettleForm = { method: "", deliveredTo: "", deliveredToDoc: "", deliverySignatureData: null }
export const emptyRefundForm: RefundForm = { amount: "", method: "", note: "" }

const inputClass = "w-full rounded-lg border bg-background px-3 py-2 text-sm"
const money = (value: number) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(value / 100)
const date = (value: string) => new Date(value).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" })
const methodLabels: Record<string, string> = { CASH: "Efectivo", CARD: "Tarjeta", TRANSFER: "Transferencia" }
const purposeLabels: Record<string, string> = { ADVANCE: "Anticipo", ABONO: "Abono", SETTLEMENT: "Liquidación", REFUND: "Reembolso" }
const purposeStyles: Record<string, string> = {
  ADVANCE: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  ABONO: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  SETTLEMENT: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  REFUND: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
}
// Estados donde la orden se entrega sin reparación: solo se cobra el cargo
// de diagnóstico/revisión, no la cotización ni las refacciones.
const NO_REPAIR_STATUSES: readonly string[] = ["NOT_AUTHORIZED", "NOT_REPAIRED"]

export const paidCents = (payments: PaymentLike[] | undefined) => orderHeldCents(payments ?? [])
/** Saldo de la orden (total — mano de obra + refacciones autorizadas, o el
 *  cargo de diagnóstico — menos lo retenido). Fuente única: workshop-money. */
export const orderBalanceCents = (order: OrderMoneyLike & { payments?: PaymentLike[]; parts?: PartLike[] }) =>
  balanceOf(order, order.parts ?? [], order.payments ?? [])

export function PaymentsPanel(props: {
  status: string; quoteCents: number | null; approvedQuoteCents: number | null; diagnosticFeeCents: number | null
  /** Persistido al entregar sin reparación: tras DELIVERED el total sigue siendo solo el cargo de diagnóstico. */
  closedWithoutRepair?: boolean | null
  parts?: PartLike[]; payments: WorkshopPayment[] | undefined
  canCharge: boolean; canDeliver: boolean; canRefund: boolean; disabled: boolean
  paymentForm: PaymentForm; onPaymentChange: (form: PaymentForm) => void; onPaymentSubmit: (event: React.FormEvent<HTMLFormElement>) => void
  settleOpen: boolean; onSettleOpenChange: (open: boolean) => void
  settleForm: SettleForm; onSettleChange: (form: SettleForm) => void; onSettleSubmit: (event: React.FormEvent<HTMLFormElement>) => void
  feeDraft: string; onFeeChange: (value: string) => void; onFeeSubmit: (event: React.FormEvent<HTMLFormElement>) => void
  refundForm: RefundForm; onRefundChange: (form: RefundForm) => void; onRefundSubmit: (event: React.FormEvent<HTMLFormElement>) => void
}) {
  const payments = props.payments ?? []
  const parts = props.parts ?? []
  // El cargo de diagnóstico es editable solo antes de entregar (status aún
  // NOT_AUTHORIZED/NOT_REPAIRED); tras la entrega manda closedWithoutRepair.
  const feeEditable = NO_REPAIR_STATUSES.includes(props.status)
  const withoutRepair = feeEditable || props.closedWithoutRepair === true
  const order = { status: props.status, quoteCents: props.quoteCents, approvedQuoteCents: props.approvedQuoteCents, diagnosticFeeCents: props.diagnosticFeeCents, closedWithoutRepair: props.closedWithoutRepair }
  const total = orderTotalCents(order, parts)
  const partsCents = approvedPartsTotal(parts).priceCents
  const paid = orderHeldCents(payments)
  const balance = Math.max(0, total - paid)
  const overpaid = Math.max(0, paid - total)
  const uncosted = !withoutRepair && props.approvedQuoteCents === null && props.quoteCents === null && partsCents === 0
  return <section className="space-y-4 rounded-xl border bg-card p-5">
    <div className="flex justify-between"><h2 className="font-semibold">Presupuesto y pagos</h2><span className="text-sm text-muted-foreground">{payments.length} {payments.length === 1 ? "cobro" : "cobros"}</span></div>
    <dl className={`grid gap-3 text-sm ${overpaid > 0 ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3"}`}>
      <div><dt className="text-xs text-muted-foreground">{withoutRepair ? "Cargo diagnóstico" : "Total"}</dt><dd className="text-lg font-semibold">{uncosted ? "Sin cotizar" : money(total)}</dd></div>
      <div><dt className="text-xs text-muted-foreground">Abonado</dt><dd className="text-lg font-semibold">{money(paid)}</dd></div>
      <div><dt className="text-xs text-muted-foreground">Saldo</dt><dd className={`text-lg font-semibold ${balance > 0 ? "text-rose-600 dark:text-rose-400" : ""}`}>{money(balance)}</dd></div>
      {overpaid > 0 && <div><dt className="text-xs text-muted-foreground">A devolver</dt><dd className="text-lg font-semibold text-amber-600 dark:text-amber-400">{money(overpaid)}</dd></div>}
    </dl>
    {!withoutRepair && partsCents > 0 && <p className="text-xs text-muted-foreground">Mano de obra {money(props.approvedQuoteCents ?? props.quoteCents ?? 0)} + refacciones autorizadas {money(partsCents)}.</p>}
    {overpaid > 0 && <p className="rounded-lg border border-amber-300/70 bg-amber-50/60 px-3 py-2 text-xs font-medium text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">El cliente pagó de más: {money(overpaid)} pendiente de devolver.{props.canRefund ? " Registra el reembolso abajo." : " La devolución la registra un administrador."}</p>}
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
    {feeEditable && <form onSubmit={props.onFeeSubmit} className="space-y-3 rounded-lg border border-dashed p-3">
      <p className="flex items-center gap-1.5 text-xs font-medium"><Stethoscope size={14} />Cargo por diagnóstico/revisión</p>
      <p className="text-xs text-muted-foreground">La cotización no se cobra: al entregar solo aplica este cargo (0 para entregar gratis).</p>
      <fieldset disabled={props.disabled} className="flex flex-wrap items-end gap-3">
        <label className="text-xs">Cargo MXN<Input type="number" min={0} step="0.01" required value={props.feeDraft} onChange={e => props.onFeeChange(e.target.value)} placeholder="0.00" className="mt-1" /></label>
        <Button size="sm" disabled={props.disabled || props.feeDraft === ""}>{props.disabled ? "Guardando…" : "Guardar cargo"}</Button>
      </fieldset>
    </form>}
    {props.canCharge && <form onSubmit={props.onPaymentSubmit} className="space-y-3 rounded-lg border border-dashed p-3">
      <p className="flex items-center gap-1.5 text-xs font-medium"><Banknote size={14} />Registrar abono</p>
      <fieldset disabled={props.disabled} className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs">Monto MXN<Input type="number" min={0} step="0.01" required value={props.paymentForm.amount} onChange={e => props.onPaymentChange({ ...props.paymentForm, amount: e.target.value })} placeholder="0.00" className="mt-1" /></label>
        <label className="text-xs">Método de cobro<select required value={props.paymentForm.method} onChange={e => props.onPaymentChange({ ...props.paymentForm, method: e.target.value })} className={`${inputClass} mt-1`}><option value="">Selecciona</option><option value="CASH">Efectivo</option><option value="CARD">Tarjeta</option><option value="TRANSFER">Transferencia</option></select></label>
        <label className="text-xs sm:col-span-2">Nota (opcional)<Input maxLength={500} value={props.paymentForm.note} onChange={e => props.onPaymentChange({ ...props.paymentForm, note: e.target.value })} placeholder="Referencia o comprobante…" className="mt-1" /></label>
      </fieldset>
      <Button size="sm" disabled={props.disabled || !props.paymentForm.amount || !props.paymentForm.method}>{props.disabled ? "Guardando…" : "Registrar abono"}</Button>
    </form>}
    {overpaid > 0 && props.canRefund && <form onSubmit={props.onRefundSubmit} className="space-y-3 rounded-lg border border-dashed border-rose-300/70 p-3 dark:border-rose-800">
      <p className="flex items-center gap-1.5 text-xs font-medium"><Undo2 size={14} />Devolver excedente al cliente</p>
      <fieldset disabled={props.disabled} className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs">Monto MXN<Input type="number" min={0} max={overpaid / 100} step="0.01" required value={props.refundForm.amount} onChange={e => props.onRefundChange({ ...props.refundForm, amount: e.target.value })} placeholder="0.00" className="mt-1" /></label>
        <label className="text-xs">Método de devolución<select required value={props.refundForm.method} onChange={e => props.onRefundChange({ ...props.refundForm, method: e.target.value })} className={`${inputClass} mt-1`}><option value="">Selecciona</option><option value="CASH">Efectivo</option><option value="CARD">Tarjeta</option><option value="TRANSFER">Transferencia</option></select></label>
        <label className="text-xs sm:col-span-2">Nota (opcional)<Input maxLength={500} value={props.refundForm.note} onChange={e => props.onRefundChange({ ...props.refundForm, note: e.target.value })} placeholder="Motivo de la devolución…" className="mt-1" /></label>
      </fieldset>
      <Button size="sm" variant="outline" disabled={props.disabled || !props.refundForm.amount || !props.refundForm.method}>{props.disabled ? "Guardando…" : `Devolver ${props.refundForm.amount ? money(Math.round(Number(props.refundForm.amount) * 100)) : ""}`}</Button>
    </form>}
    {props.canDeliver && (props.settleOpen
      ? <form onSubmit={props.onSettleSubmit} className="space-y-3 rounded-lg border border-emerald-300/70 bg-emerald-50/60 p-3 dark:border-emerald-800 dark:bg-emerald-950/30">
        <p className="text-sm font-medium">{balance > 0 ? <>Saldo a cobrar: <strong>{money(balance)}</strong></> : "Sin saldo pendiente — la entrega queda liquidada."}{overpaid > 0 && <> El cliente tiene <strong>{money(overpaid)}</strong> a favor — regístralo como reembolso.</>}</p>
        <fieldset disabled={props.disabled} className="space-y-3">
          {balance > 0 && <label className="block text-xs">Método de cobro del saldo<select required value={props.settleForm.method} onChange={e => props.onSettleChange({ ...props.settleForm, method: e.target.value })} className={`${inputClass} mt-1`}><option value="">Selecciona el método</option><option value="CASH">Efectivo</option><option value="CARD">Tarjeta</option><option value="TRANSFER">Transferencia</option></select></label>}
          <label className="block text-xs">Nombre de quien recoge<Input required minLength={2} maxLength={80} value={props.settleForm.deliveredTo} onChange={e => props.onSettleChange({ ...props.settleForm, deliveredTo: e.target.value })} placeholder="Puede ser un familiar o empleado del titular" className="mt-1" /></label>
          <label className="block text-xs">Identificación (INE/licencia, opcional)<Input maxLength={40} value={props.settleForm.deliveredToDoc} onChange={e => props.onSettleChange({ ...props.settleForm, deliveredToDoc: e.target.value })} placeholder="Número o folio de la identificación" className="mt-1" /></label>
          <SignaturePad label="Firma de quien recibe" hint="La firma queda como constancia de entrega del equipo." onChange={dataUrl => props.onSettleChange({ ...props.settleForm, deliverySignatureData: dataUrl })} />
        </fieldset>
        <div className="flex gap-2">
          <Button size="sm" disabled={props.disabled || props.settleForm.deliveredTo.trim().length < 2 || (balance > 0 && !props.settleForm.method)}>{props.disabled ? "Guardando…" : "Confirmar entrega"}</Button>
          <Button size="sm" variant="outline" type="button" disabled={props.disabled} onClick={() => props.onSettleOpenChange(false)}>Cancelar</Button>
        </div>
      </form>
      : <Button type="button" className="w-full" disabled={props.disabled} onClick={() => props.onSettleOpenChange(true)}><PackageCheck className="mr-2 h-4 w-4" />Entregar y cobrar{balance > 0 ? ` · ${money(balance)}` : ""}</Button>)}
  </section>
}
