// Borrador del ticket del mostrador en localStorage: un reload accidental,
// un corte de luz o un cobro que tumbó la pestaña no deben perder las líneas
// ya capturadas. Es un BORRADOR — el servidor revalida precios y existencias
// al cobrar; lo restaurado equivale a una suspendida local sin folio.

import type { ClientOperationKey } from "@/lib/client-operation-key"
import type { CartItem, PosCustomer, PosProduct } from "./types"

export const POS_TICKET_STORAGE_KEY = "pos:ticket"
export const POS_PENDING_PARK_STORAGE_KEY = "pos:pending-park"
/** El borrador vive un turno: más viejo se descarta (precios/stock obsoletos). */
export const POS_TICKET_TTL_MS = 12 * 60 * 60 * 1000

export interface PosPendingParkState {
    /** Llave de idempotencia del paso 1 (POST /api/pos/documents). */
    parkKey: ClientOperationKey
    /** ID del DRAFT creado cuando el paso 1 ya respondió OK. */
    parkedDocId: string | null
    /** Fingerprint de carrito + descuento que originó el park. */
    ticketFingerprint: string
    /** Llave de idempotencia del paso 2 (checkout) ligada a parkedDocId. */
    checkoutKey?: ClientOperationKey | null
}

export interface PosTicketState {
    cart: CartItem[]
    customer: PosCustomer | null
    workshopSale: boolean
    /**
     * Llave de idempotencia del cobro en vuelo. Si la pestaña muere a medio
     * POST, el borrador la restaura y el reintento del MISMO ticket reusa la
     * llave real — el servidor deduplica y no hay doble cobro. Ticket editado
     * → fingerprint ya no coincide → llave nueva.
     */
    checkoutKey?: ClientOperationKey | null
    /**
     * Estado persistido del paso 1 (park) cuando una venta con descuento se
     * procesa en dos pasos (park → checkout). Si ya hay parkedDocId y el
     * fingerprint coincide, el reintento salta el paso 1 y cobra ese DRAFT.
     */
    pendingPark?: PosPendingParkState | null
}

interface PosTicketDraft extends PosTicketState {
    savedAt: number
    /** Informativo: el stock guardado era el de esta sucursal al capturar. */
    branchId: string
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value)
}

// El borrador pudo ser escrito por una versión anterior: solo se restauran
// líneas con la forma mínima cobrable (id + precios + stock numéricos).
function sanitizeProduct(raw: unknown): PosProduct | null {
    if (!raw || typeof raw !== "object") return null
    const p = raw as Partial<PosProduct>
    if (typeof p.id !== "string" || !p.id) return null
    if (typeof p.name !== "string" || !p.name) return null
    if (!isFiniteNumber(p.stock) || !isFiniteNumber(p.retailPrice) || !isFiniteNumber(p.wholesalePrice)) return null
    return {
        ...p,
        id: p.id,
        name: p.name,
        barcode: typeof p.barcode === "string" ? p.barcode : null,
        stock: p.stock,
        retailPrice: p.retailPrice,
        wholesalePrice: p.wholesalePrice,
    } as PosProduct
}

function sanitizeCustomer(raw: unknown): PosCustomer | null {
    if (!raw || typeof raw !== "object") return null
    const c = raw as Partial<PosCustomer>
    if (typeof c.id !== "string" || !c.id || typeof c.name !== "string" || !c.name) return null
    return {
        id: c.id,
        name: c.name,
        customerType: typeof c.customerType === "string" ? c.customerType : null,
        phone: typeof c.phone === "string" ? c.phone : null,
        creditLimit: isFiniteNumber(c.creditLimit) ? c.creditLimit : null,
        creditBalance: isFiniteNumber(c.creditBalance) ? c.creditBalance : 0,
    }
}

// La llave restaurada debe venir íntegra (fingerprint + key): una corrupta
// se descarta sin tirar el borrador — getClientOperationKey generaría una
// nueva al cobrar, como antes de persistirla.
function sanitizeCheckoutKey(raw: unknown): ClientOperationKey | null {
    if (!raw || typeof raw !== "object") return null
    const k = raw as Partial<ClientOperationKey>
    if (typeof k.key !== "string" || !k.key || k.key.length > 200) return null
    if (typeof k.fingerprint !== "string" || k.fingerprint.length > 100_000) return null
    return { fingerprint: k.fingerprint, key: k.key }
}

export function sanitizePendingPark(raw: unknown): PosPendingParkState | null {
    if (!raw || typeof raw !== "object") return null
    const p = raw as Partial<PosPendingParkState>
    const parkKey = sanitizeCheckoutKey(p.parkKey)
    if (!parkKey) return null
    if (typeof p.ticketFingerprint !== "string" || !p.ticketFingerprint || p.ticketFingerprint.length > 100_000) return null
    const parkedDocId = typeof p.parkedDocId === "string" && p.parkedDocId.length > 0 && p.parkedDocId.length <= 200
        ? p.parkedDocId
        : null
    const checkoutKey = sanitizeCheckoutKey(p.checkoutKey)
    return {
        parkKey,
        parkedDocId,
        ticketFingerprint: p.ticketFingerprint,
        ...(checkoutKey ? { checkoutKey } : {}),
    }
}

export function buildParkTicketFingerprint(input: {
    items: { productId: string; quantity: number }[]
    kind?: string
    customerId?: string | null
    branchId?: string | null
    discountCents?: number
    discountReason?: string
}): string {
    return JSON.stringify({
        kind: input.kind || "RETAIL",
        items: input.items.map(i => ({ productId: i.productId, quantity: i.quantity })),
        customerId: input.customerId || null,
        branchId: input.branchId || null,
        discountCents: input.discountCents ?? 0,
        discountReason: (input.discountReason ?? "").trim(),
    })
}

export function pendingParkMatchesCart(
    park: PosPendingParkState | null | undefined,
    cart: CartItem[],
): boolean {
    if (!park) return false
    try {
        const parsed = JSON.parse(park.ticketFingerprint) as { items?: { productId: string; quantity: number }[] }
        if (!Array.isArray(parsed?.items) || parsed.items.length !== cart.length) return false
        return parsed.items.every((item, i) => item.productId === cart[i]?.product.id && item.quantity === cart[i]?.quantity)
    } catch {
        return false
    }
}

type KeyStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">

function defaultTicketStorage(): KeyStorage | null {
    if (typeof window === "undefined") return null
    try {
        return window.localStorage ?? window.sessionStorage ?? null
    } catch {
        return null
    }
}

export function savePendingPark(
    state: PosPendingParkState | null,
    storage: KeyStorage | null = defaultTicketStorage(),
): void {
    if (!storage) return
    try {
        if (!state) {
            storage.removeItem(POS_PENDING_PARK_STORAGE_KEY)
        } else {
            storage.setItem(POS_PENDING_PARK_STORAGE_KEY, JSON.stringify({ savedAt: Date.now(), ...state }))
        }
        const rawTicket = storage.getItem(POS_TICKET_STORAGE_KEY)
        if (rawTicket) {
            const draft = JSON.parse(rawTicket) as Record<string, unknown>
            draft.pendingPark = state
            if (state?.checkoutKey) draft.checkoutKey = state.checkoutKey
            storage.setItem(POS_TICKET_STORAGE_KEY, JSON.stringify(draft))
        }
    } catch {
        // Storage lleno o restringido: continúa en memoria.
    }
}

export function loadPendingPark(
    storage: KeyStorage | null = defaultTicketStorage(),
    nowMs = Date.now(),
): PosPendingParkState | null {
    if (!storage) return null
    try {
        const raw = storage.getItem(POS_PENDING_PARK_STORAGE_KEY)
        if (raw) {
            const parsed = JSON.parse(raw) as { savedAt?: number } & Partial<PosPendingParkState>
            if (isFiniteNumber(parsed?.savedAt) && (nowMs - parsed.savedAt > POS_TICKET_TTL_MS || parsed.savedAt > nowMs)) {
                storage.removeItem(POS_PENDING_PARK_STORAGE_KEY)
            } else {
                const clean = sanitizePendingPark(parsed)
                if (clean) return clean
            }
        }
        const rawTicket = storage.getItem(POS_TICKET_STORAGE_KEY)
        if (rawTicket) {
            const ticket = parsePosTicket(rawTicket, nowMs)
            if (ticket?.pendingPark) return ticket.pendingPark
        }
        return null
    } catch {
        return null
    }
}

export function serializePosTicket(state: PosTicketState, branchId: string, nowMs = Date.now()): string {
    const pendingPark = state.pendingPark && pendingParkMatchesCart(state.pendingPark, state.cart)
        ? state.pendingPark
        : null
    const draft: PosTicketDraft = { savedAt: nowMs, branchId, ...state, ...(pendingPark ? { pendingPark } : {}) }
    return JSON.stringify(draft)
}

/** Borrador → estado del ticket, o null si venció, está corrupto o no trae líneas válidas. */
export function parsePosTicket(json: string | null, nowMs: number): PosTicketState | null {
    if (!json) return null
    try {
        const draft = JSON.parse(json) as Partial<PosTicketDraft>
        if (!isFiniteNumber(draft.savedAt) || nowMs - draft.savedAt > POS_TICKET_TTL_MS || draft.savedAt > nowMs) return null
        const cart = (Array.isArray(draft.cart) ? draft.cart : [])
            .map((line): CartItem | null => {
                const product = sanitizeProduct(line?.product)
                const qty = typeof line?.quantity === "number" ? Math.floor(line.quantity) : NaN
                if (!product || !Number.isFinite(qty) || qty < 1) return null
                return { product, quantity: Math.min(qty, Math.max(1, product.stock)) }
            })
            .filter((line): line is CartItem => line !== null)
        if (cart.length === 0) return null
        const rawPark = sanitizePendingPark(draft.pendingPark)
        const pendingPark = rawPark && pendingParkMatchesCart(rawPark, cart) ? rawPark : null
        return {
            cart,
            customer: sanitizeCustomer(draft.customer),
            workshopSale: draft.workshopSale === true,
            checkoutKey: sanitizeCheckoutKey(draft.checkoutKey),
            pendingPark,
        }
    } catch {
        return null
    }
}
