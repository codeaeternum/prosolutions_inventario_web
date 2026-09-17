import type { Prisma, PrismaClient } from "@prisma/client"
import { normalizePhone } from "../utils"

/**
 * Liga una orden de taller al cliente del directorio (role CUSTOMER del mismo
 * negocio) cuyo teléfono normalizado coincida con el capturado en recepción.
 *
 * Los teléfonos se guardan tal como los escribió cada canal: User.phone es
 * único en crudo, no en forma normalizada, así que "+52 811..." y "811..."
 * pueden existir como cuentas distintas. La comparación se hace en memoria
 * sobre los customers con teléfono del tenant — volumen de piloto.
 *
 * Ambigüedad: si varias cuentas comparten el número normalizado se liga a la
 * MÁS ANTIGUA (createdAt asc) — casi siempre son duplicados del mismo cliente
 * por formato y la original suele ser la cuenta principal; además el resultado
 * es determinista. La vista 360 sigue mostrando las órdenes por teléfono en
 * todas las cuentas empatadas.
 *
 * Devuelve el userId para RepairOrder.customerId, o null cuando el número es
 * demasiado corto (<7 dígitos, no confiable para empalme) o no hay candidato.
 */
export async function linkCustomerByPhone(
  db: PrismaClient | Prisma.TransactionClient,
  businessId: string,
  phone: string | null | undefined,
): Promise<string | null> {
  const normalized = normalizePhone(phone)
  if (normalized.length < 7) return null
  const candidates = await db.user.findMany({
    where: { businessId, role: "CUSTOMER", phone: { not: null } },
    select: { id: true, phone: true },
    orderBy: { createdAt: "asc" },
  })
  const match = candidates.find((u) => normalizePhone(u.phone) === normalized)
  return match?.id ?? null
}
