"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react"

interface StaffUsersPaginationProps {
  businessId: string
  /** Página 1-based ya saneada por el servidor. */
  page: number
  totalPages: number
  /** La tabla server-rendered se recibe como children para atenuarla
   *  (sin desmontarla) mientras llega la página nueva. */
  children: React.ReactNode
}

/**
 * Controles "‹ Anterior / Siguiente ›" del staff en /platform/[id]. La
 * navegación es SSR (`?usersPage=N#equipo`): mientras la transición está
 * pendiente la lista queda atenuada y ocupada (aria-busy) con spinner —
 * estado de carga visible sin parpadeo ni lista vacía intermedia.
 */
export function StaffUsersPagination({ businessId, page, totalPages, children }: StaffUsersPaginationProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const goTo = (next: number) => {
    if (isPending || next < 1 || next > totalPages || next === page) return
    startTransition(() => {
      router.push(`/platform/${businessId}?usersPage=${next}#equipo`)
    })
  }

  return (
    <div
      aria-busy={isPending}
      className={isPending ? "opacity-60 transition-opacity" : "transition-opacity"}
    >
      {children}
      {totalPages > 1 && (
        <nav
          aria-label="Paginación de usuarios de staff"
          className="mt-4 flex items-center justify-between gap-3"
        >
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page <= 1 || isPending}
            aria-label="Página anterior de usuarios de staff"
            onClick={() => goTo(page - 1)}
          >
            <ChevronLeft className="h-4 w-4 mr-1" aria-hidden="true" />
            Anterior
          </Button>
          <span
            className="inline-flex items-center gap-2 text-sm text-muted-foreground"
            aria-live="polite"
          >
            {isPending && (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                <span className="sr-only">Cargando usuarios…</span>
              </>
            )}
            Página {page} de {totalPages}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page >= totalPages || isPending}
            aria-label="Página siguiente de usuarios de staff"
            onClick={() => goTo(page + 1)}
          >
            Siguiente
            <ChevronRight className="h-4 w-4 ml-1" aria-hidden="true" />
          </Button>
        </nav>
      )}
    </div>
  )
}
