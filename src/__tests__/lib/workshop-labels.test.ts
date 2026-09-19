import { describe, it, expect } from "vitest"
import { DEFAULT_ORDER_PREFIX, formatFolio, repairFolio } from "@/lib/workshop-labels"

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
})

describe("repairFolio", () => {
  it("keeps the OT- default format", () => {
    expect(DEFAULT_ORDER_PREFIX).toBe("OT")
    expect(repairFolio(1)).toBe("OT-000001")
    expect(repairFolio(42)).toBe("OT-000042")
  })
})
