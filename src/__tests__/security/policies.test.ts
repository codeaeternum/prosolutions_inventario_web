import { describe, expect, it } from "vitest"
import { safeRedirectPath } from "@/lib/safe-redirect"
import { refreshSessionToken, type CurrentUser } from "@/lib/session-policy"
import { productDto } from "@/lib/product-dto"
import { getAuthRedirect } from "@/lib/auth.config"
import type { JWT } from "@auth/core/jwt"

const admin: CurrentUser = { id: "admin", name: "Test", email: "test@example.invalid", phone: null, password: "bcrypt-hash-A", status: "APPROVED", role: "ADMIN", customerType: "NORMAL" }
describe("current database authorization", () => {
  const token = refreshSessionToken({ id: admin.id } as JWT, admin, true)!
  it("revokes rejected, deleted and password-changed accounts and pre-upgrade cookies", () => {
    expect(refreshSessionToken(token, { ...admin, status: "REJECTED" })).toBeNull()
    expect(refreshSessionToken(token, null)).toBeNull()
    expect(refreshSessionToken(token, { ...admin, password: "new-hash" })).toBeNull()
    expect(refreshSessionToken({ id: admin.id } as JWT, admin)).toBeNull()
  })
  it("demotion and pricing changes override the role and price tier in an old cookie", () => {
    const refreshed = refreshSessionToken(token, { ...admin, role: "CUSTOMER", customerType: "NORMAL" })!
    expect(refreshed.role).toBe("CUSTOMER")
    expect(getAuthRedirect({ user: { role: refreshed.role, status: refreshed.status } }, new URL("https://app.invalid/admin"))?.headers.get("location")).toBe("https://app.invalid/")
  })
  it("pending staff cannot enter admin; authenticated pending user does not bypass unknown paths", () => {
    for (const role of ["ADMIN", "EMPLOYEE", "CUSTOMER"] as const) {
      expect(getAuthRedirect({ user: { role, status: "PENDING" } }, new URL("https://app.invalid/admin"))?.headers.get("location")).toBe("https://app.invalid/pending")
      expect(getAuthRedirect({ user: { role, status: "PENDING" } }, new URL("https://app.invalid/unknown"))?.headers.get("location")).toBe("https://app.invalid/pending")
    }
  })
})
describe("redirect contract", () => {
  it.each(["javascript:alert(1)", "https://evil.invalid", "//evil.invalid", "/\\evil.invalid", "/%5cevil.invalid", "/%2Fevil.invalid", "/%252fevil.invalid", "/%0a/evil.invalid", "/%", "data:text/html,evil"])("rejects %s", value => expect(safeRedirectPath(value)).toBe("/"))
  it.each(["/admin", "/catalogo?search=iphone", "/mis-reservas#reserva"])("keeps local destination %s", value => expect(safeRedirectPath(value)).toBe(value))
})
describe("catalog role-based disclosure", () => {
  const product = { id: "p", name: "Screen", retailPrice: 100, wholesalePrice: 80, costPrice: 50, minStock: 2, stock: 3, _count: { reservations: 4 }, futurePrivateColumn: "private" }
  it("anonymous, pending and normal customers receive only retail fields", () => {
    for (const viewer of [null, { role: "CUSTOMER", status: "APPROVED", customerType: "NORMAL" }, { role: "ADMIN", status: "PENDING" }]) {
      expect(productDto(product, viewer)).toEqual({ id: "p", name: "Screen", retailPrice: 100, stock: 3 })
    }
  })
  it("approved wholesale customer sees negotiated tier but never costs, counts or future columns", () => {
    const dto = productDto(product, { role: "CUSTOMER", status: "APPROVED", customerType: "STORE" })
    expect(dto.wholesalePrice).toBe(80)
    for (const key of ["costPrice", "minStock", "_count", "futurePrivateColumn"]) expect(dto).not.toHaveProperty(key)
  })
  it("staff keeps existing inventory fields without exposing unlisted future data", () => {
    const dto = productDto(product, { role: "ADMIN", status: "APPROVED" })
    expect(dto.costPrice).toBe(50); expect(dto._count).toEqual({ reservations: 4 }); expect(dto).not.toHaveProperty("futurePrivateColumn")
  })
})
