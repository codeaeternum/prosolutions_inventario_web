import { NextResponse } from "next/server"
import { getSession, requireAuth } from "@/lib/api-auth"
import { MAX_PROOF_BYTES, writePaymentProof } from "@/lib/payment-proofs"
import { checkAndRecord } from "@/lib/rate-limit"

export async function POST(req: Request) {
  const result = await requireAuth()
  if (result.error) return result.error
  const user = getSession(result)!.user
  if (!checkAndRecord("proof-upload", user.id, 15 * 60 * 1000, 20)) return NextResponse.json({ error: "Demasiados archivos. Intenta más tarde." }, { status: 429 })
  if (Number(req.headers.get("content-length")) > MAX_PROOF_BYTES + 65536) return NextResponse.json({ error: "Archivo demasiado grande" }, { status: 413 })
  try {
    // Bound actual incoming bytes too; Content-Length is supplied by the client.
    const reader = req.body?.getReader()
    if (!reader) return new NextResponse(null, { status: 400 })
    const chunks: Uint8Array[] = []; let size = 0
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      size += next.value.byteLength
      if (size > MAX_PROOF_BYTES + 65536) { await reader.cancel(); return new NextResponse(null, { status: 413 }) }
      chunks.push(next.value)
    }
    const parsed = new Request(req.url, { method: "POST", headers: req.headers, body: Buffer.concat(chunks) })
    const form = await parsed.formData()
    const file = form.get("file")
    if (!(file instanceof File) || file.size > MAX_PROOF_BYTES) return NextResponse.json({ error: "Selecciona una imagen de hasta 5 MB" }, { status: 400 })
    const url = await writePaymentProof(new Uint8Array(await file.arrayBuffer()), user.id)
    return NextResponse.json({ url }, { status: 201, headers: { "Cache-Control": "private, no-store" } })
  } catch { return NextResponse.json({ error: "Comprobante inválido. Usa PNG, JPEG, WebP o GIF de hasta 5 MB." }, { status: 400 }) }
}
