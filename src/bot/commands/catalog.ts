import { randomUUID } from "node:crypto"
import { createReservations } from "../../lib/domain/reservations"
import { Input, Markup } from 'telegraf'
import type { Context } from 'telegraf'
import type { InputMediaPhoto } from 'telegraf/types'
import * as QRCode from 'qrcode'
import * as path from 'path'
import * as fs from 'fs'
import type { BotContext } from '../lib/types'
import { getBotAccount, requirePrisma } from '../lib/guards'
import { getBusinessSetting, getDefaultBusinessId } from '../../lib/settings'
import { clipMessage, escapeMarkdownV1, escapeRegExp, TG_CAPTION_MAX } from '../lib/format'

export function registerCatalog({ bot, prisma, sessions, isDev }: BotContext) {
    // Helper: getSetting (duplicated here for independence; in production use a shared module)
    async function getSetting(businessId: string, key: string, defaultValue: string): Promise<string> {
        const setting = await getBusinessSetting(businessId, key)
        return setting || defaultValue
    }

    // Multi-tenant: el catálogo siempre se scopea al businessId del usuario del
    // bot. Quienes aún no se registran navegan el negocio por defecto del
    // deployment (bot mono-negocio: un número de Telegram = un negocio).
    //
    // INTENCIONAL — el catálogo es solo lectura y ya es público en la web
    // (/catalogo): dejar que un desconocido lo hojeé es el escaparate del
    // negocio. El borde está en las acciones, no en la vista: reservar exige
    // cuenta registrada y APPROVED (reserve_), y venta/QR/eliminar exigen
    // isAdmin — ninguna escritura usa el businessId por defecto. Si este
    // deployment algún día hospeda más de un negocio, un visitante vería el
    // catálogo del negocio más viejo: aceptable mientras el deployment sea
    // mono-negocio, a revisar si cambia.
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
            const buttons = categories.map((c) => [Markup.button.callback(c.name, `cat_${c.id}`)])
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
        // Toast cosmético: si la red falla aquí el resto del handler igual corre.
        await ctx.answerCbQuery().catch(() => { })

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
                        const regex = new RegExp(`^${escapeRegExp(word)}\\s*`, 'i')
                        name = name.replace(regex, '')
                    }
                }
                return name.length >= 5 ? name.trim() : fullName
            }

            const buttons = products.map((p) => {
                const shortName = getShortName(p.name)
                const displayName = shortName.length > 28 ? shortName.substring(0, 28) + '...' : shortName
                return [Markup.button.callback(`📱 ${displayName}`, `prod_${p.id}`)]
            })
            buttons.push([Markup.button.callback('⬅️ Volver a Categorías', 'back_categories')])

            await ctx.editMessageText(`📂 *${escapeMarkdownV1(category?.name || 'Productos')}*\n\n_${products.length} productos disponibles:_`, {
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
        await ctx.answerCbQuery().catch(() => { })

        try {
            // Un solo lookup del usuario: antes businessIdOf leía businessId y
            // isAdmin releía la misma fila para rol+status.
            const me = ctx.from
                ? await prisma.user.findUnique({
                    where: { telegramId: ctx.from.id.toString() },
                    select: { businessId: true, role: true, status: true }
                })
                : null
            const businessId = me?.businessId ?? (await getDefaultBusinessId())
            const isAdminUser = me?.role === 'ADMIN' && me.status === 'APPROVED'

            const product = await prisma.product.findFirst({
                where: { id: productId, businessId },
                include: { category: true }
            })

            if (!product) {
                return ctx.editMessageText('❌ Producto no encontrado.')
            }

            const costInfo = isAdminUser && product.costPrice
                ? `\n🏷️ *Costo:* $${product.costPrice.toLocaleString()}\n📊 *Ganancia:* $${(product.retailPrice - product.costPrice).toLocaleString()} (${Math.round(((product.retailPrice - product.costPrice) / product.costPrice) * 100)}%)`
                : ''

            // clipMessage: la descripción es texto libre de BD y puede empujar
            // el mensaje/caption sobre el límite (4096 texto / 1024 caption).
            const msg = clipMessage(`📦 *${escapeMarkdownV1(product.name)}*

${product.description ? `_${escapeMarkdownV1(product.description)}_\n` : ''}
📂 *Categoría:* ${escapeMarkdownV1(product.category?.name || 'N/A')}
💰 *Precio:* $${product.retailPrice.toLocaleString()}${costInfo}
✅ *Disponible:* ${product.stock} unidades
${product.stock <= 5 ? '⚠️ *¡Poco Stock!*' : ''}`)
            const caption = clipMessage(msg, TG_CAPTION_MAX)

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

                const validMediaGroup: InputMediaPhoto[] = []
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
                    } catch {
                        await ctx.reply(`⚠️ No pude cargar las imágenes.`)
                        await ctx.reply(msg, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) })
                    }
                } else if (validMediaGroup.length === 1) {
                    try {
                        await ctx.replyWithPhoto(validMediaGroup[0].media, { caption, parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) })
                    } catch {
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
            await ctx.reply('❌ Error al cargar el producto.').catch(() => { })
        }
    })

    // showqr_ action — solo admin: el QR revela el barcode/id interno del producto.
    bot.action(/^showqr_(.+)$/, async (ctx) => {
        const telegramId = ctx.from.id.toString()
        const productId = ctx.match[1]
        try {
            // Un solo lookup: antes isAdmin y businessIdOf leían la misma fila.
            const actor = await getBotAccount(prisma, telegramId)
            if (!actor || actor.role !== 'ADMIN' || actor.status !== 'APPROVED') {
                return ctx.answerCbQuery('⛔ Solo administradores.').catch(() => { })
            }
            await ctx.answerCbQuery().catch(() => { })
            const product = await prisma.product.findFirst({ where: { id: productId, businessId: actor.businessId } })
            if (!product) return
            const qrData = product.barcode || product.id
            const qrBuffer = await QRCode.toBuffer(qrData)
            await ctx.replyWithPhoto(Input.fromBuffer(qrBuffer, 'qr.png'), { caption: clipMessage(`📱 *${escapeMarkdownV1(product.name)}*\n\nCódigo: \`${qrData.replace(/`/g, '')}\``, TG_CAPTION_MAX), parse_mode: 'Markdown' })
        } catch (e) {
            console.error('Error in showqr_:', e)
            await ctx.reply('❌ Error al generar el QR.').catch(() => { })
        }
    })

    // delprod_ action — el botón solo se renderiza a admins, pero un teclado
    // viejo o un callback reenviado no puede saltarse el gate: se revalida.
    bot.action(/^delprod_(.+)$/, async (ctx) => {
        const telegramId = ctx.from.id.toString()
        const productId = ctx.match[1]
        try {
            // Un solo lookup: antes isAdmin y businessIdOf leían la misma fila.
            const actor = await getBotAccount(prisma, telegramId)
            if (!actor || actor.role !== 'ADMIN' || actor.status !== 'APPROVED') {
                return ctx.answerCbQuery('⛔ Solo administradores.').catch(() => { })
            }
            await ctx.answerCbQuery().catch(() => { })
            const product = await prisma.product.findFirst({
                where: { id: productId, businessId: actor.businessId },
                include: { _count: { select: { reservations: true, movements: true } } }
            })
            if (!product) return
            sessions.deleteProduct[telegramId] = { step: 'CONFIRM', selectedProduct: product }
            await ctx.reply(`🗑️ *¿Eliminar este producto?*\n\n📦 ${escapeMarkdownV1(product.name)}\n⚠️ Ten cuidado, esta acción es irreversible.\n\nResponde SI para confirmar.`, { parse_mode: 'Markdown' })
        } catch (e) {
            console.error('Error in delprod_:', e)
            await ctx.reply('❌ Error al preparar la eliminación.').catch(() => { })
        }
    })

    // confirm_delete action
    bot.action(/^confirm_delete_(.+)$/, async (ctx) => {
        const telegramId = ctx.from!.id.toString()
        const productId = ctx.match[1]

        try {
            // Un solo lookup: rol + tenant en la misma fila. Antes el gate de
            // isAdmin devolvía silencio puro a un no-admin (spinner colgado).
            const actor = await getBotAccount(prisma, telegramId)
            if (!actor || actor.role !== 'ADMIN' || actor.status !== 'APPROVED') {
                await ctx.answerCbQuery('⛔ Solo administradores.')
                return ctx.editMessageText('🚫 Esta acción es solo para administradores.').catch(() => { })
            }

            const deleteSession = sessions.deleteProduct[telegramId]
            if (!deleteSession || deleteSession.step !== 'CONFIRM' || deleteSession.selectedProduct?.id !== productId) {
                await ctx.answerCbQuery('Sesión expirada')
                return ctx.editMessageText('❌ Sesión de eliminación expirada o inválida.')
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
            const productName = escapeMarkdownV1(product.name)
            const hasLedger = (product._count.reservations + product._count.movements + product._count.saleItems) > 0
            if (hasLedger) {
                await prisma.product.updateMany({ where: { id: product.id, businessId: actor.businessId }, data: { isActive: false } })
                delete sessions.deleteProduct[telegramId]
                await ctx.answerCbQuery('Archivado')
                return ctx.editMessageText(`✅ *Producto archivado*\n\n📦 ${productName}\n\nTiene historial de movimientos/ventas: se desactivó en lugar de borrarse para conservar el registro.`, { parse_mode: 'Markdown' })
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
        await ctx.answerCbQuery().catch(() => { })
        const telegramId = ctx.from?.id.toString()
        if (!telegramId) return

        try {
            const user = await prisma.user.findUnique({ where: { telegramId } })
            if (!user) return ctx.reply('⚠️ Debes estar registrado para reservar. Usa /start')
            // Solo cuentas APPROVED reservan; el dominio aplica la misma regla al confirmar.
            if (user.status !== 'APPROVED') {
                return ctx.reply('⏳ Tu cuenta está pendiente de verificación.')
            }

            const product = await prisma.product.findUnique({ where: { id: productId, businessId: user.businessId } })
            if (!product || product.stock <= 0) return ctx.reply('❌ Producto sin stock disponible.')

            // Lista de taller para clientes STORE/TECHNICIAN o cuenta aliada
            // WORKSHOP — el mismo criterio que reservations.ts/sell: el "Total"
            // mostrado y el cupo de crédito deben calcularse con el precio que
            // realmente cobrará createReservations, no siempre retail.
            const wholesale = user.customerType === 'STORE' || user.customerType === 'TECHNICIAN' || user.role === 'WORKSHOP'
            const unitPrice = wholesale ? product.wholesalePrice : product.retailPrice

            await ctx.reply(`🛒 *Reservar: ${escapeMarkdownV1(product.name)}*

💰 Precio: $${unitPrice.toLocaleString()}
✅ Stock: ${product.stock} uds

*¿Cuántas unidades deseas?*
(Responde con un número, ej: "2")

_Escribe "cancelar" para anular._`, { parse_mode: 'Markdown' })

            sessions.reservation[telegramId] = {
                productId: product.id,
                productName: product.name,
                price: unitPrice,
                maxStock: product.stock,
                step: 'QUANTITY'
            }
        } catch (e) {
            console.error('Error in reserve_:', e)
            await ctx.reply('❌ No se pudo iniciar la reserva. Intenta de nuevo.').catch(() => { })
        }
    })

    // Payment method actions — el toast es cosmético: si falla, la reserva
    // igual debe procesarse (antes un throw aquí la dejaba muda).
    bot.action('pay_store', async (ctx) => {
        await ctx.answerCbQuery().catch(() => { })
        await processReservation(ctx, 'STORE')
    })

    bot.action('pay_credit', async (ctx) => {
        await ctx.answerCbQuery().catch(() => { })
        await processReservation(ctx, 'CREDIT')
    })

    bot.action('pay_transfer', async (ctx) => {
        await ctx.answerCbQuery().catch(() => { })
        const telegramId = ctx.from!.id.toString()
        const session = sessions.reservation[telegramId]
        if (!session) return await ctx.reply('❌ Sesión expirada. Inicia de nuevo desde el producto.')

        try {
            const total = (session.price * (session.quantity || 1)).toLocaleString()
            const me = await prisma.user.findUnique({ where: { telegramId }, select: { businessId: true } })
            const businessId = me?.businessId ?? (await getDefaultBusinessId())
            const bankTransferRaw = await getSetting(businessId, 'bank_transfer_info', '')
            const bankCashRaw = await getSetting(businessId, 'bank_cash_info', '')

            if (!bankTransferRaw && !bankCashRaw) return ctx.reply('El taller aún no ha configurado sus datos de pago. Consulta en recepción antes de transferir.')
            // El paso cambia solo cuando los datos cargaron: si algo falla la
            // sesión queda en PAYMENT_METHOD y el usuario puede reintentar.
            session.step = 'PROOF_UPLOAD'
            await ctx.reply(`🏦 *Opciones de Pago*

*1️⃣ TRANSFERENCIA / SPEI*
Realiza el pago de *$${total}* a:
${escapeMarkdownV1(bankTransferRaw)}

*2️⃣ DEPÓSITO EN EFECTIVO*
${escapeMarkdownV1(bankCashRaw)}

📸 *Envía la FOTO del comprobante aquí cuando hayas pagado.*
_Escribe "cancelar" para anular._`, { parse_mode: 'Markdown' })
        } catch (e) {
            console.error('Error in pay_transfer:', e)
            await ctx.reply('❌ Error al cargar los datos de pago. Intenta de nuevo.').catch(() => { })
        }
    })

    // Process reservation
    async function processReservation(ctx: Context, method: 'STORE' | 'TRANSFER' | 'CREDIT', proofUrl?: string) {
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

📦 *${escapeMarkdownV1(session.productName)}*
📊 Cantidad: ${session.quantity}
💰 Total: $${totalPrice.toLocaleString()}
💳 Método: ${methodLabel}

🔖 ID: \`${reservation.id.substring(0, 8)}\`

_Muestra este QR al recoger:_`

            // Caption de foto: el límite es 1024, no 4096 — nombres largos lo
            // cruzaban y el 400 de Telegram enterraba la confirmación.
            await ctx.replyWithPhoto(Input.fromBuffer(qrBuffer, 'qr.png'), { caption: clipMessage(userMsg, TG_CAPTION_MAX), parse_mode: 'Markdown' })

            // Multi-tenant: la reserva se avisa solo a los admins aprobados del
            // negocio del cliente — nunca a administradores de otras empresas.
            const admins = await prisma.user.findMany({ where: { businessId: user.businessId, role: 'ADMIN', status: 'APPROVED', telegramId: { not: null } } })
            const adminTitle = method === 'TRANSFER' ? '(Con Comprobante)' : method === 'CREDIT' ? '(A Crédito)' : '(Pago en Tienda)'
            const adminFooter = method === 'TRANSFER' ? '⚠️ *Validar Comprobante*' : method === 'CREDIT' ? '💳 Cobro a cuenta de crédito' : 'ℹ️ Pendiente de pago en tienda'
            const adminMsg = `🔔 *Nueva Reserva ${adminTitle}*

👤 ${escapeMarkdownV1(user.name)}
📦 ${escapeMarkdownV1(session.productName)}
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
        await ctx.answerCbQuery().catch(() => { })
        try {
            const businessId = await businessIdOf(ctx.from?.id?.toString())
            const categories = await prisma.category.findMany({ where: { businessId }, take: 20 })
            const buttons = categories.map((c) => [Markup.button.callback(c.name, `cat_${c.id}`)])
            await ctx.editMessageText('📂 *Selecciona una categoría:*', {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard(buttons)
            })
        } catch (e) {
            console.error('Error in back_categories:', e)
            await ctx.reply('❌ Error al cargar categorías. Usa /categorias.').catch(() => { })
        }
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
            products.forEach((p, i) => {
                msg += `${i + 1}. *${escapeMarkdownV1(p.name)}*\n   💰 $${p.retailPrice} | ✅ ${p.stock} uds\n`
                if (p.category) msg += `   📂 ${escapeMarkdownV1(p.category.name)}\n`
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
        await ctx.answerCbQuery().catch(() => { })
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
            const buttons = products.map((p) => {
                const shortName = p.name.replace(new RegExp(escapeRegExp(brand), 'gi'), '').trim()
                const display = shortName.length > 25 ? shortName.substring(0, 25) + '...' : shortName
                return [Markup.button.callback(`📦 ${display}`, `prod_${p.id}`)]
            })
            buttons.push([Markup.button.callback('⬅️ Volver a Marcas', 'back_brands')])
            await ctx.editMessageText(`📱 *${escapeMarkdownV1(brand.charAt(0).toUpperCase() + brand.slice(1))}*\n\n_${products.length} productos:_`, {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard(buttons)
            })
        } catch (e) {
            console.error(e)
            await ctx.editMessageText('❌ Error al buscar productos.')
        }
    })

    bot.action('back_brands', async (ctx) => {
        await ctx.answerCbQuery().catch(() => { })
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
