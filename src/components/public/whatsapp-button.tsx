import type { ComponentProps, ReactNode } from "react"
import { MessageCircle } from "lucide-react"
import { Button } from "@/components/ui/button"

/**
 * Construye la URL de wa.me. wa.me exige solo dígitos con código de país;
 * si vienen 10 dígitos (formato local MX) se asume +52.
 * Devuelve null si no hay dígitos utilizables.
 */
export function waMeHref(phone: string | undefined | null, text?: string): string | null {
  let digits = (phone ?? "").replace(/\D/g, "")
  if (!digits) return null
  if (digits.length === 10) digits = `52${digits}`
  const base = `https://wa.me/${digits}`
  return text ? `${base}?text=${encodeURIComponent(text)}` : base
}

interface WhatsAppButtonProps extends Pick<ComponentProps<typeof Button>, "variant" | "size" | "className"> {
  phone?: string | null
  message?: string
  children: ReactNode
}

/**
 * Botón de contacto por WhatsApp. Si el teléfono no es usable no renderiza
 * nada: el llamador decide el fallback (p. ej. ancla a la sección de contacto).
 */
export function WhatsAppButton({ phone, message, children, variant = "default", size, className }: WhatsAppButtonProps) {
  const href = waMeHref(phone, message)
  if (!href) return null
  return (
    <Button variant={variant} size={size} className={className} asChild>
      <a href={href} target="_blank" rel="noopener noreferrer">
        <MessageCircle className="h-4 w-4" />
        {children}
      </a>
    </Button>
  )
}
