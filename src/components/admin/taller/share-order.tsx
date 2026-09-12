"use client"

import { useState } from "react"
import { Link2, MessageCircle, Share2, FileText } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export function ShareRepairOrder({ folio, phone, className, quote }: {
  folio: string
  phone?: string
  className?: string
  quote?: { equipment: string; token?: string; lines: { label: string; amount: number }[]; total: number }
}) {
  const [open, setOpen] = useState(false)

  const trackingUrl = () => `${window.location.origin}/seguimiento?folio=${encodeURIComponent(folio)}`

  const message = () =>
    `Hola, tu equipo ya está registrado con folio ${folio}. Rastrea su estado en ${window.location.origin}/seguimiento con tu folio y los últimos 4 dígitos de tu teléfono.`

  const mxn = (n: number) => n.toLocaleString("es-MX", { style: "currency", currency: "MXN" })

  const quoteMessage = () => {
    if (!quote) return ""
    const lines = quote.lines.map(l => `• ${l.label}: ${mxn(l.amount)}`).join("\n")
    const link = quote.token ? `\n\nRevisa y autoriza aquí: ${window.location.origin}/cotizacion/${quote.token}` : ""
    return `Cotización de reparación — ${folio}\nEquipo: ${quote.equipment}\n\n${lines}\n\nTotal estimado: ${mxn(quote.total)}\nVálida por 15 días. Si aparecen daños adicionales te avisamos antes de proceder.${link}`
  }

  function shareWhatsApp(text: string) {
    const digits = (phone ?? "").replace(/\D/g, "")
    // wa.me exige formato internacional; los locales de 10 dígitos se asumen MX (+52).
    const intl = digits.length === 10 ? `52${digits}` : digits
    const base = intl ? `https://wa.me/${intl}` : "https://wa.me/"
    window.open(`${base}?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer")
    setOpen(false)
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(trackingUrl())
      toast.success("Enlace copiado")
    } catch {
      toast.error("No se pudo copiar el enlace")
    }
    setOpen(false)
  }

  async function copyQuoteLink() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/cotizacion/${quote?.token}`)
      toast.success("Link de cotización copiado")
    } catch {
      toast.error("No se pudo copiar el enlace")
    }
    setOpen(false)
  }

  const itemClass = "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground"

  return (
    <div className={cn("relative inline-block", className)}>
      <Button
        type="button"
        variant="outline"
        onClick={() => setOpen(value => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Share2 className="h-4 w-4" />
        Compartir
      </Button>
      {open && (
        <>
          <button
            type="button"
            aria-label="Cerrar menú"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div role="menu" className="absolute right-0 z-50 mt-2 w-44 rounded-lg border bg-popover p-1 shadow-md">
            <button type="button" role="menuitem" className={itemClass} onClick={() => shareWhatsApp(message())}>
              <MessageCircle className="h-4 w-4" />
              WhatsApp
            </button>
            {quote && (
              <button type="button" role="menuitem" className={itemClass} onClick={() => shareWhatsApp(quoteMessage())}>
                <FileText className="h-4 w-4" />
                Enviar cotización
              </button>
            )}
            <button type="button" role="menuitem" className={itemClass} onClick={() => void copyLink()}>
              <Link2 className="h-4 w-4" />
              Copiar enlace
            </button>
            {quote?.token && (
              <button type="button" role="menuitem" className={itemClass} onClick={() => void copyQuoteLink()}>
                <FileText className="h-4 w-4" />
                Link cotización
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
