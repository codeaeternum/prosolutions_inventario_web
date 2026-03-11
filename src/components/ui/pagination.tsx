"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Button } from "@/components/ui/button"
import { ChevronLeft, ChevronRight } from "lucide-react"

interface PaginationProps {
  page: number
  limit: number
  total: number
  totalPages: number
  /** Query params to preserve in links (e.g. search, filter, status). page will be overridden. */
  query?: Record<string, string>
}

export function Pagination({ page, limit, total, totalPages, query = {} }: PaginationProps) {
  const pathname = usePathname()

  const buildHref = (newPage: number) => {
    const params = new URLSearchParams({ ...query, page: String(newPage), limit: String(limit) })
    return `${pathname}?${params.toString()}`
  }

  const from = total === 0 ? 0 : (page - 1) * limit + 1
  const to = Math.min(page * limit, total)

  if (totalPages <= 1 && total <= limit) {
    return (
      <div className="text-sm text-muted-foreground">
        Mostrando {from}-{to} de {total}
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <p className="text-sm text-muted-foreground">
        Mostrando {from}-{to} de {total}
      </p>
      <div className="flex items-center gap-2">
        {page <= 1 ? (
          <Button variant="outline" size="sm" disabled>
            <ChevronLeft className="h-4 w-4 mr-1" />
            Anterior
          </Button>
        ) : (
          <Button variant="outline" size="sm" asChild>
            <Link href={buildHref(page - 1)}>
              <ChevronLeft className="h-4 w-4 mr-1" />
              Anterior
            </Link>
          </Button>
        )}
        <span className="text-sm text-muted-foreground px-2">
          Página {page} de {totalPages}
        </span>
        {page >= totalPages ? (
          <Button variant="outline" size="sm" disabled>
            Siguiente
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        ) : (
          <Button variant="outline" size="sm" asChild>
            <Link href={buildHref(page + 1)}>
              Siguiente
              <ChevronRight className="h-4 w-4 ml-1" />
            </Link>
          </Button>
        )}
      </div>
    </div>
  )
}
