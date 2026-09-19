import { describe, it, expect } from "vitest"
import { DEFAULT_ORDER_PREFIX, clampFolioDigits, formatFolio, parseFolioDigits, repairFolio } from "@/lib/workshop-labels"

describe("formatFolio", () => {
  it("uses the given prefix with 6-digit padding", () => {
    expect(formatFolio("PS", 1)).toBe("PS-000001")
    expect(formatFolio("PS", 42)).toBe("PS-000042")
    expect(formatFolio("PS", 1234567)).toBe("PS-1234567")
  })

  it("falls back to the default prefix on empty input", () => {
    expect(formatFolio(null, 7)).toBe("OT-000007")
    expect(formatFolio(undefined, 7)).toBe("OT-000007")
    expect(formatFolio("", 7)).toBe("OT-000007")
    expect(formatFolio("   ", 7)).toBe("OT-000007")
  })

  it("sanitizes the prefix to short uppercase alphanumeric", () => {
    expect(formatFolio("ps", 3)).toBe("PS-000003")
    expect(formatFolio("P-S!", 3)).toBe("PS-000003")
    expect(formatFolio("---", 3)).toBe("OT-000003")
    expect(formatFolio("superlargo", 3)).toBe("SUPERLAR-000003")
  })

  it("pads the number with the configured digit count (4–8)", () => {
    expect(formatFolio("OT", 123, 4)).toBe("OT-0123")
    expect(formatFolio("OT", 123, 5)).toBe("OT-00123")
    expect(formatFolio("OT", 123, 8)).toBe("OT-00000123")
    // Consecutivos más grandes que el ancho no se truncan.
    expect(formatFolio("OT", 123456, 4)).toBe("OT-123456")
  })

  it("clamps out-of-range digits and defaults invalid input", () => {
    expect(formatFolio("OT", 7, 3)).toBe("OT-0007")
    expect(formatFolio("OT", 7, 99)).toBe("OT-00000007")
    expect(formatFolio("OT", 7, NaN)).toBe("OT-000007")
    expect(formatFolio("OT", 7, 4.9)).toBe("OT-0007")
    expect(formatFolio("OT", 7)).toBe("OT-000007")
  })
})

describe("repairFolio", () => {
  it("keeps the OT- default format", () => {
    expect(DEFAULT_ORDER_PREFIX).toBe("OT")
    expect(repairFolio(1)).toBe("OT-000001")
    expect(repairFolio(42)).toBe("OT-000042")
  })

  it("accepts the configured digit count", () => {
    expect(repairFolio(42, 4)).toBe("OT-0042")
    expect(repairFolio(42, 8)).toBe("OT-00000042")
  })
})

describe("parseFolioDigits / clampFolioDigits", () => {
  it("parses the SystemSettings text value", () => {
    expect(parseFolioDigits("4")).toBe(4)
    expect(parseFolioDigits("8")).toBe(8)
    expect(parseFolioDigits("6")).toBe(6)
  })

  it("clamps stored values outside 4–8", () => {
    expect(parseFolioDigits("2")).toBe(4)
    expect(parseFolioDigits("12")).toBe(8)
  })

  it("falls back to 6 on missing or non-numeric values", () => {
    expect(parseFolioDigits(null)).toBe(6)
    expect(parseFolioDigits(undefined)).toBe(6)
    expect(parseFolioDigits("")).toBe(6)
    expect(parseFolioDigits("   ")).toBe(6)
    expect(parseFolioDigits("abc")).toBe(6)
    expect(clampFolioDigits(undefined)).toBe(6)
    expect(clampFolioDigits(NaN)).toBe(6)
  })
})
