import { randomUUID } from "node:crypto"
import { promises as fs } from "node:fs"
import path from "node:path"

export const MAX_PROOF_BYTES = 5 * 1024 * 1024
export function paymentProofDirectory(): string { return process.env.PAYMENT_PROOFS_DIR || path.join(process.cwd(), "storage", "payment-proofs") }
export function validProofFilename(name: string): boolean { return /^[a-zA-Z0-9_-]+\.(?:jpe?g|png|webp|gif)$/.test(name) }
export function paymentProofUrl(name: string): string {
  if (!validProofFilename(name)) throw new Error("Nombre de comprobante inválido")
  return `/api/payment-proofs/${name}`
}
export function paymentProofFilename(url: string): string | null {
  const match = /^\/(?:api\/payment-proofs|uploads\/payments)\/([^/?#]+)$/.exec(url)
  return match && validProofFilename(match[1]) ? match[1] : null
}
export function imageFormat(bytes: Uint8Array): { extension: string; mime: string } | null {
  const b = Buffer.from(bytes)
  if (b.length < 12) return null
  if (b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { extension: "png", mime: "image/png" }
  if (b[0] === 255 && b[1] === 216 && b[2] === 255) return { extension: "jpg", mime: "image/jpeg" }
  if (["GIF87a", "GIF89a"].includes(b.subarray(0, 6).toString())) return { extension: "gif", mime: "image/gif" }
  if (b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP") return { extension: "webp", mime: "image/webp" }
  return null
}
/** Store both bytes and upload ownership outside public; keep this directory on a persistent volume. */
export async function writePaymentProof(bytes: Uint8Array, uploaderId: string): Promise<string> {
  const format = imageFormat(bytes)
  if (!format || bytes.byteLength > MAX_PROOF_BYTES || !uploaderId) throw new Error("Comprobante inválido o mayor de 5 MB")
  const directory = paymentProofDirectory()
  await fs.mkdir(directory, { recursive: true, mode: 0o700 })
  const name = `${randomUUID()}.${format.extension}`
  await fs.writeFile(path.join(directory, name), bytes, { flag: "wx", mode: 0o600 })
  try {
    await fs.writeFile(path.join(directory, `${name}.json`), JSON.stringify({ uploaderId, createdAt: new Date().toISOString() }), { flag: "wx", mode: 0o600 })
  } catch (error) { await fs.unlink(path.join(directory, name)); throw error }
  return paymentProofUrl(name)
}
async function confinedPath(directory: string, name: string): Promise<string> {
  const root = await fs.realpath(directory)
  const file = await fs.realpath(path.join(root, name))
  if (path.dirname(file) !== root) throw new Error("Invalid file location")
  return file
}
/** New uploads must belong to the same user before they can be attached to a reservation. */
export async function isOwnedPaymentProof(url: string, userId: string): Promise<boolean> {
  const filename = paymentProofFilename(url)
  if (!filename) return false
  try {
    const file = await confinedPath(paymentProofDirectory(), `${filename}.json`)
    const metadata = JSON.parse(await fs.readFile(file, "utf8")) as { uploaderId?: string }
    return metadata.uploaderId === userId
  } catch { return false }
}
export async function readPaymentProof(filename: string): Promise<{ bytes: Buffer; mime: string } | null> {
  if (!validProofFilename(filename)) return null
  const roots = [paymentProofDirectory(), path.join(process.cwd(), "public", "uploads", "payments")]
  for (const root of roots) {
    try {
      const file = await confinedPath(root, filename)
      const stat = await fs.stat(file)
      if (!stat.isFile() || stat.size > MAX_PROOF_BYTES) return null
      const bytes = await fs.readFile(file)
      const format = imageFormat(bytes)
      if (!format) return null
      return { bytes, mime: format.mime }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") return null
    }
  }
  return null
}
