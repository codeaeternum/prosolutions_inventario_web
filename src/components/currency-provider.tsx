"use client"

import { createContext, useContext, ReactNode } from "react"

interface CurrencyContextType {
  formatPrice: (priceInMXN: number) => string
}

const CurrencyContext = createContext<CurrencyContextType | undefined>(undefined)

/** Precios siempre en MXN. Sin toggle de moneda. */
export function CurrencyProvider({ children }: { children: ReactNode }) {
  const formatPrice = (priceInMXN: number): string =>
    new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency: "MXN",
    }).format(priceInMXN)

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
