import { submitRegistration } from "../lib/registration"
import { downloadTelegramImage } from "../lib/download"
import { writePaymentProof } from "../../lib/payment-proofs"
import { Markup } from 'telegraf'
import { message } from 'telegraf/filters'
import { randomBytes } from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import * as https from 'https'
import type { BotContext } from '../lib/types'
import { customerTypeLabels } from '../lib/types'
import { createProduct } from '../../lib/domain/products'
import { getBotAccount, requireAdmin, requirePrisma } from '../lib/guards'
import { getDefaultBusinessId } from '../../lib/settings'
import { generateQRCode, normalizePhone } from '../lib/utils'

type Intent = 'greeting' | 'help' | 'profile' | 'categories' | 'offers'
    | 'price_check' | 'stock_check' | 'reservation_status' | 'cancel'
    | 'thanks' | 'product_search'

function classifyIntent(text: string): Intent {
    const lower = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

    if (/^(hola|buenas?|hey|que tal|hi|hello)/.test(lower)) return 'greeting'
    if (/ayuda|opciones|que puedes|comandos|como funciona/.test(lower)) return 'help'
    if (/mi perfil|mis datos|mi cuenta|mi qr/.test(lower)) return 'profile'
    if (/categorias?|catalogo|que tienen|que venden/.test(lower)) return 'categories'
    if (/ofertas?|descuento|promocion|destacados|lo mejor/.test(lower)) return 'offers'
    if (/cuanto (cuesta|vale|es)|precio|costo/.test(lower)) return 'price_check'
    if (/tienen|hay|disponible|en stock/.test(lower)) return 'stock_check'
    if (/mi reserva|mis reservas|estado de mi|pedido/.test(lower)) return 'reservation_status'
    if (/cancelar|salir|no quiero|dejalo/.test(lower)) return 'cancel'
    if (/gracias|thanks|genial|perfecto|excelente/.test(lower)) return 'thanks'
    if (/adios|bye|hasta luego|nos vemos/.test(lower)) return 'thanks'

    return 'product_search'
}

export function registerProducts(
    ctx: BotContext,
    processReservation: (ctx: any, method: 'STORE' | 'TRANSFER' | 'CREDIT', proofUrl?: string) => Promise<void>
) {
    const { bot, prisma, sessions, isDev, BOT_TOKEN } = ctx

    // /agregar
    bot.command('agregar', async (ctx) => {
        const telegramId = ctx.from.id.toString()
        if (!(await requireAdmin(ctx))) return
        sessions.adminProduct[telegramId] = { step: 'NAME', data: {} }
        await ctx.reply(`📦 *Agregar Nuevo Producto*

1️⃣ *¿Cuál es el nombre del producto?*
(Ej: "Pantalla iPhone 16 Pro Max OLED")

_Usa /cancelar para salir en cualquier momento._`, { parse_mode: 'Markdown' })
    })

    // /eliminar
    bot.command('eliminar', async (ctx) => {
        const telegramId = ctx.from.id.toString()
        if (!(await requireAdmin(ctx))) return
        if (!(await requirePrisma(ctx))) return

        const args = ctx.message.text.split(' ').slice(1).join(' ').trim()
        if (!args) {
            return ctx.reply('Uso: /eliminar <nombre_producto>\nEj: /eliminar pantalla iphone')
        }

        try {
            const actor = await getBotAccount(prisma, telegramId)
            if (!actor) return ctx.reply('Cuenta no disponible.')
            const products = await prisma.product.findMany({
                where: { businessId: actor.businessId, name: { contains: args, mode: 'insensitive' } },
                take: 5,
                select: {
                    id: true, name: true, stock: true,
                    _count: { select: { reservations: true, movements: true } }
                }
            })

            if (products.length === 0) return ctx.reply(`❌ No se encontraron productos para: "${args}"`)

            if (products.length === 1) {
                const p = products[0]
                sessions.deleteProduct[telegramId] = { step: 'CONFIRM', selectedProduct: p }
                return ctx.reply(`🗑️ *¿Eliminar este producto?*

📦 *${p.name}*
📊 Stock: ${p.stock}
🔗 Reservas: ${p._count?.reservations ?? 0}
📋 Movimientos: ${p._count?.movements ?? 0}

¿Confirmar eliminación?`, {
                    parse_mode: 'Markdown',
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback('✅ Eliminar', `confirm_delete_${p.id}`)],
                        [Markup.button.callback('❌ Cancelar', 'cancel_sale')]
                    ])
                })
            }

            sessions.deleteProduct[telegramId] = { step: 'SELECT', products }
            const productList = products.map((p: any, i: number) =>
                `${i + 1}. *${p.name}* (Stock: ${p.stock})`
            ).join('\n')

            await ctx.reply(`🗑️ *Productos encontrados:*

${productList}

Responde con el número (1-${products.length}) o /cancelar`, { parse_mode: 'Markdown' })
        } catch (e) {
            console.error(e)
            await ctx.reply('❌ Error al buscar productos.')
        }
    })

    // /qr
    bot.command('qr', async (ctx) => {
        const telegramId = ctx.from.id.toString()
        if (!(await requireAdmin(ctx))) return
        if (!(await requirePrisma(ctx))) return

        const args = ctx.message.text.split(' ').slice(1).join(' ').trim()
        if (!args) {
            return ctx.reply(`📱 *Generar Código QR*

Uso: /qr <nombre_producto>

Ejemplo:
/qr pantalla iphone 14

El bot enviará una imagen del código QR para escanear.`, { parse_mode: 'Markdown' })
        }

        try {
            const actor = await getBotAccount(prisma, telegramId)
            if (!actor) return ctx.reply('Cuenta no disponible.')
            const products = await prisma.product.findMany({
                where: {
                    businessId: actor.businessId,
                    OR: [
                        { name: { contains: args, mode: 'insensitive' } },
                        { barcode: args }
                    ]
                },
                take: 5,
                select: { id: true, name: true, barcode: true }
            })

            if (products.length === 0) return ctx.reply(`❌ No se encontraron productos para: "${args}"`)

            if (products.length === 1) {
                const p = products[0]
                const qrData = p.barcode || p.id
                const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qrData)}`
                await ctx.replyWithPhoto({ url: qrUrl }, { caption: `📱 *${p.name}*\n\nCódigo: \`${qrData}\``, parse_mode: 'Markdown' })
                return
            }

            sessions.qr[telegramId] = { step: 'SELECT', products }
            const productList = products.map((p: { name: string }, i: number) => `${i + 1}. *${p.name}*`).join('\n')
            await ctx.reply(`📱 *Productos encontrados:*\n\n${productList}\n\nResponde con el número (1-${products.length}) para obtener el QR`, { parse_mode: 'Markdown' })
        } catch (e) {
            console.error('Error in /qr:', e)
            await ctx.reply('❌ Error al generar QR.')
        }
    })

    // Photo handler: admin product photo + payment proof
    bot.on(message('photo'), async (ctx) => {
        const telegramId = ctx.from.id.toString()
        const adminSession = sessions.adminProduct[telegramId]
        const reserveSession = sessions.reservation[telegramId]

        // Admin: add product photo
        if (adminSession && adminSession.step === 'PHOTO') {
            if (!(await requireAdmin(ctx))) { delete sessions.adminProduct[telegramId]; return }
            try {
                const photo = ctx.message.photo[ctx.message.photo.length - 1]
                const file = await ctx.telegram.getFile(photo.file_id)
                const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`

                const fileName = `${Date.now()}_${randomBytes(4).toString('hex')}.jpg`
                const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'products')
                if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true })

                const filePath = path.join(uploadDir, fileName)
                const fileStream = fs.createWriteStream(filePath)
                https.get(fileUrl, (response) => {
                    response.pipe(fileStream)
                    fileStream.on('finish', async () => {
                        fileStream.close()
                        adminSession.data.imageUrl = `/uploads/products/${fileName}`

                        const adminUser = await prisma.user.findUnique({ where: { telegramId }, select: { id: true, businessId: true } })
                        const newProduct = await createProduct(prisma, adminUser!.id, adminUser!.businessId, {
                            name: adminSession.data.name!,
                            categoryId: adminSession.data.categoryId!,
                            costPrice: adminSession.data.costPrice || null,
                            retailPrice: adminSession.data.retailPrice!,
                            wholesalePrice: adminSession.data.wholesalePrice!,
                            stock: adminSession.data.stock!,
                            images: [adminSession.data.imageUrl],
                        })

                        delete sessions.adminProduct[telegramId]
                        await ctx.reply(`✅ *Producto creado exitosamente!*

📦 *${newProduct.name}*
💰 Menudeo: $${newProduct.retailPrice}
💰 Mayoreo: $${newProduct.wholesalePrice}
📊 Stock: ${newProduct.stock}
📷 Imagen: ✅

ID: \`${newProduct.id}\``, { parse_mode: 'Markdown' })
                    })
                })
            } catch (e) {
                console.error('Error uploading photo:', e)
                await ctx.reply('❌ Error al subir la imagen. Intenta de nuevo.')
            }
            return
        }

        // User: payment proof
        if (reserveSession && reserveSession.step === 'PROOF_UPLOAD') {
            try {
                const photo = ctx.message.photo[ctx.message.photo.length - 1]
                const file = await ctx.telegram.getFile(photo.file_id)
                const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`

                const user = await prisma.user.findUnique({ where: { telegramId } })
                if (!user || user.status !== 'APPROVED') return ctx.reply('Tu cuenta debe estar aprobada para adjuntar un comprobante.')
                const bytes = await downloadTelegramImage(fileUrl)
                const localUrl = await writePaymentProof(bytes, user.id)
                await processReservation(ctx, 'TRANSFER', localUrl)
            } catch (e) {
                console.error('Error uploading proof')
                await ctx.reply('❌ Error al procesar la foto. Intenta de nuevo.')
            }
            return
        }

        await ctx.reply('📸 Recibí tu foto. Si deseas agregar un producto, usa /agregar primero.')
    })

    // addcat_ action (category selection in wizard)
    bot.action(/^addcat_(.+)$/, async (ctx) => {
        if (!(await requireAdmin(ctx))) return
        const categoryId = ctx.match[1]
        await ctx.answerCbQuery()
        const telegramId = ctx.from?.id.toString()
        if (!telegramId) return
        const adminSession = sessions.adminProduct[telegramId]
        if (!adminSession || adminSession.step !== 'CATEGORY') {
            return ctx.editMessageText('❌ Sesión expirada. Usa /agregar para reiniciar.')
        }
        adminSession.data.categoryId = categoryId
        adminSession.step = 'COST_PRICE'
        await ctx.editMessageText('3️⃣ *Precio de COSTO (cuánto te costó):*\n(Solo el número, ej: "2500" o escribe *saltar* para omitir)', { parse_mode: 'Markdown' })
    })

    // Debug handler
    bot.on(message('text'), async (ctx, next) => {
        if (isDev) console.log(`[Debug] Pre-Handler Text: "${ctx.message.text}"`)
        return next()
    })

    // Main text handler: registration wizard, admin product wizard, reservation, search
    bot.on(message('text'), async (ctx) => {
        try {
            if (ctx.message.text.startsWith('/')) return

            const telegramId = ctx.from.id.toString()
            const regSession = sessions.registration[telegramId]
            const adminSession = sessions.adminProduct[telegramId]
            const reserveSession = sessions.reservation[telegramId]

            if (isDev) {
                console.log(`[Debug] Text Handler - User: ${telegramId} Reg: ${!!regSession} Reserve: ${!!reserveSession}`)
            }

            // --- RESERVATION FLOW ---
            if (reserveSession) {
                if (ctx.message.text.toLowerCase() === 'cancelar') {
                    delete sessions.reservation[telegramId]
                    return ctx.reply('❌ Reserva cancelada.')
                }
                if (reserveSession.step === 'QUANTITY') {
                    const quantity = parseInt(ctx.message.text.replace(/[^0-9]/g, ''))
                    if (isNaN(quantity) || quantity <= 0) return ctx.reply('❌ Por favor ingresa un número válido')
                    if (quantity > reserveSession.maxStock) return ctx.reply(`❌ Solo hay ${reserveSession.maxStock} unidades disponibles.`)

                    reserveSession.quantity = quantity
                    reserveSession.step = 'PAYMENT_METHOD'

                    const total = reserveSession.price * quantity
                    const buttons: any[][] = [
                        [Markup.button.callback('🏢 Pago en Tienda (Pagar al recoger)', 'pay_store')],
                        [Markup.button.callback('🏦 Transferencia (Subir comprobante)', 'pay_transfer')]
                    ]
                    try {
                        const userWithCredit = await prisma.user.findUnique({
                            where: { telegramId },
                            select: { creditLimit: true, creditBalance: true }
                        })
                        const limit = userWithCredit?.creditLimit ?? 0
                        const balance = userWithCredit?.creditBalance ?? 0
                        const available = limit > 0 ? Math.max(0, limit - balance) : 0
                        if (available >= total) {
                            buttons.push([Markup.button.callback('💳 A crédito (cobro a tu cuenta)', 'pay_credit')])
                        }
                    } catch (_) { }

                    try {
                        return await ctx.reply(`💳 *¿Cómo deseas pagar?*\n\n*Total:* $${total.toLocaleString()}\n\nSelecciona una opción:`, {
                            parse_mode: 'Markdown',
                            ...Markup.inlineKeyboard(buttons)
                        })
                    } catch (replyErr) {
                        console.error('[Reserve] Error:', replyErr)
                        try { await ctx.reply('❌ Error. Intenta de nuevo o /cancelar.') } catch (_) { }
                        return
                    }
                }
                if (reserveSession.step === 'PROOF_UPLOAD') {
                    return ctx.reply('📸 Por favor envía la *FOTO* del comprobante de transferencia.')
                }
                return
            }

            // --- REGISTRATION WIZARD ---
            if (regSession) {
                try {
                    if (regSession.step === 'NAME') {
                        regSession.data.name = ctx.message.text
                        regSession.step = 'TYPE'
                        await ctx.reply(`2️⃣ <b>¿Qué tipo de cliente eres?</b>\n\nEsto nos ayuda a ofrecerte los precios correctos.`, {
                            parse_mode: 'HTML',
                            ...Markup.inlineKeyboard([
                                [Markup.button.callback('🔧 Técnico de Reparación', 'reg_type_1')],
                                [Markup.button.callback('🏪 Local de Refacciones', 'reg_type_2')],
                                [Markup.button.callback('👤 Cliente Particular', 'reg_type_3')]
                            ])
                        })
                        return
                    }
                    if (regSession.step === 'TYPE') {
                        await ctx.reply('👆 <b>Por favor selecciona una opción usando los botones de arriba.</b>', { parse_mode: 'HTML' })
                        return
                    }
                    if (regSession.step === 'BUSINESS') {
                        regSession.data.businessName = ctx.message.text
                        regSession.step = 'PHONE'
                        await ctx.reply('4️⃣ <b>¿Cuál es tu número de teléfono?</b>\n(Para contactarte por tus pedidos)', { parse_mode: 'HTML' })
                        return
                    }
                    if (regSession.step === 'PHONE') {
                        regSession.data.phone = normalizePhone(ctx.message.text)
                        regSession.step = 'GOAL'
                        await ctx.reply(`5️⃣ <b>¿Cuánto esperas comprar al mes aproximadamente?</b>\n\nEsto nos ayuda a darte mejor atención. Selecciona una opción:`, {
                            parse_mode: 'HTML',
                            ...Markup.inlineKeyboard([
                                [Markup.button.callback('🤷 No sé', 'reg_goal_0')],
                                [Markup.button.callback('💰 Menos de $5,000', 'reg_goal_5000')],
                                [Markup.button.callback('💰 $5,000 - $15,000', 'reg_goal_10000')],
                                [Markup.button.callback('💰 Más de $15,000', 'reg_goal_20000')]
                            ])
                        })
                        return
                    }
                    if (regSession.step === 'GOAL') {
                        const goalText = ctx.message.text.replace(/[^0-9]/g, '')
                        await submitRegistration({ prisma, bot, sessions }, ctx, Number(goalText) || 0)
                        return
                    }

                } catch (e) {
                    console.error('[RegWizard] General Error:', e)
                    delete sessions.registration[telegramId]
                    try { await ctx.reply('❌ Error en el proceso. Intenta de nuevo con /start') } catch (_) { }
                }
                return
            }

            // --- ADMIN PRODUCT WIZARD ---
            if (adminSession) {
                if (!(await requireAdmin(ctx))) { delete sessions.adminProduct[telegramId]; return }
                if (adminSession.step === 'NAME') {
                    adminSession.data.name = ctx.message.text
                    adminSession.step = 'CATEGORY'
                    // Multi-tenant: solo categorías del negocio del admin —
                    // el producto nuevo se ligará a una de ellas.
                    const actor = await getBotAccount(prisma, telegramId)
                    if (!actor) { delete sessions.adminProduct[telegramId]; return ctx.reply('Cuenta no disponible.') }
                    const categories = await prisma.category.findMany({ where: { businessId: actor.businessId }, take: 10 })
                    const buttons = categories.map((c: any) => [Markup.button.callback(c.name, `addcat_${c.id}`)])
                    await ctx.reply('2️⃣ *Selecciona la categoría:*', { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) })
                    return
                }
                if (adminSession.step === 'COST_PRICE') {
                    if (ctx.message.text.toLowerCase() === 'saltar') {
                        adminSession.data.costPrice = undefined
                    } else {
                        const cost = parseFloat(ctx.message.text.replace(/[^0-9.]/g, ''))
                        if (isNaN(cost) || cost <= 0) return ctx.reply('❌ Ingresa un precio válido o escribe *saltar*.', { parse_mode: 'Markdown' })
                        adminSession.data.costPrice = cost
                    }
                    adminSession.step = 'PRICE_RETAIL'
                    await ctx.reply('4️⃣ *Precio de MENUDEO:*\n(Solo el número, ej: "4500")', { parse_mode: 'Markdown' })
                    return
                }
                if (adminSession.step === 'PRICE_RETAIL') {
                    const price = parseFloat(ctx.message.text.replace(/[^0-9.]/g, ''))
                    if (isNaN(price) || price <= 0) return ctx.reply('❌ Ingresa un precio válido.')
                    adminSession.data.retailPrice = price
                    adminSession.step = 'PRICE_WHOLESALE'
                    await ctx.reply('5️⃣ *Precio de MAYOREO:*\n(Solo el número, ej: "3500")', { parse_mode: 'Markdown' })
                    return
                }
                if (adminSession.step === 'PRICE_WHOLESALE') {
                    const price = parseFloat(ctx.message.text.replace(/[^0-9.]/g, ''))
                    if (isNaN(price) || price <= 0) return ctx.reply('❌ Ingresa un precio válido.')
                    adminSession.data.wholesalePrice = price
                    adminSession.step = 'STOCK'
                    await ctx.reply('6️⃣ *Stock inicial:*\n(Cantidad de unidades disponibles)', { parse_mode: 'Markdown' })
                    return
                }
                if (adminSession.step === 'STOCK') {
                    const stock = parseInt(ctx.message.text.replace(/[^0-9]/g, ''))
                    if (isNaN(stock) || stock < 0) return ctx.reply('❌ Ingresa un número válido.')
                    adminSession.data.stock = stock
                    adminSession.step = 'PHOTO'
                    await ctx.reply(`7️⃣ *Foto del producto (opcional)*\n\n📷 Envía la imagen ahora o escribe *saltar* para omitir.`, { parse_mode: 'Markdown' })
                    return
                }
                if (adminSession.step === 'PHOTO' && ctx.message.text.toLowerCase() === 'saltar') {
                    const adminUser = await prisma.user.findUnique({ where: { telegramId }, select: { id: true, businessId: true } })
                    const newProduct = await createProduct(prisma, adminUser!.id, adminUser!.businessId, {
                        name: adminSession.data.name!,
                        categoryId: adminSession.data.categoryId!,
                        costPrice: adminSession.data.costPrice || null,
                        retailPrice: adminSession.data.retailPrice!,
                        wholesalePrice: adminSession.data.wholesalePrice!,
                        stock: adminSession.data.stock!,
                    })
                    delete sessions.adminProduct[telegramId]
                    await ctx.reply(`✅ *Producto creado exitosamente!*\n\n📦 *${newProduct.name}*\n💰 Menudeo: $${newProduct.retailPrice}\n💰 Mayoreo: $${newProduct.wholesalePrice}\n📊 Stock: ${newProduct.stock}\n\nID: \`${newProduct.id}\``, { parse_mode: 'Markdown' })
                    return
                }
                return
            }

            // --- EXPIRED SESSION NUMBER ---
            const trimmedText = ctx.message.text.trim()
            if (/^\d+$/.test(trimmedText)) {
                return ctx.reply('¿Querías indicar la cantidad para una reserva? La sesión expiró. Entra al producto y pulsa «Reservar (Cliente)» de nuevo.', { parse_mode: 'Markdown' })
            }

            // --- INTENT DETECTION ---
            const queryLower = ctx.message.text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
            const intent = classifyIntent(queryLower)
            const userObj = await prisma?.user.findUnique({ where: { telegramId } })
            const userName = userObj?.name?.split(' ')[0] || 'amigo'
            // Multi-tenant: el catálogo que se busca es el del negocio del
            // usuario; visitantes sin cuenta ven el negocio por defecto (el
            // bot de este despliegue es mono-negocio por diseño).
            const searchBusinessId = userObj?.businessId ?? (await getDefaultBusinessId())

            if (intent === 'greeting') return await ctx.reply(`¡Hola ${userName}! 👋 ¿En qué puedo ayudarte? Escribe el nombre de un producto para buscar.\n\nTambién puedes usar /categorias o /ofertas.`)
            if (intent === 'help') return await ctx.reply(`📋 *Ayuda — ProSolutions*\n\n🔍 Escribe el nombre de un producto para buscar.\n   Ej: Pantalla iPhone 15\n\n/start - Reiniciar\n/perfil - Tu perfil\n/categorias - Catálogo por categoría\n/ofertas - Productos destacados`, { parse_mode: 'Markdown' })
            if (intent === 'profile') return await ctx.reply('Usa /perfil para ver tus datos.')
            if (intent === 'categories') return await ctx.reply('Usa /categorias para explorar los productos.')
            if (intent === 'offers') return await ctx.reply('Usa /ofertas para ver productos destacados.')
            if (intent === 'cancel') return await ctx.reply('No hay ningún proceso activo que cancelar.')
            if (['ayuda', 'perfil', 'categorias', 'ofertas', 'cancel'].includes(intent)) return

            // --- PRODUCT SEARCH ---
            try {
                ctx.sendChatAction('typing')
                const query = ctx.message.text.trim()
                const words = queryLower.split(/\s+/).filter(w => w.length >= 2 || /^\d+$/.test(w))
                if (words.length === 0) return await ctx.reply(`🔍 ${userName}, escribe al menos una palabra para buscar.`)

                const andConditions = words.map(word => ({
                    OR: [
                        { name: { contains: word, mode: 'insensitive' as const } },
                        { category: { name: { contains: word, mode: 'insensitive' as const } } },
                        { models: { some: { model: { brand: { name: { contains: word, mode: 'insensitive' as const } } } } } },
                        { models: { some: { model: { name: { contains: word, mode: 'insensitive' as const } } } } }
                    ]
                }))

                let products = await prisma.product.findMany({
                    where: { businessId: searchBusinessId, AND: andConditions, isActive: true, stock: { gt: 0 } },
                    take: 5,
                    include: { category: true },
                    orderBy: { stock: 'desc' }
                })

                let usedFuzzy = false
                if (products.length === 0) {
                    try {
                        const results: any[] = await prisma.$queryRaw`
                            SELECT p.id, p.name, p."retailPrice", p.stock
                            FROM "Product" p
                            WHERE p."isActive" = true AND p.stock > 0
                              AND p."businessId" = ${searchBusinessId}
                              AND similarity(p.name, ${queryLower}) > 0.3
                            ORDER BY similarity(p.name, ${queryLower}) DESC
                            LIMIT 3
                        `
                        if (results?.length > 0) { products = results; usedFuzzy = true }
                    } catch (e) {
                        if (words.length > 1) {
                            const orConditions = words.map(word => ({
                                OR: [
                                    { name: { contains: word, mode: 'insensitive' as const } },
                                    { category: { name: { contains: word, mode: 'insensitive' as const } } },
                                    { models: { some: { model: { name: { contains: word, mode: 'insensitive' as const } } } } }
                                ]
                            }))
                            const orProducts = await prisma.product.findMany({
                                where: { businessId: searchBusinessId, OR: orConditions, isActive: true, stock: { gt: 0 } },
                                take: 10, include: { category: true }
                            })
                            const scored = orProducts.map((p: any) => {
                                const name = p.name.toLowerCase()
                                let score = words.filter(w => name.includes(w)).length
                                return { ...p, score }
                            }).filter(p => p.score >= Math.max(1, Math.ceil(words.length / 2))).sort((a: any, b: any) => b.score - a.score)
                            products = scored.slice(0, 3)
                            if (products.length > 0) usedFuzzy = true
                        }
                    }
                }

                if (products.length === 0) {
                    return ctx.reply(`🤔 ${userName}, no encontré productos para «${query}».\n\n• Prueba con menos palabras\n• /categorias o /modelos`)
                }

                if (usedFuzzy) await ctx.reply(`🤔 ${userName}, no encontré exactamente eso, pero quizás buscas alguno de estos:`)

                const buttons = products.map((p: any) => [Markup.button.callback(`📦 ${p.name.substring(0, 35)}`, `prod_${p.id}`)])
                let msg = `🔎 *${products.length} resultado(s) para "${query}"*\n\n`
                products.forEach((p: any, i: number) => {
                    msg += `${i + 1}. *${p.name}*\n   💰 $${p.retailPrice} | ✅ ${p.stock} uds\n\n`
                })
                msg += '_Selecciona un producto:_'

                await ctx.reply(msg, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) })
            } catch (error) {
                console.error('Error processing message:', error)
                await ctx.reply('❌ Algo falló al buscar. Intenta /categorias.')
            }
        } catch (e) {
            console.error('[Text Handler] CRITICAL ERROR:', e)
            try { await ctx.reply('❌ Algo falló. Usa /cancelar e intenta de nuevo.') } catch (_) { }
        }
    })
}
