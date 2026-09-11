export interface ClientOperationKey {
  fingerprint: string
  key: string
}

/** Keep the same key when retrying an unchanged operation after a network failure. */
export function getClientOperationKey(previous: ClientOperationKey | null, payload: unknown): ClientOperationKey {
  const fingerprint = JSON.stringify(payload)
  return previous?.fingerprint === fingerprint
    ? previous
    : { fingerprint, key: operationUUID() }
}

// Tailscale/LAN HTTP is not a secure context, but getRandomValues remains available.
function operationUUID(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 15) | 64
  bytes[8] = (bytes[8] & 63) | 128
  const hex = Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
