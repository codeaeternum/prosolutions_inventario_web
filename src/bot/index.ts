import 'dotenv/config'
import { Telegraf, Markup } from 'telegraf'
import { message } from 'telegraf/filters'
import { randomBytes } from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import * as https from 'https'
import * as QRCode from 'qrcode'
import * as cron from 'node-cron'
import { getPrisma } from './lib/prisma'
import { isAdmin, notifyAdmins } from './lib/notify'
import { requireAdmin, requirePrisma } from './lib/guards'
import { generateQRCode, normalizePhone } from './lib/utils'
import { loggerMiddleware } from './middlewares/logger'
import { registerStart } from './commands/start'
import { registerHelp } from './commands/help'
import { registerMiid } from './commands/miid'
import { registerCancelar } from './commands/cancelar'
import type { WizardState } from './commands/start'
import type { AdminProductState, ReservationState } from './commands/cancelar'

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN
const isDev = process.env.NODE_ENV !== 'production'

if (!BOT_TOKEN) {
    console.error('❌ TELEGRAM_BOT_TOKEN required')
    process.exit(1)
}

const bot = new Telegraf(BOT_TOKEN)
const _prisma = getPrisma()
// En Docker la BD está siempre disponible; sin DATABASE_URL getPrisma() puede ser null
const prisma = _prisma!

console.log('🤖 ProSolutions Bot Starting...')

bot.command('testnt', async (ctx) => {
    if (!(await requireAdmin(ctx))) return
    await ctx.reply('🔔 Enviando notificación de prueba a todos los admins...')
    await notifyAdmins(bot, `🧪 <b>Prueba de Notificación</b>\n\nSi ves esto, el sistema funciona para ti.\nID: ${ctx.from.id}`)
    await ctx.reply('✅ Proceso terminado. Revisa si llegaron los mensajes.')
})



bot.use(loggerMiddleware)

const registrationSessions: Record<string, WizardState> = {}
const adminProductSessions: Record<string, AdminProductState> = {}
const reservationSessions: Record<string, ReservationState> = {}

// Sesiones de flujos admin (eliminar, venta, carrito, qr, ajustes) — /cancelar las limpia
interface SaleSession {
    step: 'SELECT_PRODUCT' | 'CONFIRM'
    products?: { id: string; name: string; stock: number; retailPrice: number }[]
    selectedProduct?: { id: string; name: string; stock: number; retailPrice: number }
    quantity?: number
}
const saleSessions: Record<string, SaleSession> = {}
interface DeleteProductSession {
    step: 'SELECT' | 'CONFIRM'
    products?: { id: string; name: string; stock: number; _count: { reservations: number; movements: number } }[]
    selectedProduct?: { id: string; name: string; stock: number; _count: { reservations: number; movements: number } }
}
const deleteProductSessions: Record<string, DeleteProductSession> = {}
interface CartItem {
    id: string
    name: string
    quantity: number
    price: number
    stock: number
}
interface CartSession {
    items: CartItem[]
    pendingAdd?: { id: string; name: string; price: number; stock: number }
}
const cartSessions: Record<string, CartSession> = {}
interface QRSession {
    step: 'SELECT'
    products?: { id: string; name: string; barcode: string | null }[]
}
const qrSessions: Record<string, QRSession> = {}
const settingsSessions: Record<string, { key: string }> = {}

registerStart(bot, prisma, registrationSessions)
registerHelp(bot)
registerMiid(bot)
registerCancelar(bot, {
    registration: registrationSessions,
    adminProduct: adminProductSessions,
    reservation: reservationSessions,
    deleteProduct: deleteProductSessions,
    sale: saleSessions,
    cart: cartSessions,
    qr: qrSessions,
    settings: settingsSessions,
})

// Labels
const customerTypeLabels: Record<string, string> = {
    'TECHNICIAN': '🔧 Técnico de Reparación',
    'STORE': '🏪 Local de Refacciones',
    'NORMAL': '👤 Cliente Particular'
}

// COMANDO /admin - Panel de administración
bot.command('admin', async (ctx) => {
    if (!(await requireAdmin(ctx))) return
    await ctx.reply(`👑 *Panel de Administración*

📦 *Gestión de Productos:*
/agregar - Agregar nuevo producto
/stock - Actualizar stock (ej: /stock 123 50)
/eliminar <producto> - Eliminar producto

🛒 *Ventas en Local:*
/vender <producto> - Venta rápida (1 producto)
/carrito - Ver carrito actual
/agregarc <producto> - Agregar al carrito
/confirmarc - Confirmar venta del carrito
/vaciarc - Vaciar carrito
/qr <producto> - Obtener código QR

👥 *Gestión de Usuarios:*
/makeadmin <telefono|telegram_id> - Hacer administrador
/removeadmin <telefono|telegram_id> - Quitar administrador

📊 *Reportes:*
/pendientes - Ver reservas pendientes

🔔 *Notificaciones:*
Las alertas de nuevos pedidos llegarán aquí.

_Usa /cancelar para salir de cualquier proceso._`, { parse_mode: 'Markdown' })
})

// COMANDO /eliminar - Eliminar producto del inventario
bot.command('eliminar', async (ctx) => {
    const telegramId = ctx.from.id.toString()
    if (!(await requireAdmin(ctx))) return
    if (!(await requirePrisma(ctx))) return

    const args = ctx.message.text.split(' ').slice(1).join(' ').trim()

    if (!args) {
        return ctx.reply(`🗑️ *Eliminar Producto*

Uso: /eliminar <nombre_producto>

Ejemplo:
/eliminar pantalla iphone 14

⚠️ Esta acción es irreversible.`, { parse_mode: 'Markdown' })
    }

    try {
        // Search for matching products
        const products = await prisma.product.findMany({
            where: {
                OR: [
                    { name: { contains: args, mode: 'insensitive' } },
                    { barcode: args }
                ]
            },
            take: 5,
            select: {
                id: true,
                name: true,
                stock: true,
                _count: { select: { reservations: true, movements: true } }
            }
        })

        if (products.length === 0) {
            return ctx.reply(`❌ No se encontraron productos para: "${args}"`)
        }

        // Store products for selection
        deleteProductSessions[telegramId] = {
            step: 'SELECT',
            products
        }

        if (products.length === 1) {
            const p = products[0]
            deleteProductSessions[telegramId] = {
                step: 'CONFIRM',
                selectedProduct: p
            }
            return ctx.reply(`🗑️ *¿Eliminar este producto?*

📦 *${p.name}*
📊 Stock: ${p.stock}
🔗 Reservas: ${p._count.reservations}
📋 Movimientos: ${p._count.movements}

⚠️ Escribe *SI* para confirmar o /cancelar`, { parse_mode: 'Markdown' })
        }

        const productList = products.map((p: { id: string; name: string; stock: number; _count: { reservations: number; movements: number } }, i: number) =>
            `${i + 1}. *${p.name}* (Stock: ${p.stock})`
        ).join('\n')

        await ctx.reply(`🗑️ *Productos encontrados:*

${productList}

Responde con el número (1-${products.length}) para seleccionar o /cancelar`, { parse_mode: 'Markdown' })

    } catch (e) {
        console.error('Error in /eliminar:', e)
        await ctx.reply('❌ Error al buscar productos.')
    }
})

// COMANDO /makeadmin - Hacer administrador a un usuario
bot.command('makeadmin', async (ctx) => {
    if (!(await requireAdmin(ctx))) return
    if (!(await requirePrisma(ctx))) return

    const args = ctx.message.text.split(' ')
    if (args.length !== 2) {
        return ctx.reply('Uso: /makeadmin <telefono|telegram_id>\nEj: /makeadmin 5512345678')
    }

    const identifier = args[1].trim()

    try {
        // Buscar usuario por teléfono o telegram ID
        const user = await prisma.user.findFirst({
            where: {
                OR: [
                    { phone: { contains: identifier } },
                    { telegramId: identifier }
                ]
            }
        })

        if (!user) {
            return ctx.reply('❌ Usuario no encontrado. Verifica el teléfono o Telegram ID.')
        }

        if (user.role === 'ADMIN') {
            return ctx.reply(`⚠️ *${user.name}* ya es administrador.`, { parse_mode: 'Markdown' })
        }

        await prisma.user.update({
            where: { id: user.id },
            data: { role: 'ADMIN' }
        })

        await ctx.reply(`✅ *${user.name}* ahora es administrador. 👑

📱 Tel: ${user.phone || 'N/A'}
🆔 Telegram: ${user.telegramId || 'N/A'}`, { parse_mode: 'Markdown' })

        if (user.telegramId) {
            bot.telegram.sendMessage(user.telegramId, `👑 *¡Ahora eres Administrador!*

Un administrador te ha otorgado permisos de administrador.
Usa /admin para ver el panel de administración.`, { parse_mode: 'Markdown' }).catch(() => { })
        }

    } catch (e) {
        console.error('Error making admin:', e)
        await ctx.reply('❌ Error al procesar la solicitud.')
    }
})

// COMANDO /removeadmin - Quitar rol de administrador
bot.command('removeadmin', async (ctx) => {
    if (!(await requireAdmin(ctx))) return
    if (!(await requirePrisma(ctx))) return

    const telegramId = ctx.from.id.toString()
    const args = ctx.message.text.split(' ')
    if (args.length !== 2) {
        return ctx.reply('Uso: /removeadmin <telefono|telegram_id>\nEj: /removeadmin 5512345678')
    }

    const identifier = args[1].trim()

    try {
        // Buscar usuario por teléfono o telegram ID
        const user = await prisma.user.findFirst({
            where: {
                OR: [
                    { phone: { contains: identifier } },
                    { telegramId: identifier }
                ]
            }
        })

        if (!user) {
            return ctx.reply('❌ Usuario no encontrado. Verifica el teléfono o Telegram ID.')
        }

        if (user.role !== 'ADMIN') {
            return ctx.reply(`⚠️ *${user.name}* no es administrador.`, { parse_mode: 'Markdown' })
        }

        // Prevenir auto-degradación
        if (user.telegramId === telegramId) {
            return await ctx.reply('❌ No puedes quitarte el rol de administrador a ti mismo.')
        }

        await prisma.user.update({
            where: { id: user.id },
            data: { role: 'CUSTOMER' }
        })

        await ctx.reply(`✅ *${user.name}* ya no es administrador.

📱 Tel: ${user.phone || 'N/A'}
🆔 Telegram: ${user.telegramId || 'N/A'}`, { parse_mode: 'Markdown' })

        if (user.telegramId) {
            bot.telegram.sendMessage(user.telegramId, `ℹ️ *Tu rol de administrador ha sido removido.*

Ahora tienes acceso como cliente regular.`, { parse_mode: 'Markdown' }).catch(() => { })
        }

    } catch (e) {
        console.error('Error removing admin:', e)
        await ctx.reply('❌ Error al procesar la solicitud.')
    }
})

// COMANDO /vender - Registrar venta rápida en local
bot.command('vender', async (ctx) => {
    const telegramId = ctx.from.id.toString()
    if (!(await requireAdmin(ctx))) return
    if (!(await requirePrisma(ctx))) return

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
        // Search for matching products
        const products = await prisma.product.findMany({
            where: {
                OR: [
                    { name: { contains: args, mode: 'insensitive' } },
                    { barcode: args }
                ],
                stock: { gt: 0 }
            },
            take: 5,
            select: {
                id: true,
                name: true,
                stock: true,
                retailPrice: true
            }
        })

        if (products.length === 0) {
            return ctx.reply(`❌ No se encontraron productos con stock para: "${args}"`)
        }

        if (products.length === 1) {
            // Solo un producto, ir directo a confirmar
            saleSessions[telegramId] = {
                step: 'CONFIRM',
                selectedProduct: products[0],
                quantity: 1
            }

            return ctx.reply(`📦 *${products[0].name}*

📊 Stock: ${products[0].stock} unidades
💰 Precio: $${products[0].retailPrice.toLocaleString()}

¿Cuántas unidades vender? (escribe un número o /cancelar)`, { parse_mode: 'Markdown' })
        }

        // Multiple products, let user select
        saleSessions[telegramId] = {
            step: 'SELECT_PRODUCT',
            products
        }

        const productList = products.map((p: { name: string; stock: number; retailPrice: number }, i: number) =>
            `${i + 1}. *${p.name}*\n   Stock: ${p.stock} | $${p.retailPrice.toLocaleString()}`
        ).join('\n\n')

        await ctx.reply(`📦 *Productos encontrados:*

${productList}

Responde con el número (1-${products.length}) para seleccionar o /cancelar`, { parse_mode: 'Markdown' })

    } catch (e) {
        if (isDev) console.error('Error in /vender:', e)
        await ctx.reply('❌ Error al buscar productos. Usa /cancelar si estabas en otro proceso.')
    }
})

// COMANDO /carrito - Ver carrito actual
bot.command('carrito', async (ctx) => {
    const telegramId = ctx.from.id.toString()
    if (!(await requireAdmin(ctx))) return

    const cart = cartSessions[telegramId]
    if (!cart || cart.items.length === 0) {
        return ctx.reply(`🛒 *Carrito vacío*

Usa /agregarc <producto> para agregar productos.

Ejemplo:
/agregarc pantalla iphone 14`, { parse_mode: 'Markdown' })
    }

    const itemsList = cart.items.map((item: CartItem, i: number) =>
        `${i + 1}. *${item.name}*\n   📦 ${item.quantity} × $${item.price.toLocaleString()} = $${(item.quantity * item.price).toLocaleString()}`
    ).join('\n\n')

    const total = cart.items.reduce((sum: number, item: CartItem) => sum + item.quantity * item.price, 0)
    const totalItems = cart.items.reduce((sum: number, item: CartItem) => sum + item.quantity, 0)

    await ctx.reply(`🛒 *Tu Carrito* (${totalItems} productos)

${itemsList}

━━━━━━━━━━━━━━━━━━
💰 *TOTAL: $${total.toLocaleString()}*

/confirmarc - Confirmar venta
/vaciarc - Vaciar carrito
/agregarc <producto> - Agregar más`, { parse_mode: 'Markdown' })
})

// COMANDO /agregarc - Agregar producto al carrito
bot.command('agregarc', async (ctx) => {
    const telegramId = ctx.from.id.toString()
    if (!(await requireAdmin(ctx))) return
    if (!(await requirePrisma(ctx))) return

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

        // Initialize cart if not exists
        if (!cartSessions[telegramId]) {
            cartSessions[telegramId] = { items: [] }
        }

        if (products.length === 1) {
            const p = products[0]
            cartSessions[telegramId].pendingAdd = { id: p.id, name: p.name, price: p.retailPrice, stock: p.stock }
            return ctx.reply(`📦 *${products[0].name}*

📊 Stock: ${products[0].stock} unidades
💰 Precio: $${products[0].retailPrice.toLocaleString()}

¿Cuántas unidades agregar? (escribe un número)`, { parse_mode: 'Markdown' })
        }

        // Store pending selection
        cartSessions[telegramId].pendingAdd = undefined
        saleSessions[telegramId] = {
            step: 'SELECT_PRODUCT',
            products
        }

        const productList = products.map((p: { name: string; stock: number; retailPrice: number }, i: number) =>
            `${i + 1}. *${p.name}*\n   Stock: ${p.stock} | $${p.retailPrice.toLocaleString()}`
        ).join('\n\n')

        await ctx.reply(`📦 *Productos encontrados:*

${productList}

Responde con el número (1-${products.length}) para seleccionar`, { parse_mode: 'Markdown' })

    } catch (e) {
        console.error('Error in /agregarc:', e)
        await ctx.reply('❌ Error al buscar productos.')
    }
})

// COMANDO /confirmarc - Confirmar venta del carrito
bot.command('confirmarc', async (ctx) => {
    const telegramId = ctx.from.id.toString()
    if (!(await requireAdmin(ctx))) return
    if (!(await requirePrisma(ctx))) return

    const cart = cartSessions[telegramId]
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

bot.action('confirm_cart', async (ctx) => {
    const telegramId = ctx.from!.id.toString()
    if (!(await requireAdmin(ctx))) return
    if (!prisma) return

    const cart = cartSessions[telegramId]
    if (!cart || cart.items.length === 0) {
        await ctx.answerCbQuery('Carrito vacío')
        return ctx.editMessageText('🛒 El carrito está vacío.')
    }

    try {
        const adminUser = await prisma.user.findUnique({
            where: { telegramId },
            select: { id: true }
        })

        // Process all items in transaction
        await prisma.$transaction(async (tx) => {
            for (const item of cart.items) {
                const product = await tx.product.findUnique({
                    where: { id: item.id },
                    select: { id: true, stock: true }
                })

                if (!product || product.stock < item.quantity) {
                    throw new Error(`Stock insuficiente para ${item.name}`)
                }

                await tx.product.update({
                    where: { id: item.id },
                    data: { stock: product.stock - item.quantity }
                })

                await tx.inventoryMovement.create({
                    data: {
                        productId: item.id,
                        type: 'OUT',
                        quantity: item.quantity,
                        previousStock: product.stock,
                        newStock: product.stock - item.quantity,
                        reason: 'Venta en local (Bot - Carrito)',
                        unitPrice: item.price,
                        totalPrice: item.price * item.quantity,
                        userId: adminUser?.id
                    }
                })
            }
        })

        const total = cart.items.reduce((sum: number, item: CartItem) => sum + item.quantity * item.price, 0)
        const totalItems = cart.items.reduce((sum: number, item: CartItem) => sum + item.quantity, 0)
        const productCount = cart.items.length

        delete cartSessions[telegramId]

        await ctx.answerCbQuery('Venta registrada')
        await ctx.editMessageText(`✅ *¡Venta Registrada!*

🛒 ${productCount} producto(s)
🔢 ${totalItems} unidades totales
💰 Total: *$${total.toLocaleString()}*

El inventario ha sido actualizado.`, { parse_mode: 'Markdown' })

    } catch (e) {
        console.error('Error confirming cart:', e)
        await ctx.answerCbQuery('Error')
        await ctx.editMessageText(`❌ Error: ${e instanceof Error ? e.message : 'Error al procesar venta'}`)
    }
})

// COMANDO /vaciarc - Vaciar carrito
bot.command('vaciarc', async (ctx) => {
    const telegramId = ctx.from.id.toString()
    if (!(await requireAdmin(ctx))) return

    const cart = cartSessions[telegramId]
    if (!cart || cart.items.length === 0) {
        return ctx.reply('🛒 El carrito ya está vacío.')
    }

    delete cartSessions[telegramId]
    await ctx.reply('🗑️ Carrito vaciado.')
})

// COMANDO /qr - Obtener código QR de producto
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
        const products = await prisma.product.findMany({
            where: {
                OR: [
                    { name: { contains: args, mode: 'insensitive' } },
                    { barcode: args }
                ]
            },
            take: 5,
            select: { id: true, name: true, barcode: true }
        })

        if (products.length === 0) {
            return ctx.reply(`❌ No se encontraron productos para: "${args}"`)
        }

        if (products.length === 1) {
            const p = products[0]
            const qrData = p.barcode || p.id
            const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qrData)}`

            await ctx.replyWithPhoto({ url: qrUrl }, {
                caption: `📱 *${p.name}*\n\nCódigo: \`${qrData}\``,
                parse_mode: 'Markdown'
            })
            return
        }

        // Multiple products
        qrSessions[telegramId] = {
            step: 'SELECT',
            products
        }

        const productList = products.map((p: { name: string; barcode: string | null }, i: number) =>
            `${i + 1}. *${p.name}*`
        ).join('\n')

        await ctx.reply(`📱 *Productos encontrados:*

${productList}

Responde con el número (1-${products.length}) para obtener el QR`, { parse_mode: 'Markdown' })

    } catch (e) {
        console.error('Error in /qr:', e)
        await ctx.reply('❌ Error al generar QR.')
    }
})

// Handle sale session responses (números: QR, carrito, venta, eliminar)
// Si el usuario está en el paso GOAL del registro, dejar que el handler de texto lo procese (ej. "0")
bot.hears(/^\d+$/, async (ctx, next) => {
    const telegramId = ctx.from.id.toString()
    if (registrationSessions[telegramId]?.step === 'GOAL') {
        return next()
    }
    const number = parseInt(ctx.message.text)

    // Check QR session first
    const qrSession = qrSessions[telegramId]
    if (qrSession && qrSession.step === 'SELECT' && qrSession.products) {
        if (number < 1 || number > qrSession.products.length) {
            return ctx.reply(`Ingresa un número entre 1 y ${qrSession.products.length}`)
        }

        const p = qrSession.products[number - 1]
        const qrData = p.barcode || p.id
        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qrData)}`

        delete qrSessions[telegramId]

        await ctx.replyWithPhoto({ url: qrUrl }, {
            caption: `📱 *${p.name}*\n\nCódigo: \`${qrData}\``,
            parse_mode: 'Markdown'
        })
        return
    }

    // First check if there's a pending cart add
    const cart = cartSessions[telegramId]
    if (cart?.pendingAdd) {
        const pending = cart.pendingAdd
        if (number < 1 || number > pending.stock) {
            return ctx.reply(`❌ Cantidad inválida. Stock disponible: ${pending.stock}`)
        }

        // Check if product already in cart
        const existingIndex = cart.items.findIndex(item => item.id === pending.id)
        if (existingIndex >= 0) {
            cart.items[existingIndex].quantity += number
        } else {
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

📦 ${pending.name} × ${number}
💰 Subtotal: $${(pending.price * number).toLocaleString()}

🛒 *Total carrito: $${total.toLocaleString()}*

/carrito - Ver carrito
/agregarc <producto> - Agregar más
/confirmarc - Confirmar venta`, { parse_mode: 'Markdown' })
    }

    const session = saleSessions[telegramId]
    if (session) {
        if (session.step === 'SELECT_PRODUCT' && session.products) {
            if (number < 1 || number > session.products.length) {
                return ctx.reply(`Ingresa un número entre 1 y ${session.products.length}`)
            }

            const selected = session.products[number - 1]
            saleSessions[telegramId] = {
                step: 'CONFIRM',
                selectedProduct: selected,
                quantity: 1
            }

            return ctx.reply(`📦 *${selected.name}*

📊 Stock: ${selected.stock} unidades
💰 Precio: $${selected.retailPrice.toLocaleString()}

¿Cuántas unidades vender?`, { parse_mode: 'Markdown' })
        }

        if (session.step === 'CONFIRM' && session.selectedProduct) {
            if (number < 1 || number > session.selectedProduct.stock) {
                return ctx.reply(`❌ Cantidad inválida. Stock disponible: ${session.selectedProduct.stock}`)
            }

            saleSessions[telegramId] = {
                step: 'CONFIRM',
                selectedProduct: session.selectedProduct,
                quantity: number
            }

            const total = session.selectedProduct.retailPrice * number
            
            return ctx.reply(`📦 *Resumen de venta*

Producto: ${session.selectedProduct.name}
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

    // Handle delete product selection
    const deleteSession = deleteProductSessions[telegramId]
    if (deleteSession && deleteSession.step === 'SELECT' && deleteSession.products) {
        if (number < 1 || number > deleteSession.products.length) {
            return ctx.reply(`Ingresa un número entre 1 y ${deleteSession.products.length}`)
        }

        const selected = deleteSession.products[number - 1]
        deleteProductSessions[telegramId] = {
            step: 'CONFIRM',
            selectedProduct: selected
        }

        return ctx.reply(`🗑️ *¿Eliminar este producto?*

📦 *${selected.name}*
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
})

bot.action('cancel_sale', async (ctx) => {
    const telegramId = ctx.from!.id.toString()
    delete saleSessions[telegramId]
    await ctx.answerCbQuery()
    await ctx.editMessageText('❌ Venta cancelada.')
})

bot.action(/^confirm_sale_(.+)_(\d+)$/, async (ctx) => {
    const telegramId = ctx.from!.id.toString()
    if (!prisma) return
    if (!(await requireAdmin(ctx))) return

    const productId = ctx.match[1]
    const number = parseInt(ctx.match[2])

    try {
        // Get current stock
        const product = await prisma.product.findUnique({
            where: { id: productId },
            select: { id: true, name: true, stock: true, retailPrice: true }
        })

        if (!product || product.stock < number) {
            delete saleSessions[telegramId]
            await ctx.answerCbQuery('Stock insuficiente')
            return ctx.editMessageText('❌ Stock insuficiente.')
        }

        // Get admin user ID
        const adminUser = await prisma.user.findUnique({
            where: { telegramId },
            select: { id: true }
        })

        await prisma.$transaction(async (tx) => {
            await tx.product.update({
                where: { id: product.id },
                data: { stock: product.stock - number }
            })

            const newMovement = await tx.inventoryMovement.create({
                data: {
                    productId: product.id,
                    type: 'OUT',
                    quantity: number,
                    previousStock: product.stock,
                    newStock: product.stock - number,
                    reason: 'Venta en local (Bot)',
                    unitPrice: product.retailPrice,
                    totalPrice: product.retailPrice * number,
                    userId: adminUser?.id
                }
            })
            
            const total = product.retailPrice * number;
            const openRegister = await tx.cashRegister.findFirst({
                where: { status: "OPEN" }
            });
            
            if (openRegister) {
                await tx.cashMovement.create({
                    data: {
                        registerId: openRegister.id,
                        amount: total,
                        type: "IN",
                        description: `Venta Rápida Bot: ${product.name}`,
                        referenceType: "SALE",
                        referenceId: newMovement.id,
                        userId: adminUser?.id || "",
                    }
                });
            }
        })

        const total = product.retailPrice * number
        delete saleSessions[telegramId]

        const successMsg = `✅ *¡Venta registrada!*

📦 ${product.name}
🔢 Cantidad: ${number}
💰 Total: $${total.toLocaleString()}
📊 Stock restante: ${product.stock - number}`

        await ctx.answerCbQuery('Venta confirmada')
        await ctx.editMessageText(successMsg, { parse_mode: 'Markdown' })

        // Notify other admins
        notifyAdmins(bot, `📢 *Nueva Venta (Bot)*
        
👤 Por: Admin
${successMsg}`)

    } catch (e: any) {
        console.error('Error processing sale:', e)
        delete saleSessions[telegramId]
        await ctx.answerCbQuery('Error')
        await ctx.editMessageText(`❌ Error al procesar la venta.`)
    }
})

bot.action(/^confirm_delete_(.+)$/, async (ctx) => {
    const telegramId = ctx.from!.id.toString()
    if (!prisma) return
    if (!(await requireAdmin(ctx))) return

    const productId = ctx.match[1]
    const deleteSession = deleteProductSessions[telegramId]

    if (!deleteSession || deleteSession.step !== 'CONFIRM' || deleteSession.selectedProduct?.id !== productId) {
        await ctx.answerCbQuery('Sesión expirada')
        return ctx.editMessageText('❌ Sesión de eliminación expirada o inválida.')
    }

    try {
        await prisma.product.delete({
            where: { id: productId }
        })

        const productName = deleteSession.selectedProduct.name
        delete deleteProductSessions[telegramId]

        await ctx.answerCbQuery('Eliminado')
        return ctx.editMessageText(`✅ *Producto eliminado*\n\n🗑️ ${productName}\n\nEl producto y todos sus movimientos han sido eliminados.`, { parse_mode: 'Markdown' })
    } catch (e) {
        console.error('Error deleting product:', e)
        delete deleteProductSessions[telegramId]
        await ctx.answerCbQuery('Error')
        return ctx.editMessageText('❌ Error al eliminar el producto. Puede tener reservas activas.')
    }
})

// Handle "SI" confirmation for legacy (removed, handled by buttons)
bot.hears(/^(SI|si|Si|sI|Si|sí|SÍ)$/, async (ctx) => {
    // Legacy fallback, in case a user types SI
    const telegramId = ctx.from.id.toString()
    
    // 1. DELETE PRODUCT Check
    const deleteSession = deleteProductSessions[telegramId]
    if (deleteSession && deleteSession.step === 'CONFIRM' && deleteSession.selectedProduct && prisma) {
        try {
            await prisma.product.delete({
                where: { id: deleteSession.selectedProduct.id }
            })

            const productName = deleteSession.selectedProduct.name
            delete deleteProductSessions[telegramId]

            return ctx.reply(`✅ *Producto eliminado*\n\n🗑️ ${productName}\n\nEl producto y todos sus movimientos han sido eliminados.`, { parse_mode: 'Markdown' })

        } catch (e) {
            console.error('Error deleting product:', e)
            delete deleteProductSessions[telegramId]
            return ctx.reply('❌ Error al eliminar el producto. Puede tener reservas activas.')
        }
    }
})

// COMANDO /agregar - Wizard para agregar producto
bot.command('agregar', async (ctx) => {
    const telegramId = ctx.from.id.toString()
    if (!(await requireAdmin(ctx))) return

    adminProductSessions[telegramId] = { step: 'NAME', data: {} }
    await ctx.reply(`📦 *Agregar Nuevo Producto*

1️⃣ *¿Cuál es el nombre del producto?*
(Ej: "Pantalla iPhone 16 Pro Max OLED")

_Usa /cancelar para salir en cualquier momento._`, { parse_mode: 'Markdown' })
})

// COMANDO /stock - Actualizar stock
bot.command('stock', async (ctx) => {
    if (!(await requireAdmin(ctx))) return
    if (!(await requirePrisma(ctx))) return

    const args = ctx.message.text.split(' ')
    if (args.length !== 3) {
        return ctx.reply('Uso: /stock [ID_PRODUCTO] [CANTIDAD]\nEj: /stock abc123 50\n\nEl ID lo ves al crear con /agregar o en la web.')
    }

    const [, productId, quantity] = args
    const newStock = parseInt(quantity)

    if (isNaN(newStock) || newStock < 0) {
        return ctx.reply('❌ La cantidad debe ser un número positivo.')
    }

    try {
        const product = await prisma.product.update({
            where: { id: productId },
            data: { stock: newStock }
        })
        await ctx.reply(`✅ Stock actualizado:\n📦 ${product.name}\n📊 Nuevo stock: ${newStock} unidades`)
    } catch {
        await ctx.reply('❌ Producto no encontrado.')
    }
})

// COMANDO /pendientes - Ver reservas pendientes (Admin)
bot.command('pendientes', async (ctx) => {
    if (!(await requireAdmin(ctx))) return
    if (!(await requirePrisma(ctx))) return

    try {
        const reservations = await prisma.reservation.findMany({
            where: { status: { in: ['PENDING', 'PENDING_PAYMENT'] } },
            include: { user: true, product: true },
            orderBy: { createdAt: 'desc' },
            take: 15
        })

        if (reservations.length === 0) {
            return ctx.reply('✅ No hay reservas pendientes.')
        }

        let msg = `📋 *${reservations.length} reserva(s) pendiente(s):*\n\n`
        reservations.forEach((r: any, i: number) => {
            const exp = r.expiresAt ? new Date(r.expiresAt).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' }) : '—'
            const statusLabel = r.status === 'PENDING_PAYMENT' ? '⏳ Pago' : '🛒 Tienda'
            msg += `${i + 1}. *${r.product.name}*\n`
            msg += `   👤 ${r.user.name} | 📊 ${r.quantity} uds | 💰 $${r.totalPrice.toLocaleString()}\n`
            msg += `   📅 Expira: ${exp} | ${statusLabel}\n\n`
        })
        msg += '_Gestiona en la web: Admin → Reservas_'

        await ctx.reply(msg, { parse_mode: 'Markdown' })
    } catch (e) {
        console.error(e)
        await ctx.reply('❌ Error al obtener reservas. Usa /cancelar si estabas en otro proceso.')
    }
})

// COMANDO /misreservas - Ver mis reservas (Usuario)
bot.command('misreservas', async (ctx) => {
    if (!(await requirePrisma(ctx))) return

    const telegramId = ctx.from.id.toString()
    const user = await prisma.user.findUnique({ where: { telegramId } })
    
    if (user && user.status !== 'APPROVED' && user.role !== 'ADMIN') {
        return ctx.reply('⏳ Tu cuenta está pendiente de verificación o fue rechazada. Te avisaremos cuando se active.')
    }

    if (!user) return ctx.reply('⚠️ No estás registrado. Usa /start')

    try {
        const reservations = await prisma.reservation.findMany({
            where: { userId: user.id },
            include: { product: true },
            orderBy: { createdAt: 'desc' },
            take: 5
        })

        if (reservations.length === 0) {
            return ctx.reply('📦 No tienes reservas aún.\n\nBusca productos escribiendo su nombre.')
        }

        const statusLabels: Record<string, string> = {
            PENDING: 'Pendiente (pago en tienda)',
            PENDING_PAYMENT: 'Esperando comprobante',
            DEPOSIT_VERIFIED: 'Depósito verificado',
            COMPLETED: 'Completada',
            CANCELLED: 'Cancelada',
            EXPIRED: 'Expirada'
        }
        for (const r of reservations) {
            let statusEmoji = '🟡'
            if (r.status === 'COMPLETED') statusEmoji = '✅'
            if (r.status === 'CANCELLED' || r.status === 'EXPIRED') statusEmoji = '❌'
            if (r.status === 'PENDING_PAYMENT') statusEmoji = '⏳'

            const msg = `${statusEmoji} *${r.product.name}*
📊 ${r.quantity} uds | 💰 $${r.totalPrice.toLocaleString()}
📅 ${new Date(r.createdAt).toLocaleDateString()}
🔖 ${statusLabels[r.status] ?? r.status}`

            const buttons: any[] = []
            // Permitir cancelar si está pendiente
            if (['PENDING', 'PENDING_PAYMENT'].includes(r.status)) {
                buttons.push(Markup.button.callback('❌ Cancelar', `cancel_res_${r.id}`))
            }

            await ctx.reply(msg, {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([buttons])
            })
        }
    } catch (e) {
        console.error(e)
        await ctx.reply('❌ Error al obtener reservas.')
    }
})

// Acción: Cancelar Reserva (Usuario)
bot.action(/^cancel_res_(.+)$/, async (ctx) => {
    const reservationId = ctx.match[1]
    const telegramId = ctx.from!.id.toString()
    await ctx.answerCbQuery()

    try {
        const user = await prisma.user.findUnique({ where: { telegramId } })
        if (!user) return

        const reservation = await prisma.reservation.findFirst({
            where: { id: reservationId, userId: user.id },
            include: { product: true }
        })

        if (!reservation) {
            return ctx.reply('❌ No se encontró la reserva.')
        }

        if (!['PENDING', 'PENDING_PAYMENT'].includes(reservation.status)) {
            return ctx.reply('⚠️ Esta reserva ya no se puede cancelar.')
        }

        // Cancelar y devolver stock
        await prisma.$transaction([
            prisma.reservation.update({
                where: { id: reservationId },
                data: { status: 'CANCELLED' }
            }),
            prisma.product.update({
                where: { id: reservation.productId },
                data: { stock: { increment: reservation.quantity } }
            })
        ])

        await ctx.editMessageText(`❌ *Reserva Cancelada*\n\n📦 ${reservation.product.name}\nEstado: Cancelado por usuario`, { parse_mode: 'Markdown' })

    } catch (e) {
        console.error(e)
        await ctx.reply('❌ Error al cancelar reserva.')
    }
})

// COMANDO /ofertas - Ver productos destacados
bot.command('ofertas', async (ctx) => {
    if (!(await requirePrisma(ctx))) return

    try {
        // Productos con más stock (disponibilidad) como "ofertas"
        const products = await prisma.product.findMany({
            where: { isPublic: true, stock: { gt: 5 } },
            include: { category: true },
            orderBy: { stock: 'desc' },
            take: 5
        })

        if (products.length === 0) {
            return ctx.reply('📦 No hay ofertas disponibles en este momento.')
        }

        let msg = `🔥 *Productos Destacados:*\n\n`
        products.forEach((p: any, i: number) => {
            msg += `${i + 1}. *${p.name}*\n`
            msg += `   💰 $${p.retailPrice} | ✅ ${p.stock} uds\n`
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

// COMANDO /modelos - Ver por marca/modelo
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

    await ctx.reply('📱 *Selecciona una marca:*', {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(buttons)
    })
})

// Callback para marca seleccionada
bot.action(/^brand_(.+)$/, async (ctx) => {
    const brand = ctx.match[1]
    await ctx.answerCbQuery()

    try {
        const products = await prisma.product.findMany({
            where: {
                name: { contains: brand, mode: 'insensitive' },
                isPublic: true,
                stock: { gt: 0 }
            },
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

// Volver a marcas
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

    await ctx.editMessageText('📱 *Selecciona una marca:*', {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(buttons)
    })
})

// COMANDO /historial - Ver historial de compras
bot.command('historial', async (ctx) => {
    if (!(await requirePrisma(ctx))) return

    const telegramId = ctx.from.id.toString()
    const user = await prisma.user.findUnique({ where: { telegramId } })
    
    if (user && user.status !== 'APPROVED' && user.role !== 'ADMIN') {
        return ctx.reply('⏳ Tu cuenta está pendiente de verificación o fue rechazada. Te avisaremos cuando se active.')
    }

    if (!user) return ctx.reply('⚠️ No estás registrado. Usa /start')

    try {
        const history = await prisma.reservation.findMany({
            where: {
                userId: user.id,
                status: { in: ['COMPLETED', 'CANCELLED'] }
            },
            include: { product: true },
            orderBy: { createdAt: 'desc' },
            take: 10
        })

        if (history.length === 0) {
            return ctx.reply('📜 No tienes historial de compras finalizadas.')
        }

        let msg = `📜 *Historial de Compras:*\n\n`
        history.forEach((r: any, i: number) => {
            const statusIcon = r.status === 'COMPLETED' ? '✅' : r.status === 'CANCELLED' ? '❌' : '📦'
            msg += `${i + 1}. ${statusIcon} *${r.product.name}*\n`
            msg += `   📅 ${new Date(r.createdAt).toLocaleDateString()} | 💰 $${r.totalPrice}\n`
            msg += `   📊 ${r.quantity} uds\n\n`
        })

        await ctx.reply(msg, { parse_mode: 'Markdown' })
    } catch (e) {
        console.error(e)
        await ctx.reply('❌ Error al obtener historial.')
    }
})

// COMANDO /entregar - Marcar reserva como entregada (Admin)
bot.command('entregar', async (ctx) => {
    if (!(await requireAdmin(ctx))) return
    if (!(await requirePrisma(ctx))) return

    const args = ctx.message.text.split(' ')
    if (args.length !== 2) {
        return ctx.reply('Uso: /entregar [ID_RESERVA]\nEj: /entregar 123abcde')
    }

    const reservationIdStart = args[1]

    try {
        // Buscar reserva por inicio de ID
        const reservation = await prisma.reservation.findFirst({
            where: { id: { startsWith: reservationIdStart } },
            include: { user: true, product: true }
        })

        if (!reservation) {
            return ctx.reply('❌ No encontré ninguna reserva con ese ID.')
        }

        if (reservation.status === 'COMPLETED') {
            return ctx.reply('⚠️ Esta reserva ya fue entregada anteriormente.')
        }

        // Marcar como COMPLETED
        await prisma.reservation.update({
            where: { id: reservation.id },
            data: { status: 'COMPLETED' }
        })

        await ctx.reply(`✅ *Entrega Confirmada*

📦 ${reservation.product.name}
👤 ${reservation.user.name}
📊 ${reservation.quantity} uds
💰 $${reservation.totalPrice}

_Inventario ya fue descontado al reservar._`, { parse_mode: 'Markdown' })

        if (reservation.user.telegramId) {
            bot.telegram.sendMessage(reservation.user.telegramId, `✅ *¡Tu pedido ha sido entregado!*

Gracias por tu compra en ProSolutions.
Disfruta tu producto. ⭐️`, { parse_mode: 'Markdown' }).catch(() => { })
        }

    } catch (e) {
        console.error(e)
        await ctx.reply('❌ Error al procesar entrega.')
    }
})

// COMANDO /perfil
bot.command('perfil', async (ctx) => {
    if (!(await requirePrisma(ctx))) return

    const telegramId = ctx.from.id.toString()
    const user = await prisma.user.findUnique({ where: { telegramId } })
    
    if (user && user.status !== 'APPROVED' && user.role !== 'ADMIN') {
        return ctx.reply('⏳ Tu cuenta está pendiente de verificación o fue rechazada. Te avisaremos cuando se active.')
    }

    if (!user) return ctx.reply('⚠️ No estás registrado. Usa /start para registrarte.')

    const qrDisplay = user.qrCode || 'Pendiente'
    const tipoCliente = customerTypeLabels[user.customerType] || user.customerType

    let progressMsg = ''
    if (user.monthlyPurchaseGoal && user.monthlyPurchaseGoal > 0) {
        const current = user.currentMonthPurchases || 0
        const progress = (current / user.monthlyPurchaseGoal) * 100
        const progressBar = generateProgressBar(progress)
        progressMsg = `
📊 *Progreso del Mes:*
${progressBar} ${progress.toFixed(0)}%
💰 $${current.toFixed(0)} / $${user.monthlyPurchaseGoal.toFixed(0)}`
    }

    const creditBalance = user.creditBalance ?? 0
    const creditLimit = user.creditLimit
    const creditMsg = (creditLimit != null && creditLimit > 0) || creditBalance > 0
        ? `
💳 *Crédito:*
   Saldo a pagar: $${creditBalance.toLocaleString()}
   ${creditLimit != null ? `Límite: $${creditLimit.toLocaleString()}` : ''}`
        : ''

    try {
        const qrBuffer = await QRCode.toBuffer(qrDisplay)

        ctx.replyWithPhoto({ source: qrBuffer }, {
            caption: `👤 *Tu Perfil*

📛 *Nombre:* ${user.name}
${user.businessName ? `🏢 *Negocio:* ${user.businessName}\n` : ''}📱 *Teléfono:* ${user.phone || 'No registrado'}
🏷️ *Tipo:* ${tipoCliente}
${progressMsg}
${creditMsg}

🔲 *Código: ${qrDisplay}*
_Muestra este código en tienda para identificarte._`,
            parse_mode: 'Markdown'
        })
    } catch {
        await ctx.reply(`👤 *Tu Perfil* (Error gen QR)
        
Código: ${qrDisplay}`, { parse_mode: 'Markdown' })
    }
})

// --- HANDLER DE AJUSTES (Texto) ---
// Debe ir antes de otros handlers genéricos de texto
bot.on(message('text'), async (ctx, next) => {
    const telegramId = ctx.from.id.toString()

    // Si hay una sesión de ajustes activa
    if (settingsSessions[telegramId]) {
        const session = settingsSessions[telegramId]
        const newValue = ctx.message.text.trim()

        try {
            await prisma.systemSettings.upsert({
                where: { key: session.key },
                update: { value: newValue },
                create: { key: session.key, value: newValue }
            })

            delete settingsSessions[telegramId]
            await ctx.reply(`✅ *Ajuste guardado correctamente.*`, { parse_mode: 'Markdown' })
        } catch (e) {
            console.error(e)
            await ctx.reply('❌ Error al guardar ajuste.')
        }
        return // Detiene propagación (no busca productos)
    }

    return next() // Continúa a otros handlers (búsqueda, wizard, etc)
})

// ========== FOTOS (Admin/Usuario) ==========

bot.on(message('photo'), async (ctx) => {
    const telegramId = ctx.from.id.toString()
    const adminSession = adminProductSessions[telegramId]
    const reserveSession = reservationSessions[telegramId]

    // --- ADMIN: AGREGAR PRODUCTO (FOTO) ---
    if (adminSession && adminSession.step === 'PHOTO') {
        try {
            const photo = ctx.message.photo[ctx.message.photo.length - 1] // Mayor resolución
            const file = await ctx.telegram.getFile(photo.file_id)
            const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`

            // Descargar y guardar localmente
            const fileName = `${Date.now()}_${randomBytes(4).toString('hex')}.jpg`
            const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'products')

            // Crear directorio si no existe
            if (!fs.existsSync(uploadDir)) {
                fs.mkdirSync(uploadDir, { recursive: true })
            }

            const filePath = path.join(uploadDir, fileName)

            // Descargar archivo
            const fileStream = fs.createWriteStream(filePath)
            https.get(fileUrl, (response) => {
                response.pipe(fileStream)
                fileStream.on('finish', async () => {
                    fileStream.close()

                    adminSession.data.imageUrl = `/uploads/products/${fileName}`

                    // Crear producto en DB
                    const newProduct = await prisma.product.create({
                        data: {
                            name: adminSession.data.name!,
                            categoryId: adminSession.data.categoryId!,
                            retailPrice: adminSession.data.retailPrice!,
                            wholesalePrice: adminSession.data.wholesalePrice!,
                            stock: adminSession.data.stock!,
                            images: [adminSession.data.imageUrl],
                            isPublic: true
                        }
                    })

                    delete adminProductSessions[telegramId]
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

    // --- USUARIO: COMPROBANTE PAGO ---
    if (reserveSession && reserveSession.step === 'PROOF_UPLOAD') {
        try {
            const photo = ctx.message.photo[ctx.message.photo.length - 1]
            const file = await ctx.telegram.getFile(photo.file_id)

            // Usamos directamente el file_id para enviarlo después, o descargamos
            // Aquí descargamos para tener registro
            const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`

            const fileName = `pay_${Date.now()}_${randomBytes(4).toString('hex')}.jpg`
            const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'payments')

            if (!fs.existsSync(uploadDir)) {
                fs.mkdirSync(uploadDir, { recursive: true })
            }

            const filePath = path.join(uploadDir, fileName)
            const localUrl = `/uploads/payments/${fileName}`

            const fileStream = fs.createWriteStream(filePath)
            https.get(fileUrl, (response) => {
                response.pipe(fileStream)
                fileStream.on('finish', async () => {
                    fileStream.close()
                    await processReservation(ctx, 'TRANSFER', localUrl)
                })
            })

        } catch (e) {
            console.error('Error uploading proof:', e)
            await ctx.reply('❌ Error al procesar la foto. Intenta de nuevo.')
        }
        return
    }

    await ctx.reply('📸 Recibí tu foto. Si deseas agregar un producto, usa /agregar primero. Si envías comprobante, inicia una reserva.')
})

function generateProgressBar(percent: number): string {
    const filled = Math.min(10, Math.floor(percent / 10))
    const empty = 10 - filled
    return '█'.repeat(filled) + '░'.repeat(empty)
}

// COMANDO /categorias
bot.command('categorias', async (ctx) => {
    if (!(await requirePrisma(ctx))) return
    try {
        const categories = await prisma.category.findMany({ take: 20 })
        if (categories.length === 0) return ctx.reply('No hay categorías registradas.')

        // Crear botones inline para cada categoría
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

// ========== CALLBACK QUERIES (Botones) ==========

// Selección de categoría
bot.action(/^cat_(.+)$/, async (ctx) => {
    const categoryId = ctx.match[1]
    await ctx.answerCbQuery()

    try {
        const category = await prisma.category.findUnique({ where: { id: categoryId } })
        const products = await prisma.product.findMany({
            where: { categoryId, isPublic: true, stock: { gt: 0 } },
            take: 8,
            orderBy: { stock: 'desc' }
        })

        if (products.length === 0) {
            return ctx.editMessageText('📂 No hay productos disponibles en esta categoría.', {
                ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Volver', 'back_categories')]])
            })
        }

        const categoryName = category?.name?.toLowerCase() || ''

        // Helper: Quitar nombre de categoría redundante del producto
        const getShortName = (fullName: string) => {
            let name = fullName
            // Quitar prefijos comunes basados en la categoría
            const categoryWords = categoryName.split(/\s+/)
            for (const word of categoryWords) {
                if (word.length >= 3) {
                    const regex = new RegExp(`^${word}\\s*`, 'i')
                    name = name.replace(regex, '')
                }
            }
            // Si quedó muy corto, usar original
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

// Ver detalle de producto
bot.action(/^prod_(.+)$/, async (ctx) => {
    const productId = ctx.match[1]
    await ctx.answerCbQuery()

    try {
        const product = await prisma.product.findUnique({
            where: { id: productId },
            include: { category: true }
        })

        if (!product) {
            return ctx.editMessageText('❌ Producto no encontrado.')
        }

        const isAdminUser = await isAdmin(ctx.from.id.toString())

        const msg = `📦 *${product.name}*

${product.description ? `_${product.description}_\n` : ''}
📂 *Categoría:* ${product.category?.name || 'N/A'}
💰 *Precio:* $${product.retailPrice.toLocaleString()}
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

        // Si tiene imágenes, manejar carrusel
        if (product.images && product.images.length > 0) {
            if (isDev) console.log(`[Prod] Sending ${product.images.length} images for ${product.id}`)
            await ctx.deleteMessage().catch(() => { })

            // Validar imágenes antes de enviar
            const validMediaGroup: any[] = []

            for (let i = 0; i < product.images.length; i++) {
                const url = product.images[i]
                if (url.startsWith('/uploads')) {
                    const absPath = path.join(process.cwd(), 'public', url)
                    if (isDev) console.log(`[Prod] Checking local path: ${absPath}`)
                    if (fs.existsSync(absPath)) {
                        validMediaGroup.push({
                            type: 'photo',
                            media: { source: absPath },
                            caption: i === 0 ? `📸 ${product.name}` : undefined
                        })
                    } else {
                        console.error(`[Prod] Local image missing: ${absPath}`)
                    }
                } else if (url.startsWith('http')) {
                    validMediaGroup.push({
                        type: 'photo',
                        media: url,
                        caption: i === 0 ? `📸 ${product.name}` : undefined
                    })
                } else if (url.startsWith('data:')) {
                    // Soporte Base64
                    try {
                        const base64Data = url.split(',')[1]
                        const buffer = Buffer.from(base64Data, 'base64')
                        validMediaGroup.push({
                            type: 'photo',
                            media: { source: buffer },
                            caption: i === 0 ? `📸 ${product.name}` : undefined
                        })
                        if (isDev) console.log(`[Prod] Added base64 image ${i}`)
                    } catch (e) {
                        console.error('[Prod] Error processing base64 image', e)
                    }
                }
            }

            if (validMediaGroup.length > 1) {
                try {
                    await ctx.replyWithMediaGroup(validMediaGroup.slice(0, 10))
                    await ctx.reply(msg, {
                        parse_mode: 'Markdown',
                        ...Markup.inlineKeyboard(buttons)
                    })
                } catch (e: any) {
                    console.error('[Prod] Error sending MediaGroup:', e)
                    await ctx.reply(`⚠️ No pude cargar las imágenes (${e.message}).`)
                    await ctx.reply(msg, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) })
                }
            } else if (validMediaGroup.length === 1) {
                try {
                    await ctx.replyWithPhoto(validMediaGroup[0].media, {
                        caption: msg,
                        parse_mode: 'Markdown',
                        ...Markup.inlineKeyboard(buttons)
                    })
                } catch (e: any) {
                    console.error('[Prod] Error sending Photo:', e)
                    await ctx.reply(`⚠️ No pude cargar la imagen (${e.message}).`)
                    await ctx.reply(msg, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) })
                }
            } else {
                // Fallback: No valid images found
                console.warn('[Prod] No valid images found for product')
                await ctx.reply(`⚠️ Imagen no disponible.`)
                await ctx.reply(msg, {
                    parse_mode: 'Markdown',
                    ...Markup.inlineKeyboard(buttons)
                })
            }
        } else {
            // Solo texto
            await ctx.editMessageText(msg, {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard(buttons)
            })
        }
    } catch (e) {
        console.error('[Text Handler] CRITICAL ERROR:', e)
    }
})

// --- ACCIONES DE ADMINISTRADOR DESDE DETALLE ---

// Venta Rápida (1 unidad)
bot.action(/^fastsell_(.+)$/, async (ctx) => {
    const productId = ctx.match[1]
    await ctx.answerCbQuery()

    // Simular sesión de venta para 1 unidad
    const product = await prisma.product.findUnique({
        where: { id: productId },
        select: { id: true, name: true, stock: true, retailPrice: true } // Add retailPrice here
    })
    if (!product || product.stock < 1) return ctx.reply('❌ Sin stock.')

    const telegramId = ctx.from.id.toString()
    saleSessions[telegramId] = {
        step: 'CONFIRM',
        selectedProduct: product, // Now includes retailPrice
        quantity: 1
    }

    await ctx.reply(`📦 *Venta Rápida: ${product.name}*

Precio: $${product.retailPrice}
Cantidad: 1

¿Confirmar venta? (Escribe SI)`, { parse_mode: 'Markdown' })
})

// Agregar al Carrito (+1)
bot.action(/^addtocart_(.+)$/, async (ctx) => {
    const productId = ctx.match[1]
    const telegramId = ctx.from.id.toString()

    // Obtener producto
    const product = await prisma.product.findUnique({ where: { id: productId } })
    if (!product) return ctx.answerCbQuery('❌ Error')

    // Inicializar carrito si no existe
    if (!cartSessions[telegramId]) {
        cartSessions[telegramId] = { items: [] }
    }

    const cart = cartSessions[telegramId]
    const existingIndex = cart.items.findIndex(p => p.id === productId)

    if (existingIndex >= 0) {
        if (cart.items[existingIndex].quantity + 1 > product.stock) {
            return ctx.answerCbQuery('❌ Stock insuficiente')
        }
        cart.items[existingIndex].quantity += 1
    } else {
        if (product.stock < 1) return ctx.answerCbQuery('❌ Sin stock')
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
})

// Ver QR
bot.action(/^showqr_(.+)$/, async (ctx) => {
    const productId = ctx.match[1]
    await ctx.answerCbQuery()

    const product = await prisma.product.findUnique({ where: { id: productId } })
    if (!product) return

    const qrData = product.barcode || product.id
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qrData)}`

    await ctx.replyWithPhoto({ url: qrUrl }, {
        caption: `📱 *${product.name}*\n\nCódigo: \`${qrData}\``,
        parse_mode: 'Markdown'
    })
})

// Eliminar Producto
bot.action(/^delprod_(.+)$/, async (ctx) => {
    const productId = ctx.match[1]
    await ctx.answerCbQuery()

    const product = await prisma.product.findUnique({
        where: { id: productId },
        include: { _count: { select: { reservations: true, movements: true } } }
    })

    if (!product) return

    const telegramId = ctx.from.id.toString()
    deleteProductSessions[telegramId] = {
        step: 'CONFIRM',
        selectedProduct: product
    }

    await ctx.reply(`🗑️ *¿Eliminar este producto?*

📦 ${product.name}
⚠️ Ten cuidado, esta acción es irreversible.

Responde SI para confirmar.`, { parse_mode: 'Markdown' })
})

// Reservar producto (Inicio)
bot.action(/^reserve_(.+)$/, async (ctx) => {
    const productId = ctx.match[1]
    await ctx.answerCbQuery()

    const telegramId = ctx.from?.id.toString()
    if (!telegramId) return

    const user = await prisma.user.findUnique({ where: { telegramId } })
    if (!user) {
        return ctx.reply('⚠️ Debes estar registrado para reservar. Usa /start')
    }
    if (user.status !== 'APPROVED' && user.role !== 'ADMIN') {
        return ctx.reply('⏳ Tu cuenta está pendiente de verificación. Te avisaremos cuando se active para que puedas reservar.')
    }

    const product = await prisma.product.findUnique({ where: { id: productId } })
    if (!product || product.stock <= 0) {
        return ctx.reply('❌ Producto sin stock disponible.')
    }

    await ctx.reply(`🛒 *Reservar: ${product.name}*

💰 Precio: $${product.retailPrice}
✅ Stock: ${product.stock} uds

*¿Cuántas unidades deseas?*
(Responde con un número, ej: "2")

_Escribe "cancelar" para anular._`, { parse_mode: 'Markdown' })

    // Guardar estado de reserva pendiente
    reservationSessions[telegramId] = {
        productId: product.id,
        productName: product.name,
        price: product.retailPrice,
        maxStock: product.stock,
        step: 'QUANTITY'
    }
})

// PAGO: TIENDA
bot.action('pay_store', async (ctx) => {
    await ctx.answerCbQuery()
    await processReservation(ctx, 'STORE')
})

// PAGO: A CRÉDITO
bot.action('pay_credit', async (ctx) => {
    await ctx.answerCbQuery()
    await processReservation(ctx, 'CREDIT')
})

// PAGO: TRANSFERENCIA (pedir foto)
bot.action('pay_transfer', async (ctx) => {
    await ctx.answerCbQuery()
    const telegramId = ctx.from!.id.toString()
    const session = reservationSessions[telegramId]

    if (!session) return await ctx.reply('❌ Sesión expirada. Inicia de nuevo desde el producto.')

    session.step = 'PROOF_UPLOAD'

    const total = (session.price * (session.quantity || 1)).toLocaleString()
    const bankTransferRaw = await getSetting('bank_transfer_info', 'BBVA\nProSolutions SA\n0123456789')
    const bankCashRaw = await getSetting('bank_cash_info', 'OXXO\nJuan Pérez\n4152 3133 4444 5555')

    await ctx.reply(`🏦 *Opciones de Pago*

*1️⃣ TRANSFERENCIA / SPEI*
Realiza el pago de *$${total}* a:
${bankTransferRaw}

*2️⃣ DEPÓSITO EN EFECTIVO*
${bankCashRaw}

📸 *Envía la FOTO del comprobante aquí cuando hayas pagado.*
_Escribe "cancelar" para anular._`, { parse_mode: 'Markdown' })
})

async function processReservation(ctx: any, method: 'STORE' | 'TRANSFER' | 'CREDIT', proofUrl?: string) {
    const telegramId = ctx.from!.id.toString()
    const session = reservationSessions[telegramId]
    if (!session || !session.quantity) return

    try {
        const user = await prisma.user.findUnique({ where: { telegramId } })
        if (!user) return

        const totalPrice = session.price * session.quantity

        // Validar crédito si es pago a crédito
        if (method === 'CREDIT') {
            const limit = user.creditLimit ?? 0
            const balance = user.creditBalance ?? 0
            if (limit <= 0) {
                return ctx.reply('❌ No tienes línea de crédito asignada. Contacta al administrador.')
            }
            if (balance + totalPrice > limit) {
                return ctx.reply(`❌ Superas tu límite de crédito (saldo: $${balance.toLocaleString()}, límite: $${limit.toLocaleString()}). Elige otra forma de pago.`)
            }
        }

        const hoursStr = await getSetting('reservation_hours', '24')
        const hours = Math.max(1, parseInt(hoursStr, 10) || 24)
        const expiresAt = new Date()
        expiresAt.setHours(expiresAt.getHours() + hours)

        const reservation = await prisma.reservation.create({
            data: {
                userId: user.id,
                productId: session.productId,
                quantity: session.quantity,
                totalPrice,
                status: method === 'TRANSFER' ? 'PENDING_PAYMENT' : 'PENDING',
                expiresAt: expiresAt,
                paymentMethod: method,
                paymentProofUrl: method === 'CREDIT' ? null : proofUrl
            }
        })

        // Si es a crédito: registrar movimiento y actualizar saldo
        if (method === 'CREDIT') {
            await prisma.$transaction([
                prisma.creditMovement.create({
                    data: {
                        userId: user.id,
                        amount: totalPrice,
                        type: 'DEBT',
                        referenceType: 'RESERVATION',
                        referenceId: reservation.id,
                        notes: `Reserva #${reservation.id.slice(-8)} - ${session.productName} x${session.quantity}`,
                    },
                }),
                prisma.user.update({
                    where: { id: user.id },
                    data: { creditBalance: { increment: totalPrice } },
                }),
            ])
        }

        // Actualizar stock
        await prisma.product.update({
            where: { id: session.productId },
            data: { stock: { decrement: session.quantity } }
        })

        // Generar QR de la reserva con la URL
        const qrData = `${process.env.NEXTAUTH_URL || 'https://prosolutions.ascnex.com'}/verificar/${reservation.qrCode}`
        const qrBuffer = await QRCode.toBuffer(qrData)

        // Mensaje al usuario
        const methodLabel = method === 'STORE' ? 'Pago en Tienda' : method === 'TRANSFER' ? 'Transferencia' : 'A crédito'
        let userMsg = `✅ *¡Reserva Confirmada!*

📦 *${session.productName}*
📊 Cantidad: ${session.quantity}
💰 Total: $${totalPrice.toLocaleString()}
💳 Método: ${methodLabel}

🔖 ID: \`${reservation.id.substring(0, 8)}\`

_Muestra este QR al recoger:_`

        await ctx.replyWithPhoto({ source: qrBuffer }, {
            caption: userMsg,
            parse_mode: 'Markdown'
        })

        const admins = await prisma.user.findMany({ where: { role: 'ADMIN', telegramId: { not: null } } })

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
                if (method === 'TRANSFER' && proofUrl) {
                    // Enviar foto del comprobante
                    try {
                        // Si proofUrl es local path
                        if (proofUrl.startsWith('/uploads')) {
                            const localPath = path.join(process.cwd(), 'public', proofUrl)
                            await bot.telegram.sendPhoto(admin.telegramId, { source: localPath }, { caption: adminMsg, parse_mode: 'Markdown' })
                        } else {
                            await bot.telegram.sendPhoto(admin.telegramId, proofUrl, { caption: adminMsg, parse_mode: 'Markdown' })
                        }
                    } catch (e) {
                        bot.telegram.sendMessage(admin.telegramId, adminMsg, { parse_mode: 'Markdown' })
                    }
                } else {
                    bot.telegram.sendMessage(admin.telegramId, adminMsg, { parse_mode: 'Markdown' })
                }
            }
        }

        delete reservationSessions[telegramId]

    } catch (e) {
        console.error(e)
        delete reservationSessions[telegramId]
        await ctx.reply('❌ Error al procesar la reserva. Puedes intentar de nuevo o usar /cancelar.')
    }
}

// Volver a categorías
bot.action('back_categories', async (ctx) => {
    await ctx.answerCbQuery()

    const categories = await prisma.category.findMany({ take: 20 })
    const buttons = categories.map((c: any) => [Markup.button.callback(c.name, `cat_${c.id}`)])

    await ctx.editMessageText('📂 *Selecciona una categoría:*', {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(buttons)
    })
})

// REGISTRO: MANEJO DE BOTONES DE TIPO
bot.action(/^reg_type_(\d+)$/, async (ctx) => {
    const typeId = ctx.match[1]
    const telegramId = ctx.from.id.toString()
    const regSession = registrationSessions[telegramId]

    if (!regSession || regSession.step !== 'TYPE') {
        return ctx.answerCbQuery('⚠️ Sesión expirada o paso incorrecto.')
    }

    await ctx.answerCbQuery()

    if (typeId === '1') { // Technician
        regSession.data.customerType = 'TECHNICIAN'
        regSession.step = 'BUSINESS'
        await ctx.editMessageText('🔧 <b>Excelente!</b>\n\n¿Cuál es el nombre de tu taller?', { parse_mode: 'HTML' })
    } else if (typeId === '2') { // Store
        regSession.data.customerType = 'STORE'
        regSession.step = 'BUSINESS'
        await ctx.editMessageText('🏪 <b>Perfecto!</b>\n\n¿Cuál es el nombre de tu tienda?', { parse_mode: 'HTML' })
    } else if (typeId === '3') { // Normal
        regSession.data.customerType = 'NORMAL'
        regSession.step = 'PHONE'
        await ctx.editMessageText('3️⃣ <b>¿Cuál es tu número de teléfono?</b>\n(Para contactarte por tus pedidos)', { parse_mode: 'HTML' })
    }
})

// REGISTRO: BOTÓN DE META DE COMPRA (paso GOAL)
bot.action(/^reg_goal_(\d+)$/, async (ctx) => {
    const goalValue = parseInt(ctx.match[1], 10)
    const telegramId = ctx.from.id.toString()
    const regSession = registrationSessions[telegramId]

    if (!regSession || regSession.step !== 'GOAL') {
        await ctx.answerCbQuery('⚠️ Sesión expirada o paso incorrecto.')
        return
    }

    await ctx.answerCbQuery()

    const goal = goalValue === 0 ? null : goalValue
    if (!prisma) {
        delete registrationSessions[telegramId]
        await ctx.reply('✅ Registro simulado (Modo Offline).')
        return
    }

    try {
        const qrCode = generateQRCode()
        const newUser = await prisma.user.create({
            data: {
                name: regSession.data.name!,
                telegramId,
                phone: regSession.data.phone!,
                businessName: regSession.data.businessName,
                qrCode,
                customerType: regSession.data.customerType || 'NORMAL',
                monthlyPurchaseGoal: goal,
                role: 'CUSTOMER',
                status: 'PENDING'
            }
        })
        delete registrationSessions[telegramId]

        const tipoCliente = customerTypeLabels[newUser.customerType]
        const goalMsg = goal ? `\n📊 <b>Meta mensual:</b> $${goal.toLocaleString()}` : ''

        await ctx.reply(`✅ <b>¡Registro completado!</b>

📛 <b>Nombre:</b> ${newUser.name}
${newUser.businessName ? `🏢 <b>Negocio:</b> ${newUser.businessName}\n` : ''}🏷️ <b>Tipo:</b> ${tipoCliente}${goalMsg}

⏳ <b>Estado: Pendiente de Aprobación</b>
_Tu cuenta está bajo revisión. Te avisaremos cuando un administrador la active para que puedas ver precios y realizar reservas._`, { parse_mode: 'HTML' })

        notifyAdmins(bot, `📢 <b>Nuevo Usuario Registrado</b>
        
📛 ${newUser.name}
📱 ${newUser.phone}
🏷️ ${tipoCliente}

¿Deseas aprobar a este usuario?`, Markup.inlineKeyboard([
            [Markup.button.callback('✅ Aprobar', `approve_user_${newUser.id}`)],
            [Markup.button.callback('❌ Rechazar', `reject_user_${newUser.id}`)]
        ]))
    } catch (e) {
        console.error('[RegWizard] DB Error (goal button):', e)
        delete registrationSessions[telegramId]
        await ctx.reply('⚠️ Hubo un error guardando tu registro. Intenta de nuevo con /start')
    }
})

// ========== CONTACTO (compartir teléfono desde Telegram) ==========
// Si el usuario comparte su número con el botón de Telegram, el mensaje es "contact", no "text" — sin este handler el bot no responde.
bot.on(message('contact'), async (ctx) => {
    const telegramId = ctx.from.id.toString()
    const regSession = registrationSessions[telegramId]
    if (!regSession || regSession.step !== 'PHONE') return
    const phone = ctx.message.contact.phone_number
    if (!phone) {
        await ctx.reply('❌ No se pudo leer el número. Escribe tu teléfono, ej: 5512345678')
        return
    }
    regSession.data.phone = normalizePhone(phone)
    regSession.step = 'GOAL'
    await ctx.reply(`5️⃣ <b>¿Cuánto esperas comprar al mes aproximadamente?</b>

Esto nos ayuda a darte mejor atención. Selecciona una opción:`, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
            [Markup.button.callback('🤷 No sé', 'reg_goal_0')],
            [Markup.button.callback('💰 Menos de $5,000', 'reg_goal_5000')],
            [Markup.button.callback('💰 $5,000 - $15,000', 'reg_goal_10000')],
            [Markup.button.callback('💰 Más de $15,000', 'reg_goal_20000')]
        ])
    })
})

// ========== TEXTO (Búsqueda + Wizards) ==========

bot.on(message('text'), async (ctx, next) => {
    if (isDev) console.log(`[Debug] Pre-Handler Text: "${ctx.message.text}"`)
    return next()
})

// Intent Detection Types
type Intent = 'greeting' | 'help' | 'profile' | 'categories' | 'offers'
    | 'price_check' | 'stock_check' | 'reservation_status' | 'cancel'
    | 'thanks' | 'product_search'

// ---------- Aprobación de Usuarios desde Telegram ----------
bot.action(/^approve_user_(.+)$/, async (ctx) => {
    const userId = ctx.match[1]
    if (!(await isAdmin(ctx.from.id.toString()))) {
        return ctx.answerCbQuery('Solo administradores pueden hacer esto')
    }

    try {
        const user = await prisma!.user.update({
            where: { id: userId },
            data: { status: 'APPROVED' }
        })
        
        await ctx.answerCbQuery('Usuario aprobado')
        await ctx.editMessageText(`✅ <b>Usuario Aprobado</b>\n\n📛 ${user.name}\n📱 ${user.phone}`, { parse_mode: 'HTML' })
        
        if (user.telegramId) {
            bot.telegram.sendMessage(user.telegramId, `🎉 <b>¡Tu cuenta ha sido aprobada!</b>\n\nYa puedes ver precios, buscar productos y realizar reservas en nuestro bot.\n\nEscribe "Hola" o el nombre de un producto para comenzar.`, { parse_mode: 'HTML' })
        }
    } catch (e) {
        console.error(e)
        ctx.answerCbQuery('Error al aprobar')
    }
})

bot.action(/^reject_user_(.+)$/, async (ctx) => {
    const userId = ctx.match[1]
    if (!(await isAdmin(ctx.from.id.toString()))) {
        return ctx.answerCbQuery('Solo administradores pueden hacer esto')
    }

    try {
        const user = await prisma!.user.update({
            where: { id: userId },
            data: { status: 'REJECTED' }
        })
        
        await ctx.answerCbQuery('Usuario rechazado')
        await ctx.editMessageText(`❌ <b>Usuario Rechazado</b>\n\n📛 ${user.name}\n📱 ${user.phone}`, { parse_mode: 'HTML' })
    } catch (e) {
        console.error(e)
        ctx.answerCbQuery('Error al rechazar')
    }
})

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
    if (/adios|bye|hasta luego|nos vemos/.test(lower)) return 'thanks' // Reused for simplicity
    
    return 'product_search'
}

bot.on(message('text'), async (ctx) => {
    try {
        if (ctx.message.text.startsWith('/')) return

        const telegramId = ctx.from.id.toString()
        const regSession = registrationSessions[telegramId]
        const adminSession = adminProductSessions[telegramId]
        const reserveSession = reservationSessions[telegramId]

        if (isDev) {
            console.log(`[Debug] Text Handler - User: ${telegramId} Reg: ${!!regSession} Reserve: ${!!reserveSession}`)
        }


        // --- RESERVA PENDIENTE ---
        if (reserveSession) {
            // Manejar cancelación
            if (ctx.message.text.toLowerCase() === 'cancelar') {
                delete reservationSessions[telegramId]
                return ctx.reply('❌ Reserva cancelada.')
            }

            // PASO 1: CANTIDAD
            if (reserveSession.step === 'QUANTITY') {
                const quantity = parseInt(ctx.message.text.replace(/[^0-9]/g, ''))

                if (isNaN(quantity) || quantity <= 0) {
                    return ctx.reply('❌ Por favor ingresa un número válido (ej: "1" or "2")')
                }

                if (quantity > reserveSession.maxStock) {
                    return ctx.reply(`❌ Solo hay ${reserveSession.maxStock} unidades disponibles.`)
                }

                reserveSession.quantity = quantity
                reserveSession.step = 'PAYMENT_METHOD'

                const total = reserveSession.price * quantity
                const buttons: any[][] = [
                    [Markup.button.callback('🏢 Pago en Tienda (Pagar al recoger)', 'pay_store')],
                    [Markup.button.callback('🏦 Transferencia (Subir comprobante)', 'pay_transfer')]
                ]
                // Opción "A crédito" solo si la BD tiene crédito y hay saldo disponible (evita romper si migración no aplicada)
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
                } catch (_) { /* ignorar si falla crédito (ej. columnas no existen aún) */ }

                try {
                    return await ctx.reply(`💳 *¿Cómo deseas pagar?*

*Total:* $${total.toLocaleString()}

Selecciona una opción:`, {
                        parse_mode: 'Markdown',
                        ...Markup.inlineKeyboard(buttons)
                    })
                } catch (replyErr) {
                    console.error('[Reserve] Error al enviar opciones de pago:', replyErr)
                    try {
                        await ctx.reply('❌ No pude mostrar las opciones. Intenta de nuevo o escribe /cancelar para anular.')
                    } catch (_) { /* ignore */ }
                    return
                }
            }

            // PASO 3: ESCUCHAR COMPROBANTE (Solo texto aquí, foto en otro handler)
            if (reserveSession.step === 'PROOF_UPLOAD') {
                return ctx.reply('📸 Por favor envía la *FOTO* del comprobante de transferencia.')
            }

            return
        }

        // --- WIZARD DE REGISTRO ---
        if (regSession) {
            try {
                if (isDev) console.log(`[RegWizard] User ${telegramId} Step: ${regSession.step}`)

                if (regSession.step === 'NAME') {
                    regSession.data.name = ctx.message.text
                    regSession.step = 'TYPE'

                    const buttons = [
                        [Markup.button.callback('🔧 Técnico de Reparación', 'reg_type_1')],
                        [Markup.button.callback('🏪 Local de Refacciones', 'reg_type_2')],
                        [Markup.button.callback('👤 Cliente Particular', 'reg_type_3')]
                    ]

                    await ctx.reply(`2️⃣ <b>¿Qué tipo de cliente eres?</b>

Esto nos ayuda a ofrecerte los precios correctos.`, {
                        parse_mode: 'HTML',
                        ...Markup.inlineKeyboard(buttons)
                    })
                    return
                }

                // Step TYPE is now handled by actions, but keep a fallback just in case they type
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
                    await ctx.reply(`5️⃣ <b>¿Cuánto esperas comprar al mes aproximadamente?</b>

Esto nos ayuda a darte mejor atención. Selecciona una opción:`, {
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
                    const goal = parseInt(goalText) || 0

                    if (prisma) {
                        try {
                            const qrCode = generateQRCode()
                            const newUser = await prisma.user.create({
                                data: {
                                    name: regSession.data.name!,
                                    telegramId: telegramId,
                                    phone: regSession.data.phone!,
                                    businessName: regSession.data.businessName,
                                    qrCode: qrCode,
                                    customerType: regSession.data.customerType || 'NORMAL',
                                    monthlyPurchaseGoal: goal > 0 ? goal : null,
                                    role: 'CUSTOMER',
                                    status: 'APPROVED'
                                }
                            })
                            delete registrationSessions[telegramId]

                            const tipoCliente = customerTypeLabels[newUser.customerType]
                            const goalMsg = goal > 0 ? `\n📊 <b>Meta mensual:</b> $${goal}` : ''

                            return await ctx.reply(`✅ <b>¡Registro completado!</b>

📛 <b>Nombre:</b> ${newUser.name}
${newUser.businessName ? `🏢 <b>Negocio:</b> ${newUser.businessName}\n` : ''}🏷️ <b>Tipo:</b> ${tipoCliente}${goalMsg}

🔲 <b>Tu código QR:</b> <code>${qrCode}</code>

¿Quieres ver el catálogo? Escribe el nombre de un producto o usa /categorias.`, { parse_mode: 'HTML' })
                        } catch (e) {
                            console.error('[RegWizard] DB Error:', e)
                            return await ctx.reply('⚠️ Hubo un error guardando tu registro. Intenta de nuevo con /start')
                        }
                    } else {
                        delete registrationSessions[telegramId]
                        return ctx.reply('✅ Registro simulado (Modo Offline).')
                    }
                }
            } catch (e) {
                console.error('[RegWizard] General Error:', e)
                delete registrationSessions[telegramId]
                try { await ctx.reply('❌ Error en el proceso. Intenta de nuevo con /start') } catch (_) { /* ignore */ }
            }
            return
        }

        // --- WIZARD ADMIN: AGREGAR PRODUCTO ---
        if (adminSession) {
            if (adminSession.step === 'NAME') {
                adminSession.data.name = ctx.message.text
                adminSession.step = 'CATEGORY'

                const categories = await prisma.category.findMany({ take: 10 })
                const buttons = categories.map((c: any) => [Markup.button.callback(c.name, `addcat_${c.id}`)])

                await ctx.reply('2️⃣ *Selecciona la categoría:*', {
                    parse_mode: 'Markdown',
                    ...Markup.inlineKeyboard(buttons)
                })
                return
            }

            if (adminSession.step === 'PRICE_RETAIL') {
                const price = parseFloat(ctx.message.text.replace(/[^0-9.]/g, ''))
                if (isNaN(price) || price <= 0) {
                    return ctx.reply('❌ Ingresa un precio válido (número positivo).')
                }
                adminSession.data.retailPrice = price
                adminSession.step = 'PRICE_WHOLESALE'
                await ctx.reply('4️⃣ *Precio de MAYOREO:*\n(Solo el número, ej: "3500")', { parse_mode: 'Markdown' })
                return
            }

            if (adminSession.step === 'PRICE_WHOLESALE') {
                const price = parseFloat(ctx.message.text.replace(/[^0-9.]/g, ''))
                if (isNaN(price) || price <= 0) {
                    return ctx.reply('❌ Ingresa un precio válido (número positivo).')
                }
                adminSession.data.wholesalePrice = price
                adminSession.step = 'STOCK'
                await ctx.reply('5️⃣ *Stock inicial:*\n(Cantidad de unidades disponibles)', { parse_mode: 'Markdown' })
                return
            }

            if (adminSession.step === 'STOCK') {
                const stock = parseInt(ctx.message.text.replace(/[^0-9]/g, ''))
                if (isNaN(stock) || stock < 0) {
                    return ctx.reply('❌ Ingresa un número válido.')
                }
                adminSession.data.stock = stock
                adminSession.step = 'PHOTO'
                await ctx.reply(`6️⃣ *Foto del producto (opcional)*

📷 Envía la imagen ahora o escribe *saltar* para omitir.`, { parse_mode: 'Markdown' })
                return
            }

            if (adminSession.step === 'PHOTO' && ctx.message.text.toLowerCase() === 'saltar') {
                // Crear producto sin imagen
                const newProduct = await prisma.product.create({
                    data: {
                        name: adminSession.data.name!,
                        categoryId: adminSession.data.categoryId!,
                        retailPrice: adminSession.data.retailPrice!,
                        wholesalePrice: adminSession.data.wholesalePrice!,
                        stock: adminSession.data.stock!,
                        isPublic: true
                    }
                })

                delete adminProductSessions[telegramId]
                await ctx.reply(`✅ *Producto creado exitosamente!*

📦 *${newProduct.name}*
💰 Menudeo: $${newProduct.retailPrice}
💰 Mayoreo: $${newProduct.wholesalePrice}
📊 Stock: ${newProduct.stock}

ID: \`${newProduct.id}\``, { parse_mode: 'Markdown' })
                return
            }
            return
        }

        // --- POSIBLE CANTIDAD DE RESERVA SIN SESIÓN (sesión expirada o reinicio) ---
        const trimmedText = ctx.message.text.trim()
        if (/^\d+$/.test(trimmedText)) {
            return ctx.reply(
                '¿Querías indicar la cantidad para una reserva? La sesión expiró o no hay reserva en curso. Entra al producto y pulsa «Reservar (Cliente)» de nuevo.',
                { parse_mode: 'Markdown' }
            )
        }

        // --- INTENT DETECTION (Rules-based AI) ---
        const queryLower = ctx.message.text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
        const intent = classifyIntent(queryLower)

        const userObj = await prisma?.user.findUnique({ where: { telegramId } })
        const userName = userObj?.name?.split(' ')[0] || 'amigo'

        if (intent === 'greeting') {
            return await ctx.reply(`¡Hola ${userName}! 👋 ¿En qué puedo ayudarte? Escribe el nombre de un producto para buscar, por ejemplo: "Pantalla iPhone 15".\n\nTambién puedes usar /categorias o /ofertas.`)
        }
        if (intent === 'help') {
            return await ctx.reply(`📋 *Ayuda — ProSolutions*\n\n🔍 Escribe el nombre de un producto para buscar.\n   Ej: Pantalla iPhone 15\n\n/comandos:\n/start - Reiniciar\n/perfil - Tu perfil y código QR\n/categorias - Catálogo por categoría\n/ofertas - Productos destacados\n/miid - Tu ID de Telegram\n\n¿Necesitas algo más? Responde con tu búsqueda.`, { parse_mode: 'Markdown' })
        }
        if (intent === 'profile') {
            return await ctx.reply('Usa /perfil para ver tus datos, historial de compras y código QR de cliente.')
        }
        if (intent === 'categories') {
            return await ctx.reply('Usa /categorias para explorar los productos por categoría o /modelos para buscar por marca.')
        }
        if (intent === 'offers') {
            return await ctx.reply('Usa /ofertas para ver los productos más vendidos y destacados.')
        }
        if (intent === 'cancel') {
            return await ctx.reply('No hay ningún proceso activo que cancelar. Si necesitas buscar un producto, solo escribe su nombre.')
        }
        // --- RESPUESTAS CORTAS (INTENT DETECTION) ---
        if (['ayuda', 'perfil', 'categorias', 'ofertas', 'cancel'].includes(intent)) {
            return
        }

        // --- BÚSQUEDA CON AND LOGIC + FUZZY ---
        if (!prisma) return await ctx.reply('⚠️ Búsqueda no disponible temporalmente (Modo Offline).')

        try {
            ctx.sendChatAction('typing')
            const query = ctx.message.text.trim()

            // Palabras significativas (mínimo 2 caracteres)
            const words = queryLower.split(/\s+/).filter(w => w.length >= 2)

            if (words.length === 0) {
                return await ctx.reply(`🔍 ${userName}, por favor escribe al menos una palabra para buscar.\n\nEj: "Pantalla iPhone 15"`)
            }

            // BÚSQUEDA AND: Producto debe contener TODAS las palabras
            const andConditions = words.map(word => ({
                OR: [
                    { name: { contains: word, mode: 'insensitive' as const } },
                    { category: { name: { contains: word, mode: 'insensitive' as const } } },
                    { models: { some: { model: { brand: { name: { contains: word, mode: 'insensitive' as const } } } } } },
                    { models: { some: { model: { name: { contains: word, mode: 'insensitive' as const } } } } }
                ]
            }))

            let products = await prisma.product.findMany({
                where: {
                    AND: andConditions,
                    isPublic: true,
                    stock: { gt: 0 }
                },
                take: 5,
                include: { category: true },
                orderBy: { stock: 'desc' }
            })

            // FALLBACK: Fuzzy Search con pg_trgm
            let usedFuzzy = false
            if (products.length === 0) {
                try {
                    const results: any[] = await prisma.$queryRaw`
                        SELECT p.id, p.name, p."retailPrice", p.stock
                        FROM "Product" p
                        WHERE p."isActive" = true AND p."isPublic" = true AND p.stock > 0
                          AND similarity(p.name, ${queryLower}) > 0.3
                        ORDER BY similarity(p.name, ${queryLower}) DESC
                        LIMIT 3
                    `
                    if (results && results.length > 0) {
                        products = results
                        usedFuzzy = true
                    }
                } catch (e) {
                    // Si falla pg_trgm, fallback a OR con scoring
                    if (words.length > 1) {
                        const orConditions = words.map(word => ({
                            OR: [
                                { name: { contains: word, mode: 'insensitive' as const } },
                                { category: { name: { contains: word, mode: 'insensitive' as const } } },
                                { models: { some: { model: { name: { contains: word, mode: 'insensitive' as const } } } } }
                            ]
                        }))

                        const orProducts = await prisma.product.findMany({
                            where: {
                                OR: orConditions,
                                isPublic: true,
                                stock: { gt: 0 }
                            },
                            take: 10,
                            include: { category: true }
                        })

                        const scored = orProducts.map((p: any) => {
                            const name = p.name.toLowerCase()
                            let score = words.filter(w => name.includes(w)).length
                            return { ...p, score }
                        }).filter(p => p.score >= Math.max(1, Math.ceil(words.length / 2))) // Solo si hay buena coincidencia
                        .sort((a: any, b: any) => b.score - a.score)

                        products = scored.slice(0, 3)
                        if (products.length > 0) usedFuzzy = true
                    }
                }
            }

            if (products.length === 0) {
                return ctx.reply(`🤔 ${userName}, no encontré productos para «${query}».\n\n• Prueba con menos palabras (ej: «Pantalla» o «Batería»)\n• Revisa la ortografía\n• Ver todo el catálogo: /categorias o /modelos`)
            }

            if (usedFuzzy) {
                await ctx.reply(`🤔 ${userName}, no encontré exactamente eso, pero quizás buscas alguno de estos:`)
            }

            // Crear botones inline para cada producto
            const buttons = products.map((p: any) => [
                Markup.button.callback(`📦 ${p.name.substring(0, 35)}`, `prod_${p.id}`)
            ])

            let msg = `🔎 *${products.length} resultado(s) para "${query}"*\n\n`
            products.forEach((p: any, i: number) => {
                msg += `${i + 1}. *${p.name}*\n   💰 $${p.retailPrice} | ✅ ${p.stock} uds\n\n`
            })
            msg += '_Selecciona un producto:_'

            await ctx.reply(msg, {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard(buttons)
            })

        } catch (error) {
            console.error('Error processing message:', error)
            await ctx.reply('❌ Algo falló al buscar. Vuelve a intentar en un momento.\nSi sigue pasando, escribe /ayuda o intenta /categorias.')
        }
    } catch (e) {
        console.error('[Text Handler] CRITICAL ERROR:', e)
        try {
            await ctx.reply('❌ Algo falló. Si estabas reservando, escribe /cancelar e intenta de nuevo desde el producto.')
        } catch (_) { /* evitar doble fallo */ }
    }
})

// Callback para selección de categoría en wizard admin
bot.action(/^addcat_(.+)$/, async (ctx) => {
    const categoryId = ctx.match[1]
    await ctx.answerCbQuery()

    const telegramId = ctx.from?.id.toString()
    if (!telegramId) return

    const adminSession = adminProductSessions[telegramId]
    if (!adminSession || adminSession.step !== 'CATEGORY') {
        return ctx.editMessageText('❌ Sesión expirada. Usa /agregar para reiniciar.')
    }

    adminSession.data.categoryId = categoryId
    adminSession.step = 'PRICE_RETAIL'

    await ctx.editMessageText('3️⃣ *Precio de MENUDEO:*\n(Solo el número, ej: "4500")', { parse_mode: 'Markdown' })
})

// Launch con menú de comandos
bot.launch(async () => {
    console.log('🚀 Bot is running!')

    // Configurar menú de comandos
    try {
        await bot.telegram.setMyCommands([
            { command: 'start', description: '🏠 Iniciar' },
            { command: 'categorias', description: '📂 Por categoría' },
            { command: 'modelos', description: '📱 Por marca' },
            { command: 'ofertas', description: '🔥 Destacados' },
            { command: 'misreservas', description: '📋 Mis reservas pendientes' },
            { command: 'historial', description: '📜 Historial compras' },
            { command: 'perfil', description: '👤 Mi perfil' },
            { command: 'cancelar', description: '❌ Cancelar' },
            { command: 'ayuda', description: '❓ Ayuda' }
        ])
        console.log('✅ Menú de comandos configurado')
    } catch (e) {
        console.error('Error configurando menú:', e)
    }
})


// Cron Job: Cancelar reservas vencidas cada 30 min
cron.schedule('*/30 * * * *', async () => {
    if (isDev) console.log('⏳ Checking for expired reservations...')

    try {
        const expired = await prisma.reservation.findMany({
            where: {
                status: 'PENDING',
                expiresAt: { lt: new Date() }
            },
            include: { user: true, product: true }
        })

        for (const r of expired) {
            // Cancelar reserva
            await prisma.reservation.update({
                where: { id: r.id },
                data: { status: 'CANCELLED' }
            })

            // Devolver Stock
            await prisma.product.update({
                where: { id: r.productId },
                data: { stock: { increment: r.quantity } }
            })

            if (r.user.telegramId) {
                bot.telegram.sendMessage(r.user.telegramId, `⏰ *Tu reserva ha expirado*\n\nEl producto *${r.product.name}* ha sido liberado.`, { parse_mode: 'Markdown' })
                    .catch(() => { })
            }

            if (isDev) console.log(`❌ Cancelled expired reservation: ${r.id}`)
        }
    } catch (e) {
        console.error('Error in expiration job:', e)
    }
})

// ========== AJUSTES DEL SISTEMA ==========

interface SystemSetting {
    key: string
    value: string
    label: string
}

async function getSetting(key: string, defaultValue: string): Promise<string> {
    const setting = await prisma.systemSettings.findUnique({ where: { key } })
    return setting?.value || defaultValue
}

bot.command('ajustes', async (ctx) => {
    if (!(await requireAdmin(ctx))) return
    if (!(await requirePrisma(ctx))) return

    const usd = await getSetting('usd_rate', '20.00')
    const hours = await getSetting('reservation_hours', '24')
    const bank = await getSetting('bank_info', 'BBVA | ProSolutions SA | 0123456789')

    await ctx.reply(`⚙️ *Ajustes del Sistema*

💵 *Dólar:* $${usd} MXN
⏳ *Expiración:* ${hours} horas
🏦 *Banco:* ${bank}

_Selecciona qué deseas modificar:_`, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
            [Markup.button.callback('💵 Cambiar Dólar', 'set_usd')],
            [Markup.button.callback('⏳ Cambiar Horas', 'set_hours')],
            [Markup.button.callback('🏦 Cambiar Banco', 'set_bank')]
        ])
    })
})

bot.action(['set_usd', 'set_hours', 'set_bank'], async (ctx) => {
    if (!(await requireAdmin(ctx))) return
    const telegramId = ctx.from!.id.toString()

    const keyMap: Record<string, string> = {
        'set_usd': 'usd_rate',
        'set_hours': 'reservation_hours',
        'set_bank': 'bank_info'
    }
    const labelMap: Record<string, string> = {
        'set_usd': 'el precio del Dólar (ej: 20.50) (Referencia interna)',
        'set_hours': 'las horas de expiración (ej: 48)',
        'set_bank': 'la info del Banco (ej: Banco | Nombre | Cuenta)'
    }

    const action = ctx.match[0]
    const key = keyMap[action]

    settingsSessions[telegramId] = { key }

    await ctx.reply(`✏️ *Ingresa el nuevo valor para ${labelMap[action]}:*`)
    await ctx.answerCbQuery()
})


process.once('SIGINT', () => bot.stop('SIGINT'))
process.once('SIGTERM', () => bot.stop('SIGTERM'))
