import Link from "next/link"
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
            <Link
              href="/platform"
              aria-label="Ir al inicio de la consola de plataforma"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-opacity hover:opacity-90"
            >
              <Shield className="h-5 w-5" aria-hidden="true" />
            </Link>
            <div className="flex flex-col min-w-0">
              <Link
                href="/platform"
                className="font-bold text-lg leading-tight truncate hover:underline underline-offset-4"
              >
                Reficio Platform
              </Link>
              <span className="text-[10px] text-muted-foreground leading-tight truncate">
                Consola de operador — {session.user.name ?? session.user.email ?? "operador"}
                {/* Build desplegado (ARG GIT_SHA del Dockerfile vía deploy-n5). */}
                {process.env.APP_BUILD_SHA && process.env.APP_BUILD_SHA !== "unknown" && (
                  <span className="ml-1 font-mono" title={`Commit ${process.env.APP_BUILD_SHA}`}>
                    · build {process.env.APP_BUILD_SHA}
                  </span>
                )}
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
