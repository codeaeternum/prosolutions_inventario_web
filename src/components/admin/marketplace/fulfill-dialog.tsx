"use client"

import { useEffect, useState } from "react"
import { Loader2, PackageCheck } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import type { MarketplaceRequest } from "./requests-panel"

// Misma llave que branch-switcher: sucursal activa elegida en el header.
const BRANCH_KEY = "reficio-branch"

const PAYMENT_METHODS = [
  { value: "EFECTIVO", label: "Efectivo" },
  { value: "TARJETA", label: "Tarjeta" },
  { value: "TRANSFERENCIA", label: "Transferencia" },
  { value: "CREDITO", label: "Crédito (cuenta del taller)" },
] as const

type PaymentMethod = (typeof PAYMENT_METHODS)[number]["value"]

interface WorkshopAccount {
  id: string
  name: string
  email: string | null
}

function activeBranchId(): string | null {
  if (typeof window === "undefined") return null
  const cookie = document.cookie.match(new RegExp(`(?:^|; )${BRANCH_KEY}=([^;]*)`))
  return (cookie ? decodeURIComponent(cookie[1]) : null) ?? localStorage.getItem(BRANCH_KEY)
}

interface MarketplaceFulfillDialogProps {
  request: MarketplaceRequest | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onFulfilled?: (request: MarketplaceRequest, saleNumber: number) => void
  formatPrice: (price: number) => string
}

export function MarketplaceFulfillDialog({
  request,
  open,
  onOpenChange,
  onFulfilled,
  formatPrice,
}: MarketplaceFulfillDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PackageCheck className="h-5 w-5 text-violet-600" />
            Surtir solicitud
          </DialogTitle>
          <DialogDescription>
            Se generará la venta a precio de taller y se descontará el stock de la
            sucursal activa.
          </DialogDescription>
        </DialogHeader>

        {/* Se monta solo al abrir: el formulario arranca limpio cada vez. */}
        {open && request && (
          <FulfillForm
            request={request}
            onClose={() => onOpenChange(false)}
            onFulfilled={onFulfilled}
            formatPrice={formatPrice}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

interface FulfillFormProps {
  request: MarketplaceRequest
  onClose: () => void
  onFulfilled?: (request: MarketplaceRequest, saleNumber: number) => void
  formatPrice: (price: number) => string
}

function FulfillForm({ request, onClose, onFulfilled, formatPrice }: FulfillFormProps) {
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("EFECTIVO")
  // Si la pidió una cuenta WORKSHOP, esa es la cuenta del taller por defecto.
  const [customerId, setCustomerId] = useState(
    request.requestedBy?.role === "WORKSHOP" ? request.requestedBy.id : ""
  )
  const [note, setNote] = useState("")
  const [accounts, setAccounts] = useState<WorkshopAccount[]>([])
  const [sending, setSending] = useState(false)

  useEffect(() => {
    fetch("/api/users?role=WORKSHOP&status=APPROVED&limit=100")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setAccounts(Array.isArray(data?.users) ? data.users : []))
      .catch(() => setAccounts([]))
  }, [])

  const total = request.product.wholesalePrice * request.qty
  const needsAccount = paymentMethod === "CREDITO"
  const canSubmit = (!needsAccount || customerId !== "") && !sending

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    setSending(true)
    try {
      const branchId = activeBranchId()
      const res = await fetch(`/api/marketplace/requests/${request.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "FULFILL",
          paymentMethod,
          customerId: customerId || undefined,
          branchId: branchId || undefined,
          decisionNote: note.trim() || undefined,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "No se pudo surtir la solicitud")
      const folio = `V-${String(data.saleNumber).padStart(6, "0")}`
      toast.success(`Surtida — venta ${folio} generada`)
      onClose()
      onFulfilled?.(data.request, data.saleNumber)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo surtir la solicitud")
    } finally {
      setSending(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4 pt-1">
      {/* Resumen de la solicitud */}
      <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 px-3 py-2.5">
        <p className="font-medium leading-snug">{request.product.name}</p>
        <p className="text-sm text-muted-foreground">
          {request.qty} × {formatPrice(request.product.wholesalePrice)} ={" "}
          <span className="font-semibold text-foreground">{formatPrice(total)}</span>
          {" · "}
          {request.tallerName}
        </p>
      </div>

      <div className="space-y-1.5">
        <Label>Método de pago *</Label>
        <Select
          value={paymentMethod}
          onValueChange={(v) => setPaymentMethod(v as PaymentMethod)}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAYMENT_METHODS.map((m) => (
              <SelectItem key={m.value} value={m.value}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label>
          Cuenta de taller {needsAccount ? "*" : "(opcional)"}
        </Label>
        <Select value={customerId} onValueChange={setCustomerId}>
          <SelectTrigger>
            <SelectValue placeholder="Sin cuenta ligada" />
          </SelectTrigger>
          <SelectContent>
            {accounts.map((account) => (
              <SelectItem key={account.id} value={account.id}>
                {account.name}
                {account.email ? ` · ${account.email}` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {needsAccount && (
          <p className="text-[11px] text-muted-foreground">
            El crédito se cargará a la cuenta seleccionada.
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="mful-note">Nota (opcional)</Label>
        <Textarea
          id="mful-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Referencia de entrega, factura, etc."
          maxLength={500}
          rows={2}
        />
      </div>

      <DialogFooter className="gap-2">
        <Button type="button" variant="outline" onClick={onClose} disabled={sending}>
          Cancelar
        </Button>
        <Button type="submit" disabled={!canSubmit}>
          {sending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <PackageCheck className="mr-2 h-4 w-4" />
          )}
          Surtir y cobrar
        </Button>
      </DialogFooter>
    </form>
  )
}
