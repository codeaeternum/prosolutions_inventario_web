"use client"

import { createContext, useContext, useState, useEffect, ReactNode } from "react"
import { useSession } from "next-auth/react"

export interface CartItem {
    productId: string
    name: string
    price: number
    quantity: number
    image?: string
    maxStock: number
}

interface CartContextType {
    items: CartItem[]
    addItem: (item: CartItem) => void
    removeItem: (productId: string) => void
    updateQuantity: (productId: string, quantity: number) => void
    clearCart: () => void
    totalItems: number
    totalPrice: number
}

const CartContext = createContext<CartContextType | undefined>(undefined)

// El carrito se guarda por NEGOCIO (`cart:{businessId}`) y como "public" para
// visitantes anónimos (catálogo del negocio default). Antes una sola clave
// global "cart" mezclaba productos entre negocios al cambiar de cuenta o
// entrar en modo soporte — la misma fuga que el caché de notificaciones.
const CART_STORAGE_PREFIX = "cart:"
const PUBLIC_CART_SCOPE = "public"
const LEGACY_CART_KEY = "cart"

function cartKey(scope: string) {
    return `${CART_STORAGE_PREFIX}${scope}`
}

function readCart(key: string): CartItem[] | null {
    try {
        const raw = localStorage.getItem(key)
        if (!raw) return null
        const parsed = JSON.parse(raw)
        return Array.isArray(parsed) && parsed.every((i) => i?.productId && typeof i.quantity === "number")
            ? parsed
            : null
    } catch {
        return null
    }
}

export function CartProvider({ children }: { children: ReactNode }) {
    const { data: session, status } = useSession()
    const [items, setItems] = useState<CartItem[]>([])
    // `itemsScope` recuerda A QUÉ clave pertenece el contenido actual de
    // `items`. Sin él, al cerrar sesión el scope pasa de `cart:{businessId}`
    // a `cart:public` en un render donde `items` AÚN contiene el carrito
    // privado y el efecto de guardado lo volcaba dentro de `cart:public`
    // (fuga entre usuarios del mismo dispositivo, cerrada por la auditoría).
    const [itemsScope, setItemsScope] = useState("")
    const [isInitialized, setIsInitialized] = useState(false)

    const scope = status === "authenticated" && session?.user?.businessId ? session.user.businessId : PUBLIC_CART_SCOPE
    const isCustomer = session?.user?.role === "CUSTOMER"

    // Load from localStorage al resolver la sesión. El setState síncrono aquí
    // es intencional: hidrata el carrito guardado solo en cliente (un useState
    // lazy correría en SSR/prerender, donde localStorage no existe, y causaría
    // hydration mismatch).
    /* eslint-disable react-hooks/set-state-in-effect */
    useEffect(() => {
        if (status === "loading") return
        const key = cartKey(scope)
        const isPublic = scope === PUBLIC_CART_SCOPE
        // Migraciones de una sola vez:
        // - legacy "cart" → scope vigente (anónimos y clientes lo conservan).
        // - "cart:public" (carrito anónimo) → lo adopta un CUSTOMER al entrar:
        //   continúa su compra tras el login. El staff no hereda carritos ajenos.
        const adoptSources = isPublic || isCustomer
        const stored =
            readCart(key) ??
            (adoptSources && !isPublic ? readCart(cartKey(PUBLIC_CART_SCOPE)) : null) ??
            (adoptSources ? readCart(LEGACY_CART_KEY) : null)
        setItems(stored ?? [])
        setItemsScope(scope)
        if (adoptSources) localStorage.removeItem(LEGACY_CART_KEY)
        if (adoptSources && !isPublic) localStorage.removeItem(cartKey(PUBLIC_CART_SCOPE))
        setIsInitialized(true)
    }, [scope, status, isCustomer])
    /* eslint-enable react-hooks/set-state-in-effect */

    // Save to localStorage on change (clave segmentada por negocio). Solo se
    // persiste lo que PERTENECE al scope activo: en el render de transición
    // (logout o cambio de usuario/negocio) `items` todavía es del scope
    // anterior y no debe copiarse a la clave nueva.
    useEffect(() => {
        if (isInitialized && itemsScope === scope) {
            localStorage.setItem(cartKey(scope), JSON.stringify(items))
        }
    }, [items, isInitialized, scope, itemsScope])

    const addItem = (newItem: CartItem) => {
        setItems((currentItems) => {
            const existingItem = currentItems.find((item) => item.productId === newItem.productId)

            if (existingItem) {
                return currentItems.map((item) =>
                    item.productId === newItem.productId
                        ? { ...item, quantity: Math.min(item.quantity + newItem.quantity, item.maxStock) }
                        : item
                )
            }

            return [...currentItems, newItem]
        })
    }

    const removeItem = (productId: string) => {
        setItems((currentItems) => currentItems.filter((item) => item.productId !== productId))
    }

    const updateQuantity = (productId: string, quantity: number) => {
        setItems((currentItems) =>
            currentItems.map((item) =>
                item.productId === productId
                    ? { ...item, quantity: Math.max(1, Math.min(quantity, item.maxStock)) }
                    : item
            )
        )
    }

    const clearCart = () => {
        setItems([])
    }

    const totalItems = items.reduce((total, item) => total + item.quantity, 0)
    const totalPrice = items.reduce((total, item) => total + item.price * item.quantity, 0)

    return (
        <CartContext.Provider
            value={{
                items,
                addItem,
                removeItem,
                updateQuantity,
                clearCart,
                totalItems,
                totalPrice,
            }}
        >
            {children}
        </CartContext.Provider>
    )
}

export function useCart() {
    const context = useContext(CartContext)
    if (context === undefined) {
        throw new Error("useCart must be used within a CartProvider")
    }
    return context
}
