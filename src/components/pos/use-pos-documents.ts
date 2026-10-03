"use client"

import { useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react"
import { toast } from "sonner"
import { getClientOperationKey, type ClientOperationKey } from "@/lib/client-operation-key"
import type { CartItem, PosCustomer, PosDocumentDetail } from "./types"

interface UsePosDocumentsArgs {
    cart: CartItem[]
    customer: PosCustomer | null
    branchId: string
    /** Modo taller del ticket (suspender con kind WORKSHOP fotografía el precio de taller). */
    workshopActive: boolean
    /** Candado compartido con el checkout para no tocar el ticket en vuelo. */
    submittingRef: MutableRefObject<boolean>
    setCart: Dispatch<SetStateAction<CartItem[]>>
    setCustomer: Dispatch<SetStateAction<PosCustomer | null>>
    setWorkshopSale: Dispatch<SetStateAction<boolean>>
    setResumedDoc: Dispatch<SetStateAction<{ id: string; number: number; kind?: string } | null>>
    clearTicket: () => void
    /** Se invoca tras suspender/descartar/liquidar para recargar los drawers. */
    onDocumentsChanged: () => void
}

/** Suspende el ticket como documento RETAIL/DRAFT y recupera documentos al ticket. */
export function usePosDocuments({
    cart, customer, branchId, workshopActive, submittingRef, setCart, setCustomer, setWorkshopSale, setResumedDoc, clearTicket, onDocumentsChanged,
}: UsePosDocumentsArgs) {
    // Reintento idempotente: mismo payload → misma llave (doble clic no duplica).
    const suspendKey = useRef<ClientOperationKey | null>(null)

    const suspendSale = async (note: string): Promise<boolean> => {
        if (!cart.length || submittingRef.current) return false
        const payload = {
            // WORKSHOP fotografía precio de taller en el documento suspendido.
            kind: workshopActive ? "WORKSHOP" : "RETAIL",
            note: note || undefined,
            items: cart.map(i => ({ productId: i.product.id, quantity: i.quantity })),
            customerId: customer?.id ?? undefined,
            branchId: branchId || undefined,
        }
        suspendKey.current = getClientOperationKey(suspendKey.current, payload)
        submittingRef.current = true
        try {
            const res = await fetch("/api/pos/documents", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...payload, idempotencyKey: suspendKey.current.key }),
            })
            const data: { error?: string } | null = await res.json().catch(() => null)
            if (!res.ok) throw new Error(data?.error || "No se pudo suspender la venta")
            suspendKey.current = null
            clearTicket()
            onDocumentsChanged()
            toast.success("Venta suspendida — recupérala desde «Recuperar»")
            return true
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "No se pudo suspender la venta")
            return false
        } finally {
            submittingRef.current = false
        }
    }

    const resumeDoc = async (docId: string): Promise<boolean> => {
        try {
            const res = await fetch(`/api/pos/documents/${docId}`)
            const data: { document?: PosDocumentDetail; error?: string } | null = await res.json().catch(() => null)
            if (!res.ok || !data?.document) throw new Error(data?.error || "No se pudo cargar la venta suspendida")
            const doc = data.document
            const items: CartItem[] = (doc.items ?? []).flatMap(i => {
                const p = i.product
                if (!p?.id) return []
                return [{
                    quantity: i.quantity,
                    product: {
                        id: p.id,
                        name: p.name ?? "Producto",
                        barcode: p.barcode ?? null,
                        stock: p.stock ?? 0,
                        retailPrice: p.retailPrice ?? i.unitPrice,
                        wholesalePrice: p.wholesalePrice ?? i.unitPrice,
                        images: p.images,
                    },
                }]
            })
            if (items.length === 0) throw new Error("El documento no tiene líneas recuperables")
            setCart(items)
            setResumedDoc({ id: doc.id, number: doc.number, kind: doc.kind })
            // El documento cobra sus precios snapshot: el ticket refleja el mismo modo.
            setWorkshopSale(doc.kind === "WORKSHOP")
            if (doc.customer?.id) {
                // El detalle del documento no trae línea de crédito: se hidrata
                // aparte para que la suspendida recuperada sí pueda cobrarse a
                // crédito (sin esto creditLimit=null la bloqueaba siempre).
                let credit: Pick<PosCustomer, "creditLimit" | "creditBalance"> = { creditLimit: null, creditBalance: 0 }
                try {
                    const res = await fetch(`/api/users/pos?id=${encodeURIComponent(doc.customer.id)}`)
                    const data: { users?: { creditLimit: number | null; creditBalance: number | null }[] } | null =
                        res.ok ? await res.json() : null
                    const u = data?.users?.[0]
                    if (u) credit = { creditLimit: u.creditLimit, creditBalance: u.creditBalance ?? 0 }
                } catch { /* sin crédito hidratado: el checkout lo valida de nuevo */ }
                setCustomer({
                    id: doc.customer.id,
                    name: doc.customer.name,
                    phone: doc.customer.phone ?? null,
                    customerType: doc.customer.customerType ?? null,
                    creditLimit: credit.creditLimit,
                    creditBalance: credit.creditBalance,
                })
            }
            toast.success(`${doc.kind === "QUOTE" ? "Cotización" : "Suspendida"} #${doc.number} recuperada al ticket`)
            return true
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "No se pudo cargar la venta suspendida")
            return false
        }
    }

    return { suspendSale, resumeDoc }
}
