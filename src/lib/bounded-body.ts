/**
 * Cota real de bytes entrantes en endpoints de upload.
 *
 * El rechazo temprano por Content-Length solo corre cuando el cliente lo
 * declara: con `Transfer-Encoding: chunked` (o un header mentiroso) no hay
 * nada que revisar y formData()/arrayBuffer() buferarían TODO el cuerpo en
 * memoria — un POST gigante tumba el proceso. Aquí se lee el stream por
 * chunks contando bytes y se aborta (reader.cancel) en cuanto se pasa del
 * tope — mismo patrón que /api/payment-proofs:14-23.
 */

export type BoundedRead =
  | { ok: true; bytes: Buffer }
  | { ok: false; reason: "empty" | "too_large" }

/**
 * Lee el cuerpo de `req` hasta `maxBytes`. Devuelve:
 * - { ok: true, bytes } el cuerpo completo ya buferado,
 * - { ok: false, reason: "empty" } si la request no trae cuerpo,
 * - { ok: false, reason: "too_large" } si superó el tope (stream cancelado).
 */
export async function readBoundedBody(req: Request, maxBytes: number): Promise<BoundedRead> {
  const reader = req.body?.getReader()
  if (!reader) return { ok: false, reason: "empty" }
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const next = await reader.read()
    if (next.done) break
    size += next.value.byteLength
    if (size > maxBytes) {
      await reader.cancel()
      return { ok: false, reason: "too_large" }
    }
    chunks.push(next.value)
  }
  return { ok: true, bytes: Buffer.concat(chunks) }
}

/**
 * Reconstruye el Request con el cuerpo ya buferado: el stream original quedó
 * consumido por readBoundedBody y formData() exige un cuerpo legible. Los
 * headers se conservan (el boundary multipart del Content-Type es el que
 * hace falta para parsear).
 */
export function requestWithBody(req: Request, bytes: Buffer): Request {
  return new Request(req.url, {
    method: req.method,
    headers: req.headers,
    // Buffer<ArrayBufferLike> no satisface BodyInit estricto (TS 5.7):
    // Uint8Array<ArrayBuffer> sí.
    body: new Uint8Array(bytes),
  })
}
