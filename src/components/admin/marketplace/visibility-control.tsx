"use client"

import { EyeOff, Globe, Loader2, Users } from "lucide-react"
import {
  MARKET_VISIBILITY_HINTS,
  MARKET_VISIBILITY_LABELS,
  MARKET_VISIBILITY_LEVELS,
  type MarketVisibility,
} from "@/lib/market-visibility"
import { cn } from "@/lib/utils"

const LEVEL_ICONS = {
  HIDDEN: EyeOff,
  ALLIES: Users,
  PUBLIC: Globe,
} as const

interface MarketVisibilityControlProps {
  value: MarketVisibility
  onChange: (level: MarketVisibility) => void
  /** Deshabilita el control mientras la mutación de ESTE producto corre. */
  busy?: boolean
  disabled?: boolean
}

/**
 * Control segmentado de 3 niveles para Product.marketVisibility:
 * Oculto / Solo aliados / Público. El cambio es optimista en el padre —
 * aquí solo se dispara onChange y se muestra el estado actual.
 */
export function MarketVisibilityControl({
  value,
  onChange,
  busy = false,
  disabled = false,
}: MarketVisibilityControlProps) {
  return (
    <div
      role="group"
      aria-label="Visibilidad en el mercado"
      className="inline-flex items-center rounded-lg border bg-muted/50 p-0.5"
    >
      {MARKET_VISIBILITY_LEVELS.map((level) => {
        const Icon = LEVEL_ICONS[level]
        const selected = value === level
        return (
          <button
            key={level}
            type="button"
            aria-pressed={selected}
            title={MARKET_VISIBILITY_HINTS[level]}
            disabled={disabled || busy}
            onClick={() => {
              if (!selected) onChange(level)
            }}
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors whitespace-nowrap",
              selected
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
              (disabled || busy) && "opacity-60 cursor-not-allowed"
            )}
          >
            {busy && selected ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Icon className="h-3 w-3" />
            )}
            {MARKET_VISIBILITY_LABELS[level]}
          </button>
        )
      })}
    </div>
  )
}
