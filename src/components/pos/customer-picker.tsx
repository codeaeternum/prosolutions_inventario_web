"use client"

import { useEffect, useRef, useState } from "react"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Loader2, Search, Store, User, Wrench, X } from "lucide-react"
import { formatPrice } from "@/lib/utils"
import type { PosCustomer } from "./types"

interface CustomerPickerProps {
    value: PosCustomer | null
    onChange: (customer: PosCustomer | null) => void
    disabled?: boolean
    /** Solo clientes con línea de crédito autorizada (cobro CREDITO). */
    requiresCredit?: boolean
    placeholder?: string
}

interface RawUser {
    id: string
    name: string
    customerType?: string | null
    phone?: string | null
    creditLimit?: number | null
    creditBalance?: number | null
}

function toCustomer(u: RawUser): PosCustomer {
    return {
        id: u.id,
        name: u.name,
        customerType: u.customerType ?? null,
        phone: u.phone ?? null,
        creditLimit: u.creditLimit ?? null,
        creditBalance: u.creditBalance ?? 0,
    }
}

/** Buscador de cliente del ticket: crédito, apartados y notas a taller lo comparten. */
export function CustomerPicker({ value, onChange, disabled, requiresCredit, placeholder }: CustomerPickerProps) {
    const [query, setQuery] = useState("")
    const [results, setResults] = useState<PosCustomer[]>([])
    const [searching, setSearching] = useState(false)
    const requestRef = useRef(0)

    useEffect(() => {
        const q = query.trim()
        if (q.length < 2) return // resultados visibles se filtran por la query
        const requestId = ++requestRef.current
        const timer = setTimeout(async () => {
            setSearching(true)
            try {
                // /api/users lista todos los clientes; sin permiso del módulo
                // usuarios se cae a /api/users/pos?all=1 (cualquier cliente
                // aprobado — el filtro de crédito se aplica abajo en cliente).
                let res = await fetch(`/api/users?role=CUSTOMER&status=APPROVED&search=${encodeURIComponent(q)}&limit=8`)
                if (!res.ok) {
                    res = await fetch(`/api/users/pos?search=${encodeURIComponent(q)}&all=1`)
                }
                const data: { users?: RawUser[] } | null = await res.json().catch(() => null)
                if (!res.ok || requestRef.current !== requestId) return
                let users = (data?.users ?? []).map(toCustomer)
                if (requiresCredit) users = users.filter(u => u.creditLimit != null)
                setResults(users)
            } catch {
                if (requestRef.current === requestId) setResults([])
            } finally {
                if (requestRef.current === requestId) setSearching(false)
            }
        }, 250)
        return () => clearTimeout(timer)
    }, [query, requiresCredit])

    const queryActive = query.trim().length >= 2
    const shownResults = queryActive ? results : []

    const pick = (customer: PosCustomer) => {
        onChange(customer)
        setQuery("")
        setResults([])
    }

    if (value) {
        const available = value.creditLimit != null ? Math.max(0, value.creditLimit - value.creditBalance) : null
        return (
            <div className="flex items-center justify-between gap-2 rounded-lg border bg-primary/5 px-3 py-2">
                <div className="min-w-0">
                    <p className="text-sm font-semibold truncate flex items-center gap-1.5">
                        <User className="h-3.5 w-3.5 shrink-0 text-primary" />
                        {value.name}
                        {value.customerType === "STORE" && <Badge variant="secondary" className="text-[10px] px-1"><Store className="h-2.5 w-2.5 mr-0.5" />Taller</Badge>}
                        {value.customerType === "TECHNICIAN" && <Badge variant="secondary" className="text-[10px] px-1"><Wrench className="h-2.5 w-2.5 mr-0.5" />Técnico</Badge>}
                    </p>
                    {available != null && (
                        <p className="text-[11px] text-muted-foreground">
                            Crédito disponible: {formatPrice(available)} de {formatPrice(value.creditLimit ?? 0)}
                        </p>
                    )}
                </div>
                <Button type="button" variant="ghost" size="icon-sm" disabled={disabled} onClick={() => onChange(null)} aria-label="Quitar cliente">
                    <X className="h-4 w-4" />
                </Button>
            </div>
        )
    }

    return (
        <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
                value={query}
                onChange={e => setQuery(e.target.value)}
                disabled={disabled}
                placeholder={placeholder ?? "Cliente (nombre o teléfono)…"}
                aria-label="Buscar cliente"
                className="pl-9 h-9 text-sm"
            />
            {searching && queryActive && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin" />}
            {shownResults.length > 0 && (
                <div className="absolute z-20 inset-x-0 top-full mt-1 rounded-lg border bg-popover shadow-md max-h-48 overflow-y-auto">
                    {shownResults.map(u => {
                        const available = u.creditLimit != null ? Math.max(0, u.creditLimit - u.creditBalance) : null
                        return (
                            <button
                                key={u.id}
                                type="button"
                                className="w-full text-left px-3 py-2 hover:bg-muted border-b last:border-0"
                                onClick={() => pick(u)}
                            >
                                <p className="text-sm font-medium truncate">{u.name}</p>
                                <p className="text-[11px] text-muted-foreground truncate">
                                    {u.phone ? `${u.phone} · ` : ""}
                                    {available != null ? `Crédito: ${formatPrice(available)}` : "Sin línea de crédito"}
                                </p>
                            </button>
                        )
                    })}
                </div>
            )}
            {queryActive && shownResults.length === 0 && !searching && (
                <p className="absolute z-20 inset-x-0 top-full mt-1 rounded-lg border bg-popover px-3 py-2 text-xs text-muted-foreground shadow-md">
                    {requiresCredit ? "Sin clientes con crédito" : "Sin coincidencias"}
                </p>
            )}
        </div>
    )
}
