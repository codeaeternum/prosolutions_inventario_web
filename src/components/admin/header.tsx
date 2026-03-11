"use client"

import { signOut } from "next-auth/react"
import Link from "next/link"
import { ThemeToggle } from "@/components/theme-toggle"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { SearchBar } from "@/components/search-bar"
import { NotificationsDropdown } from "@/components/notifications-dropdown"
import { LogOut, Home } from "lucide-react"
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
          <SearchBar className="hidden sm:block max-w-md flex-1" />
        </div>

        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/">
              <Home className="h-5 w-5" />
            </Link>
          </Button>

          <NotificationsDropdown />

          <ThemeToggle />

          <div className="flex items-center gap-2 ml-2">
            <Avatar className="h-8 w-8">
              <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="hidden sm:block">
              <p className="text-sm font-medium">{user.name}</p>
              <p className="text-xs text-muted-foreground">{user.email}</p>
            </div>
          </div>

          <Button
            variant="ghost"
            size="icon"
            onClick={() => signOut({ callbackUrl: "/login" })}
          >
            <LogOut className="h-5 w-5" />
          </Button>
        </div>
      </div>
    </header>
  )
}
