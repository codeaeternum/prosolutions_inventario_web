import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { PlatformHeaderActions } from "@/components/platform/platform-header-actions"
import { Shield } from "lucide-react"

/**
 * Consola de plataforma (Reficio): solo superadmins. El middleware ya filtra
 * /platform, pero el guard vive también aquí por si el matcher no corre.
 * Header propio — deliberadamente distinto del sidebar de tenant de /admin.
 */
export default async function PlatformLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth()

  if (!session?.user?.isSuperAdmin || session.user.status !== "APPROVED") {
    redirect("/")
  }

  const canAccessAdmin = session.user.role === "ADMIN" || session.user.role === "EMPLOYEE"

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b bg-card">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4 lg:px-8">
          <div className="flex items-center gap-2 min-w-0">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Shield className="h-5 w-5" />
            </div>
            <div className="flex flex-col min-w-0">
              <span className="font-bold text-lg leading-tight truncate">Reficio Platform</span>
              <span className="text-[10px] text-muted-foreground leading-tight">
                Consola de operador — {session.user.name}
              </span>
            </div>
          </div>
          <PlatformHeaderActions canAccessAdmin={canAccessAdmin} />
        </div>
      </header>
      <main id="main-content" className="mx-auto max-w-7xl p-4 lg:p-8" role="main">
        {children}
      </main>
    </div>
  )
}
