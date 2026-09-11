import { describe, it, expect } from "vitest"
import { formatDate, formatPrice, generateSlug } from "@/lib/utils"

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
