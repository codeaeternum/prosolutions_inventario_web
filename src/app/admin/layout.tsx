import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { AdminSidebar } from "@/components/admin/sidebar"
import { AdminHeader } from "@/components/admin/header"

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth()

  if (!session || (session.user.role !== "ADMIN" && session.user.role !== "EMPLOYEE")) {
    redirect("/login")
  }

  return (
    <div className="min-h-screen bg-background">
      <AdminSidebar user={{ role: session.user.role }} />
      <div className="lg:pl-64">
        <AdminHeader user={session.user} />
        <main id="main-content" className="p-4 lg:p-8" role="main">
          {children}
        </main>
      </div>
    </div>
  )
}
