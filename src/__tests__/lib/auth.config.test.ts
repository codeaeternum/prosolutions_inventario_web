import { describe, it, expect } from "vitest"
import { getAuthRedirect } from "@/lib/auth.config"

/** Mock URL para getAuthRedirect (acepta URL estándar) */
function createNextUrl(pathname: string): URL {
  return new URL(`http://localhost${pathname}`)
}

describe("getAuthRedirect", () => {
  it("allows public path without auth", () => {
    const url = createNextUrl("/")
    expect(getAuthRedirect(null, url)).toBeNull()
  })

  it("redirects unauthenticated user from /admin to /login", () => {
    const url = createNextUrl("/admin")
    const redirect = getAuthRedirect(null, url)
    expect(redirect).not.toBeNull()
    expect(redirect!.headers.get("location")).toContain("/login")
  })

  it("allows ADMIN to access /admin", () => {
    const url = createNextUrl("/admin")
    const redirect = getAuthRedirect(
      { user: { role: "ADMIN", status: "APPROVED" } },
      url
    )
    expect(redirect).toBeNull()
  })

  it("allows EMPLOYEE to access /admin", () => {
    const url = createNextUrl("/admin")
    const redirect = getAuthRedirect(
      { user: { role: "EMPLOYEE", status: "APPROVED" } },
      url
    )
    expect(redirect).toBeNull()
  })

  it("redirects CUSTOMER from /admin to /", () => {
    const url = createNextUrl("/admin")
    const redirect = getAuthRedirect(
      { user: { role: "CUSTOMER", status: "APPROVED" } },
      url
    )
    expect(redirect).not.toBeNull()
    expect(redirect!.headers.get("location")).toContain("/")
  })

  it("redirects unauthenticated from /mis-reservas to /?redirect=bot (legacy)", () => {
    const url = createNextUrl("/mis-reservas")
    const redirect = getAuthRedirect(null, url)
    expect(redirect).not.toBeNull()
    expect(redirect!.headers.get("location")).toContain("redirect=bot")
  })

  it("allows approved user on /mis-reservas", () => {
    const url = createNextUrl("/mis-reservas")
    const redirect = getAuthRedirect(
      { user: { role: "CUSTOMER", status: "APPROVED" } },
      url
    )
    expect(redirect).toBeNull()
  })

  it("redirects PENDING user from /carrito to /pending", () => {
    const url = createNextUrl("/carrito")
    const redirect = getAuthRedirect(
      { user: { role: "CUSTOMER", status: "PENDING" } },
      url
    )
    expect(redirect).not.toBeNull()
    expect(redirect!.headers.get("location")).toContain("/pending")
  })
})
