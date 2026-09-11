import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { imageFormat, isOwnedPaymentProof, paymentProofFilename, readPaymentProof, writePaymentProof } from "@/lib/payment-proofs"

// A complete valid 1x1 PNG, not a mocked filesystem or fake MIME string.
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l1cAAAAASUVORK5CYII=", "base64")
let directory: string; const previousDirectory = process.env.PAYMENT_PROOFS_DIR
beforeEach(async () => { directory = await fs.mkdtemp(path.join(os.tmpdir(), "prosolutions-proof-test-")); process.env.PAYMENT_PROOFS_DIR = path.join(directory, "private") })
afterEach(async () => { await fs.rm(directory, { recursive: true, force: true }); if (previousDirectory === undefined) delete process.env.PAYMENT_PROOFS_DIR; else process.env.PAYMENT_PROOFS_DIR = previousDirectory })
describe("private proof storage", () => {
  it("persists original bytes and ownership outside public across reads", async () => {
    const url = await writePaymentProof(png, "owner-A")
    expect(url).toMatch(/^\/api\/payment-proofs\/[\w-]+\.png$/)
    const filename = paymentProofFilename(url)!
    expect(await isOwnedPaymentProof(url, "owner-A")).toBe(true)
    expect(await isOwnedPaymentProof(url, "owner-B")).toBe(false)
    const stored = await readPaymentProof(filename)
    expect(stored?.bytes).toEqual(png); expect(stored?.mime).toBe("image/png")
    expect((await fs.stat(path.join(process.env.PAYMENT_PROOFS_DIR!, filename))).mode & 0o077).toBe(0)
  })
  it("rejects forged MIME content, traversal, external URL and oversized image", async () => {
    await expect(writePaymentProof(Buffer.from("<html>not an image</html>"), "owner")).rejects.toThrow()
    await expect(writePaymentProof(Buffer.concat([png, Buffer.alloc(5 * 1024 * 1024)]), "owner")).rejects.toThrow()
    for (const url of ["https://evil.invalid/image.png", "/api/payment-proofs/../secret.png", "/api/payment-proofs/%2e%2e.png", "/uploads/products/p.png", "/api/payment-proofs/p.png?x=1"]) expect(paymentProofFilename(url)).toBeNull()
    expect(await readPaymentProof("../../secret.png")).toBeNull()
    expect(imageFormat(Buffer.from("not-a-real-image.png"))).toBeNull()
  })
  it("does not follow symlinks to a file or ownership metadata outside storage", async () => {
    await fs.mkdir(process.env.PAYMENT_PROOFS_DIR!, { recursive: true })
    await fs.writeFile(path.join(directory, "secret.png"), png)
    await fs.writeFile(path.join(directory, "metadata.json"), JSON.stringify({ uploaderId: "attacker" }))
    await fs.symlink(path.join(directory, "secret.png"), path.join(process.env.PAYMENT_PROOFS_DIR!, "escape.png"))
    await fs.symlink(path.join(directory, "metadata.json"), path.join(process.env.PAYMENT_PROOFS_DIR!, "escape.png.json"))
    expect(await readPaymentProof("escape.png")).toBeNull()
    expect(await isOwnedPaymentProof("/api/payment-proofs/escape.png", "attacker")).toBe(false)
  })
})
