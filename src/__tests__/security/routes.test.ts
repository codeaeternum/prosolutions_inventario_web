import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({ auth: vi.fn(), findProduct: vi.fn(), productCount: vi.fn(), findReservation: vi.fn(), authPost: vi.fn(), findUser: vi.fn(), findUserById: vi.fn() }))
vi.mock("@/lib/auth", () => ({ auth: mocks.auth, handlers: { GET: vi.fn(), POST: mocks.authPost } }))
vi.mock("@/lib/prisma", () => ({ prisma: {
  product: { findMany: mocks.findProduct, findUnique: mocks.findProduct, count: mocks.productCount },
  reservation: { findFirst: mocks.findReservation },
  user: { findMany: mocks.findUser, findUnique: mocks.findUserById },
  business: { findFirst: vi.fn(async () => ({ id: "biz-test" })) },
} }))
import { GET as fixPreview, POST as fixApply } from "@/app/api/fix-catalog/route"
import { GET as products } from "@/app/api/products/route"
import { GET as productDetail } from "@/app/api/products/[id]/route"
import { GET as proof } from "@/app/api/payment-proofs/[filename]/route"
import { POST as uploadProof } from "@/app/api/payment-proofs/route"
import { POST as login } from "@/app/api/auth/[...nextauth]/route"
import { GET as users } from "@/app/api/users/route"
import { GET as reports } from "@/app/api/reports/route"
import { paymentProofFilename, writePaymentProof } from "@/lib/payment-proofs"

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l1cAAAAASUVORK5CYII=", "base64")
const user = (id: string, role = "CUSTOMER", status = "APPROVED") => ({ user: { id, role, status, customerType: "NORMAL", businessId: "biz-test" } })
let directory: string
beforeEach(async () => {
  vi.clearAllMocks(); mocks.auth.mockResolvedValue(null); mocks.findReservation.mockResolvedValue(null); mocks.findUserById.mockResolvedValue({ businessId: "biz-test" })
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "proof-route-test-"))
  vi.stubEnv("PAYMENT_PROOFS_DIR", directory)
})
afterEach(async () => { await fs.rm(directory, { recursive: true, force: true }); vi.unstubAllEnvs() })
describe("route authorization contracts with real Request/Response", () => {
  it("fix catalog denies anonymous and employee access before database reads", async () => {
    for (const session of [null, user("employee", "EMPLOYEE"), user("pending-admin", "ADMIN", "PENDING")]) {
      mocks.auth.mockResolvedValue(session)
      expect([401, 403]).toContain((await fixPreview()).status)
      expect([401, 403]).toContain((await fixApply()).status)
    }
    expect(mocks.findProduct).not.toHaveBeenCalled()
  })
  it("employees cannot call full users or reports APIs", async () => {
    mocks.auth.mockResolvedValue(user("employee", "EMPLOYEE"))
    expect((await users(new Request("https://app.invalid/api/users"))).status).toBe(403)
    expect((await reports(new NextRequest("https://app.invalid/api/reports"))).status).toBe(403)
  })
  it("public catalog response never serializes wholesale or cost data", async () => {
    mocks.findProduct.mockResolvedValue([{ id: "p", name: "Screen", retailPrice: 100, wholesalePrice: 80, costPrice: 45, minStock: 1, _count: { reservations: 25 } }])
    mocks.productCount.mockResolvedValue(1)
    const response = await products(new Request("https://app.invalid/api/products"))
    const json = await response.json()
    expect(json.products[0]).toEqual({ id: "p", name: "Screen", retailPrice: 100 })
    expect(response.headers.get("cache-control")).toContain("no-store")
  })
  it("inactive product detail is 404 for anonymous users", async () => {
    mocks.findProduct.mockResolvedValue({ id: "p", isActive: false, models: [] })
    expect((await productDetail(new NextRequest("https://app.invalid/api/products/p"), { params: Promise.resolve({ id: "p" }) })).status).toBe(404)
  })
  it("proof bytes require an approved owner or staff; unrelated users learn no existence", async () => {
    const url = await writePaymentProof(png, "owner")
    const params = { params: Promise.resolve({ filename: paymentProofFilename(url)! }) }
    expect((await proof(new Request(`https://app.invalid${url}`), params)).status).toBe(401)
    mocks.auth.mockResolvedValue(user("stranger"))
    expect((await proof(new Request(`https://app.invalid${url}`), params)).status).toBe(404)
    for (const session of [user("owner"), user("admin", "ADMIN"), user("employee", "EMPLOYEE")]) {
      mocks.auth.mockResolvedValue(session)
      const response = await proof(new Request(`https://app.invalid${url}`), params)
      expect(response.status).toBe(200); expect(Buffer.from(await response.arrayBuffer())).toEqual(png)
      expect(response.headers.get("cache-control")).toContain("no-store")
      expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    }
  })
  it("multipart upload records owner and rejects a forged image MIME", async () => {
    mocks.auth.mockResolvedValue(user("uploader"))
    for (const valid of [true, false]) {
      const form = new FormData(); form.set("file", new File([valid ? png : Buffer.from("<html>fake image</html>")], "photo.png", { type: "image/png" }))
      const response = await uploadProof(new Request("https://app.invalid/api/payment-proofs", { method: "POST", body: form }))
      expect(response.status).toBe(valid ? 201 : 400)
    }
  })
  it("encoded credential field names cannot bypass request throttling", async () => {
    vi.stubEnv("TRUST_PROXY_HEADERS", "false")
    mocks.authPost.mockResolvedValue(new Response("handled"))
    // Rotate the evasion vectors the audit used: percent-encoded field names,
    // forged X-Forwarded-For values and JSON bodies all share one bucket.
    for (let i = 0; i < 30; i++) {
      const json = i % 3 === 1
      const result = await login(new Request("https://app.invalid/api/auth/callback/credentials", {
        method: "POST",
        headers: json
          ? { "content-type": "application/json", "x-forwarded-for": `10.0.0.${i}` }
          : { "Content-Type": "application/x-www-form-urlencoded", "x-forwarded-for": `1.2.3.${i}` },
        body: json ? JSON.stringify({ identifier: "t", password: "w" }) : "%69dentifier=test&%70assword=wrong",
      }))
      expect(result.status).toBe(200)
    }
    const result = await login(new Request("https://app.invalid/api/auth/callback/credentials", { method: "POST", body: "%69dentifier=test&%70assword=wrong" }))
    expect(result.status).toBe(429); expect(mocks.authPost).toHaveBeenCalledTimes(30)
  })
  it("keeps serving non-credential auth actions while the login bucket is exhausted", async () => {
    mocks.authPost.mockResolvedValue(new Response("ok"))
    const result = await login(new Request("https://app.invalid/api/auth/session", { method: "POST" }))
    expect(result.status).toBe(200)
    expect(mocks.authPost).toHaveBeenCalledTimes(1)
  })
  it("rejects oversized credential posts before touching the auth handler", async () => {
    vi.stubEnv("TRUST_PROXY_HEADERS", "false")
    // Keep fake time running during the call so checkAndRecord's expiry sweep drops the earlier bucket.
    vi.useFakeTimers()
    vi.advanceTimersByTime(16 * 60 * 1000)
    mocks.authPost.mockClear()
    const req = { url: "https://app.invalid/api/auth/callback/credentials", headers: new Headers({ "content-length": "99999" }) } as unknown as Request
    expect((await login(req)).status).toBe(413)
    expect(mocks.authPost).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
  it("a session with stale privileged claims cannot reach admin handlers", async () => {
    for (const session of [user("demoted", "CUSTOMER"), user("rejected", "ADMIN", "REJECTED"), null]) {
      mocks.auth.mockResolvedValue(session)
      expect([401, 403]).toContain((await users(new Request("https://app.invalid/api/users"))).status)
    }
    expect(mocks.findUser).not.toHaveBeenCalled()
  })
})
