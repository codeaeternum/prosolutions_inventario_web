"use client"

import { createContext, useContext, useState, useEffect, ReactNode } from "react"

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

export function CartProvider({ children }: { children: ReactNode }) {
    const [items, setItems] = useState<CartItem[]>([])
    const [isInitialized, setIsInitialized] = useState(false)

    // Load from localStorage on mount
    useEffect(() => {
        const savedCart = localStorage.getItem("cart")
        if (savedCart) {
            try {
                const parsed = JSON.parse(savedCart)
                if (Array.isArray(parsed) && parsed.every((i) => i?.productId && typeof i.quantity === "number")) {
                    setItems(parsed)
                }
            } catch {
                localStorage.removeItem("cart")
            }
        }
        setIsInitialized(true)
    }, [])

    // Save to localStorage on change
    useEffect(() => {
        if (isInitialized) {
            localStorage.setItem("cart", JSON.stringify(items))
        }
    }, [items, isInitialized])

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
