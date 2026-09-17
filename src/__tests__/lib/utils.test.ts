import { describe, it, expect } from "vitest"
import { formatDate, formatPrice, generateSlug, normalizePhone } from "@/lib/utils"

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
