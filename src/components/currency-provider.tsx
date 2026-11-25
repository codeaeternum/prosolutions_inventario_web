"use client"

import { createContext, useContext, ReactNode } from "react"

interface CurrencyContextType {
  formatPrice: (priceInMXN: number) => string
}

const CurrencyContext = createContext<CurrencyContextType | undefined>(undefined)

// Una instancia por módulo: Intl.NumberFormat es caro de construir y el
// formato nunca cambia (MXN fijo).
const mxnFormatter = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
})

/** Precios siempre en MXN. Sin toggle de moneda. */
export function CurrencyProvider({ children }: { children: ReactNode }) {
  const formatPrice = (priceInMXN: number): string =>
    mxnFormatter.format(priceInMXN)

  return (
    <CurrencyContext.Provider value={{ formatPrice }}>
      {children}
    </CurrencyContext.Provider>
  )
}

export function useCurrency() {
  const context = useContext(CurrencyContext)
  if (context === undefined) {
    throw new Error("useCurrency must be used within a CurrencyProvider")
  }
  return context
}
