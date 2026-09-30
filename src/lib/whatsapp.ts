/**
 * Links de WhatsApp (wa.me) para avisar al cliente desde el panel.
 * wa.me exige solo dígitos con código de país; los teléfonos locales
 * de 10 dígitos se asumen México (+52), mismo criterio que el resto
 * del repo (clientes, taller, cobranza, solicitudes del mercado).
 */

/** Dígitos del teléfono en formato internacional; "" si no hay número usable. */
export function waPhoneIntl(phone: string | null | undefined): string {
    const digits = (phone ?? "").replace(/\D/g, "")
    return digits.length === 10 ? `52${digits}` : digits
}

/** true cuando el teléfono tiene al menos un dígito usable para wa.me. */
export function hasWhatsAppPhone(phone: string | null | undefined): boolean {
    return waPhoneIntl(phone).length > 0
}

/**
 * URL wa.me con el mensaje precargado. Sin teléfono queda wa.me/?text=…
 * (WhatsApp deja elegir el contacto); los botones de aviso solo se
 * muestran cuando hasWhatsAppPhone(phone) es true.
 */
export function waLink(phone: string | null | undefined, message: string): string {
    const intl = waPhoneIntl(phone)
    const base = intl ? `https://wa.me/${intl}` : "https://wa.me/"
    return `${base}?text=${encodeURIComponent(message)}`
}

/** Abre la conversación en una pestaña nueva (para handlers de clic). */
export function openWhatsApp(phone: string | null | undefined, message: string): void {
    window.open(waLink(phone, message), "_blank", "noopener,noreferrer")
}
