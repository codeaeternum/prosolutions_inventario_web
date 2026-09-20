"use client"

import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet"
import { ArrowDownRight, ArrowUpRight, Loader2, Printer } from "lucide-react"
import { toast } from "sonner"
import { formatDate, formatPrice } from "@/lib/utils"
import { creditMovementLabels, type CreditAccountDetail } from "./credit-utils"

interface EstadoCuentaSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Cliente cuyo estado de cuenta se consulta (GET /api/credit/users/[id]). */
  userId: string | null
}

/**
 * Estado de cuenta del cliente (saldo, límite, disponible e historial de
 * movimientos de crédito). Lo comparten la cartera (/admin/credito) y la
 * ficha 360; el botón de impresión manda la hoja a window.print().
 */
export function EstadoCuentaSheet({ open, onOpenChange, userId }: EstadoCuentaSheetProps) {
  const [account, setAccount] = useState<CreditAccountDetail | null>(null)
  const [loading, setLoading] = useState(false)
  // Ref para el callback: los padres pasan handlers inline y no deben
  // provocar refetches al re-renderizar.
  const onOpenChangeRef = useRef(onOpenChange)
  useEffect(() => {
    onOpenChangeRef.current = onOpenChange
  }, [onOpenChange])

  useEffect(() => {
    if (!open || !userId) return
    const controller = new AbortController()
    // setTimeout evita setState síncrono dentro del effect (react-hooks/set-state-in-effect)
    const timer = setTimeout(() => {
      setLoading(true)
      setAccount(null)
      fetch(`/api/credit/users/${userId}`, { signal: controller.signal })
        .then(async (res) => {
          if (!res.ok) throw new Error("Error al cargar estado de cuenta")
          setAccount(await res.json())
        })
        .catch((error) => {
          if (controller.signal.aborted) return
          console.error("Error cargando estado de cuenta:", error)
          toast.error("Error al cargar estado de cuenta")
          onOpenChangeRef.current(false)
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false)
        })
    }, 0)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [open, userId])

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Estado de Cuenta</SheetTitle>
          <SheetDescription>
            {account ? `${account.name} — ${account.email || "Sin email"}` : "Cargando..."}
          </SheetDescription>
        </SheetHeader>
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : account ? (
          <div className="space-y-6 mt-6">
            <div className="flex justify-end print:hidden">
              <Button variant="outline" size="sm" onClick={() => window.print()}>
                <Printer className="mr-2 h-4 w-4" />
                Imprimir
              </Button>
            </div>

            {/* Resumen */}
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 bg-destructive/10 rounded-lg text-center">
                <p className="text-xs text-muted-foreground font-medium">Saldo Deudor</p>
                <p className="text-xl font-bold text-destructive mt-1">
                  {formatPrice(account.creditBalance || 0)}
                </p>
              </div>
              <div className="p-4 bg-primary/10 rounded-lg text-center">
                <p className="text-xs text-muted-foreground font-medium">Límite</p>
                <p className="text-xl font-bold mt-1">
                  {account.creditLimit != null ? formatPrice(account.creditLimit) : "Sin límite"}
                </p>
              </div>
            </div>

            {/* Disponible */}
            {account.creditLimit != null && (
              <div className="p-3 bg-muted rounded-lg text-center">
                <p className="text-xs text-muted-foreground">Crédito Disponible</p>
                <p className="text-lg font-bold text-green-600">
                  {formatPrice(Math.max(0, account.creditLimit - (account.creditBalance || 0)))}
                </p>
              </div>
            )}

            {/* Historial */}
            <div>
              <h3 className="font-semibold text-sm mb-3">
                Historial de Movimientos ({account.creditMovements?.length || 0})
              </h3>
              {!account.creditMovements || account.creditMovements.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">
                  No hay movimientos registrados.
                </p>
              ) : (
                <div className="space-y-2">
                  {account.creditMovements.map((mov) => {
                    const isDebt = mov.type === "DEBT"
                    return (
                      <div
                        key={mov.id}
                        className="flex items-center justify-between p-3 border rounded-lg text-sm"
                      >
                        <div className="flex items-center gap-2">
                          <div
                            className={`p-1.5 rounded-full ${
                              isDebt
                                ? "bg-destructive/10 text-destructive"
                                : "bg-green-500/10 text-green-500"
                            }`}
                          >
                            {isDebt ? (
                              <ArrowUpRight className="h-3 w-3" />
                            ) : (
                              <ArrowDownRight className="h-3 w-3" />
                            )}
                          </div>
                          <div>
                            <p className="font-medium">{creditMovementLabels[mov.type]}</p>
                            <p className="text-xs text-muted-foreground">
                              {mov.notes || mov.referenceType || "-"}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className={`font-bold ${isDebt ? "text-destructive" : "text-green-600"}`}>
                            {isDebt ? "+" : "-"}
                            {formatPrice(mov.amount)}
                          </p>
                          <p className="text-[10px] text-muted-foreground">{formatDate(mov.createdAt)}</p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
