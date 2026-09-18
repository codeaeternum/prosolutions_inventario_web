"use client"

import { useState } from "react"
import { useSession } from "next-auth/react"
import { Download, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"

export type ExportType = "products" | "sales" | "orders"

interface ExportButtonProps {
  type: ExportType
  branchId?: string
  label?: string
  className?: string
}

export function ExportButton({ type, branchId, label = "Exportar", className }: ExportButtonProps) {
  const { data: session } = useSession()
  const [exporting, setExporting] = useState(false)

  // La exportación incluye costos y PII: la API es admin-only, así que el
  // botón no se muestra a otros roles (evita un 403 seguro pero confuso).
  const isAdmin = session?.user?.role === "ADMIN"

  const handleExport = async () => {
    if (exporting) return
    setExporting(true)
    try {
      const params = new URLSearchParams({ type })
      if (branchId) params.set("branchId", branchId)
      const res = await fetch(`/api/export?${params}`)
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || "No se pudo generar la exportación")
      }
      const blob = await res.blob()
      const disposition = res.headers.get("Content-Disposition") ?? ""
      const filename =
        /filename="?([^";]+)"?/.exec(disposition)?.[1] ??
        `${type}-${new Date().toISOString().slice(0, 10)}.csv`
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      a.remove()
    } catch (error) {
      console.error("Error exporting:", error)
      toast.error(error instanceof Error ? error.message : "Error al exportar. Reintenta en un momento.")
    } finally {
      setExporting(false)
    }
  }

  if (!isAdmin) return null

  return (
    <Button type="button" variant="outline" onClick={handleExport} disabled={exporting} className={className}>
      {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
      {label}
    </Button>
  )
}
