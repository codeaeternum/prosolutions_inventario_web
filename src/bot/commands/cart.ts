import { sell } from "../../lib/domain/sales"
import { Markup } from 'telegraf'
import { CART_MAX_ITEMS } from '../lib/types'
import type { BotContext, CartItem } from '../lib/types'
import { getBotAccount, requireAdmin, requireAdminAccount, requirePrisma } from '../lib/guards'
import { clipMessage, escapeMarkdownV1 } from '../lib/format'

export function registerCart({ bot, prisma, sessions }: BotContext) {
    // /carrito
    bot.command('carrito', async (ctx) => {
        const telegramId = ctx.from.id.toString()
        if (!(await requireAdmin(ctx))) return

        const cart = sessions.cart[telegramId]
        if (!cart || cart.items.length === 0) {
            return ctx.reply(`🛒 *Carrito vacío*

Usa /agregarc <producto> para agregar productos.

Ejemplo:
/agregarc pantalla iphone 14`, { parse_mode: 'Markdown' })
        }

        const itemsList = cart.items.map((item: CartItem, i: number) =>
            `${i + 1}. *${escapeMarkdownV1(item.name)}*\n   📦 ${item.quantity} × $${item.price.toLocaleString()} = $${(item.quantity * item.price).toLocaleString()}`
        ).join('\n\n')

        const total = cart.items.reduce((sum: number, item: CartItem) => sum + item.quantity * item.price, 0)
        const totalItems = cart.items.reduce((sum: number, item: CartItem) => sum + item.quantity, 0)

        // clipMessage: 30 items × nombres largos pueden rozar los 4096 chars.
        await ctx.reply(clipMessage(`🛒 *Tu Carrito* (${totalItems} productos)

${itemsList}

━━━━━━━━━━━━━━━━━━
💰 *TOTAL: $${total.toLocaleString()}*

/confirmarc - Confirmar venta
/vaciarc - Vaciar carrito
/agregarc <producto> - Agregar más`), { parse_mode: 'Markdown' })
    })

    // /agregarc
    bot.command('agregarc', async (ctx) => {
        const telegramId = ctx.from.id.toString()
        if (!(await requirePrisma(ctx))) return
        // Un solo findUnique para gate + tenant (antes requireAdmin y
        // getBotAccount hacían un lookup cada uno de la misma fila).
        const actor = await requireAdminAccount(ctx, prisma)
        if (!actor) return

        // Tope de items: sin él el carrito crecía sin límite en memoria y el
        // listado podía pasar de 4096. Se revisa ANTES de buscar producto:
        // el usuario ya sabe que no cabe nada más.
        const existingCart = sessions.cart[telegramId]
        if (existingCart && existingCart.items.length >= CART_MAX_ITEMS) {
            return ctx.reply(`🛒 *Carrito lleno* (máx. ${CART_MAX_ITEMS} productos distintos)

Confirma la venta con /confirmarc o vacía con /vaciarc antes de agregar más.`, { parse_mode: 'Markdown' })
        }

        const args = ctx.message.text.split(' ').slice(1).join(' ').trim()

        if (!args) {
            return ctx.reply(`➕ *Agregar al Carrito*

Uso: /agregarc <producto>

Ejemplo:
/agregarc pantalla iphone 14
/agregarc bateria samsung

Después indica la cantidad.`, { parse_mode: 'Markdown' })
        }

        try {
            const products = await prisma.product.findMany({
                where: {
                    businessId: actor.businessId,
                    OR: [
                        { name: { contains: args, mode: 'insensitive' } },
                        { barcode: args }
                    ],
                    stock: { gt: 0 }
                },
                take: 5,
                select: { id: true, name: true, stock: true, retailPrice: true }
            })

            if (products.length === 0) {
                return ctx.reply(`❌ No se encontraron productos con stock para: "${args}"`)
            }

            if (!sessions.cart[telegramId]) {
                sessions.cart[telegramId] = { items: [] }
            }

            if (products.length === 1) {
                const p = products[0]
                sessions.cart[telegramId].selecting = undefined
                sessions.cart[telegramId].pendingAdd = { id: p.id, name: p.name, price: p.retailPrice, stock: p.stock }
                return ctx.reply(`📦 *${escapeMarkdownV1(products[0].name)}*

📊 Stock: ${products[0].stock} unidades
💰 Precio: $${products[0].retailPrice.toLocaleString()}

¿Cuántas unidades agregar? (escribe un número)`, { parse_mode: 'Markdown' })
            }

            // Multi-match: paso propio del carrito (sessions.cart.selecting).
            // Antes se reutilizaba sessions.sale[SELECT_PRODUCT] y el número
            // que elegía el producto lo procesaba el hears de sales.ts como
            // VENTA — descontaba stock sin pasar por el carrito.
            sessions.cart[telegramId].pendingAdd = undefined
            sessions.cart[telegramId].selecting = products

            const productList = products.map((p: { name: string; stock: number; retailPrice: number }, i: number) =>
                `${i + 1}. *${escapeMarkdownV1(p.name)}*\n   Stock: ${p.stock} | $${p.retailPrice.toLocaleString()}`
            ).join('\n\n')

            await ctx.reply(`📦 *Productos encontrados:*

${productList}

Responde con el número (1-${products.length}) para seleccionar`, { parse_mode: 'Markdown' })

        } catch (e) {
            console.error('Error in /agregarc:', e)
            await ctx.reply('❌ Error al buscar productos.')
        }
    })

    // /confirmarc
    bot.command('confirmarc', async (ctx) => {
        const telegramId = ctx.from.id.toString()
        if (!(await requireAdmin(ctx))) return
        if (!(await requirePrisma(ctx))) return

        const cart = sessions.cart[telegramId]
        if (!cart || cart.items.length === 0) {
            return ctx.reply('🛒 El carrito está vacío. Usa /agregarc <producto> para agregar o /cancelar.')
        }

        const total = cart.items.reduce((sum: number, item: CartItem) => sum + item.quantity * item.price, 0)
        const totalItems = cart.items.reduce((sum: number, item: CartItem) => sum + item.quantity, 0)
        const productCount = cart.items.length

        return ctx.reply(`🛒 *Confirmar venta de carrito*

Vas a registrar la venta de:
📦 ${productCount} producto(s)
🔢 ${totalItems} unidades totales
💰 Total: *$${total.toLocaleString()}*

¿Confirmar?`, {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('✅ Confirmar', 'confirm_cart')],
                [Markup.button.callback('❌ Cancelar', 'cancel_sale')]
            ])
        })
    })

    // confirm_cart action
    bot.action('confirm_cart', async (ctx) => {
        const telegramId = ctx.from!.id.toString()

        try {
            // Un solo lookup: rol + cuenta en la misma fila. Negar vía
            // answerCbQuery (no ctx.reply): el toast frena el spinner del botón.
            const adminUser = await getBotAccount(prisma, telegramId)
            if (!adminUser || adminUser.role !== 'ADMIN' || adminUser.status !== 'APPROVED') {
                await ctx.answerCbQuery('⛔ Solo administradores.')
                return
            }

            const cart = sessions.cart[telegramId]
            if (!cart || cart.items.length === 0) {
                await ctx.answerCbQuery('Carrito vacío')
                return ctx.editMessageText('🛒 El carrito está vacío.')
            }

            const result = await sell(prisma, adminUser.id, adminUser.businessId, {
                idempotencyKey: `bot-cart:${telegramId}:${ctx.callbackQuery.message?.message_id ?? ctx.update.update_id}`,
                items: cart.items.map(item => ({ productId: item.id, quantity: item.quantity })), paymentMethod: 'EFECTIVO',
            })
            const total = result.total
            const totalItems = cart.items.reduce((sum: number, item: CartItem) => sum + item.quantity, 0)
            const productCount = cart.items.length

            delete sessions.cart[telegramId]

            // El toast es cosmético: si falla la red ahí, la venta YA quedó
            // registrada — no debe caer al catch y mostrar "Error" al usuario.
            await ctx.answerCbQuery('Venta registrada').catch(() => { })
            await ctx.editMessageText(`✅ *¡Venta Registrada!*

🛒 ${productCount} producto(s)
🔢 ${totalItems} unidades totales
💰 Total: *$${total.toLocaleString()}*

El inventario ha sido actualizado.`, { parse_mode: 'Markdown' })

        } catch (e) {
            console.error('Error confirming cart:', e)
            await ctx.answerCbQuery('Error').catch(() => { })
            await ctx.editMessageText(`❌ Error: ${e instanceof Error ? e.message : 'Error al procesar venta'}`).catch(() => { })
        }
    })

    // /vaciarc
    bot.command('vaciarc', async (ctx) => {
        const telegramId = ctx.from.id.toString()
        if (!(await requireAdmin(ctx))) return

        const cart = sessions.cart[telegramId]
        if (!cart || cart.items.length === 0) {
            return ctx.reply('🛒 El carrito ya está vacío.')
        }

        delete sessions.cart[telegramId]
        await ctx.reply('🗑️ Carrito vaciado.')
    })

    // addtocart action (from catalog) — el carrito es herramienta de venta
    // (admin); igual que fastsell_, el rol se revalida en el callback.
    bot.action(/^addtocart_(.+)$/, async (ctx) => {
        const telegramId = ctx.from.id.toString()
        const productId = ctx.match[1]

        try {
            // Un solo lookup: antes isAdmin y getBotAccount leían la misma fila.
            const actor = await getBotAccount(prisma, telegramId)
            if (!actor || actor.role !== 'ADMIN' || actor.status !== 'APPROVED') {
                return ctx.answerCbQuery('⛔ Solo administradores.')
            }
            const product = await prisma.product.findUnique({ where: { id: productId, businessId: actor.businessId } })
            if (!product) return ctx.answerCbQuery('❌ Error')

            if (!sessions.cart[telegramId]) {
                sessions.cart[telegramId] = { items: [] }
            }

            const cart = sessions.cart[telegramId]
            const existingIndex = cart.items.findIndex(p => p.id === productId)

            if (existingIndex >= 0) {
                if (cart.items[existingIndex].quantity + 1 > product.stock) {
                    return ctx.answerCbQuery('❌ Stock insuficiente')
                }
                cart.items[existingIndex].quantity += 1
            } else {
                if (product.stock < 1) return ctx.answerCbQuery('❌ Sin stock')
                if (cart.items.length >= CART_MAX_ITEMS) {
                    return ctx.answerCbQuery(`🛒 Carrito lleno (máx. ${CART_MAX_ITEMS}). Usa /confirmarc o /vaciarc.`)
                }
                cart.items.push({
                    id: product.id,
                    name: product.name,
                    quantity: 1,
                    price: product.retailPrice,
                    stock: product.stock
                })
            }

            await ctx.answerCbQuery('✅ Agregado al carrito')
            await ctx.reply(`🛒 ${product.name} agregado al carrito.\nUsa /carrito para ver.`)
        } catch (e) {
            console.error('Error in addtocart_:', e)
            await ctx.answerCbQuery('❌ Error al agregar al carrito').catch(() => { })
        }
    })
}
