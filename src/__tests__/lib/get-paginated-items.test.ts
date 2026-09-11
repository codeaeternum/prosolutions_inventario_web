import { describe, it, expect } from "vitest"
import {
  getPaginatedItems,
  getPaginationMeta,
} from "@/lib/get-paginated-items"

describe("getPaginatedItems", () => {
  it("returns data when present", () => {
    expect(getPaginatedItems({ data: [1, 2, 3] })).toEqual([1, 2, 3])
  })

  it("returns products when preferredKey is products", () => {
    expect(
      getPaginatedItems({ products: [{ id: "1" }] }, "products")
    ).toEqual([{ id: "1" }])
  })

  it("falls back to products when data missing", () => {
    expect(
      getPaginatedItems({ products: [1, 2], total: 2, page: 1 }, "data")
    ).toEqual([1, 2])
  })

  it("returns empty array when no list key", () => {
    expect(getPaginatedItems({ total: 0, page: 1 })).toEqual([])
  })
})

describe("getPaginationMeta", () => {
  it("returns default meta when empty", () => {
    expect(getPaginationMeta({})).toEqual({
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 1,
    })
  })

  it("returns provided meta", () => {
    expect(
      getPaginationMeta({ total: 50, page: 2, limit: 10, totalPages: 5 })
    ).toEqual({ total: 50, page: 2, limit: 10, totalPages: 5 })
  })
})
