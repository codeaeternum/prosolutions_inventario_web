import { randomUUID } from "node:crypto"
import { createReservations } from "../../lib/domain/reservations"
import { Markup } from 'telegraf'
import * as QRCode from 'qrcode'
import * as path from 'path'
import * as fs from 'fs'
import type { BotContext } from '../lib/types'
import { isAdmin } from '../lib/notify'
import { requirePrisma } from '../lib/guards'
import { getBusinessSetting, getDefaultBusinessId } from '../../lib/settings'

export function registerCatalog({ bot, prisma, sessions, isDev, BOT_TOKEN }: BotContext) {
    // Helper: getSetting (duplicated here for independence; in production use a shared module)
    async function getSetting(businessId: string, key: string, defaultValue: string): Promise<string> {
        const setting = await getBusinessSetting(businessId, key)
        return setting || defaultValue
    }

    // Multi-tenant: el catálogo siempre se scopea al businessId del usuario del
    // bot. Quienes aún no se registran navegan el negocio por defecto del
    // deployment (bot mono-negocio: un número de Telegram = un negocio).
    async function businessIdOf(telegramId?: string): Promise<string> {
        if (telegramId) {
            const me = await prisma.user.findUnique({ where: { telegramId }, select: { businessId: true } })
            if (me?.businessId) return me.businessId
        }
        return getDefaultBusinessId()
    }

    // /categorias
    bot.command('categorias', async (ctx) => {
        if (!(await requirePrisma(ctx))) return
        try {
            const businessId = await businessIdOf(ctx.from?.id?.toString())
            const categories = await prisma.category.findMany({ where: { businessId }, take: 20 })
            if (categories.length === 0) return ctx.reply('No hay categorías registradas.')
            const buttons = categories.map((c: any) => [Markup.button.callback(c.name, `cat_${c.id}`)])
            await ctx.reply('📂 *Selecciona una categoría:*', {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard(buttons)
            })
        } catch (e) {
            console.error(e)
            await ctx.reply('Error al obtener categorías')
        }
    })

    // cat_ action
    bot.action(/^cat_(.+)$/, async (ctx) => {
        const categoryId = ctx.match[1]
        await ctx.answerCbQuery()

        try {
            const businessId = await businessIdOf(ctx.from?.id?.toString())
            const category = await prisma.category.findFirst({ where: { id: categoryId, businessId } })
            const products = await prisma.product.findMany({
                where: { categoryId, businessId, isActive: true, stock: { gt: 0 } },
                take: 8,
                orderBy: { stock: 'desc' }
            })

            if (products.length === 0) {
                return ctx.editMessageText('📂 No hay productos disponibles en esta categoría.', {
                    ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Volver', 'back_categories')]])
                })
            }

            const categoryName = category?.name?.toLowerCase() || ''
            const getShortName = (fullName: string) => {
                let name = fullName
                const categoryWords = categoryName.split(/\s+/)
                for (const word of categoryWords) {
                    if (word.length >= 3) {
                        const regex = new RegExp(`^${word}\\s*`, 'i')
                        name = name.replace(regex, '')
                    }
                }
                return name.length >= 5 ? name.trim() : fullName
            }

            const buttons = products.map((p: any) => {
                const shortName = getShortName(p.name)
                const displayName = shortName.length > 28 ? shortName.substring(0, 28) + '...' : shortName
                return [Markup.button.callback(`📱 ${displayName}`, `prod_${p.id}`)]
            })
            buttons.push([Markup.button.callback('⬅️ Volver a Categorías', 'back_categories')])

            await ctx.editMessageText(`📂 *${category?.name || 'Productos'}*\n\n_${products.length} productos disponibles:_`, {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard(buttons)
            })
        } catch (e) {
            console.error(e)
            await ctx.editMessageText('Error al cargar productos.')
        }
    })

    // prod_ action — product detail
    bot.action(/^prod_(.+)$/, async (ctx) => {
        const productId = ctx.match[1]
        await ctx.answerCbQuery()

        try {
            const businessId = await businessIdOf(ctx.from?.id?.toString())
            const product = await prisma.product.findFirst({
                where: { id: productId, businessId },
                include: { category: true }
            })

            if (!product) {
                return ctx.editMessageText('❌ Producto no encontrado.')
            }

            const isAdminUser = await isAdmin(ctx.from.id.toString())

            const costInfo = isAdminUser && (product as any).costPrice
                ? `\n🏷️ *Costo:* $${(product as any).costPrice.toLocaleString()}\n📊 *Ganancia:* $${(product.retailPrice - (product as any).costPrice).toLocaleString()} (${Math.round(((product.retailPrice - (product as any).costPrice) / (product as any).costPrice) * 100)}%)`
                : ''

            const msg = `📦 *${product.name}*

${product.description ? `_${product.description}_\n` : ''}
📂 *Categoría:* ${product.category?.name || 'N/A'}
💰 *Precio:* $${product.retailPrice.toLocaleString()}${costInfo}
✅ *Disponible:* ${product.stock} unidades
${product.stock <= 5 ? '⚠️ *¡Poco Stock!*' : ''}`

            const buttons = []

            if (isAdminUser) {
                buttons.push([Markup.button.callback('⚡ Venta Rápida (1 un)', `fastsell_${product.id}`)])
                buttons.push([Markup.button.callback('🛒 (+1) Al Carrito', `addtocart_${product.id}`)])
                buttons.push([
                    Markup.button.callback('📱 Ver QR', `showqr_${product.id}`),
                    Markup.button.callback('🗑️ Eliminar', `delprod_${product.id}`)
                ])
            }

            buttons.push([Markup.button.callback('📅 Reservar (Cliente)', `reserve_${product.id}`)])
            buttons.push([Markup.button.callback('⬅️ Volver', `cat_${product.categoryId}`)])

            if (product.images && product.images.length > 0) {
                if (isDev) console.log(`[Prod] Sending ${product.images.length} images for ${product.id}`)
                await ctx.deleteMessage().catch(() => { })

                const validMediaGroup: any[] = []
                for (let i = 0; i < product.images.length; i++) {
                    const url = product.images[i]
                    if (url.startsWith('/uploads')) {
                        const absPath = path.join(process.cwd(), 'public', url)
                        if (fs.existsSync(absPath)) {
                            validMediaGroup.push({ type: 'photo', media: { source: absPath }, caption: i === 0 ? `📸 ${product.name}` : undefined })
                        }
                    } else if (url.startsWith('http')) {
                        validMediaGroup.push({ type: 'photo', media: url, caption: i === 0 ? `📸 ${product.name}` : undefined })
                    } else if (url.startsWith('data:')) {
                        try {
                            const base64Data = url.split(',')[1]
                            const buffer = Buffer.from(base64Data, 'base64')
                            validMediaGroup.push({ type: 'photo', media: { source: buffer }, caption: i === 0 ? `📸 ${product.name}` : undefined })
                        } catch (e) {
                            console.error('[Prod] Error processing base64 image', e)
                        }
                    }
                }

                if (validMediaGroup.length > 1) {
                    try {
                        await ctx.replyWithMediaGroup(validMediaGroup.slice(0, 10))
                        await ctx.reply(msg, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) })
                    } catch (e: any) {
                        await ctx.reply(`⚠️ No pude cargar las imágenes.`)
                        await ctx.reply(msg, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) })
                    }
                } else if (validMediaGroup.length === 1) {
                    try {
                        await ctx.replyWithPhoto(validMediaGroup[0].media, { caption: msg, parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) })
                    } catch (e: any) {
                        await ctx.reply(`⚠️ No pude cargar la imagen.`)
                        await ctx.reply(msg, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) })
                    }
                } else {
                    await ctx.reply(`⚠️ Imagen no disponible.`)
                    await ctx.reply(msg, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) })
                }
            } else {
                await ctx.editMessageText(msg, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) })
            }
        } catch (e) {
            console.error('[Catalog] CRITICAL ERROR:', e)
        }
    })

    // showqr_ action
    bot.action(/^showqr_(.+)$/, async (ctx) => {
        const productId = ctx.match[1]
        await ctx.answerCbQuery()
        const businessId = await businessIdOf(ctx.from?.id?.toString())
        const product = await prisma.product.findFirst({ where: { id: productId, businessId } })
        if (!product) return
        const qrData = product.barcode || product.id
        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qrData)}`
        await ctx.replyWithPhoto({ url: qrUrl }, { caption: `📱 *${product.name}*\n\nCódigo: \`${qrData}\``, parse_mode: 'Markdown' })
    })

    // delprod_ action
    bot.action(/^delprod_(.+)$/, async (ctx) => {
        const productId = ctx.match[1]
        await ctx.answerCbQuery()
        const businessId = await businessIdOf(ctx.from?.id?.toString())
        const product = await prisma.product.findFirst({
            where: { id: productId, businessId },
            include: { _count: { select: { reservations: true, movements: true } } }
        })
        if (!product) return
        const telegramId = ctx.from.id.toString()
        sessions.deleteProduct[telegramId] = { step: 'CONFIRM', selectedProduct: product }
        await ctx.reply(`🗑️ *¿Eliminar este producto?*\n\n📦 ${product.name}\n⚠️ Ten cuidado, esta acción es irreversible.\n\nResponde SI para confirmar.`, { parse_mode: 'Markdown' })
    })

    // confirm_delete action
    bot.action(/^confirm_delete_(.+)$/, async (ctx) => {
        const telegramId = ctx.from!.id.toString()
        if (!(await isAdmin(telegramId))) return
        const productId = ctx.match[1]
        const deleteSession = sessions.deleteProduct[telegramId]

        if (!deleteSession || deleteSession.step !== 'CONFIRM' || deleteSession.selectedProduct?.id !== productId) {
            await ctx.answerCbQuery('Sesión expirada')
            return ctx.editMessageText('❌ Sesión de eliminación expirada o inválida.')
        }

        try {
            // Multi-tenant: solo productos del negocio del admin.
            const actor = await prisma.user.findUnique({ where: { telegramId }, select: { businessId: true } })
            if (!actor) {
                delete sessions.deleteProduct[telegramId]
                await ctx.answerCbQuery('Cuenta no disponible')
                return ctx.editMessageText('❌ Cuenta no disponible.')
            }
            // Nunca borrar físicamente un producto con historial (reservas,
            // movimientos o ventas): se archiva con isActive=false para
            // conservar el ledger. Solo se elimina si no tiene movimientos.
            const product = await prisma.product.findFirst({
                where: { id: productId, businessId: actor.businessId },
                include: { _count: { select: { reservations: true, movements: true, saleItems: true } } }
            })
            if (!product) {
                delete sessions.deleteProduct[telegramId]
                await ctx.answerCbQuery('Producto no encontrado')
                return ctx.editMessageText('❌ Producto no encontrado en tu negocio.')
            }
            const productName = product.name
            const hasLedger = (product._count.reservations + product._count.movements + product._count.saleItems) > 0
            if (hasLedger) {
                await prisma.product.updateMany({ where: { id: product.id, businessId: actor.businessId }, data: { isActive: false } })
                delete sessions.deleteProduct[telegramId]
                await ctx.answerCbQuery('Archivado')
                return ctx.editMessageText(`✅ *Producto archivado*\n\n� ${productName}\n\nTiene historial de movimientos/ventas: se desactivó en lugar de borrarse para conservar el registro.`, { parse_mode: 'Markdown' })
            }
            await prisma.product.deleteMany({ where: { id: product.id, businessId: actor.businessId } })
            delete sessions.deleteProduct[telegramId]
            await ctx.answerCbQuery('Eliminado')
            return ctx.editMessageText(`✅ *Producto eliminado*\n\n🗑️ ${productName}\n\nEl producto fue eliminado (sin historial que preservar).`, { parse_mode: 'Markdown' })
        } catch (e) {
            console.error('Error deleting product:', e)
            delete sessions.deleteProduct[telegramId]
            await ctx.answerCbQuery('Error')
            return ctx.editMessageText('❌ Error al eliminar el producto. Puede tener reservas activas.')
        }
    })

    // reserve_ action
    bot.action(/^reserve_(.+)$/, async (ctx) => {
        const productId = ctx.match[1]
        await ctx.answerCbQuery()
        const telegramId = ctx.from?.id.toString()
        if (!telegramId) return

        const user = await prisma.user.findUnique({ where: { telegramId } })
        if (!user) return ctx.reply('⚠️ Debes estar registrado para reservar. Usa /start')
        // Solo cuentas APPROVED reservan; el dominio aplica la misma regla al confirmar.
        if (user.status !== 'APPROVED') {
            return ctx.reply('⏳ Tu cuenta está pendiente de verificación.')
        }

        const product = await prisma.product.findUnique({ where: { id: productId, businessId: user.businessId } })
        if (!product || product.stock <= 0) return ctx.reply('❌ Producto sin stock disponible.')

        await ctx.reply(`🛒 *Reservar: ${product.name}*

💰 Precio: $${product.retailPrice}
✅ Stock: ${product.stock} uds

*¿Cuántas unidades deseas?*
(Responde con un número, ej: "2")

_Escribe "cancelar" para anular._`, { parse_mode: 'Markdown' })

        sessions.reservation[telegramId] = {
            productId: product.id,
            productName: product.name,
            price: product.retailPrice,
            maxStock: product.stock,
            step: 'QUANTITY'
        }
    })

    // Payment method actions
    bot.action('pay_store', async (ctx) => {
        await ctx.answerCbQuery()
        await processReservation(ctx, 'STORE')
    })

    bot.action('pay_credit', async (ctx) => {
        await ctx.answerCbQuery()
        await processReservation(ctx, 'CREDIT')
    })

    bot.action('pay_transfer', async (ctx) => {
        await ctx.answerCbQuery()
        const telegramId = ctx.from!.id.toString()
        const session = sessions.reservation[telegramId]
        if (!session) return await ctx.reply('❌ Sesión expirada. Inicia de nuevo desde el producto.')

        session.step = 'PROOF_UPLOAD'
        const total = (session.price * (session.quantity || 1)).toLocaleString()
        const me = await prisma.user.findUnique({ where: { telegramId }, select: { businessId: true } })
        const businessId = me?.businessId ?? (await getDefaultBusinessId())
        const bankTransferRaw = await getSetting(businessId, 'bank_transfer_info', '')
        const bankCashRaw = await getSetting(businessId, 'bank_cash_info', '')

        if (!bankTransferRaw && !bankCashRaw) return ctx.reply('El taller aún no ha configurado sus datos de pago. Consulta en recepción antes de transferir.')
        await ctx.reply(`🏦 *Opciones de Pago*

*1️⃣ TRANSFERENCIA / SPEI*
Realiza el pago de *$${total}* a:
${bankTransferRaw}

*2️⃣ DEPÓSITO EN EFECTIVO*
${bankCashRaw}

📸 *Envía la FOTO del comprobante aquí cuando hayas pagado.*
_Escribe "cancelar" para anular._`, { parse_mode: 'Markdown' })
    })

    // Process reservation
    async function processReservation(ctx: any, method: 'STORE' | 'TRANSFER' | 'CREDIT', proofUrl?: string) {
        const telegramId = ctx.from!.id.toString()
        const session = sessions.reservation[telegramId]
        if (!session || !session.quantity) return

        try {
            const user = await prisma.user.findUnique({ where: { telegramId } })
            // Approval is revalidated at confirmation time: the status may have changed since the flow started.
            if (!user || user.status !== 'APPROVED') {
                delete sessions.reservation[telegramId]
                return ctx.reply('⏳ Tu cuenta debe estar aprobada para completar la reserva.')
            }

            session.operationKey ??= randomUUID()
            const result = await createReservations(prisma, user.id, user.businessId, {
                idempotencyKey: session.operationKey, productId: session.productId,
                quantity: session.quantity, paymentMethod: method, paymentProofUrl: proofUrl,
                type: method === 'TRANSFER' ? 'DEPOSIT' : 'TEMPORARY',
            })
            const reservation = result.reservations[0]
            const totalPrice = reservation.totalPrice

            const qrData = `${process.env.NEXTAUTH_URL || 'https://reficio.app'}/verificar/${reservation.qrCode}`
            const qrBuffer = await QRCode.toBuffer(qrData)

            const methodLabel = method === 'STORE' ? 'Pago en Tienda' : method === 'TRANSFER' ? 'Transferencia' : 'A crédito'
            const userMsg = `✅ *¡Reserva Confirmada!*

📦 *${session.productName}*
📊 Cantidad: ${session.quantity}
💰 Total: $${totalPrice.toLocaleString()}
💳 Método: ${methodLabel}

🔖 ID: \`${reservation.id.substring(0, 8)}\`

_Muestra este QR al recoger:_`

            await ctx.replyWithPhoto({ source: qrBuffer }, { caption: userMsg, parse_mode: 'Markdown' })

            // Multi-tenant: la reserva se avisa solo a los admins del negocio
            // del cliente — nunca a administradores de otras empresas.
            const admins = await prisma.user.findMany({ where: { businessId: user.businessId, role: 'ADMIN', telegramId: { not: null } } })
            const adminTitle = method === 'TRANSFER' ? '(Con Comprobante)' : method === 'CREDIT' ? '(A Crédito)' : '(Pago en Tienda)'
            const adminFooter = method === 'TRANSFER' ? '⚠️ *Validar Comprobante*' : method === 'CREDIT' ? '💳 Cobro a cuenta de crédito' : 'ℹ️ Pendiente de pago en tienda'
            const adminMsg = `🔔 *Nueva Reserva ${adminTitle}*

👤 ${user.name}
📦 ${session.productName}
📊 ${session.quantity} uds
💰 $${totalPrice.toLocaleString()}

${adminFooter}`

            for (const admin of admins) {
                if (admin.telegramId) {
                    // Comprobantes privados se revisan únicamente desde la sesión web autenticada.
                    bot.telegram.sendMessage(admin.telegramId, adminMsg, { parse_mode: 'Markdown' }).catch(() => {})
                }
            }

            delete sessions.reservation[telegramId]
        } catch (e) {
            console.error(e)
            await ctx.reply('❌ No se confirmó la operación. Reintenta la misma reserva o revisa Mis reservas antes de crear otra.')
        }
    }

    // back_categories
    bot.action('back_categories', async (ctx) => {
        await ctx.answerCbQuery()
        const businessId = await businessIdOf(ctx.from?.id?.toString())
        const categories = await prisma.category.findMany({ where: { businessId }, take: 20 })
        const buttons = categories.map((c: any) => [Markup.button.callback(c.name, `cat_${c.id}`)])
        await ctx.editMessageText('📂 *Selecciona una categoría:*', {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard(buttons)
        })
    })

    // /ofertas
    bot.command('ofertas', async (ctx) => {
        if (!(await requirePrisma(ctx))) return
        try {
            const businessId = await businessIdOf(ctx.from?.id?.toString())
            const products = await prisma.product.findMany({
                where: { businessId, isActive: true, stock: { gt: 5 } },
                include: { category: true },
                orderBy: { stock: 'desc' },
                take: 5
            })
            if (products.length === 0) return ctx.reply('📦 No hay ofertas disponibles.')
            let msg = `🔥 *Productos Destacados:*\n\n`
            products.forEach((p: any, i: number) => {
                msg += `${i + 1}. *${p.name}*\n   💰 $${p.retailPrice} | ✅ ${p.stock} uds\n`
                if (p.category) msg += `   📂 ${p.category.name}\n`
                msg += '\n'
            })
            msg += '_Busca por nombre para ver detalles._'
            await ctx.reply(msg, { parse_mode: 'Markdown' })
        } catch (e) {
            console.error(e)
            await ctx.reply('❌ Error al obtener productos.')
        }
    })

    // /modelos
    bot.command('modelos', async (ctx) => {
        if (!(await requirePrisma(ctx))) return
        const brands = [
            { name: '📱 iPhone', query: 'iphone' },
            { name: '📱 Samsung', query: 'samsung' },
            { name: '📱 Xiaomi', query: 'xiaomi' },
            { name: '📱 Huawei', query: 'huawei' },
            { name: '📱 Motorola', query: 'motorola' },
            { name: '📱 Otros', query: 'otro' }
        ]
        const buttons = brands.map(b => [Markup.button.callback(b.name, `brand_${b.query}`)])
        await ctx.reply('📱 *Selecciona una marca:*', { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) })
    })

    bot.action(/^brand_(.+)$/, async (ctx) => {
        const brand = ctx.match[1]
        await ctx.answerCbQuery()
        try {
            const businessId = await businessIdOf(ctx.from?.id?.toString())
            const products = await prisma.product.findMany({
                where: { businessId, name: { contains: brand, mode: 'insensitive' }, isActive: true, stock: { gt: 0 } },
                include: { category: true },
                take: 8,
                orderBy: { name: 'asc' }
            })
            if (products.length === 0) {
                return ctx.editMessageText(`📱 No hay productos de ${brand} disponibles.`, {
                    ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Volver', 'back_brands')]])
                })
            }
            const buttons = products.map((p: any) => {
                const shortName = p.name.replace(new RegExp(brand, 'gi'), '').trim()
                const display = shortName.length > 25 ? shortName.substring(0, 25) + '...' : shortName
                return [Markup.button.callback(`📦 ${display}`, `prod_${p.id}`)]
            })
            buttons.push([Markup.button.callback('⬅️ Volver a Marcas', 'back_brands')])
            await ctx.editMessageText(`📱 *${brand.charAt(0).toUpperCase() + brand.slice(1)}*\n\n_${products.length} productos:_`, {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard(buttons)
            })
        } catch (e) {
            console.error(e)
            await ctx.editMessageText('❌ Error al buscar productos.')
        }
    })

    bot.action('back_brands', async (ctx) => {
        await ctx.answerCbQuery()
        const brands = [
            { name: '📱 iPhone', query: 'iphone' },
            { name: '📱 Samsung', query: 'samsung' },
            { name: '📱 Xiaomi', query: 'xiaomi' },
            { name: '📱 Huawei', query: 'huawei' },
            { name: '📱 Motorola', query: 'motorola' }
        ]
        const buttons = brands.map(b => [Markup.button.callback(b.name, `brand_${b.query}`)])
        await ctx.editMessageText('📱 *Selecciona una marca:*', { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) })
    })

    // Export processReservation for photo handler
    return { processReservation }
}
