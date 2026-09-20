// Tipos y helpers compartidos del terminal POS (mostrador).
// Los endpoints /api/pos/documents se construyen en paralelo: las formas
// de aquí siguen el contrato acordado (documentos RETAIL/LAYAWAY/QUOTE).

export interface PosProduct {
    id: string
    name: string
    barcode: string | null
    stock: number
    retailPrice: number
    wholesalePrice: number
    /** La API devuelve `images` (productDto); `imageUrl` cubre respuestas nuevas. */
    images?: string[]
    imageUrl?: string | null
    categoryId?: string | null
    category?: { name: string } | null
}

export interface CartItem {
    product: PosProduct
    quantity: number
}

export interface PosCustomer {
    id: string
    name: string
    customerType?: string | null
    phone?: string | null
    creditLimit: number | null
    creditBalance: number
}

/** Documento POS en lista (suspendido DRAFT o apartado OPEN). */
export interface PosDocumentSummary {
    id: string
    number: number
    kind: string
    status?: string
    note?: string | null
    total: number
    /** Lo confirmado en pagos; listDocuments lo computa siempre. */
    paid?: number
    balance?: number
    itemCount?: number
    expiresAt?: string | null
    customer?: { id?: string; name: string; phone?: string | null } | null
    createdAt: string
}

export interface PosDocumentItem {
    productId: string
    quantity: number
    unitPrice: number
    product: Partial<PosProduct> & { id?: string; name?: string }
}

/** El detalle trae el cliente sin datos de crédito (se rellenan al recuperar). */
export interface PosDocumentDetail extends PosDocumentSummary {
    customer?: { id: string; name: string; phone?: string | null; customerType?: string | null } | null
    items: PosDocumentItem[]
}

export type PosPaymentMethod = "EFECTIVO" | "TARJETA" | "TRANSFERENCIA" | "CREDITO"

export const PAYMENT_METHODS: { value: PosPaymentMethod; label: string }[] = [
    { value: "EFECTIVO", label: "Efectivo" },
    { value: "TARJETA", label: "Tarjeta / Terminal" },
    { value: "TRANSFERENCIA", label: "Transferencia" },
    { value: "CREDITO", label: "A crédito" },
]

/** Anticipos de apartado: un depósito a crédito no tiene sentido en caja. */
export const DEPOSIT_METHODS = PAYMENT_METHODS.filter(m => m.value !== "CREDITO")

export interface PaymentDraft {
    method: PosPaymentMethod
    amount: string
    reference?: string
}

/** Resultado normalizado de un cobro/documento para la tarjeta "última venta". */
export interface CheckoutResult {
    kind: "SALE" | "WORKSHOP" | "LAYAWAY" | "QUOTE"
    number?: number | null
    /** id del Sale o documento: el ticket se imprime en /admin/tickets/venta/<id>. */
    ticketId?: string | null
    total: number
    quantity: number
    description: string
    paidWithCard?: boolean
}

export function productImage(product: PosProduct): string | null {
    const fromList = product.images?.[0]
    return fromList || product.imageUrl || null
}

/** Precio que cobra el mostrador según el modo de venta (mayoreo/menudeo). */
export function unitPriceOf(product: PosProduct, workshopActive: boolean): number {
    return workshopActive ? product.wholesalePrice : product.retailPrice
}

export function cartTotalOf(cart: CartItem[], workshopActive: boolean): number {
    return cart.reduce((sum, item) => sum + unitPriceOf(item.product, workshopActive) * item.quantity, 0)
}

export function cartUnitsOf(cart: CartItem[]): number {
    return cart.reduce((sum, item) => sum + item.quantity, 0)
}

/** Pagos del checkout → cuerpo payments[] que espera el dominio. */
export function toPaymentsPayload(drafts: PaymentDraft[]): { method: string; amount: number; reference?: string }[] {
    return drafts.map(p => ({
        method: p.method,
        amount: parseFloat(p.amount),
        ...(p.method === "TRANSFERENCIA" && p.reference?.trim() ? { reference: p.reference.trim() } : {}),
    }))
}
