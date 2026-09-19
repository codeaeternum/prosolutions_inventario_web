import { describe, it, expect } from "vitest"
import {
  fillDays,
  fillMonths,
  lastDayKeys,
  lastMonthKeys,
} from "@/lib/chart-utils"

describe("lastDayKeys", () => {
  const end = new Date("2026-03-15T18:30:00Z")

  it("returns n ascending YYYY-MM-DD keys ending today (UTC)", () => {
    const keys = lastDayKeys(5, end)
    expect(keys).toEqual([
      "2026-03-11",
      "2026-03-12",
      "2026-03-13",
      "2026-03-14",
      "2026-03-15",
    ])
  })

  it("crosses month boundaries", () => {
    const keys = lastDayKeys(3, new Date("2026-03-01T10:00:00Z"))
    expect(keys).toEqual(["2026-02-27", "2026-02-28", "2026-03-01"])
  })

  it("ignores the time of day", () => {
    expect(lastDayKeys(1, new Date("2026-03-15T00:00:01Z"))).toEqual([
      "2026-03-15",
    ])
    expect(lastDayKeys(1, new Date("2026-03-15T23:59:59Z"))).toEqual([
      "2026-03-15",
    ])
  })
})

describe("lastMonthKeys", () => {
  it("returns n ascending YYYY-MM keys ending this month", () => {
    expect(lastMonthKeys(3, new Date("2026-03-15T12:00:00Z"))).toEqual([
      "2026-01",
      "2026-02",
      "2026-03",
    ])
  })

  it("crosses year boundaries", () => {
    expect(lastMonthKeys(3, new Date("2026-01-10T12:00:00Z"))).toEqual([
      "2025-11",
      "2025-12",
      "2026-01",
    ])
  })
})

describe("fillDays", () => {
  const days = ["2026-03-01", "2026-03-02", "2026-03-03"]

  it("fills missing days with the zero template", () => {
    const out = fillDays(
      days,
      [{ day: "2026-03-02", salesCents: 500, count: 2 }],
      { salesCents: 0, count: 0 }
    )
    expect(out).toEqual([
      { day: "2026-03-01", salesCents: 0, count: 0 },
      { day: "2026-03-02", salesCents: 500, count: 2 },
      { day: "2026-03-03", salesCents: 0, count: 0 },
    ])
  })

  it("merges partial rows over the zero template", () => {
    const out = fillDays(days, [{ day: "2026-03-01", inCents: 100 }], {
      inCents: 0,
      outCents: 0,
    })
    expect(out[0]).toEqual({ day: "2026-03-01", inCents: 100, outCents: 0 })
  })

  it("ignores rows whose day is outside the key list", () => {
    const out = fillDays(
      days,
      [
        { day: "2026-03-03", count: 1 },
        { day: "2026-04-01", count: 99 },
      ],
      { count: 0 }
    )
    expect(out.map((r) => r.day)).toEqual(days)
    expect(out[2].count).toBe(1)
    expect(out.reduce((s, r) => s + r.count, 0)).toBe(1)
  })

  it("does not mutate the zero template or the input rows", () => {
    const zero = { count: 0 }
    const row = { day: "2026-03-01", count: 5 }
    fillDays(days, [row], zero)
    expect(zero).toEqual({ count: 0 })
    expect(row).toEqual({ day: "2026-03-01", count: 5 })
  })
})

describe("fillMonths", () => {
  it("fills missing months with the zero template", () => {
    const out = fillMonths(
      ["2026-01", "2026-02", "2026-03"],
      [{ month: "2026-03", count: 4 }],
      { count: 0 }
    )
    expect(out).toEqual([
      { month: "2026-01", count: 0 },
      { month: "2026-02", count: 0 },
      { month: "2026-03", count: 4 },
    ])
  })
})
