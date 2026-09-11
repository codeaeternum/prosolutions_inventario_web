"use client"

import { signOut } from "next-auth/react"
import { useState } from "react"
import Link from "next/link"
import { ThemeToggle } from "@/components/theme-toggle"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { SearchBar } from "@/components/search-bar"
import { NotificationsDropdown } from "@/components/notifications-dropdown"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { LogOut, Home, Search, X } from "lucide-react"
import type { UserRole, CustomerType, UserStatus } from "@prisma/client"

interface AdminHeaderProps {
  user: {
    id: string
    name: string
    email: string
    role: UserRole
    customerType: CustomerType
    status: UserStatus
  }
}

export function AdminHeader({ user }: AdminHeaderProps) {
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false)

  const initials = user.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)

  return (
    <header className="sticky top-0 safe-area-sticky z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-16 items-center justify-between px-4 lg:px-8">
        <div className="flex items-center gap-4 flex-1 pl-12 lg:pl-0">
          {/* Desktop search */}
          <SearchBar className="hidden sm:block max-w-md flex-1" />
          {/* Mobile search toggle */}
          <Button
            variant="ghost"
            size="icon"
            className="sm:hidden"
            onClick={() => setMobileSearchOpen(!mobileSearchOpen)}
          >
            {mobileSearchOpen ? <X className="h-5 w-5" /> : <Search className="h-5 w-5" />}
          </Button>
        </div>

        <div className="flex items-center gap-1 sm:gap-2">
          <NotificationsDropdown />
          <ThemeToggle />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="flex items-center gap-2 px-2">
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

      {/* Mobile search bar - expandable */}
      {mobileSearchOpen && (
        <div className="sm:hidden px-4 pb-3 border-t">
          <SearchBar className="w-full" />
        </div>
      )}
    </header>
  )
}

