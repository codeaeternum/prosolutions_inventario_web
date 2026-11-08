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

/** Máximo de caracteres de un mensaje de Telegram (texto o caption de foto). */
export const TG_MESSAGE_MAX = 4096

/**
 * Recorta un mensaje al máximo de Telegram terminando en '…' si hubo truncado.
 * Para listados que crecen con datos de BD (nombres de hasta ~200 chars):
 * sin el recorte, sendMessage devuelve 400 "message is too long" y el aviso
 * se pierde en silencio.
 */
export function clipMessage(text: string, max = TG_MESSAGE_MAX): string {
    if (text.length <= max) return text
    return `${text.slice(0, max - 1)}…`
}
