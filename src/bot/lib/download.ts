import { MAX_PROOF_BYTES } from "../../lib/payment-proofs"
/** Telegram downloads have a deadline, an actual byte limit, and no token-bearing error logs. */
export async function downloadTelegramImage(url: string): Promise<Uint8Array> {
  const parsed = new URL(url)
  if (parsed.protocol !== "https:" || parsed.hostname !== "api.telegram.org") throw new Error("Invalid Telegram file origin")
  const response = await fetch(url, { signal: AbortSignal.timeout(15000), redirect: "error" })
  if (!response.ok || !response.body) throw new Error("Telegram image unavailable")
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0
  for (;;) {
    const result = await reader.read()
    if (result.done) break
    size += result.value.byteLength
    if (size > MAX_PROOF_BYTES) { await reader.cancel(); throw new Error("Image exceeds 5 MB") }
    chunks.push(result.value)
  }
  return Buffer.concat(chunks)
}
