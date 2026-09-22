import { randomUUID } from "node:crypto"
import { prisma } from "@/lib/prisma"

// Estado de cuenta público del cliente (/cuenta/<token>). El token es la
// frontera de seguridad: quien lo tiene ve el saldo — nunca se aceptan
// businessId/userId por query. Mismo patrón que workshop-tokens.ts.

/**
 * Vigencia del link: 30 días. Es una vista viva (el cliente vuelve a abrirla
 * tras cada abono o apartado nuevo), así que dura más que la cotización (15
 * días) pero sigue caducando: un WhatsApp viejo no es una puerta trasera
 * permanente. Reenviar el link rota el token y mata el anterior.
 */
export const STATEMENT_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000

/** Movimientos de crédito que se publican (los más recientes). */
export const STATEMENT_MOVEMENTS_LIMIT = 30
/** Apartados abiertos que se publican como máximo. */
export const STATEMENT_LAYAWAYS_LIMIT = 20

export function newStatementToken(): string {
  return randomUUID()
}

/**
 * Rotación: revoca el link anterior (los reenvíos viejos mueren) y emite uno
 * nuevo con vigencia completa. Se usa en cada "Compartir estado de cuenta".
 */
export function rotatedStatementToken(now = new Date()) {
  return {
    statementToken: newStatementToken(),
    statementTokenExpiresAt: new Date(now.getTime() + STATEMENT_TOKEN_TTL_MS),
  }
}

/**
 * Caducidad: NULL = token histórico sin vigencia y sigue válido — la
 * caducidad solo corre para tokens emitidos con statementTokenExpiresAt.
 */
export function statementExpired(expiresAt: Date | null): boolean {
  return expiresAt !== null && expiresAt.getTime() < Date.now()
}

/* ---------- Payload público ----------

 * Lo ÚNICO que el enlace expone. La selección se hace campo a campo (nunca
 * se serializa la fila de Prisma): sin businessId, ids internos, email,
 * teléfono, costos ni datos de otros clientes. */
export interface PublicStatementMovement {
  type: "DEBT" | "PAYMENT" | "REVERSAL"
  amount: number
  note: string | null
  createdAt: Date
}

export interface PublicStatementLayaway {
  number: number
  folio: string
  total: number
  paid: number
  balance: number
  expiresAt: Date | null
  createdAt: Date
}

export interface PublicStatement {
  businessName: string
  customerName: string
  creditBalance: number
  creditLimit: number | null
  movements: PublicStatementMovement[]
  layaways: PublicStatementLayaway[]
}

export type StatementResult =
  | { kind: "not_found" }
  | { kind: "expired" }
  | { kind: "ok"; statement: PublicStatement; expiresAt: Date | null }

/** Folio de mostrador, igual que la ficha 360 (V-000123). */
function saleFolio(number: number): string {
  return `V-${String(number).padStart(6, "0")}`
}

/**
 * Carga el estado de cuenta por su statementToken. Compartido por la API
 * pública (/api/cuenta/[token]) y la página /cuenta/[token], para que ambas
 * apliquen exactamente la misma selección de campos y reglas de vigencia.
 *
 * "not_found" también cubre negocio suspendido: el enlace muere igual que un
 * token inválido y no revela si el token existe.
 */
export async function loadStatementByToken(token: string): Promise<StatementResult> {
  const user = await prisma.user.findUnique({
    where: { statementToken: token },
    select: {
      id: true,
      name: true,
      creditBalance: true,
      creditLimit: true,
      statementTokenExpiresAt: true,
      business: { select: { name: true, isActive: true } },
    },
  })
  if (!user || !user.business.isActive) return { kind: "not_found" }
  if (statementExpired(user.statementTokenExpiresAt)) return { kind: "expired" }

  const [movements, layaways] = await Promise.all([
    prisma.creditMovement.findMany({
      where: { userId: user.id },
      select: { type: true, amount: true, notes: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: STATEMENT_MOVEMENTS_LIMIT,
    }),
    // Apartados de mostrador vivos: stock comprometido con saldo por liquidar.
    // pagado = suma de pagos CONFIRMED (mismo criterio que la ficha 360).
    prisma.sale.findMany({
      where: { customerId: user.id, kind: "LAYAWAY", status: "OPEN" },
      select: {
        number: true,
        total: true,
        expiresAt: true,
        createdAt: true,
        payments: { where: { status: "CONFIRMED" }, select: { amount: true } },
      },
      orderBy: { createdAt: "desc" },
      take: STATEMENT_LAYAWAYS_LIMIT,
    }),
  ])

  return {
    kind: "ok",
    expiresAt: user.statementTokenExpiresAt,
    statement: {
      businessName: user.business.name,
      customerName: user.name,
      creditBalance: user.creditBalance,
      creditLimit: user.creditLimit,
      movements: movements.map((mov) => ({
        type: mov.type,
        amount: mov.amount,
        note: mov.notes,
        createdAt: mov.createdAt,
      })),
      layaways: layaways.map(({ payments, ...sale }) => {
        const paid = payments.reduce((sum, p) => sum + p.amount, 0)
        return {
          number: sale.number,
          folio: saleFolio(sale.number),
          total: sale.total,
          paid,
          balance: Math.max(0, sale.total - paid),
          expiresAt: sale.expiresAt,
          createdAt: sale.createdAt,
        }
      }),
    },
  }
}
