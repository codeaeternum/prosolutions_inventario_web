import { NextResponse } from "next/server"
import { requireAdmin, requireAdminOrEmployee } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { getBusinessSetting, setBusinessSetting } from "@/lib/settings"
import { isValidSlug } from "@/lib/slug-rules"

// Checklist de onboarding por negocio. El progreso NO se persiste: cada paso
// se deriva de conteos reales en el momento del GET. Lo único guardado es el
// "dismiss" en SystemSettings scoped por businessId.
const DISMISS_KEY = "onboarding_dismissed"

// Nombres placeholder que no cuentan como identidad propia del negocio
// (semillas y defaults conocidos). La comparación es case-insensitive.
const GENERIC_BUSINESS_NAMES = new Set([
  "prosolutions",
  "mi negocio",
  "mi empresa",
  "negocio",
  "empresa",
  "sin nombre",
])

interface OnboardingStep {
  key: string
  label: string
  done: boolean
  href: string
}

// GET — Pasos del checklist con done/href (solo staff del negocio).
export async function GET() {
  try {
    const auth = await requireAdminOrEmployee()
    if (auth.error) return auth.error
    const businessId = auth.session.user.businessId

    const [business, branches, products, services, orders, staffCount, dismissed] =
      await Promise.all([
        prisma.business.findUnique({
          where: { id: businessId },
          select: { name: true, slug: true, logoUrl: true },
        }),
        prisma.branch.count({ where: { businessId } }),
        prisma.product.count({ where: { businessId } }),
        prisma.workshopService.count({ where: { businessId } }),
        prisma.repairOrder.count({ where: { businessId } }),
        prisma.user.count({
          where: { businessId, role: { in: ["ADMIN", "EMPLOYEE"] } },
        }),
        getBusinessSetting(businessId, DISMISS_KEY),
      ])

    const businessName = (business?.name ?? "").trim().toLowerCase()
    const hasIdentity =
      Boolean(business?.logoUrl) ||
      (businessName !== "" && !GENERIC_BUSINESS_NAMES.has(businessName))

    const steps: OnboardingStep[] = [
      {
        key: "identity",
        label: "Ponle nombre y logo a tu negocio",
        done: hasIdentity,
        href: "/admin/configuracion",
      },
      {
        key: "public-profile",
        label: "Configura tu vitrina pública",
        done: isValidSlug(business?.slug ?? ""),
        href: "/admin/configuracion",
      },
      {
        key: "branch",
        label: "Crea tu primera sucursal",
        done: branches >= 1,
        href: "/admin/sucursales",
      },
      {
        key: "product",
        label: "Registra tu primer producto",
        done: products >= 1,
        href: "/admin/productos",
      },
      {
        key: "service",
        label: "Publica un servicio de reparación",
        done: services >= 1,
        href: "/admin/taller/catalogo",
      },
      {
        key: "order",
        label: "Recibe tu primera orden",
        done: orders >= 1,
        href: "/admin/taller/recibir",
      },
      {
        key: "team",
        label: "Invita a tu equipo",
        done: staffCount >= 2,
        href: "/admin/usuarios",
      },
    ]

    return NextResponse.json(
      {
        dismissed: dismissed === "1",
        doneCount: steps.filter((s) => s.done).length,
        total: steps.length,
        steps,
      },
      { headers: { "Cache-Control": "private, no-store" } }
    )
  } catch (error) {
    console.error("Error fetching onboarding:", error)
    return NextResponse.json(
      { error: "Error al obtener el checklist" },
      { status: 500 }
    )
  }
}

// POST — { dismiss: true } oculta el checklist para todo el negocio (admin).
export async function POST(req: Request) {
  try {
    const auth = await requireAdmin()
    if (auth.error) return auth.error

    const body = await req.json().catch(() => null)
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      (body as Record<string, unknown>).dismiss !== true
    ) {
      return NextResponse.json(
        { error: "Cuerpo de la solicitud inválido" },
        { status: 400 }
      )
    }

    await setBusinessSetting(auth.session.user.businessId, DISMISS_KEY, "1")
    return NextResponse.json({ dismissed: true })
  } catch (error) {
    console.error("Error dismissing onboarding:", error)
    return NextResponse.json(
      { error: "No se pudo ocultar la guía" },
      { status: 500 }
    )
  }
}
