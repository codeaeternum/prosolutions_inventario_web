"use client"

import { useState, useSyncExternalStore } from "react"
import { AdminSidebar } from "@/components/admin/sidebar"
import { AdminHeader } from "@/components/admin/header"
import { AdminCommandPalette } from "@/components/admin/command-palette"
import { GuidedTour } from "@/components/admin/guided-tour"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { Undo2, Loader2 } from "lucide-react"
import { toast } from "sonner"
import type { UserRole, CustomerType, UserStatus, BusinessKind } from "@prisma/client"

const SIDEBAR_STORAGE_KEY = "reficio-sidebar-collapsed"
// Evento propio porque "storage" no se dispara en la pestaña que modifica localStorage.
const SIDEBAR_EVENT = "reficio-sidebar-change"

function subscribeCollapsed(onChange: () => void) {
  window.addEventListener(SIDEBAR_EVENT, onChange)
  window.addEventListener("storage", onChange)
  return () => {
    window.removeEventListener(SIDEBAR_EVENT, onChange)
    window.removeEventListener("storage", onChange)
  }
}

function getCollapsedSnapshot() {
  return localStorage.getItem(SIDEBAR_STORAGE_KEY) === "true"
}

interface AdminShellUser {
  id: string
  name: string
  email: string
  role: UserRole
  customerType: CustomerType
  status: UserStatus
  jobTitle?: string | null
  // Operador de plataforma: habilita el acceso a la consola /platform.
  isSuperAdmin?: boolean
  // Restricción de módulos del staff (vacío = sin restricción).
  allowedModules?: string[]
  // Id del staff que originó la sesión cuando hay cambio rápido de usuario.
  impersonator?: string | null
}

interface AdminShellProps {
  user: AdminShellUser
  // Sucursal base del usuario, usada como fallback del selector de sucursal.
  homeBranchId?: string | null
  // El negocio tiene taller asociado configurado → muestra "Portal aliado".
  hasPartner?: boolean
  // Giro principal del negocio (FULL, REPAIR, PARTNER, PARTS) para adaptar navegación.
  businessKind?: BusinessKind | null
  children: React.ReactNode
}

export function AdminShell({ user, homeBranchId, hasPartner, businessKind, children }: AdminShellProps) {
  const collapsed = useSyncExternalStore(subscribeCollapsed, getCollapsedSnapshot, () => false)
  const [restoring, setRestoring] = useState(false)

  const toggleSidebar = () => {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, String(!getCollapsedSnapshot()))
    window.dispatchEvent(new Event(SIDEBAR_EVENT))
  }

  const handleRestore = async () => {
    if (restoring) return
    setRestoring(true)
    try {
      const res = await fetch("/api/auth/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restore: true }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        // Recarga completa: el switch reescribe la cookie de sesión JWT.
        window.location.assign(data?.user?.isSuperAdmin ? "/platform" : "/admin")
      } else {
        toast.error(data.error || "No se pudo volver a tu cuenta")
        setRestoring(false)
      }
    } catch {
      toast.error("Error de conexión")
      setRestoring(false)
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <AdminSidebar user={{ role: user.role, isSuperAdmin: user.isSuperAdmin, allowedModules: user.allowedModules }} hasPartner={hasPartner} businessKind={businessKind} collapsed={collapsed} />
      <div className={cn("transition-all duration-300", collapsed ? "lg:pl-20" : "lg:pl-64")}>
        <AdminHeader
          user={user}
          homeBranchId={homeBranchId}
          sidebarCollapsed={collapsed}
          onToggleSidebar={toggleSidebar}
        />
        {user.impersonator && (
          <div className="flex items-center justify-center gap-3 px-4 py-1.5 bg-amber-100 dark:bg-amber-950/50 border-b border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200 text-sm">
            <span className="truncate">
              Actuando como <strong>{user.name}</strong>
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-amber-900 dark:text-amber-200 hover:bg-amber-200/60 dark:hover:bg-amber-900/60"
              onClick={handleRestore}
              disabled={restoring}
            >
              {restoring ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Undo2 className="mr-1 h-3.5 w-3.5" />
              )}
              Volver a mi cuenta
            </Button>
          </div>
        )}
        {/* max-w centrado: en monitores 1440+ el contenido no se estira al
            infinito y las filas de datos conservan un ancho legible. */}
        <main id="main-content" className="mx-auto w-full max-w-[1600px] p-4 lg:p-8" role="main">
          {children}
        </main>
      </div>
      {/* Paleta ⌘K: navegación, acciones rápidas y búsqueda de entidades. */}
      <AdminCommandPalette
        user={{ role: user.role, isSuperAdmin: user.isSuperAdmin, allowedModules: user.allowedModules }}
        hasPartner={hasPartner}
        businessKind={businessKind}
      />
      {/* Spotlight tour del primer login: se auto-muestra una vez por
          navegador (localStorage). No durante impersonaciones ("Actuando
          como…") ni para roles fuera del staff — el layout de /admin ya
          garantiza ADMIN/EMPLOYEE, el check queda como defensa. hasTaller
          replica el gate del sidebar (Taller oculto solo en PARTS) para no
          mencionar atajos a un módulo inexistente. */}
      {!user.impersonator && (user.role === "ADMIN" || user.role === "EMPLOYEE") && (
        <GuidedTour hasTaller={businessKind !== "PARTS"} />
      )}
    </div>
  )
}
