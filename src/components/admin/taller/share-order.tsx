"use client"

import { useState } from "react"
import { Link2, MessageCircle, Share2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export function ShareRepairOrder({ folio, phone, className }: { folio: string; phone?: string; className?: string }) {
  const [open, setOpen] = useState(false)

  const trackingUrl = () => `${window.location.origin}/seguimiento?folio=${encodeURIComponent(folio)}`

  const message = () =>
    `Hola, tu equipo ya está registrado con folio ${folio}. Rastrea su estado en ${window.location.origin}/seguimiento con tu folio y los últimos 4 dígitos de tu teléfono.`

  function shareWhatsApp() {
    const digits = (phone ?? "").replace(/\D/g, "")
    const base = digits ? `https://wa.me/${digits}` : "https://wa.me/"
    window.open(`${base}?text=${encodeURIComponent(message())}`, "_blank", "noopener,noreferrer")
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
            <button type="button" role="menuitem" className={itemClass} onClick={shareWhatsApp}>
              <MessageCircle className="h-4 w-4" />
              WhatsApp
            </button>
            <button type="button" role="menuitem" className={itemClass} onClick={() => void copyLink()}>
              <Link2 className="h-4 w-4" />
              Copiar enlace
            </button>
          </div>
        </>
      )}
    </div>
  )
}
