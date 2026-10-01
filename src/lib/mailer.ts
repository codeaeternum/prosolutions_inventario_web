/**
 * Envío de correos transaccionales vía Resend (API HTTP, sin SDK).
 * Si RESEND_API_KEY no está configurada devuelve { sent: false, reason:
 * "unconfigured" } — la verificación de correo es opcional hoy y NUNCA debe
 * romper el flujo que la dispara (signup, reenvío). Tampoco lanza hacia el
 * caller: cualquier fallo de red/API se reporta como { sent:false }.
 */

export type SendResult =
  | { sent: true }
  | { sent: false; reason: "unconfigured" | "failed" }

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

export async function sendVerificationEmail(
  email: string,
  code: string,
  businessName?: string | null,
): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return { sent: false, reason: "unconfigured" }

  const from = process.env.RESEND_FROM || "Reficio <noreply@resend.dev>"
  const business = businessName?.trim() || "Reficio"
  const html = `
    <div style="font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:24px">
      <h2 style="margin:0 0 8px">Verifica tu correo</h2>
      <p style="color:#444;margin:0 0 16px">
        ${escapeHtml(business)}: usa este código para confirmar tu correo en Reficio.
        Expira en 15 minutos.
      </p>
      <p style="font-size:36px;font-weight:700;letter-spacing:8px;text-align:center;
                background:#f4f4f5;border-radius:12px;padding:18px 0;margin:0 0 16px">
        ${escapeHtml(code)}
      </p>
      <p style="color:#888;font-size:12px;margin:0">
        Si no creaste esta cuenta, ignora este mensaje.
      </p>
    </div>`

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [email],
        subject: "Tu código de verificación",
        html,
      }),
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => "")
      console.error(`[mailer] Resend respondió ${res.status}: ${detail.slice(0, 300)}`)
      return { sent: false, reason: "failed" }
    }
    return { sent: true }
  } catch (error) {
    console.error("[mailer] Error llamando a Resend:", error)
    return { sent: false, reason: "failed" }
  }
}

/**
 * Correo de bienvenida para un dueño que acaba de activar su cuenta al
 * verificar su contacto (PENDING+ADMIN → APPROVED). Misma garantía que
 * sendVerificationEmail: nunca lanza; sin API key devuelve unconfigured.
 */
export async function sendWelcomeEmail(
  to: string,
  businessName?: string | null,
  slug?: string | null,
): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return { sent: false, reason: "unconfigured" }

  const from = process.env.RESEND_FROM || "Reficio <noreply@resend.dev>"
  const business = businessName?.trim() || "Tu negocio"
  const loginUrl = "https://reficio.app/login"
  const safeSlug = slug?.trim()
  const pageUrl = `https://reficio.app/${safeSlug}`
  const marketUrl = `https://reficio.app/${safeSlug}/market`
  const linksHtml = safeSlug
    ? `
      <p style="color:#444;margin:0 0 4px">Tu página pública:</p>
      <p style="margin:0 0 12px"><a href="${escapeHtml(pageUrl)}" style="color:#2563eb">${escapeHtml(pageUrl)}</a></p>
      <p style="color:#444;margin:0 0 4px">Tu catálogo en el mercado:</p>
      <p style="margin:0 0 16px"><a href="${escapeHtml(marketUrl)}" style="color:#2563eb">${escapeHtml(marketUrl)}</a></p>`
    : ""
  const html = `
    <div style="font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:24px">
      <h2 style="margin:0 0 8px">¡Bienvenido a Reficio!</h2>
      <p style="color:#444;margin:0 0 16px">
        ${escapeHtml(business)} quedó activo. Ya puedes entrar a tu panel,
        cargar tu catálogo y compartir tu página pública.
      </p>
      <p style="margin:0 0 16px">
        <a href="${loginUrl}" style="display:inline-block;background:#18181b;color:#fff;
           text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600">
          Entrar a mi cuenta
        </a>
      </p>
      ${linksHtml}
      <p style="color:#888;font-size:12px;margin:0">
        Si no creaste esta cuenta, ignora este mensaje.
      </p>
    </div>`

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject: "Tu cuenta de Reficio está lista",
        html,
      }),
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => "")
      console.error(`[mailer] Resend respondió ${res.status}: ${detail.slice(0, 300)}`)
      return { sent: false, reason: "failed" }
    }
    return { sent: true }
  } catch (error) {
    console.error("[mailer] Error llamando a Resend:", error)
    return { sent: false, reason: "failed" }
  }
}
