import { sell } from "../../lib/domain/sales"
import { actor, BusinessError, transaction } from "../../lib/domain/operations"
import { Input, Markup } from 'telegraf'
import * as QRCode from 'qrcode'
import { CART_MAX_ITEMS } from '../lib/types'
import type { BotContext, CartItem } from '../lib/types'
import { getBotAccount, requireAdmin, requireAdminAccount, requirePrisma } from '../lib/guards'
import { notifyAdmins } from '../lib/notify'
import { clipMessage, escapeHtml, escapeMarkdownV1, TG_CAPTION_MAX } from '../lib/format'

export function registerSales({ bot, prisma, sessions, isDev }: BotContext) {
    // /vender
    bot.command('vender', async (ctx) => {
        const telegramId = ctx.from.id.toString()
        if (!(await requirePrisma(ctx))) return
        // Un solo findUnique para gate + tenant (antes requireAdmin y
        // getBotAccount leían la misma fila por separado).
        const actor = await requireAdminAccount(ctx, prisma)
        if (!actor) return

        const args = ctx.message.text.split(' ').slice(1).join(' ').trim()

        if (!args) {
            return ctx.reply(`🛒 *Venta Rápida*

Uso: /vender <nombre_producto>

Ejemplo:
/vender pantalla iphone 14
/vender bateria samsung

Luego eliges producto y cantidad.
_O usa /agregarc para vender varios en el carrito._`, { parse_mode: 'Markdown' })
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

            if (products.length === 1) {
                sessions.sale[telegramId] = {
                    step: 'CONFIRM',
                    selectedProduct: products[0],
                    quantity: 1
                }

                return ctx.reply(`📦 *${escapeMarkdownV1(products[0].name)}*

📊 Stock: ${products[0].stock} unidades
💰 Precio: $${products[0].retailPrice.toLocaleString()}

¿Cuántas unidades vender? (escribe un número o /cancelar)`, { parse_mode: 'Markdown' })
            }

            sessions.sale[telegramId] = { step: 'SELECT_PRODUCT', products }

            const productList = products.map((p: { name: string; stock: number; retailPrice: number }, i: number) =>
                `${i + 1}. *${escapeMarkdownV1(p.name)}*\n   Stock: ${p.stock} | $${p.retailPrice.toLocaleString()}`
            ).join('\n\n')

            await ctx.reply(`📦 *Productos encontrados:*

${productList}

Responde con el número (1-${products.length}) para seleccionar o /cancelar`, { parse_mode: 'Markdown' })

        } catch (e) {
            if (isDev) console.error('Error in /vender:', e)
            await ctx.reply('❌ Error al buscar productos. Usa /cancelar si estabas en otro proceso.')
        }
    })

    // cancel_sale action — el mismo botón "❌ Cancelar" acompaña la venta,
    // la confirmación de borrado y la selección de QR. Debe limpiar TODAS las
    // sesiones pendientes: antes solo borraba sessions.sale y un "SI" o número
    // posterior retomaba un deleteProduct en CONFIRM (archivaba el producto).
    bot.action('cancel_sale', async (ctx) => {
        const telegramId = ctx.from!.id.toString()
        delete sessions.sale[telegramId]
        delete sessions.deleteProduct[telegramId]
        delete sessions.qr[telegramId]
        const cart = sessions.cart[telegramId]
        if (cart) { cart.pendingAdd = undefined; cart.selecting = undefined }
        await ctx.answerCbQuery().catch(() => { })
        await ctx.editMessageText('❌ Operación cancelada.').catch(() => { })
    })

    // confirm_sale action
    bot.action(/^confirm_sale_(.+)_(\d+)$/, async (ctx) => {
        const telegramId = ctx.from!.id.toString()

        const productId = ctx.match[1]
        const number = parseInt(ctx.match[2])

        try {
            // Un solo lookup: rol + cuenta en la misma fila (getBotAccount ya
            // trae name para atribuir la venta en el aviso a otros admins).
            // Negar vía answerCbQuery: el toast frena el spinner del botón.
            const adminUser = await getBotAccount(prisma, telegramId)
            if (!adminUser || adminUser.role !== 'ADMIN' || adminUser.status !== 'APPROVED') {
                await ctx.answerCbQuery('⛔ Solo administradores.')
                return
            }

            const product = await prisma.product.findUnique({
                where: { id: productId, businessId: adminUser.businessId },
                select: { id: true, name: true, stock: true, retailPrice: true }
            })

            if (!product || product.stock < number) {
                delete sessions.sale[telegramId]
                await ctx.answerCbQuery('Stock insuficiente')
                return ctx.editMessageText('❌ Stock insuficiente.')
            }

            const result = await sell(prisma, adminUser.id, adminUser.businessId, {
                idempotencyKey: `bot-sale:${telegramId}:${ctx.callbackQuery.message?.message_id ?? ctx.update.update_id}`,
                items: [{ productId, quantity: number }], paymentMethod: 'EFECTIVO',
            })
            const total = result.total
            delete sessions.sale[telegramId]

            const successMsg = `✅ *¡Venta registrada!*

📦 ${escapeMarkdownV1(product.name)}
🔢 Cantidad: ${number}
💰 Total: $${total.toLocaleString()}
📊 Stock restante: ${product.stock - number}`

            // El toast es cosmético: si falla la red ahí, la venta YA quedó
            // registrada — no debe caer al catch y mostrar "Error" al usuario.
            await ctx.answerCbQuery('Venta confirmada').catch(() => { })
            await ctx.editMessageText(successMsg, { parse_mode: 'Markdown' })

            // notifyAdmins envía con parse_mode HTML: el aviso usa tags <b>
            // y escapeHtml — no el Markdown/escapeMarkdownV1 del successMsg.
            notifyAdmins(bot, adminUser.businessId, `📢 <b>Nueva Venta (Bot)</b>

👤 Por: ${escapeHtml(adminUser.name)}
✅ <b>¡Venta registrada!</b>

📦 ${escapeHtml(product.name)}
🔢 Cantidad: ${number}
💰 Total: $${total.toLocaleString()}
📊 Stock restante: ${product.stock - number}`).catch(() => {})

        } catch (e) {
            console.error('Error processing sale:', e)
            delete sessions.sale[telegramId]
            await ctx.answerCbQuery('Error').catch(() => { })
            await ctx.editMessageText(`❌ Error al procesar la venta.`).catch(() => { })
        }
    })

    // fastsell action (from catalog) — venta = operación de admin; el botón
    // solo se muestra a admins pero el rol pudo cambiar o el teclado ser viejo.
    bot.action(/^fastsell_(.+)$/, async (ctx) => {
        const telegramId = ctx.from.id.toString()
        const productId = ctx.match[1]

        try {
            // Un solo lookup: antes isAdmin y getBotAccount leían la misma fila.
            // El gate va ANTES del toast vacío: Telegram solo acepta una
            // respuesta por callback y la de "Solo administradores" es la que
            // cuenta en la negación.
            const actor = await getBotAccount(prisma, telegramId)
            if (!actor || actor.role !== 'ADMIN' || actor.status !== 'APPROVED') {
                return ctx.answerCbQuery('⛔ Solo administradores.').catch(() => { })
            }
            await ctx.answerCbQuery().catch(() => { })
            const product = await prisma.product.findUnique({
                where: { id: productId, businessId: actor.businessId },
                select: { id: true, name: true, stock: true, retailPrice: true }
            })
            if (!product || product.stock < 1) return ctx.reply('❌ Sin stock.')
            sessions.sale[telegramId] = {
                step: 'CONFIRM',
                selectedProduct: product,
                quantity: 1
            }

            await ctx.reply(`📦 *Venta Rápida: ${escapeMarkdownV1(product.name)}*

Precio: $${product.retailPrice}
Cantidad: 1

¿Confirmar venta? (Escribe SI)`, { parse_mode: 'Markdown' })
        } catch (e) {
            console.error('Error in fastsell_:', e)
            await ctx.reply('❌ Error al preparar la venta. Intenta de nuevo.').catch(() => { })
        }
    })

    // Number handler for sale sessions, QR, cart, delete
    bot.hears(/^\d+$/, async (ctx, next) => {
        const telegramId = ctx.from.id.toString()
        if (sessions.registration[telegramId]?.step === 'GOAL') {
            return next()
        }
        try {
            const number = parseInt(ctx.message.text)

            // QR session
            const qrSession = sessions.qr[telegramId]
            if (qrSession && qrSession.step === 'SELECT' && qrSession.products) {
                if (number < 1 || number > qrSession.products.length) {
                    return ctx.reply(`Ingresa un número entre 1 y ${qrSession.products.length}`)
                }
                const p = qrSession.products[number - 1]
                const qrData = p.barcode || p.id
                const qrBuffer = await QRCode.toBuffer(qrData)
                delete sessions.qr[telegramId]
                await ctx.replyWithPhoto(Input.fromBuffer(qrBuffer, 'qr.png'), {
                    caption: clipMessage(`📱 *${escapeMarkdownV1(p.name)}*\n\nCódigo: \`${qrData.replace(/`/g, '')}\``, TG_CAPTION_MAX),
                    parse_mode: 'Markdown'
                })
                return
            }

            // Cart pending add
            const cart = sessions.cart[telegramId]
            if (cart?.pendingAdd) {
                const pending = cart.pendingAdd
                if (number < 1 || number > pending.stock) {
                    return ctx.reply(`❌ Cantidad inválida. Stock disponible: ${pending.stock}`)
                }

                const existingIndex = cart.items.findIndex(item => item.id === pending.id)
                if (existingIndex >= 0) {
                    // El chequeo es contra el TOTAL acumulado: antes sumaba sin
                    // verificar y confirmarc podía reventar por stock insuficiente.
                    if (cart.items[existingIndex].quantity + number > pending.stock) {
                        return ctx.reply(`❌ Con eso serían ${cart.items[existingIndex].quantity + number} uds de ese producto y solo hay ${pending.stock} en stock.`)
                    }
                    cart.items[existingIndex].quantity += number
                } else {
                    // Tope de productos distintos: memoria y límite de 4096 del
                    // listado. Se libera pendingAdd para que el wizard no quede
                    // esperando otra cantidad que tampoco cabría.
                    if (cart.items.length >= CART_MAX_ITEMS) {
                        cart.pendingAdd = undefined
                        return ctx.reply(`🛒 El carrito ya tiene ${CART_MAX_ITEMS} productos distintos.

Confirma la venta con /confirmarc o vacía con /vaciarc antes de agregar más.`)
                    }
                    cart.items.push({
                        id: pending.id,
                        name: pending.name,
                        quantity: number,
                        price: pending.price,
                        stock: pending.stock
                    })
                }
                cart.pendingAdd = undefined

                const total = cart.items.reduce((sum: number, item: CartItem) => sum + item.quantity * item.price, 0)
                return ctx.reply(`✅ *Agregado al carrito*

    📦 ${escapeMarkdownV1(pending.name)} × ${number}
    💰 Subtotal: $${(pending.price * number).toLocaleString()}

    🛒 *Total carrito: $${total.toLocaleString()}*

    /carrito - Ver carrito
    /agregarc <producto> - Agregar más
    /confirmarc - Confirmar venta`, { parse_mode: 'Markdown' })
            }

            // Cart multi-select (de /agregarc con >1 coincidencia): el número elige
            // el producto y queda pendingAdd para la cantidad — nunca sale session.
            if (cart?.selecting?.length) {
                const options = cart.selecting
                if (number < 1 || number > options.length) {
                    return ctx.reply(`Ingresa un número entre 1 y ${options.length}`)
                }
                const chosen = options[number - 1]
                cart.selecting = undefined
                cart.pendingAdd = { id: chosen.id, name: chosen.name, price: chosen.retailPrice, stock: chosen.stock }
                return ctx.reply(`📦 *${escapeMarkdownV1(chosen.name)}*

    📊 Stock: ${chosen.stock} unidades
    💰 Precio: $${chosen.retailPrice.toLocaleString()}

    ¿Cuántas unidades agregar? (escribe un número)`, { parse_mode: 'Markdown' })
            }

            // Sale session
            const session = sessions.sale[telegramId]
            if (session) {
                if (session.step === 'SELECT_PRODUCT' && session.products) {
                    if (number < 1 || number > session.products.length) {
                        return ctx.reply(`Ingresa un número entre 1 y ${session.products.length}`)
                    }
                    const selected = session.products[number - 1]
                    sessions.sale[telegramId] = { step: 'CONFIRM', selectedProduct: selected, quantity: 1 }
                    return ctx.reply(`📦 *${escapeMarkdownV1(selected.name)}*

    📊 Stock: ${selected.stock} unidades
    💰 Precio: $${selected.retailPrice.toLocaleString()}

    ¿Cuántas unidades vender?`, { parse_mode: 'Markdown' })
                }

                if (session.step === 'CONFIRM' && session.selectedProduct) {
                    if (number < 1 || number > session.selectedProduct.stock) {
                        return ctx.reply(`❌ Cantidad inválida. Stock disponible: ${session.selectedProduct.stock}`)
                    }
                    sessions.sale[telegramId] = { step: 'CONFIRM', selectedProduct: session.selectedProduct, quantity: number }
                    const total = session.selectedProduct.retailPrice * number
                    return ctx.reply(`📦 *Resumen de venta*

    Producto: ${escapeMarkdownV1(session.selectedProduct.name)}
    Cantidad: ${number}
    Total: *$${total.toLocaleString()}*

    ¿Confirmar venta?`, {
                        parse_mode: 'Markdown',
                        ...Markup.inlineKeyboard([
                            [Markup.button.callback('✅ Confirmar', `confirm_sale_${session.selectedProduct.id}_${number}`)],
                            [Markup.button.callback('❌ Cancelar', 'cancel_sale')]
                        ])
                    })
                }
            }

            // Delete product session
            const deleteSession = sessions.deleteProduct[telegramId]
            if (deleteSession && deleteSession.step === 'SELECT' && deleteSession.products) {
                if (number < 1 || number > deleteSession.products.length) {
                    return ctx.reply(`Ingresa un número entre 1 y ${deleteSession.products.length}`)
                }
                const selected = deleteSession.products[number - 1]
                sessions.deleteProduct[telegramId] = { step: 'CONFIRM', selectedProduct: selected }
                return ctx.reply(`🗑️ *¿Eliminar este producto?*

    📦 *${escapeMarkdownV1(selected.name)}*
    📊 Stock: ${selected.stock}
    🔗 Reservas: ${selected._count?.reservations ?? 0}
    📋 Movimientos: ${selected._count?.movements ?? 0}

    ¿Confirmar eliminación?`, {
                    parse_mode: 'Markdown',
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback('✅ Eliminar', `confirm_delete_${selected.id}`)],
                        [Markup.button.callback('❌ Cancelar', 'cancel_sale')]
                    ])
                })
            }

            return next()
        } catch (e) {
            // Un fallo a mitad del reparto (QR, carrito, venta, borrado) no
            // puede quedar mudo: el usuario vería "nada" tras mandar un número.
            console.error('[Digits] Error:', e)
            try { await ctx.reply('❌ Algo falló. Usa /cancelar e intenta de nuevo.') } catch { }
        }
    })

    // Legacy SI confirmation
    bot.hears(/^(SI|si|Si|sI|Si|sí|SÍ)$/, async (ctx) => {
        const telegramId = ctx.from.id.toString()
        const deleteSession = sessions.deleteProduct[telegramId]
        if (deleteSession && deleteSession.step === 'CONFIRM' && deleteSession.selectedProduct && prisma) {
            if (!(await requireAdmin(ctx))) return
            if (!(await requirePrisma(ctx))) return
            try {
                const productId = deleteSession.selectedProduct.id
                await transaction(prisma, async tx => {
                    const currentUser = await tx.user.findUnique({ where: { telegramId }, select: { id: true, businessId: true } })
                    if (!currentUser) throw new BusinessError('Cuenta no autorizada.', 403)
                    await actor(tx, currentUser.id, 'admin', currentUser.businessId)
                    await tx.product.update({ where: { id: productId, businessId: currentUser.businessId }, data: { isActive: false } })
                })
                const productName = deleteSession.selectedProduct.name
                delete sessions.deleteProduct[telegramId]
                return ctx.reply(`✅ *Producto archivado*\n\n📦 ${escapeMarkdownV1(productName)}\n\nSus existencias, reservas y movimientos se conservaron.`, { parse_mode: 'Markdown' })
            } catch (e) {
                if (isDev) console.error('Error archiving product:', e)
                delete sessions.deleteProduct[telegramId]
                return ctx.reply('❌ No se pudo archivar el producto. Revisa tus permisos e inténtalo de nuevo.')
            }
        }
    })
}
