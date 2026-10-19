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
    /**
     * Precio de catálogo vigente al recuperar un documento: las líneas
     * retomadas muestran el snapshot (retailPrice/wholesalePrice = unitPrice
     * del documento), pero si el ticket se desliga se cobra como venta nueva
     * con el precio de catálogo — que es este.
     */
    catalogRetailPrice?: number
    catalogWholesalePrice?: number
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

export interface PosPaymentMethodOption { value: PosPaymentMethod; label: string; disabled?: boolean }

/**
 * Con la caja cerrada todo cobro en efectivo rebota en el servidor (409
 * REGISTER_REQUIRED): el método queda visible pero bloqueado para que el
 * cajero entienda por qué no puede elegirlo. cajaOpen null (aún cargando)
 * no bloquea — el servidor sigue siendo la autoridad.
 */
export function paymentMethodsFor(cajaOpen: boolean | null, methods: PosPaymentMethodOption[] = PAYMENT_METHODS): PosPaymentMethodOption[] {
    if (cajaOpen !== false) return methods
    return methods.map(m => m.value === "EFECTIVO" ? { ...m, label: `${m.label} (caja cerrada)`, disabled: true } : m)
}

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

/** Precio que cobra el mostrador según el modo de venta (taller/público). */
export function unitPriceOf(product: PosProduct, workshopActive: boolean): number {
    return workshopActive ? product.wholesalePrice : product.retailPrice
}

export function cartTotalOf(cart: CartItem[], workshopActive: boolean): number {
    return cart.reduce((sum, item) => sum + unitPriceOf(item.product, workshopActive) * item.quantity, 0)
}

export function cartUnitsOf(cart: CartItem[]): number {
    return cart.reduce((sum, item) => sum + item.quantity, 0)
}

/**
 * Coincidencia exacta para el escáner (cámara o pistola HID que teclea el
 * código + Enter): barcode o id del producto, sin fuzzy — una coincidencia
 * parcial nunca debe agregar al ticket sola.
 */
export function exactCodeMatches(products: PosProduct[], code: string): PosProduct[] {
    const clean = code.trim()
    if (!clean) return []
    return products.filter(p => p.barcode?.trim() === clean || p.id === clean)
}

/**
 * Reconstruye las líneas del ticket desde el detalle de un documento
 * (suspendida/cotización). El precio mostrado es el SNAPSHOT del documento
 * (item.unitPrice en ambos campos: el checkout cobra ese, no el catálogo —
 * mostrar retailPrice actual hacía cobrar distinto de lo anunciado). El
 * precio de catálogo vigente queda en catalogRetailPrice/catalogWholesalePrice
 * para restaurarlo si el ticket se desliga y se cobra como venta nueva.
 * `branchStock` (overlay de /api/search/pos) topa el botón + con la
 * existencia de la sucursal; sin él se usa el stock total y topa el servidor.
 */
export function docItemsToCart(doc: PosDocumentDetail, branchStock?: ReadonlyMap<string, number>): CartItem[] {
    return (doc.items ?? []).flatMap(i => {
        const p = i.product
        if (!p?.id) return []
        const snapshot = i.unitPrice
        return [{
            quantity: i.quantity,
            product: {
                id: p.id,
                name: p.name ?? "Producto",
                barcode: p.barcode ?? null,
                stock: branchStock?.get(p.id) ?? p.stock ?? 0,
                retailPrice: snapshot,
                wholesalePrice: snapshot,
                ...(p.retailPrice != null ? { catalogRetailPrice: p.retailPrice } : {}),
                ...(p.wholesalePrice != null ? { catalogWholesalePrice: p.wholesalePrice } : {}),
                images: p.images,
            },
        }]
    })
}

/** Pagos del checkout → cuerpo payments[] que espera el dominio. */
export function toPaymentsPayload(drafts: PaymentDraft[]): { method: string; amount: number; reference?: string }[] {
    return drafts.map(p => ({
        method: p.method,
        amount: parseFloat(p.amount),
        ...(p.method === "TRANSFERENCIA" && p.reference?.trim() ? { reference: p.reference.trim() } : {}),
    }))
}
