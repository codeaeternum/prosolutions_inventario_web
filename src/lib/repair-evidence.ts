import { promises as fs } from "node:fs"
import path from "node:path"
import { imageFormat, MAX_PROOF_BYTES } from "./payment-proofs"

// Evidencias fotográficas de órdenes de reparación. Misma convención que
// payment-proofs: archivos fuera de /public, nombre = id del registro,
// formato detectado por magic bytes (nunca por el MIME declarado).
// Raíz: <cwd>/data/uploads — mantenerla en volumen persistente (ver compose).
export const MAX_EVIDENCE_BYTES = MAX_PROOF_BYTES // 5 MB

const SAFE_ID = /^[a-zA-Z0-9_-]+$/
const SAFE_PATH = /^repairs\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+\.(?:jpe?g|png|webp)$/

export function evidenceBaseDirectory(): string {
  return process.env.REPAIR_EVIDENCE_DIR || path.join(process.cwd(), "data", "uploads")
}

/** Solo jpeg/png/webp — gif queda fuera y SVG jamás entra (riesgo XSS). */
export function evidenceImageFormat(bytes: Uint8Array): { extension: "jpg" | "png" | "webp"; mime: string } | null {
  const format = imageFormat(bytes)
  if (!format || format.extension === "gif") return null
  return format as { extension: "jpg" | "png" | "webp"; mime: string }
}

/** Guarda bytes ya validados como repairs/<orderId>/<photoId>.<ext> y devuelve la ruta relativa que se persiste en RepairPhoto.filePath. */
export async function writeRepairPhoto(orderId: string, photoId: string, bytes: Uint8Array): Promise<string> {
  const format = evidenceImageFormat(bytes)
  if (!format || bytes.byteLength === 0 || bytes.byteLength > MAX_EVIDENCE_BYTES) throw new Error("Imagen inválida o mayor de 5 MB")
  if (!SAFE_ID.test(orderId) || !SAFE_ID.test(photoId)) throw new Error("Identificador inválido")
  const directory = path.join(evidenceBaseDirectory(), "repairs", orderId)
  await fs.mkdir(directory, { recursive: true, mode: 0o700 })
  const name = `${photoId}.${format.extension}`
  await fs.writeFile(path.join(directory, name), bytes, { flag: "wx", mode: 0o600 })
  return `repairs/${orderId}/${name}`
}

/** Resuelve filePath confinado dentro del dir base (realpath, sin traversal). */
async function confinedEvidencePath(filePath: string): Promise<string> {
  if (!SAFE_PATH.test(filePath)) throw new Error("Ruta de evidencia inválida")
  const root = await fs.realpath(evidenceBaseDirectory())
  const file = await fs.realpath(path.join(root, filePath))
  if (!file.startsWith(root + path.sep)) throw new Error("Ruta de evidencia inválida")
  return file
}

export async function readRepairPhoto(filePath: string): Promise<{ bytes: Buffer; mime: string } | null> {
  try {
    const file = await confinedEvidencePath(filePath)
    const stat = await fs.stat(file)
    if (!stat.isFile() || stat.size === 0 || stat.size > MAX_EVIDENCE_BYTES) return null
    const bytes = await fs.readFile(file)
    const format = evidenceImageFormat(bytes)
    if (!format) return null
    return { bytes, mime: format.mime }
  } catch {
    return null
  }
}

export async function deleteRepairPhotoFile(filePath: string): Promise<void> {
  try {
    await fs.unlink(await confinedEvidencePath(filePath))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }
}
