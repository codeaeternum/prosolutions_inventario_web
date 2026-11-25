"use client"

import { useCurrency } from "@/components/currency-provider"
import { cn } from "@/lib/utils"

interface PriceDisplayProps {
  price: number
  className?: string
}

export function PriceDisplay({ price, className }: PriceDisplayProps) {
  const { formatPrice } = useCurrency()
  return <span className={cn("", className)}>{formatPrice(price)}</span>
}

// Para usar en server components, pasar el formatPrice como prop
interface PriceDisplayServerProps {
  price: number
  className?: string
}

// Una instancia por módulo: Intl.NumberFormat es caro de construir y el
// formato nunca cambia (MXN fijo).
const mxnFormatter = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
})

export function PriceDisplayStatic({ price, className }: PriceDisplayServerProps) {
  // Esta versión siempre muestra en MXN (para server components)
  return <span className={className}>{mxnFormatter.format(price)}</span>
}
