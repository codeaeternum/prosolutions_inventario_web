import { describe, expect, it } from "vitest"
import {
  isQuoteExpiredAt,
  parseQuoteValidityDays,
  quoteExpiryDate,
  QUOTE_VALIDITY_DAYS_DEFAULT,
} from "@/app/api/cotizacion/quote-config"
import { QUOTE_TTL_MS } from "@/lib/workshop-tokens"

const DAY_MS = 24 * 60 * 60 * 1000

describe("parseQuoteValidityDays", () => {
  it("cae al default con valores ausentes o inválidos", () => {
    for (const raw of [null, undefined, "", "abc", "0", "-3", "91", "2.5"]) {
      expect(parseQuoteValidityDays(raw)).toBe(QUOTE_VALIDITY_DAYS_DEFAULT)
    }
  })

  it("acepta enteros dentro de 1–90", () => {
    expect(parseQuoteValidityDays("1")).toBe(1)
    expect(parseQuoteValidityDays("15")).toBe(15)
    expect(parseQuoteValidityDays("90")).toBe(90)
  })
})

describe("quoteExpiryDate", () => {
  const issuedAt = new Date("2026-01-01T12:00:00Z")

  it("sin quoteExpiresAt guardado vence a N días de la emisión", () => {
    const expiry = quoteExpiryDate(null, issuedAt, 10)
    expect(expiry?.getTime()).toBe(issuedAt.getTime() + 10 * DAY_MS)
  })

  it("con el default de 15 días equivale exactamente al quoteExpiresAt guardado", () => {
    // El dominio guarda presentación + QUOTE_TTL_MS.
    const stored = new Date(issuedAt.getTime() + QUOTE_TTL_MS)
    const expiry = quoteExpiryDate(stored, issuedAt, QUOTE_VALIDITY_DAYS_DEFAULT)
    expect(expiry?.getTime()).toBe(stored.getTime())
  })

  it("una vigencia configurada distinta recorre la fecha guardada", () => {
    const stored = new Date(issuedAt.getTime() + QUOTE_TTL_MS)
    // 30 días configurados: expira 15 días después del guardado de 15.
    const expiry30 = quoteExpiryDate(stored, issuedAt, 30)
    expect(expiry30?.getTime()).toBe(stored.getTime() + 15 * DAY_MS)
    // 7 días: expira antes que el guardado.
    const expiry7 = quoteExpiryDate(stored, issuedAt, 7)
    expect(expiry7?.getTime()).toBe(stored.getTime() - 8 * DAY_MS)
  })

  it("sin fecha base devuelve null (sin vigencia que aplicar)", () => {
    expect(quoteExpiryDate(null, null, 15)).toBeNull()
  })
})

describe("isQuoteExpiredAt", () => {
  const now = Date.now()

  it("vencida cuando la vigencia efectiva ya pasó", () => {
    const stored = new Date(now - 60_000)
    expect(isQuoteExpiredAt(stored, null, 15, now)).toBe(true)
  })

  it("vigente cuando la vigencia efectiva no ha pasado", () => {
    const stored = new Date(now + QUOTE_TTL_MS)
    expect(isQuoteExpiredAt(stored, new Date(now), 15, now)).toBe(false)
    // Con 60 días configurados, un documento emitido hace 30 sigue vivo.
    const old = new Date(now - 30 * DAY_MS)
    expect(isQuoteExpiredAt(null, old, 60, now)).toBe(false)
    expect(isQuoteExpiredAt(null, old, 15, now)).toBe(true)
  })
})
