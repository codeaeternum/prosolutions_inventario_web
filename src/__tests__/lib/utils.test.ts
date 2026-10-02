import { describe, it, expect } from "vitest"
import { formatDate, formatPrice, generateSlug, normalizePhone, normalizeProductName, titleCaseName } from "@/lib/utils"

describe("formatDate", () => {
  it("formats a date string in es-MX locale", () => {
    const result = formatDate("2025-03-05T14:30:00.000Z")
    expect(result).toMatch(/\d{1,2}/)
    expect(result).toMatch(/mar|abr|may|jun|jul|ago|sep|oct|nov|dic/)
    expect(result).toMatch(/2025/)
  })

  it("accepts Date object", () => {
    const result = formatDate(new Date("2025-01-15T10:00:00Z"))
    expect(result).toMatch(/2025/)
  })
})

describe("formatPrice", () => {
  it("formats number as MXN currency", () => {
    expect(formatPrice(100)).toMatch(/\$?\s*100/)
    expect(formatPrice(0)).toMatch(/0/)
  })
})

describe("normalizePhone", () => {
  it("strips formatting from 10-digit numbers", () => {
    expect(normalizePhone("811 234 5678")).toBe("8112345678")
    expect(normalizePhone("(811) 234-5678")).toBe("8112345678")
    expect(normalizePhone("811-234-5678")).toBe("8112345678")
  })

  it("strips +52 country code", () => {
    expect(normalizePhone("+52 811 234 5678")).toBe("8112345678")
    expect(normalizePhone("528112345678")).toBe("8112345678")
  })

  it("strips +52 1 mobile prefix", () => {
    expect(normalizePhone("+52 1 811 234 5678")).toBe("8112345678")
  })

  it("keeps short local numbers as digits only", () => {
    expect(normalizePhone("123-4567")).toBe("1234567")
  })

  it("matches numbers regardless of capture format", () => {
    const a = normalizePhone("811 234 5678")
    const b = normalizePhone("+52 1 (811) 234-5678")
    expect(a).toBe(b)
  })

  it("returns empty string for null/undefined/empty", () => {
    expect(normalizePhone(null)).toBe("")
    expect(normalizePhone(undefined)).toBe("")
    expect(normalizePhone("")).toBe("")
    expect(normalizePhone("   ")).toBe("")
  })
})

describe("titleCaseName", () => {
  it("title-cases all-caps counter input", () => {
    expect(titleCaseName("MARIA MARTINBEZ")).toBe("Maria Martinbez")
    expect(titleCaseName("JUAN PEREZ")).toBe("Juan Perez")
  })

  it("normalizes spacing and keeps accents", () => {
    expect(titleCaseName("  ana   maria  ")).toBe("Ana Maria")
    expect(titleCaseName("juan pérez garcía")).toBe("Juan Pérez García")
    expect(titleCaseName("ÑANDÚ")).toBe("Ñandú")
  })

  it("keeps Mc and O' name particles readable", () => {
    expect(titleCaseName("MCDONALD")).toBe("McDonald")
    expect(titleCaseName("o'brien")).toBe("O'Brien")
    expect(titleCaseName("O'NEIL")).toBe("O'Neil")
  })

  it("title-cases hyphenated names", () => {
    expect(titleCaseName("maria-jose")).toBe("Maria-Jose")
    expect(titleCaseName("JEAN-LUC")).toBe("Jean-Luc")
  })

  it("returns empty for empty/blank input", () => {
    expect(titleCaseName("")).toBe("")
    expect(titleCaseName("   ")).toBe("")
  })
})

describe("generateSlug", () => {
  it("lowercases and replaces spaces with hyphens", () => {
    expect(generateSlug("Hello World")).toBe("hello-world")
  })

  it("removes accents", () => {
    expect(generateSlug("Café")).toBe("cafe")
    expect(generateSlug("Niño")).toBe("nino")
  })

  it("replaces non-alphanumeric with single hyphen", () => {
    expect(generateSlug("  foo   bar  ")).toBe("foo-bar")
  })

  it("removes leading and trailing hyphens", () => {
    expect(generateSlug("-hello-")).toBe("hello")
  })
})

describe("normalizeProductName", () => {
  it("title-cases ALL-CAPS names keeping model tokens", () => {
    expect(normalizeProductName("PANTALLA Y7P")).toBe("Pantalla Y7P")
    expect(normalizeProductName("PANTALLA SAMSUNG A06 4G")).toBe("Pantalla Samsung A06 4G")
    expect(normalizeProductName("BATERÍA IPHONE 15 PRO MAX")).toBe("Batería iPhone 15 Pro Max")
  })

  it("title-cases all-lowercase names and keeps acronyms upper", () => {
    expect(normalizeProductName("pantalla honor x8")).toBe("Pantalla Honor X8")
    expect(normalizeProductName("pantalla lcd samsung a03s")).toBe("Pantalla LCD Samsung A03S")
    expect(normalizeProductName("flex de carga 5g")).toBe("Flex De Carga 5G")
  })

  it("leaves intentional mixed case untouched", () => {
    expect(normalizeProductName("Pantalla iPhone 6s Negra")).toBe("Pantalla iPhone 6s Negra")
    expect(normalizeProductName("Pantalla Moto G04 / G04S")).toBe("Pantalla Moto G04 / G04S")
  })

  it("collapses extra whitespace and trims", () => {
    expect(normalizeProductName("  pantalla   moto  e20 ")).toBe("Pantalla Moto E20")
  })

  it("returns blank/numeric-only input unchanged", () => {
    expect(normalizeProductName("")).toBe("")
    expect(normalizeProductName("   ")).toBe("")
    expect(normalizeProductName("12345")).toBe("12345")
  })
})
