import type { Prisma, PrismaClient } from "@prisma/client"
import { normalizePhone } from "../utils"

/**
 * Liga una orden de taller al cliente del directorio (role CUSTOMER del mismo
 * negocio) cuyo teléfono normalizado coincida con el capturado en recepción.
 *
 * Los teléfonos se guardan tal como los escribió cada canal: User.phone es
 * único en crudo, no en forma normalizada, así que "+52 811..." y "811..."
 * pueden existir como cuentas distintas. La comparación corre en SQL sobre
 * User.phoneNormalized — columna espejo indexada (businessId, phoneNormalized)
 * que cada write-path de User.phone mantiene al día — ya no se barren todos
 * los customers del tenant dentro de la tx serializable.
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
  const match = await db.user.findFirst({
    where: { businessId, role: "CUSTOMER", phoneNormalized: normalized },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  })
  return match?.id ?? null
}
