"use client"

import { useState } from "react"
import { Handshake, Loader2 } from "lucide-react"
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import type { MarketplaceProduct } from "./product-card"

interface MarketplaceRequestDialogProps {
  product: MarketplaceProduct | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
  formatPrice: (price: number) => string
}

export function MarketplaceRequestDialog({
  product,
  open,
  onOpenChange,
  onSuccess,
  formatPrice,
}: MarketplaceRequestDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Handshake className="h-5 w-5 text-primary" />
            Solicitar pieza
          </DialogTitle>
          <DialogDescription>
            Registra la solicitud de un taller aliado. El proveedor la revisará
            para aprobarla.
          </DialogDescription>
        </DialogHeader>

        {/* El formulario se monta solo al abrir: sus campos arrancan limpios. */}
        {open && product && (
          <RequestForm
            product={product}
            onClose={() => onOpenChange(false)}
            onSuccess={onSuccess}
            formatPrice={formatPrice}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

interface RequestFormProps {
  product: MarketplaceProduct
  onClose: () => void
  onSuccess?: () => void
  formatPrice: (price: number) => string
}

function RequestForm({ product, onClose, onSuccess, formatPrice }: RequestFormProps) {
  const [qty, setQty] = useState(1)
  const [tallerName, setTallerName] = useState("")
  const [contactName, setContactName] = useState("")
  const [contactPhone, setContactPhone] = useState("")
  const [note, setNote] = useState("")
  const [sending, setSending] = useState(false)

  const total = product.wholesalePrice * Math.max(1, qty)
  const canSubmit = tallerName.trim().length >= 2 && qty >= 1 && !sending

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    setSending(true)
    try {
      const res = await fetch("/api/marketplace/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: product.id,
          qty,
          tallerName: tallerName.trim(),
          contactName: contactName.trim() || undefined,
          contactPhone: contactPhone.trim() || undefined,
          note: note.trim() || undefined,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "No se pudo enviar la solicitud")
      toast.success("Solicitud enviada al proveedor")
      onClose()
      onSuccess?.()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo enviar la solicitud")
    } finally {
      setSending(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4 pt-1">
      {/* Producto */}
      <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5">
        <p className="font-medium leading-snug">{product.name}</p>
        <p className="text-sm text-muted-foreground">
          Precio taller:{" "}
          <span className="font-semibold text-primary">
            {formatPrice(product.wholesalePrice)}
          </span>
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="mreq-qty">Cantidad</Label>
          <Input
            id="mreq-qty"
            type="number"
            min={1}
            step={1}
            value={qty}
            onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label>Total estimado</Label>
          <div className="flex h-9 items-center rounded-md border bg-muted/50 px-3 text-sm font-semibold">
            {formatPrice(total)}
          </div>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="mreq-taller">Nombre del taller *</Label>
        <Input
          id="mreq-taller"
          value={tallerName}
          onChange={(e) => setTallerName(e.target.value)}
          placeholder="Ej. Taller Rodríguez"
          maxLength={120}
          required
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="mreq-contact">Contacto</Label>
          <Input
            id="mreq-contact"
            value={contactName}
            onChange={(e) => setContactName(e.target.value)}
            placeholder="Nombre de quien pide"
            maxLength={120}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="mreq-phone">Teléfono</Label>
          <Input
            id="mreq-phone"
            type="tel"
            value={contactPhone}
            onChange={(e) => setContactPhone(e.target.value)}
            placeholder="Ej. 55 1234 5678"
            maxLength={30}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="mreq-note">Nota</Label>
        <Textarea
          id="mreq-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Urgencia, referencia de la unidad, etc."
          maxLength={500}
          rows={3}
        />
      </div>

      <DialogFooter className="gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={onClose}
          disabled={sending}
        >
          Cancelar
        </Button>
        <Button type="submit" disabled={!canSubmit}>
          {sending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Handshake className="mr-2 h-4 w-4" />
          )}
          Enviar solicitud
        </Button>
      </DialogFooter>
    </form>
  )
}
