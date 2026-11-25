"use client"

import { useEffect, useId, useRef, useState } from "react"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Loader2, Search, Store, User, UserPlus, Wrench, X } from "lucide-react"
import { toast } from "sonner"
import { formatPrice } from "@/lib/utils"
import type { PosCustomer } from "./types"

interface CustomerPickerProps {
    value: PosCustomer | null
    onChange: (customer: PosCustomer | null) => void
    disabled?: boolean
    /** Solo clientes con línea de crédito autorizada (cobro CREDITO). */
    requiresCredit?: boolean
    placeholder?: string
    /** id del input de búsqueda para asociarlo a un Label externo (htmlFor). */
    id?: string
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

/** El término es casi todo dígitos/signos de teléfono: prellena teléfono, no nombre. */
function looksLikePhone(term: string): boolean {
    return /^[+\d][\d\s()-]*$/.test(term.trim()) && term.replace(/\D/g, "").length >= 3
}

/** Buscador de cliente del ticket: crédito, apartados y notas a taller lo comparten. */
export function CustomerPicker({ value, onChange, disabled, requiresCredit, placeholder, id }: CustomerPickerProps) {
    // El picker convive dos veces en el POS (panel y diálogo): id generado.
    const inputId = useId()
    const [query, setQuery] = useState("")
    const [results, setResults] = useState<PosCustomer[]>([])
    const [searching, setSearching] = useState(false)
    // Red caída o ambos endpoints fallando: NO es lo mismo que "sin
    // coincidencias" — se muestra un error con reintento en vez del vacío.
    const [errorFor, setErrorFor] = useState("")
    // El botón Reintentar re-corre el efecto sin obligar a editar la query.
    const [retryNonce, setRetryNonce] = useState(0)
    // Alta inline: mini-forma de cliente nuevo sin salir del cobro.
    const [createOpen, setCreateOpen] = useState(false)
    const [createName, setCreateName] = useState("")
    const [createPhone, setCreatePhone] = useState("")
    const [createBusy, setCreateBusy] = useState(false)
    const [createError, setCreateError] = useState("")
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
                if (requestRef.current !== requestId) return
                if (!res.ok) {
                    // Error del servidor en AMBOS endpoints: limpia los
                    // resultados del query anterior — mostrar coincidencias
                    // viejas como si aplicaran al término nuevo es peor que
                    // el error honesto.
                    setResults([])
                    setErrorFor(q)
                    return
                }
                let users = (data?.users ?? []).map(toCustomer)
                if (requiresCredit) users = users.filter(u => u.creditLimit != null)
                setResults(users)
                setErrorFor("")
            } catch {
                // Red caída: misma regla — sin resultados obsoletos, error claro.
                if (requestRef.current === requestId) {
                    setResults([])
                    setErrorFor(q)
                }
            } finally {
                if (requestRef.current === requestId) setSearching(false)
            }
        }, 250)
        return () => clearTimeout(timer)
    }, [query, requiresCredit, retryNonce])

    const queryActive = query.trim().length >= 2
    const shownResults = queryActive ? results : []
    // El error solo se muestra mientras el término no haya cambiado: escribir
    // de nuevo ya es un reintento implícito y dispara la búsqueda otra vez.
    const searchFailed = queryActive && errorFor === query.trim() && !searching

    const pick = (customer: PosCustomer) => {
        onChange(customer)
        setQuery("")
        setResults([])
        setErrorFor("")
    }

    const openCreate = () => {
        // Prefill inteligente: si el cajero buscó por teléfono, los dígitos
        // van al teléfono; si buscó por nombre, al nombre.
        const term = query.trim()
        if (looksLikePhone(term)) {
            setCreateName("")
            setCreatePhone(term.replace(/\D/g, "").slice(-10))
        } else {
            setCreateName(term)
            setCreatePhone("")
        }
        setCreateError("")
        setCreateOpen(true)
    }

    const closeCreate = () => {
        if (createBusy) return
        setCreateOpen(false)
        setCreateError("")
    }

    const submitCreate = async () => {
        if (createBusy) return
        const name = createName.trim()
        const phone = createPhone.replace(/\D/g, "")
        if (name.length < 2) {
            setCreateError("Escribe el nombre del cliente (mínimo 2 letras).")
            return
        }
        if (createPhone.trim() && phone.length < 7) {
            setCreateError("Revisa el teléfono: al menos 7 dígitos, o déjalo vacío.")
            return
        }
        setCreateBusy(true)
        setCreateError("")
        try {
            const res = await fetch("/api/users/pos", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name, ...(phone ? { phone } : {}) }),
            })
            const data: { user?: RawUser; existing?: boolean; error?: string } | null = await res.json().catch(() => null)
            if (!res.ok || !data?.user) {
                setCreateError(data?.error ?? "No se pudo crear el cliente. Reintenta.")
                return
            }
            const customer = toCustomer(data.user)
            setCreateOpen(false)
            setCreateName("")
            setCreatePhone("")
            pick(customer)
            toast.success(data.existing ? "El cliente ya existía — seleccionado" : `Cliente "${customer.name}" creado y seleccionado`)
        } catch {
            setCreateError("Sin conexión — no se pudo crear el cliente. Reintenta.")
        } finally {
            setCreateBusy(false)
        }
    }

    if (value) {
        // Disponible en centavos: limit/balance son Float en pesos.
        const available = value.creditLimit != null ? Math.max(0, Math.round(value.creditLimit * 100) - Math.round(value.creditBalance * 100)) / 100 : null
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

    // Alta inline: el cliente nuevo no obliga a abandonar el cobro — nombre +
    // teléfono opcional y queda seleccionado al crear. No aplica al cobro a
    // crédito (requiresCredit): un cliente recién creado nunca tiene línea
    // autorizada, así que la opción sería un callejón sin salida.
    if (createOpen) {
        return (
            <div className="rounded-lg border bg-card p-3 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                    <p className="flex items-center gap-1.5 text-sm font-medium">
                        <UserPlus className="h-4 w-4 text-primary" />
                        Cliente nuevo
                    </p>
                    <Button type="button" variant="ghost" size="icon-sm" onClick={closeCreate} disabled={createBusy} aria-label="Cancelar alta de cliente">
                        <X className="h-4 w-4" />
                    </Button>
                </div>
                <div className="space-y-1">
                    <label htmlFor={`${inputId}-create-name`} className="text-xs text-muted-foreground">Nombre *</label>
                    <Input
                        id={`${inputId}-create-name`}
                        name="customer-create-name"
                        data-pos-no-enter
                        value={createName}
                        onChange={e => { setCreateName(e.target.value); setCreateError("") }}
                        disabled={createBusy}
                        maxLength={80}
                        autoComplete="off"
                        placeholder="Nombre y apellido"
                        className="h-9 text-sm"
                        autoFocus
                    />
                </div>
                <div className="space-y-1">
                    <label htmlFor={`${inputId}-create-phone`} className="text-xs text-muted-foreground">Teléfono (opcional)</label>
                    <Input
                        id={`${inputId}-create-phone`}
                        name="customer-create-phone"
                        data-pos-no-enter
                        value={createPhone}
                        onChange={e => { setCreatePhone(e.target.value); setCreateError("") }}
                        disabled={createBusy}
                        maxLength={20}
                        inputMode="tel"
                        autoComplete="off"
                        placeholder="10 dígitos — vincula órdenes y apartados"
                        className="h-9 text-sm"
                        onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void submitCreate() } }}
                    />
                </div>
                {createError && <p role="alert" className="text-xs text-destructive">{createError}</p>}
                <div className="flex items-center justify-end gap-2 pt-0.5">
                    <Button type="button" variant="ghost" size="sm" onClick={closeCreate} disabled={createBusy}>
                        Cancelar
                    </Button>
                    <Button type="button" size="sm" onClick={() => void submitCreate()} disabled={createBusy || createName.trim().length < 2}>
                        {createBusy && <Loader2 className="h-4 w-4 animate-spin" />}
                        Crear y seleccionar
                    </Button>
                </div>
            </div>
        )
    }

    const showDropdown = queryActive && !searching
    return (
        <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
                id={id ?? inputId}
                name="customer-search"
                // Enter aquí busca cliente, no confirma el cobro del diálogo padre.
                data-pos-no-enter
                value={query}
                onChange={e => setQuery(e.target.value)}
                disabled={disabled}
                placeholder={placeholder ?? "Cliente (nombre o teléfono)…"}
                aria-label="Buscar cliente"
                className="pl-9 h-9 text-sm"
            />
            {searching && queryActive && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin" />}
            {showDropdown && (
                <div className="absolute z-20 inset-x-0 top-full mt-1 rounded-lg border bg-popover shadow-md max-h-56 overflow-y-auto">
                    {searchFailed ? (
                        <div className="px-3 py-2 flex items-center justify-between gap-2">
                            <p className="text-xs text-muted-foreground">No se pudo buscar — revisa tu conexión.</p>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-7 shrink-0 text-xs"
                                onClick={() => setRetryNonce(nonce => nonce + 1)}
                            >
                                Reintentar
                            </Button>
                        </div>
                    ) : (
                        <>
                            {shownResults.map(u => {
                                const available = u.creditLimit != null ? Math.max(0, Math.round(u.creditLimit * 100) - Math.round(u.creditBalance * 100)) / 100 : null
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
                            {shownResults.length === 0 && (
                                <p className="px-3 py-2 text-xs text-muted-foreground">
                                    {requiresCredit ? "Sin clientes con crédito" : "Sin coincidencias"}
                                </p>
                            )}
                            {!requiresCredit && (
                                <button
                                    type="button"
                                    className="w-full text-left px-3 py-2 hover:bg-muted border-t flex items-center gap-2 text-sm font-medium text-primary"
                                    onClick={openCreate}
                                >
                                    <UserPlus className="h-4 w-4 shrink-0" />
                                    Crear cliente nuevo{query.trim() && !looksLikePhone(query) ? ` "${query.trim()}"` : ""}
                                </button>
                            )}
                        </>
                    )}
                </div>
            )}
        </div>
    )
}
