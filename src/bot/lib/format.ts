/**
 * Helpers de formato/escape para mensajes de Telegram — ÚNICA fuente del bot.
 *
 * Regla: todo dato de BD o input de usuario interpolado en un mensaje con
 * parse_mode debe pasar por el escaper de ESE parse_mode
 * ('Markdown' → escapeMarkdownV1, 'HTML' → escapeHtml). Nunca escapar los
 * literales de formato propios del mensaje (*bold*, <b>…), solo las variables.
 */

/**
 * Escapa los metacaracteres del parser "Markdown" legacy de Telegram
 * (Telegraf parse_mode: 'Markdown'): * _ ` [
 */
export function escapeMarkdownV1(text?: string | null): string {
    return (text ?? '').replace(/([*_`\[])/g, '\\$1')
}

/** Alias de compatibilidad: las copias locales previas se llamaban escapeMarkdown. */
export const escapeMarkdown = escapeMarkdownV1

/**
 * Escapa entidades para parse_mode: 'HTML' (& < > " ').
 */
export function escapeHtml(value: unknown): string {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
}

/**
 * Escapa un literal antes de interpolarlo en `new RegExp(...)`: sin esto,
 * un input como "a(" o "x.*" rompe la expresión o altera el patrón
 * (regex injection).
 */
export function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
