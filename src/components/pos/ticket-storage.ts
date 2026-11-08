// Borrador del ticket del mostrador en localStorage: un reload accidental,
// un corte de luz o un cobro que tumbó la pestaña no deben perder las líneas
// ya capturadas. Es un BORRADOR — el servidor revalida precios y existencias
// al cobrar; lo restaurado equivale a una suspendida local sin folio.

import type { CartItem, PosCustomer, PosProduct } from "./types"

export const POS_TICKET_STORAGE_KEY = "pos:ticket"
/** El borrador vive un turno: más viejo se descarta (precios/stock obsoletos). */
export const POS_TICKET_TTL_MS = 12 * 60 * 60 * 1000

export interface PosTicketState {
    cart: CartItem[]
    customer: PosCustomer | null
    workshopSale: boolean
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

export function serializePosTicket(state: PosTicketState, branchId: string, nowMs = Date.now()): string {
    const draft: PosTicketDraft = { savedAt: nowMs, branchId, ...state }
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
        return {
            cart,
            customer: sanitizeCustomer(draft.customer),
            workshopSale: draft.workshopSale === true,
        }
    } catch {
        return null
    }
}
