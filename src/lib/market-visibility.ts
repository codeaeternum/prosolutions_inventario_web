import { z } from "zod"

/**
 * Niveles de visibilidad de mercado (Product.marketVisibility):
 *
 * - HIDDEN: nadie fuera del staff ve el producto en el mercado.
 * - ALLIES: solo talleres aliados con cuenta (WORKSHOP aprobado) y staff.
 * - PUBLIC: además el público general (vitrina /<slug>/market y directorio
 *   global /mercado). Es un nivel estrictamente mayor que ALLIES.
 *
 * Regla de oro: el público anónimo NUNCA ve productos ALLIES — esa fuga
 * existía cuando la flag era booleana (marketplaceVisible) y se cierra aquí.
 */
export const MARKET_VISIBILITY_LEVELS = ["HIDDEN", "ALLIES", "PUBLIC"] as const

export type MarketVisibility = (typeof MARKET_VISIBILITY_LEVELS)[number]

/** Etiqueta legible para UI y auditoría. */
export const MARKET_VISIBILITY_LABELS: Record<MarketVisibility, string> = {
  HIDDEN: "Oculto",
  ALLIES: "Solo aliados",
  PUBLIC: "Público",
}

/** Descripción corta de cada nivel (tooltips / ayuda en el panel). */
export const MARKET_VISIBILITY_HINTS: Record<MarketVisibility, string> = {
  HIDDEN: "No sale en el mercado: ni aliados ni público lo ven.",
  ALLIES: "Lo ven los talleres aliados con cuenta, a precio de mayoreo.",
  PUBLIC: "Lo ve todo el público en tu vitrina y en el directorio, a precio de menudeo.",
}

export const marketVisibilitySchema = z.enum(MARKET_VISIBILITY_LEVELS)

/**
 * Productos que un taller aliado (WORKSHOP) puede ver y ordenar: niveles
 * ALLIES y PUBLIC. El público anónimo usa el filtro estricto "PUBLIC".
 */
export const ALLY_CATALOG_LEVELS: readonly MarketVisibility[] = ["ALLIES", "PUBLIC"]

/** Compat con el booleano viejo: visible→ALLIES (lo que talleres veían), oculto→HIDDEN. */
export function levelFromLegacyBoolean(visible: boolean): MarketVisibility {
  return visible ? "ALLIES" : "HIDDEN"
}

export function isMarketVisibility(value: unknown): value is MarketVisibility {
  return (
    typeof value === "string" &&
    (MARKET_VISIBILITY_LEVELS as readonly string[]).includes(value)
  )
}
