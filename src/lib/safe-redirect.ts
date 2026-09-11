/** Only same-origin root-relative destinations are accepted, including after decoding. */
export function safeRedirectPath(value: string | null | undefined, fallback = "/"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return fallback
  try {
    let decoded = value
    for (let i = 0; i < 3; i++) {
      if (/[\\\u0000-\u0020\u007f]/.test(decoded) || !decoded.startsWith("/") || decoded.startsWith("//")) return fallback
      const next = decodeURIComponent(decoded)
      if (next === decoded) break
      decoded = next
    }
    if (/[\\\u0000-\u0020\u007f]/.test(decoded) || decoded.startsWith("//")) return fallback
    const url = new URL(value, "https://local.invalid")
    return url.origin === "https://local.invalid" ? `${url.pathname}${url.search}${url.hash}` : fallback
  } catch { return fallback }
}
