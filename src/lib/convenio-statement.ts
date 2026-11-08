import { csvCell } from "./csv"

/**
 * Estado de cuenta del convenio para UN aliado captador (lado porCobrar):
 * el documento que se le entrega a fin de mes con lo que debe por las
 * órdenes que trajo. Divide las cuentas en tres grupos:
 *  - pendiente: exigible y sin saldar — es lo que se cobra;
 *  - proceso:   el trabajo aún no llega a estado exigible — solo referencia
 *    para que el aliado sepa que esos cargos vienen en camino;
 *  - saldada:   ya pagada — historial del periodo.
 * Puro: la vista imprimible (cuentas-panel) y la exportación CSV comparten
 * este armado para que ambos muestren exactamente lo mismo.
 */

/** Subconjunto de la fila porCobrar del reporte (CobrarRow en el panel). */
export interface ConvenioStatementSourceRow {
  folio: string
  createdAt: string | Date
  chargeableAt: string | Date | null
  daysPending: number | null
  partnerPriceCents: number | null
  convenioSettledAt: string | Date | null
  convenioSettledAmountCents: number | null
  chargeable: boolean
  /** Estado del trabajo (RepairStatus) — se muestra como referencia en las
   *  cuentas aún no exigibles. */
  status?: string | null
}

export type ConvenioStatementStatus = "pendiente" | "proceso" | "saldada"

export const CONVENIO_STATEMENT_STATUS_LABELS: Record<ConvenioStatementStatus, string> = {
  pendiente: "Pendiente",
  proceso: "En proceso",
  saldada: "Saldada",
}

export interface ConvenioStatementEntry {
  folio: string
  /** Fecha de recepción de la orden (ISO). */
  receivedAt: string
  /** Cuándo se volvió exigible (ISO); null si aún no. */
  chargeableAt: string | null
  /** Días desde que es exigible — null cuando no hay dato de antigüedad. */
  daysPending: number | null
  /** Monto a cobrar: el congelado al liquidar en saldadas, el precio
   *  convenio vigente en el resto. null = sin precio convenio. */
  amountCents: number | null
  settledAt: string | null
  repairStatus: string | null
  status: ConvenioStatementStatus
}

export interface ConvenioStatement {
  allyName: string
  /** Fecha de emisión del documento (ISO). */
  issuedAt: string
  pending: ConvenioStatementEntry[]
  inProcess: ConvenioStatementEntry[]
  settled: ConvenioStatementEntry[]
  /** Suma de lo exigible sin saldar (las "proceso" no son deuda aún). */
  totalPendingCents: number
  /** Pendientes sin precio convenio: hay que pactar el monto antes de cobrar. */
  unpricedPending: number
  totalSettledCents: number
}

const toIso = (value: string | Date | null | undefined): string | null =>
  value == null ? null : new Date(value).toISOString()

export function buildConvenioStatement(
  rows: ConvenioStatementSourceRow[],
  allyName: string,
  issuedAt: Date = new Date(),
): ConvenioStatement {
  const pending: ConvenioStatementEntry[] = []
  const inProcess: ConvenioStatementEntry[] = []
  const settled: ConvenioStatementEntry[] = []
  for (const row of rows) {
    const settledAt = toIso(row.convenioSettledAt)
    const status: ConvenioStatementStatus = settledAt ? "saldada" : row.chargeable ? "pendiente" : "proceso"
    const entry: ConvenioStatementEntry = {
      folio: row.folio,
      receivedAt: toIso(row.createdAt) ?? "",
      chargeableAt: toIso(row.chargeableAt),
      daysPending: row.daysPending,
      // En la saldada manda el monto congelado al liquidar (snapshot): si el
      // precio convenio cambió después, el estado de cuenta no se reescribe.
      amountCents: settledAt ? row.convenioSettledAmountCents ?? row.partnerPriceCents : row.partnerPriceCents,
      settledAt,
      repairStatus: row.status ?? null,
      status,
    }
    if (status === "pendiente") pending.push(entry)
    else if (status === "saldada") settled.push(entry)
    else inProcess.push(entry)
  }
  // Pendientes: primero la más vieja (mayor antigüedad arriba), igual que el
  // panel. En proceso y saldadas: lo más reciente primero.
  pending.sort((a, b) => (b.daysPending ?? -1) - (a.daysPending ?? -1))
  inProcess.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
  settled.sort((a, b) => (b.settledAt ?? "").localeCompare(a.settledAt ?? ""))

  let totalPendingCents = 0, totalSettledCents = 0, unpricedPending = 0
  for (const entry of pending) {
    if (entry.amountCents == null) unpricedPending += 1
    else totalPendingCents += entry.amountCents
  }
  for (const entry of settled) totalSettledCents += entry.amountCents ?? 0

  return {
    allyName,
    issuedAt: issuedAt.toISOString(),
    pending, inProcess, settled,
    totalPendingCents, unpricedPending, totalSettledCents,
  }
}

/* ---------- CSV ---------- */

export const CONVENIO_STATEMENT_CSV_HEADERS = ["Folio", "Recibida", "Exigible", "Días", "Monto", "Estado"] as const

const csvDay = (iso: string | null) => (iso ? iso.slice(0, 10) : "")
const csvAmount = (cents: number | null) => (cents == null ? "" : (cents / 100).toFixed(2))

/**
 * Contenido del archivo CSV (texto completo, con BOM para que Excel abra el
 * UTF-8 sin mojibake). Columnas: folio, recibida, exigible, días, monto y
 * estado; las fechas van ISO para que Excel las reconozca como fecha y el
 * monto en pesos con dos decimales. Cierra con renglones de totales.
 */
export function convenioStatementCsv(statement: ConvenioStatement): string {
  const lines = [CONVENIO_STATEMENT_CSV_HEADERS.map(csvCell).join(",")]
  const rowOf = (entry: ConvenioStatementEntry) =>
    [
      entry.folio,
      csvDay(entry.receivedAt),
      csvDay(entry.chargeableAt),
      // Los días de antigüedad solo aplican a la deuda pendiente exigible.
      entry.status === "pendiente" && entry.daysPending != null ? entry.daysPending : "",
      csvAmount(entry.amountCents),
      CONVENIO_STATEMENT_STATUS_LABELS[entry.status],
    ]
  for (const entry of [...statement.pending, ...statement.inProcess, ...statement.settled]) {
    lines.push(rowOf(entry).map(csvCell).join(","))
  }
  lines.push(["Total pendiente", "", "", "", csvAmount(statement.totalPendingCents), ""].map(csvCell).join(","))
  if (statement.settled.length > 0) {
    lines.push(["Total saldado", "", "", "", csvAmount(statement.totalSettledCents), ""].map(csvCell).join(","))
  }
  return "\uFEFF" + lines.join("\r\n")
}

/** `estado-cuenta-telcel-centro-2026-01-31.csv` — el nombre ya dice quién debe. */
export function convenioStatementFileName(allyName: string, date: Date = new Date()): string {
  const slug = allyName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // marcas combinantes (acentos)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return `estado-cuenta-${slug || "aliado"}-${date.toISOString().slice(0, 10)}.csv`
}

/* ---------- Vida del panel tras liquidar ---------- */

/**
 * Cuentas saldadas dentro de la ventana (default 30 días): alimenta el aviso
 * "todo al corriente — N saldadas recientemente" para que el panel no se vea
 * muerto después de liquidar toda la cartera del aliado.
 */
export function countSettledWithin(
  rows: { convenioSettledAt: string | Date | null }[],
  days = 30,
  now = Date.now(),
): number {
  const windowMs = days * 24 * 60 * 60 * 1000
  let count = 0
  for (const row of rows) {
    if (!row.convenioSettledAt) continue
    const at = new Date(row.convenioSettledAt).getTime()
    // Una fecha futura (dato raro) también cuenta como "reciente".
    if (Number.isFinite(at) && now - at <= windowMs) count += 1
  }
  return count
}
