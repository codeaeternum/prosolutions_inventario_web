import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({ authSession: vi.fn(), findReservation: vi.fn(), getAuthRedirect: vi.fn() }))
// api-auth calls auth() for the session; middleware calls auth(handler) as a wrapper.
vi.mock("@/lib/auth", () => ({ auth: (arg?: unknown) => (typeof arg === "function" ? arg : mocks.authSession()) }))
vi.mock("@/lib/prisma", () => ({ prisma: { reservation: { findFirst: mocks.findReservation } } }))
vi.mock("@/lib/auth.config", () => ({ getAuthRedirect: mocks.getAuthRedirect }))

import { GET as uploads } from "@/app/uploads/[[...path]]/route"
import middleware from "@/middleware"
import { paymentProofFilename, writePaymentProof } from "@/lib/payment-proofs"

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l1cAAAAASUVORK5CYII=", "base64")
const user = (id: string, role = "CUSTOMER", status = "APPROVED") => ({ user: { id, role, status, customerType: "NORMAL" } })
// The middleware only reads req.auth and req.nextUrl; a stub with a real NextURL exercises the same logic.
const runMiddleware = (req: NextRequest, auth: unknown) => (middleware as any)({ auth, nextUrl: req.nextUrl })
const getUpload = (segments: string[]) => uploads(new NextRequest(`https://app.invalid/uploads/${segments.join("/")}`), { params: Promise.resolve({ path: segments }) })

let directory: string
beforeEach(async () => {
  vi.clearAllMocks()
  mocks.authSession.mockResolvedValue(null)
  mocks.findReservation.mockResolvedValue(null)
  mocks.getAuthRedirect.mockReturnValue(null)
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "proof-access-test-"))
  vi.stubEnv("PAYMENT_PROOFS_DIR", directory)
})
afterEach(async () => { await fs.rm(directory, { recursive: true, force: true }); vi.unstubAllEnvs() })

describe("private proof objects are never served publicly (SEC-05)", () => {
  it("middleware blocks anonymous and unapproved access before static file serving", async () => {
    for (const auth of [null, user("pending", "CUSTOMER", "PENDING")]) {
      const response = await runMiddleware(new NextRequest("https://app.invalid/uploads/payments/proof.png"), auth)
      expect(response.status).toBe(401)
      expect(response.headers.get("cache-control")).toContain("no-store")
    }
  })
  it("middleware rewrites approved sessions to the authorized file handler", async () => {
    const response = await runMiddleware(new NextRequest("https://app.invalid/uploads/payments/proof.png"), user("owner"))
    expect(response.headers.get("x-middleware-rewrite")).toContain("/api/payment-proofs/proof.png")
  })
  it("a differently-cased payments path is still intercepted", async () => {
    const response = await runMiddleware(new NextRequest("https://app.invalid/uploads/PAYMENTS/proof.png"), null)
    expect(response.status).toBe(401)
    const delegated = await getUpload(["PAYMENTS", "proof.png"])
    expect(delegated.status).toBe(401)
  })
  it("the image optimizer cannot proxy private proofs", async () => {
    for (const target of ["%2Fuploads%2Fpayments%2Fp.png", "%2Fapi%2Fpayment-proofs%2Fp.png"]) {
      const response = await runMiddleware(new NextRequest(`https://app.invalid/_next/image?url=${target}&w=64&q=75`), null)
      expect(response.status).toBe(403)
    }
  })
  it("the catch-all uploads route delegates payments to the authorized handler", async () => {
    const url = await writePaymentProof(png, "owner")
    const filename = paymentProofFilename(url)!
    // Anonymous and unrelated approved users never receive bytes or existence.
    expect((await getUpload(["payments", filename])).status).toBe(401)
    mocks.authSession.mockResolvedValue(user("stranger"))
    const denied = await getUpload(["payments", filename])
    expect(denied.status).toBe(404)
    // The uploader receives bytes with private, non-cacheable headers.
    mocks.authSession.mockResolvedValue(user("owner"))
    const allowed = await getUpload(["payments", filename])
    expect(allowed.status).toBe(200)
    expect(Buffer.from(await allowed.arrayBuffer())).toEqual(png)
    expect(allowed.headers.get("cache-control")).toContain("no-store")
    // A staff member can review proofs too.
    mocks.authSession.mockResolvedValue(user("admin", "ADMIN"))
    expect((await getUpload(["payments", filename])).status).toBe(200)
  })
  it("other uploads keep working as public product assets", async () => {
    mocks.authSession.mockResolvedValue(null)
    const response = await getUpload(["products", "missing.png"])
    expect(response.status).toBe(404)
    const traversal = await getUpload(["products", "..", "payments", "x.png"])
    expect([403, 404]).toContain(traversal.status)
  })
})
