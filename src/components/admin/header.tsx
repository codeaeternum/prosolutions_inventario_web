"use client"

import { signOut } from "next-auth/react"
import { useState } from "react"
import Link from "next/link"
import { ThemeToggle } from "@/components/theme-toggle"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { openCommandPalette } from "@/components/admin/command-palette"
import { NotificationsDropdown } from "@/components/notifications-dropdown"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { BranchSwitcher } from "@/components/admin/branch-switcher"
import { UserSwitcher } from "@/components/admin/user-switcher"
import { hasModule } from "@/lib/access"
import { LogOut, Home, Search, PanelLeft, PanelLeftClose, UserCog } from "lucide-react"
import type { UserRole, CustomerType, UserStatus } from "@prisma/client"

interface AdminHeaderProps {
  user: {
    id: string
    name: string
    email: string
    role: UserRole
    customerType: CustomerType
    status: UserStatus
    jobTitle?: string | null
    allowedModules?: string[]
    impersonator?: string | null
  }
  homeBranchId?: string | null
  sidebarCollapsed?: boolean
  onToggleSidebar?: () => void
}

export function AdminHeader({ user, homeBranchId, sidebarCollapsed, onToggleSidebar }: AdminHeaderProps) {
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const canViewNotifications = hasModule(user, "notificaciones")

  const initials = user.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)

  return (
    <header className="sticky top-0 safe-area-sticky z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-16 items-center justify-between px-4 lg:px-8">
        <div className="flex items-center gap-2 sm:gap-4 flex-1 pl-12 lg:pl-0">
          {/* Sidebar collapse toggle (desktop) */}
          {onToggleSidebar && (
            <Button
              variant="ghost"
              size="icon"
              className="hidden lg:inline-flex"
              onClick={onToggleSidebar}
              title={sidebarCollapsed ? "Expandir menú" : "Contraer menú"}
            >
              {sidebarCollapsed ? (
                <PanelLeft className="h-5 w-5" />
              ) : (
                <PanelLeftClose className="h-5 w-5" />
              )}
            </Button>
          )}
          {/* Desktop search: abre la paleta de comandos (⌘K) */}
          <button
            type="button"
            onClick={openCommandPalette}
            aria-label="Abrir buscador y navegación (⌘K)"
            className="hidden sm:flex max-w-md flex-1 h-9 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm text-muted-foreground shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <Search className="h-4 w-4 shrink-0" />
            <span className="flex-1 truncate text-left">Buscar…</span>
            <kbd className="inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">⌘K</kbd>
          </button>
          <BranchSwitcher homeBranchId={homeBranchId} />
          {/* Mobile search: misma paleta (el diálogo funciona en táctil) */}
          <Button
            variant="ghost"
            size="icon"
            className="sm:hidden"
            aria-label="Abrir buscador y navegación"
            onClick={openCommandPalette}
          >
            <Search className="h-5 w-5" />
          </Button>
        </div>

        <div className="flex items-center gap-1 sm:gap-2">
          {canViewNotifications && <NotificationsDropdown enabled={canViewNotifications} />}
          <ThemeToggle />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="flex items-center gap-2 px-2" aria-label="Menú de cuenta de usuario">
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <div className="hidden sm:block text-left">
                  <p className="text-sm font-medium">{user.name}</p>
                  <p className="text-xs text-muted-foreground">{user.email}</p>
                </div>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem asChild>
                <Link href="/" className="flex items-center gap-2">
                  <Home className="h-4 w-4" />
                  Ir al inicio
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setSwitcherOpen(true)}
                className="flex items-center gap-2"
              >
                <UserCog className="h-4 w-4" />
                Cambiar de usuario
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => signOut({ callbackUrl: "/login" })}
                className="flex items-center gap-2 text-destructive"
              >
                <LogOut className="h-4 w-4" />
                Cerrar sesión
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <UserSwitcher
        open={switcherOpen}
        onOpenChange={setSwitcherOpen}
        currentUserId={user.id}
        isAdmin={user.role === "ADMIN"}
      />
    </header>
  )
}

