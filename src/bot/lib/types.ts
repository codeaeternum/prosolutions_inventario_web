import type { Telegraf } from 'telegraf'
import type { PrismaClient } from '@prisma/client'

// ========== SESSION TYPES ==========

export interface SaleSession {
    step: 'SELECT_PRODUCT' | 'CONFIRM'
    products?: { id: string; name: string; stock: number; retailPrice: number }[]
    selectedProduct?: { id: string; name: string; stock: number; retailPrice: number }
    quantity?: number
}

export interface DeleteProductSession {
    step: 'SELECT' | 'CONFIRM'
    products?: { id: string; name: string; stock: number; _count: { reservations: number; movements: number } }[]
    selectedProduct?: { id: string; name: string; stock: number; _count: { reservations: number; movements: number } }
}

export interface CartItem {
    id: string
    name: string
    quantity: number
    price: number
    stock: number
}

export interface CartSession {
    items: CartItem[]
    pendingAdd?: { id: string; name: string; price: number; stock: number }
}

export interface QRSession {
    step: 'SELECT'
    products?: { id: string; name: string; barcode: string | null }[]
}

export interface AdminProductState {
    step: 'NAME' | 'CATEGORY' | 'COST_PRICE' | 'PRICE_RETAIL' | 'PRICE_WHOLESALE' | 'STOCK' | 'PHOTO'
    data: {
        name?: string
        categoryId?: string
        costPrice?: number
        retailPrice?: number
        wholesalePrice?: number
        stock?: number
        imageUrl?: string
    }
}

export interface ReservationState {
    operationKey?: string
    productId: string
    productName: string
    price: number
    maxStock: number
    step: 'QUANTITY' | 'PAYMENT_METHOD' | 'PROOF_UPLOAD'
    quantity?: number
}

export interface WizardState {
    step: 'NAME' | 'TYPE' | 'BUSINESS' | 'PHONE' | 'GOAL'
    data: {
        name?: string
        customerType?: 'TECHNICIAN' | 'STORE' | 'NORMAL'
        businessName?: string
        phone?: string
        monthlyPurchaseGoal?: number
        telegramId?: string
    }
}

/**
 * Wizard /orden — recepción de una orden de reparación por staff (captador).
 * Espejo compacto de /admin/taller/recibir: nombre del cliente, teléfono,
 * tipo de equipo, marca, modelo, falla y sucursal de recepción.
 * BRANCH solo aparece cuando el negocio tiene más de una sucursal elegible.
 */
export interface OrdenSession {
    step: 'NAME' | 'PHONE' | 'TYPE' | 'BRAND' | 'MODEL' | 'ISSUE' | 'BRANCH' | 'CONFIRM'
    data: {
        customerName?: string
        customerPhone?: string
        equipmentType?: string
        brand?: string
        model?: string
        reportedIssue?: string
        branchId?: string
    }
    /** Sucursales activas ∩ permisos del staff (índice → fila); con una sola
     *  se preselecciona y el paso BRANCH se salta. */
    branches?: { id: string; name: string }[]
    /** Tipos de equipo servidos en el teclado del paso TYPE (índice → nombre). */
    equipmentTypes?: string[]
    /** Marcas sugeridas del catálogo DeviceModel como chips (índice → nombre). */
    brandChips?: string[]
    /** Llave de idempotencia fija del wizard: doble confirmación = misma orden. */
    operationKey?: string
}

// ========== SESSION STORES ==========

export interface SessionStores {
    registration: Record<string, WizardState>
    adminProduct: Record<string, AdminProductState>
    reservation: Record<string, ReservationState>
    deleteProduct: Record<string, DeleteProductSession>
    sale: Record<string, SaleSession>
    cart: Record<string, CartSession>
    qr: Record<string, QRSession>
    settings: Record<string, { key: string; businessId: string }>
    orden: Record<string, OrdenSession>
}

// ========== SHARED CONTEXT ==========

export interface BotContext {
    bot: Telegraf
    prisma: PrismaClient
    sessions: SessionStores
    isDev: boolean
    BOT_TOKEN: string
}

// ========== LABELS ==========

export const customerTypeLabels: Record<string, string> = {
    'TECHNICIAN': '🔧 Técnico de Reparación',
    'STORE': '🏪 Local de Refacciones',
    'NORMAL': '👤 Cliente Particular'
}
