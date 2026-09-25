import { Suspense } from "react"
import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { businessIdOf } from "@/lib/tenant"
import { InventarioPanel } from "@/components/admin/inventario/inventario-panel"

/**
 * /admin/inventario — LA pantalla de productos/stock.
 * El layout ya garantiza sesión staff (ADMIN|EMPLOYEE); aquí solo se cargan
 * la sucursal base del usuario y las sucursales activas para que el panel
 * pueda fijar la sucursal del empleado (label, no selector).
 */
export default async function InventarioPage() {
    const session = await auth()
    if (!session?.user?.id) redirect("/login")

    const businessId = businessIdOf(session)
    const [dbUser, branches] = await Promise.all([
        prisma.user.findUnique({
            where: { id: session.user.id },
            select: { homeBranchId: true },
        }),
        prisma.branch.findMany({
            where: { businessId, isActive: true },
            select: { id: true, name: true },
            orderBy: { createdAt: "asc" },
        }),
    ])

    return (
        <div className="space-y-6 pb-20 lg:pb-0">
            <Suspense fallback={null}>
                <InventarioPanel
                    viewer={{
                        role: session.user.role,
                        homeBranchId: dbUser?.homeBranchId ?? null,
                    }}
                    branches={branches}
                />
            </Suspense>
        </div>
    )
}
