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
        customerType?: string
        businessName?: string
        phone?: string
    }
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
    settings: Record<string, { key: string }>
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
