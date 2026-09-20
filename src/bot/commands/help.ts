import type { Telegraf } from "telegraf"
import { isAdmin } from "../lib/notify"
import { getPrisma } from "../lib/prisma"

export function registerHelp(bot: Telegraf) {
  const prisma = getPrisma()

  bot.help(async (ctx) => {
    const telegramId = ctx.from.id.toString()
    const userIsAdmin = await isAdmin(telegramId)

    let msg = `📋 *Ayuda — ProSolutions*

🔍 Escribe el nombre de un producto para buscar.
   Ej: Pantalla iPhone 15

/comandos:
/start - Reiniciar
/perfil - Tu perfil y código QR
/categorias - Catálogo por categoría
/ofertas - Productos destacados
/miid - Tu ID de Telegram

¿Necesitas algo más? Responde con tu búsqueda.`

    if (userIsAdmin) {
      msg += `\n\n---\n👑 *Comandos de administración*\n/admin - Ver todos los comandos admin\n/orden - Nueva orden de reparación\n/vender <producto> - Venta rápida\n/carrito - Ver carrito · /agregarc · /confirmarc\n/qr <producto> - Código QR\n/pendientes - Reservas pendientes\n/agregar - Nuevo producto\n\n/cancelar - Sale de cualquier proceso`
    }

    return ctx.reply(msg, { parse_mode: "Markdown" })
  })

  // Añadir alias de ayuda
  bot.command('ayuda', async (ctx) => {
    const telegramId = ctx.from.id.toString()
    const userIsAdmin = await isAdmin(telegramId)

    let msg = `📋 *Ayuda — ProSolutions*

🔍 Escribe el nombre de un producto para buscar.
   Ej: Pantalla iPhone 15

/comandos:
/start - Reiniciar
/perfil - Tu perfil y código QR
/categorias - Catálogo por categoría
/ofertas - Productos destacados
/miid - Tu ID de Telegram

¿Necesitas algo más? Responde con tu búsqueda.`

    if (userIsAdmin) {
      msg += `\n\n---\n👑 *Comandos de administración*\n/admin - Ver todos los comandos admin\n/orden - Nueva orden de reparación\n/vender <producto> - Venta rápida\n/carrito - Ver carrito · /agregarc · /confirmarc\n/qr <producto> - Código QR\n/pendientes - Reservas pendientes\n/agregar - Nuevo producto\n\n/cancelar - Sale de cualquier proceso`
    }

    return ctx.reply(msg, { parse_mode: "Markdown" })
  })
}
