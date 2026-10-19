/**
 * Celda CSV segura para las exportaciones: siempre va entre comillas con las
 * comillas internas duplicadas y neutraliza CSV-injection — Excel/Sheets
 * ejecutan como fórmula los valores que empiezan con = + - @, y un tab/CR
 * inicial también puede disparar contenido, así que esos valores se prefijan
 * con una comilla simple.
 */
export function csvCell(value: string | number | null | undefined): string {
  let text = value === null || value === undefined ? "" : String(value)
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return `"${text.replace(/"/g, '""')}"`
}
