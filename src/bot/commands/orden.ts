import { Markup, type Context } from 'telegraf'
import { message } from 'telegraf/filters'
import type { BotContext, OrdenSession } from '../lib/types'
import { getBotAccount, requirePrisma } from '../lib/guards'
import { notifyAdmins } from '../lib/notify'
import { escapeHtml } from '../lib/registration'
import { normalizePhone } from '../lib/utils'
import { createRepair } from '../../lib/domain/workshop'
import { delegateRepairToPartner, resolveRepairPartner } from '../../lib/domain/delegation'
import { BusinessError } from '../../lib/domain/operations'
import { hasBranchAccess, hasModule } from '../../lib/access'
import { DEVICE_PROFILES } from '../../lib/device-profiles'
import { formatFolio, parseFolioDigits } from '../../lib/workshop-labels'

/**
 * /orden — recepción de una orden de reparación desde Telegram.
 *
 * Es el equivalente del bot a /admin/taller/recibir + "Enviar a taller":
 * un staff (ADMIN/EMPLOYEE con módulo "taller") de un negocio captador
 * registra el equipo del cliente en un wizard y, si el negocio tiene taller
 * asociado configurado (SystemSettings["repair_partner_business_id"]), puede
 * delegarlo con un botón — la orden espejo la crea delegateRepairToPartner
 * en el tenant reparador.
 *
 * Sesiones: sessions.orden[telegramId] (se limpia con /cancelar).
 *
 * ORDEN DE REGISTRO (index.ts): este módulo debe quedar ANTES de los
 * hears de sales.ts y del handler de texto principal de products.ts —
 * ese handler es terminal (no llama next()), así que un listener de texto
 * registrado después jamás vería las respuestas del wizard.
 */

// Roles que operan el taller: el dominio exige permission "staff"
// (operations.actor → ADMIN/EMPLOYEE). CUSTOMER y WORKSHOP reciben negación.
type StaffAccount = NonNullable<Awaited<ReturnType<typeof getBotAccount>>>

/** null = sin acceso; string = motivo legible para el usuario. */
function workshopGate(user: StaffAccount | null): string | null {
    if (!user) return '⚠️ No tienes cuenta registrada. Usa /start primero.'
    if (user.status !== 'APPROVED') return '⏳ Tu cuenta está pendiente de aprobación.'
    if (user.role !== 'ADMIN' && user.role !== 'EMPLOYEE') {
        return '🚫 /orden es solo para el personal del negocio. Si buscas tus equipos o productos, usa /ayuda.'
    }
    // Misma regla que la web: POST /api/workshop exige requireModule("taller").
    if (!hasModule(user, 'taller')) return '🚫 Tu cuenta no tiene acceso al módulo de taller.'
    return null
}

const SKIP_WORDS = new Set(['saltar', '-', 'no', 'n/a', 'na'])
const isSkip = (text: string) => SKIP_WORDS.has(text.trim().toLowerCase())

export function registerOrden({ bot, prisma, sessions, isDev }: BotContext) {

    // ---------- helpers de lectura (siempre por businessId del staff) ----------

    async function settingOf(businessId: string, key: string): Promise<string | null> {
        const row = await prisma.systemSettings.findUnique({
            where: { businessId_key: { businessId, key } },
            select: { value: true },
        })
        return row?.value ?? null
    }

    /** Tipos de equipo del negocio (SystemSettings workshop_equipment_types,
     *  JSON); fallback al catálogo por defecto de device-profiles. El teclado
     *  se acota a ~8 + "Otro", igual que la recepción web. */
    async function equipmentTypesOf(businessId: string): Promise<string[]> {
        try {
            const parsed: unknown = JSON.parse((await settingOf(businessId, 'workshop_equipment_types')) ?? '')
            if (Array.isArray(parsed)) {
                const list = parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
                if (list.length) return capTypes(list)
            }
        } catch { /* ajuste ausente o inválido → catálogo por defecto */ }
        return capTypes(Object.keys(DEVICE_PROFILES))
    }

    function capTypes(list: string[]): string[] {
        const rest = list.filter(t => t !== 'Otro').slice(0, 8)
        return [...rest, 'Otro']
    }

    /** Marcas frecuentes del catálogo de modelos (global + tenant) como chips. */
    async function brandChipsOf(businessId: string): Promise<string[]> {
        try {
            const rows = await prisma.deviceModel.findMany({
                where: { OR: [{ businessId: null }, { businessId }] },
                select: { brand: true },
                distinct: ['brand'],
                orderBy: { brand: 'asc' },
                take: 6,
            })
            return rows.map(row => row.brand)
        } catch {
            return []
        }
    }

    /** Resuelve las marcas sugeridas para el paso BRAND del wizard. */
    async function refreshBrandChips(session: OrdenSession, telegramId: string) {
        const user = await getBotAccount(prisma, telegramId)
        session.brandChips = user ? await brandChipsOf(user.businessId) : []
    }

    /** Folio impreso con order_prefix/order_folio_digits del negocio — mismo
     *  formato que folioOf de domain/delegation para que coincida con tickets. */
    async function folioOf(businessId: string, number: number): Promise<string> {
        const [prefix, digitsRaw] = await Promise.all([
            settingOf(businessId, 'order_prefix').catch(() => null),
            settingOf(businessId, 'order_folio_digits').catch(() => null),
        ])
        return formatFolio(prefix, number, parseFolioDigits(digitsRaw))
    }

    /** Link público de rastreo (/<slug>/order-status; /seguimiento como
     *  fallback), con los últimos 4 dígitos del teléfono prellenados — igual
     *  que el botón "Compartir" de la ficha web. */
    async function trackingUrl(businessId: string, folio: string, phone: string): Promise<string> {
        const business = await prisma.business.findUnique({ where: { id: businessId }, select: { slug: true } }).catch(() => null)
        const phone4 = phone.replace(/\D/g, '').slice(-4)
        const base = (process.env.NEXTAUTH_URL || 'https://reficio.app').replace(/\/+$/, '')
        const path = business?.slug ? `/${business.slug}/order-status` : '/seguimiento'
        return `${base}${path}?folio=${encodeURIComponent(folio)}${phone4 ? `&t=${phone4}` : ''}`
    }

    /** Sucursales activas del negocio ∩ sucursales permitidas del staff. */
    async function branchesOf(user: StaffAccount) {
        const branches = await prisma.branch.findMany({
            where: { businessId: user.businessId, isActive: true },
            orderBy: { name: 'asc' },
            select: { id: true, name: true },
        })
        return branches.filter(branch => hasBranchAccess(user, branch.id))
    }

    const branchName = (session: OrdenSession) =>
        session.branches?.find(branch => branch.id === session.data.branchId)?.name ?? '—'

    function summaryText(session: OrdenSession): string {
        const d = session.data
        const equipo = [d.equipmentType, d.brand, d.model].filter(Boolean).join(' ')
        return `📋 <b>Resumen de la orden</b>

👤 Cliente: <b>${escapeHtml(d.customerName)}</b>
📞 Teléfono: ${escapeHtml(d.customerPhone)}
🔧 Equipo: ${escapeHtml(equipo)}
🛠 Falla reportada: ${escapeHtml(d.reportedIssue)}
🏢 Sucursal: ${escapeHtml(branchName(session))}

¿Crear la orden de reparación?`
    }

    async function askNext(ctx: Context, telegramId: string, session: OrdenSession) {
        switch (session.step) {
            case 'NAME':
                return ctx.reply('1️⃣ <b>Nombre del cliente:</b>', { parse_mode: 'HTML' })
            case 'PHONE':
                return ctx.reply('2️⃣ <b>Teléfono del cliente:</b>\n(Con lada, ej: <code>55 1234 5678</code>)', { parse_mode: 'HTML' })
            case 'TYPE': {
                const types = session.equipmentTypes ?? []
                const rows = []
                for (let i = 0; i < types.length; i += 2) {
                    rows.push(types.slice(i, i + 2).map((t, j) => Markup.button.callback(t, `orden_type_${i + j}`)))
                }
                return ctx.reply('3️⃣ <b>Tipo de equipo:</b>\n(Elige un botón o escribe el tipo)', {
                    parse_mode: 'HTML',
                    ...Markup.inlineKeyboard(rows),
                })
            }
            case 'BRAND': {
                const chips = session.brandChips ?? []
                const rows = chips.map((chip, i) => [Markup.button.callback(chip, `orden_brand_${i}`)])
                rows.push([Markup.button.callback('⏭️ Omitir', 'orden_skip_brand')])
                return ctx.reply('4️⃣ <b>Marca del equipo:</b>\n(Escribe la marca, elige un chip u omite)', {
                    parse_mode: 'HTML',
                    ...Markup.inlineKeyboard(rows),
                })
            }
            case 'MODEL':
                return ctx.reply('5️⃣ <b>Modelo del equipo:</b>\n(Ej: <code>iPhone 13</code> · escribe <code>saltar</code> para omitir)', {
                    parse_mode: 'HTML',
                    ...Markup.inlineKeyboard([[Markup.button.callback('⏭️ Omitir', 'orden_skip_model')]]),
                })
            case 'ISSUE':
                return ctx.reply('6️⃣ <b>Falla que reporta el cliente:</b>\n(Descríbela brevemente, ej: "no enciende", "pantalla rota")', { parse_mode: 'HTML' })
            case 'BRANCH': {
                const rows = (session.branches ?? []).map((branch, i) => [Markup.button.callback(`🏢 ${branch.name}`, `orden_branch_${i}`)])
                return ctx.reply('7️⃣ <b>Sucursal de recepción:</b>\n(Elige un botón o responde con el número)', {
                    parse_mode: 'HTML',
                    ...Markup.inlineKeyboard(rows),
                })
            }
            case 'CONFIRM':
                return ctx.reply(summaryText(session), {
                    parse_mode: 'HTML',
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback('✅ Crear orden', 'orden_confirm')],
                        [Markup.button.callback('❌ Cancelar', 'orden_cancel')],
                    ]),
                })
        }
    }

    /** Tras la falla reportada: si hay varias sucursales se pregunta cuál
     *  recibe el equipo; si no, se va directo a la confirmación. */
    async function advancePastIssue(ctx: Context, telegramId: string, session: OrdenSession) {
        if ((session.branches?.length ?? 0) > 1) {
            session.step = 'BRANCH'
        } else {
            session.step = 'CONFIRM'
        }
        await askNext(ctx, telegramId, session)
    }

    // ---------- /orden ----------

    bot.command('orden', async (ctx) => {
        const telegramId = ctx.from.id.toString()
        if (!(await requirePrisma(ctx))) return
        const user = await getBotAccount(prisma, telegramId)
        if (!user) return ctx.reply('⚠️ No tienes cuenta registrada. Usa /start primero.')
        const denied = workshopGate(user)
        if (denied) return ctx.reply(denied)

        try {
            const branches = await branchesOf(user)
            if (branches.length === 0) {
                return ctx.reply('❌ No hay sucursales activas para recibir equipos. Configura una en el panel web.')
            }
            sessions.orden[telegramId] = {
                step: 'NAME',
                data: branches.length === 1 ? { branchId: branches[0].id } : {},
                // La lista queda siempre: con una sola sucursal no hay paso
                // BRANCH, pero el resumen muestra su nombre.
                branches,
                equipmentTypes: await equipmentTypesOf(user.businessId),
                operationKey: `bot-orden-${telegramId}-${Date.now()}`,
            }
            await ctx.reply('🔧 <b>Nueva orden de reparación</b>\n\n<i>Usa /cancelar para salir en cualquier momento.</i>', { parse_mode: 'HTML' })
            await askNext(ctx, telegramId, sessions.orden[telegramId])
        } catch (e) {
            if (isDev) console.error('Error in /orden:', e)
            delete sessions.orden[telegramId]
            await ctx.reply('❌ No se pudo iniciar la orden. Intenta de nuevo.')
        }
    })

    // ---------- callbacks del wizard ----------

    // Tipo de equipo (botón): el índice apunta a session.equipmentTypes, así el
    // callback no carga nombres arbitrarios y aguanta tipos personalizados.
    bot.action(/^orden_type_(\d+)$/, async (ctx) => {
        const telegramId = ctx.from.id.toString()
        const session = sessions.orden[telegramId]
        if (!session || session.step !== 'TYPE') {
            await ctx.answerCbQuery('Sesión expirada')
            return ctx.editMessageText('❌ Sesión de orden expirada. Usa /orden para iniciar de nuevo.').catch(() => {})
        }
        const type = session.equipmentTypes?.[Number(ctx.match[1])]
        if (!type) {
            await ctx.answerCbQuery('Tipo inválido')
            return ctx.reply('❌ Tipo inválido. Elige un botón o escribe el tipo de equipo.')
        }
        session.data.equipmentType = type
        session.step = 'BRAND'
        await refreshBrandChips(session, telegramId)
        await ctx.answerCbQuery(type)
        await askNext(ctx, telegramId, session)
    })

    // Marca sugerida (chip del catálogo de modelos).
    bot.action(/^orden_brand_(\d+)$/, async (ctx) => {
        const telegramId = ctx.from.id.toString()
        const session = sessions.orden[telegramId]
        if (!session || session.step !== 'BRAND') {
            await ctx.answerCbQuery('Sesión expirada')
            return ctx.editMessageText('❌ Sesión de orden expirada. Usa /orden para iniciar de nuevo.').catch(() => {})
        }
        const brand = session.brandChips?.[Number(ctx.match[1])]
        if (!brand) {
            await ctx.answerCbQuery('Marca inválida')
            return ctx.reply('❌ Marca inválida. Escríbela o pulsa "Omitir".')
        }
        session.data.brand = brand
        session.step = 'MODEL'
        await ctx.answerCbQuery(brand)
        await askNext(ctx, telegramId, session)
    })

    bot.action('orden_skip_brand', async (ctx) => {
        const telegramId = ctx.from.id.toString()
        const session = sessions.orden[telegramId]
        if (!session || session.step !== 'BRAND') {
            await ctx.answerCbQuery('Sesión expirada')
            return
        }
        session.data.brand = undefined
        session.step = 'MODEL'
        await ctx.answerCbQuery()
        await askNext(ctx, telegramId, session)
    })

    bot.action('orden_skip_model', async (ctx) => {
        const telegramId = ctx.from.id.toString()
        const session = sessions.orden[telegramId]
        if (!session || session.step !== 'MODEL') {
            await ctx.answerCbQuery('Sesión expirada')
            return
        }
        session.data.model = undefined
        session.step = 'ISSUE'
        await ctx.answerCbQuery()
        await askNext(ctx, telegramId, session)
    })

    // Sucursal (botón) cuando el negocio tiene más de una elegible.
    bot.action(/^orden_branch_(\d+)$/, async (ctx) => {
        const telegramId = ctx.from.id.toString()
        const session = sessions.orden[telegramId]
        if (!session || session.step !== 'BRANCH') {
            await ctx.answerCbQuery('Sesión expirada')
            return ctx.editMessageText('❌ Sesión de orden expirada. Usa /orden para iniciar de nuevo.').catch(() => {})
        }
        const branch = session.branches?.[Number(ctx.match[1])]
        if (!branch) {
            await ctx.answerCbQuery('Sucursal inválida')
            return ctx.reply('❌ Sucursal inválida. Elige una de las opciones.')
        }
        session.data.branchId = branch.id
        session.step = 'CONFIRM'
        await ctx.answerCbQuery(branch.name)
        await askNext(ctx, telegramId, session)
    })

    bot.action('orden_cancel', async (ctx) => {
        const telegramId = ctx.from.id.toString()
        delete sessions.orden[telegramId]
        await ctx.answerCbQuery()
        await ctx.editMessageText('❌ Orden cancelada.').catch(() => {})
    })

    // Confirmación: crea la orden con la MISMA forma de datos que el intake
    // web (POST /api/workshop → createRepair). La llave de idempotencia se
    // fijó al abrir el wizard: un doble toque en "Crear" devuelve la misma
    // orden por el recibo de BusinessOperation, nunca una duplicada.
    bot.action('orden_confirm', async (ctx) => {
        const telegramId = ctx.from.id.toString()
        const session = sessions.orden[telegramId]
        if (!session || session.step !== 'CONFIRM') {
            await ctx.answerCbQuery('Sesión expirada')
            return ctx.editMessageText('❌ Sesión de orden expirada. Usa /orden para iniciar de nuevo.').catch(() => {})
        }
        // Revalida permisos al confirmar: el rol/módulo pudo cambiar a mitad del wizard.
        const user = await getBotAccount(prisma, telegramId)
        const denied = workshopGate(user)
        if (!user || denied) {
            delete sessions.orden[telegramId]
            await ctx.answerCbQuery('Sin permiso')
            return ctx.editMessageText(`🚫 ${denied ?? 'Cuenta no disponible.'}`).catch(() => {})
        }
        if (!session.data.branchId || !hasBranchAccess(user, session.data.branchId)) {
            delete sessions.orden[telegramId]
            await ctx.answerCbQuery('Sucursal inválida')
            return ctx.editMessageText('🚫 La sucursal elegida ya no está disponible para ti. Inicia de nuevo con /orden.').catch(() => {})
        }

        try {
            const result = await createRepair(prisma, user.id, user.businessId, {
                idempotencyKey: session.operationKey ?? `bot-orden-${telegramId}-${Date.now()}`,
                customerName: session.data.customerName!,
                customerPhone: session.data.customerPhone!,
                equipmentType: session.data.equipmentType!,
                brand: session.data.brand,
                model: session.data.model,
                reportedIssue: session.data.reportedIssue!,
                intakeBranchId: session.data.branchId,
            })
            const order = result.order
            const data = { ...session.data }
            delete sessions.orden[telegramId]

            const folio = await folioOf(user.businessId, order.number)
            const track = await trackingUrl(user.businessId, folio, data.customerPhone!)

            // El botón de delegación solo se ofrece a un ADMIN — el dominio
            // (delegateRepairToPartner → actor "admin") y la ruta /delegar lo
            // exigen; un EMPLOYEE que lo tocara recibiría un 403. Además el
            // taller asociado debe estar configurado Y apto para recibir
            // (negocio activo, con sucursal y staff habilitado — la resolución
            // completa del dominio).
            let canDelegate = user.role === 'ADMIN'
            if (canDelegate) {
                try {
                    await resolveRepairPartner(prisma, user.businessId)
                } catch { canDelegate = false /* sin taller asociado (o no disponible): no se ofrece el botón */ }
            }

            const equipo = [data.equipmentType, data.brand, data.model].filter(Boolean).join(' ')
            const successMsg = `✅ <b>Orden creada</b>

📄 Folio: <b>${escapeHtml(folio)}</b>
👤 ${escapeHtml(data.customerName)} · ${escapeHtml(data.customerPhone)}
🔧 ${escapeHtml(equipo)}
🛠 ${escapeHtml(data.reportedIssue)}
🏢 ${escapeHtml(branchName(session))}

🔗 Rastreo para el cliente:
${track}`

            await ctx.answerCbQuery('Orden creada')
            await ctx.editMessageText(successMsg, {
                parse_mode: 'HTML',
                ...(canDelegate
                    ? Markup.inlineKeyboard([[Markup.button.callback('🔧 Enviar a taller asociado', `orden_delegate_${order.id}`)]])
                    : {}),
            })

            notifyAdmins(bot, user.businessId, `🔧 <b>Nueva orden de taller (Bot)</b>

📄 Folio: <b>${escapeHtml(folio)}</b>
👤 ${escapeHtml(data.customerName)} · ${escapeHtml(data.customerPhone)}
🔧 ${escapeHtml(equipo)}
🛠 ${escapeHtml(data.reportedIssue)}

<i>Registrada por ${escapeHtml(user.name)} vía Telegram.</i>`).catch(() => {})
        } catch (e) {
            // BusinessError (p. ej. sucursal inactiva): la sesión se conserva
            // en CONFIRM para reintentar con el mismo botón — la llave de
            // idempotencia hace seguro el reintento.
            const msg = e instanceof BusinessError ? e.message : 'No se pudo crear la orden. Reintenta o usa /cancelar.'
            if (!(e instanceof BusinessError) && isDev) console.error('Error creating repair order:', e)
            await ctx.answerCbQuery('No se pudo crear')
            await ctx.reply(`⚠️ ${escapeHtml(msg)}\n\nPuedes volver a intentarlo con el botón ✅ Crear, o salir con /cancelar.`, { parse_mode: 'HTML' })
        }
    })

    // Delegación al taller asociado: el dominio ya es idempotente (orden
    // marcada, espejo existente por delegatedFromOrderId o llave determinista
    // delegate-<orderId>), así que un reintento muestra el mismo resultado.
    bot.action(/^orden_delegate_(.+)$/, async (ctx) => {
        const telegramId = ctx.from.id.toString()
        const orderId = ctx.match[1]
        const user = await getBotAccount(prisma, telegramId)
        const denied = workshopGate(user)
        if (!user || denied) {
            await ctx.answerCbQuery('Sin permiso')
            return ctx.reply(`🚫 ${denied ?? 'Cuenta no disponible.'}`)
        }
        // Delegar es acción de ADMIN (mismo gate que la web): el botón no se
        // ofrece a EMPLOYEE, pero el rol pudo cambiar desde que se renderizó —
        // se vuelve a verificar aquí, igual que en orden_confirm.
        if (user.role !== 'ADMIN') {
            await ctx.answerCbQuery('Sin permiso')
            return ctx.reply('🚫 Solo un administrador puede enviar la orden al taller asociado.')
        }
        try {
            // La orden se busca con businessId del staff dentro del dominio:
            // una orden de otro tenant responde "Orden no encontrada".
            const result = await delegateRepairToPartner(prisma, user.id, user.businessId, orderId)
            const partner = escapeHtml(result.partnerName ?? 'el taller asociado')
            const mirror = result.mirrorFolio ? ` (folio <b>${escapeHtml(result.mirrorFolio)}</b>)` : ''
            if (result.alreadyDelegated) {
                await ctx.answerCbQuery('Ya estaba enviada')
                return ctx.reply(`ℹ️ La orden ya había sido enviada a ${partner}${mirror}.`, { parse_mode: 'HTML' })
            }
            await ctx.answerCbQuery('Enviada al taller')
            await ctx.reply(`🔧 <b>Orden enviada a ${partner}</b>${mirror}

La orden local quedó como laboratorio externo. El taller actualizará su avance y te llegará el aviso aquí y en el panel.`, { parse_mode: 'HTML' })
            notifyAdmins(bot, user.businessId, `🔧 <b>Orden enviada al taller asociado (Bot)</b>

Destino: ${partner}${mirror}
Por: ${escapeHtml(user.name)}`).catch(() => {})
        } catch (e) {
            const msg = e instanceof BusinessError ? e.message : 'No se pudo enviar al taller. Reintenta.'
            if (!(e instanceof BusinessError)) console.error('Error delegating repair order:', e)
            await ctx.answerCbQuery('Error')
            await ctx.reply(`⚠️ ${escapeHtml(msg)}`, { parse_mode: 'HTML' })
        }
    })

    // ---------- captura de texto del wizard ----------
    // Patrón idéntico a settings.ts: solo consume texto cuando hay sesión
    // propia activa; en cualquier otro caso cede con next() a los handlers
    // siguientes (hears de ventas, wizard de registro, búsqueda de productos).
    bot.on(message('text'), async (ctx, next) => {
        const telegramId = ctx.from.id.toString()
        const session = sessions.orden[telegramId]
        if (!session) return next()

        const text = ctx.message.text.trim()
        if (text.startsWith('/')) return next() // los comandos (/cancelar, /orden…) se procesan normal
        if (text.toLowerCase() === 'cancelar') {
            delete sessions.orden[telegramId]
            return ctx.reply('❌ Orden cancelada.')
        }

        switch (session.step) {
            case 'NAME': {
                if (text.length < 2 || text.length > 200) {
                    return ctx.reply('❌ Ingresa un nombre válido (2–200 caracteres).')
                }
                session.data.customerName = text
                session.step = 'PHONE'
                return askNext(ctx, telegramId, session)
            }
            case 'PHONE': {
                // Mismo contrato que el intake web: [+\d\s()-], 7–15 dígitos.
                // normalizePhone asume MX (+52) cuando llegan 10 dígitos.
                if (!/^[+\d\s()-]+$/.test(text)) {
                    return ctx.reply('❌ Teléfono inválido: solo números, espacios y + ( ) -. Ej: <code>55 1234 5678</code>', { parse_mode: 'HTML' })
                }
                const digits = text.replace(/\D/g, '')
                if (digits.length < 7 || digits.length > 15) {
                    return ctx.reply('❌ Ingresa un teléfono de 7 a 15 dígitos. Ej: <code>55 1234 5678</code>', { parse_mode: 'HTML' })
                }
                session.data.customerPhone = normalizePhone(text)
                session.step = 'TYPE'
                return askNext(ctx, telegramId, session)
            }
            case 'TYPE': {
                // Además de los botones se acepta texto libre (tipo personalizado).
                if (text.length > 60) return ctx.reply('❌ Tipo de equipo demasiado largo (máx. 60 caracteres).')
                session.data.equipmentType = text
                session.step = 'BRAND'
                await refreshBrandChips(session, telegramId)
                return askNext(ctx, telegramId, session)
            }
            case 'BRAND': {
                if (isSkip(text)) {
                    session.data.brand = undefined
                } else {
                    if (text.length > 100) return ctx.reply('❌ Marca demasiado larga (máx. 100 caracteres).')
                    session.data.brand = text
                }
                session.step = 'MODEL'
                return askNext(ctx, telegramId, session)
            }
            case 'MODEL': {
                if (isSkip(text)) {
                    session.data.model = undefined
                } else {
                    if (text.length > 100) return ctx.reply('❌ Modelo demasiado largo (máx. 100 caracteres).')
                    session.data.model = text
                }
                session.step = 'ISSUE'
                return askNext(ctx, telegramId, session)
            }
            case 'ISSUE': {
                if (text.length < 2 || text.length > 500) {
                    return ctx.reply('❌ Describe la falla en 2–500 caracteres.')
                }
                session.data.reportedIssue = text
                return advancePastIssue(ctx, telegramId, session)
            }
            case 'BRANCH': {
                // También acepta el número de la opción (1..n) además del botón.
                const index = Number(text)
                const branch = Number.isInteger(index) ? session.branches?.[index - 1] : undefined
                if (!branch) {
                    return ctx.reply(`❌ Elige una sucursal con los botones o responde con un número (1-${session.branches?.length ?? 0}).`)
                }
                session.data.branchId = branch.id
                session.step = 'CONFIRM'
                return askNext(ctx, telegramId, session)
            }
            case 'CONFIRM':
                return ctx.reply('👆 Usa los botones de arriba para <b>crear</b> la orden o /cancelar para salir.', { parse_mode: 'HTML' })
        }
    })
}
