import type { Telegraf } from "telegraf"
import type { WizardState } from "./start"

export interface AdminProductState {
  step: "NAME" | "CATEGORY" | "COST_PRICE" | "PRICE_RETAIL" | "PRICE_WHOLESALE" | "STOCK" | "PHOTO"
  data: {
    name?: string
    categoryId?: string
    costPrice?: number
    retailPrice?: number
    wholesalePrice?: number
    stock?: number
    imageUrl?: string
  }
}

export interface ReservationState {
  productId: string
  productName: string
  price: number
  maxStock: number
  quantity?: number
  step?: "QUANTITY" | "PAYMENT_METHOD" | "PROOF_UPLOAD"
}

/** Sesiones opcionales que /cancelar también limpia (eliminar, venta, carrito, qr, ajustes). */
export type ExtraSessions = Record<string, unknown>

export function registerCancelar(
  bot: Telegraf,
  sessions: {
    registration: Record<string, WizardState>
    adminProduct: Record<string, AdminProductState>
    reservation: Record<string, ReservationState>
  } & { deleteProduct?: ExtraSessions; sale?: ExtraSessions; cart?: ExtraSessions; qr?: ExtraSessions; settings?: ExtraSessions }
) {
  bot.command("cancelar", async (ctx) => {
    const telegramId = ctx.from.id.toString()
    let cancelled = false

    const maps = [
      sessions.registration,
      sessions.adminProduct,
      sessions.reservation,
      sessions.deleteProduct,
      sessions.sale,
      sessions.cart,
      sessions.qr,
      sessions.settings
    ].filter(Boolean) as Record<string, unknown>[]

    for (const map of maps) {
      if (map[telegramId]) {
        delete map[telegramId]
        cancelled = true
      }
    }

    if (cancelled) {
      await ctx.reply("✅ Proceso cancelado.\n\nEscribe /ayuda para ver los comandos disponibles.")
    } else {
      await ctx.reply("ℹ️ No hay ningún proceso activo que cancelar.")
    }
  })
}
