import type { PrismaClient } from "@prisma/client"

/** Anti-spam: un producto bajo mínimo no vuelve a avisar hasta pasado este tiempo. */
const ALERT_COOLDOWN_MS = 24 * 60 * 60 * 1000

/** Junta productIds únicos desde filas que pueden no tener producto vinculado. */
export function collectLowStockIds(parts: { productId?: string | null }[]): string[] {
  return [...new Set(parts.map(part => part.productId).filter((id): id is string => typeof id === "string" && id.length > 0))]
}

// Telegram interpreta el mensaje como HTML (parse_mode HTML): un "<" o "&" en
// el nombre del producto invalidaría el envío, así que se escapan.
const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

/**
 * Revisa productos después de un movimiento de stock y emite el aviso de
 * "stock bajo" (SSE al staff + Telegram a los admins) cuando cruzan el mínimo.
 *
 * - stock <= minStock y sin aviso en las últimas 24 h → marca lowStockAlertAt y avisa.
 * - stock > minStock con aviso previo → limpia el flag: la próxima caída vuelve a avisar.
 * - Productos inactivos o ajenos al negocio se ignoran (filtro del findMany).
 *
 * DISEÑO: corre POST-COMMIT, fuera de la transacción del movimiento y con el
 * PrismaClient real — llamarla dentro del callback de operation() rompería la
 * atomicidad de la alerta. El flag se actualiza sin tx, así que una carrera
 * puede duplicar un aviso (aceptable) pero JAMÁS rompe la operación que la
 * disparó: cualquier fallo se registra con console.error y no se propaga.
 */
export async function syncLowStockAlerts(db: PrismaClient, businessId: string, productIds: string[]): Promise<void> {
  try {
    const ids = [...new Set(productIds.filter(id => typeof id === "string" && id.length > 0))]
    if (ids.length === 0) return

    const products = await db.product.findMany({
      where: { id: { in: ids }, businessId, isActive: true },
      select: { id: true, name: true, stock: true, minStock: true, lowStockAlertAt: true },
    })

    const now = new Date()
    const toNotify: typeof products = []
    for (const product of products) {
      if (product.stock <= product.minStock) {
        const elapsed = product.lowStockAlertAt === null
          ? Number.POSITIVE_INFINITY
          : now.getTime() - product.lowStockAlertAt.getTime()
        if (elapsed > ALERT_COOLDOWN_MS) {
          await db.product.update({ where: { id: product.id }, data: { lowStockAlertAt: now } })
          toNotify.push(product)
        }
      } else if (product.lowStockAlertAt !== null) {
        // Se repuso por encima del mínimo: rearma la alerta para la próxima caída.
        await db.product.update({ where: { id: product.id }, data: { lowStockAlertAt: null } })
      }
    }
    if (toNotify.length === 0) return

    const names = toNotify.map(product => product.name)
    const summary = names.length <= 10 ? names.join(", ") : `${names.slice(0, 10).join(", ")} y ${names.length - 10} más`
    try {
      // Import perezoso: el módulo del stream vive en una ruta (tira de
      // api-auth/next-auth) y solo debe cargarse cuando de verdad hay aviso —
      // un fallo aquí queda cubierto por el mismo best-effort.
      const { sendNotificationToStaff } = await import("@/app/api/notifications/stream/route")
      await sendNotificationToStaff({
        type: "low_stock",
        title: "Stock bajo",
        message: `${toNotify.length} producto(s) bajo mínimo: ${summary}`,
        data: { products: toNotify.map(({ id, name, stock, minStock }) => ({ id, name, stock, minStock })) },
      }, businessId)
    } catch (error) {
      console.error("[low-stock] aviso SSE falló:", error)
    }

    const lines = toNotify.map(product => `- ${escapeHtml(product.name)}: quedan ${product.stock} (mín ${product.minStock})`)
    try {
      // Igual que el SSE: lib/telegram tira de lib/prisma (exige DATABASE_URL
      // al importar), así que solo se carga cuando hay aviso que enviar.
      const { sendTelegramToUsers } = await import("./telegram")
      await sendTelegramToUsers(businessId, `⚠️ <b>Stock bajo</b>\n${lines.join("\n")}`, { role: "ADMIN" })
    } catch (error) {
      console.error("[low-stock] aviso Telegram falló:", error)
    }
  } catch (error) {
    // Best-effort total: ni la BD ni los canales de aviso pueden tumbar la
    // operación ya confirmada que disparó la revisión.
    console.error("[low-stock] syncLowStockAlerts falló:", error)
  }
}
