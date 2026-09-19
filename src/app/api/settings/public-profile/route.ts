import { NextResponse } from "next/server"
import { requireModule } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { getBusinessSettingsMap } from "@/lib/settings"
import { isValidSlug, normalizeSlug } from "@/lib/public-slug"
import * as fs from "fs"
import * as path from "path"

// Perfil público del negocio. La identidad vive en la tabla Business (slug,
// phone, address, logoUrl, name); la descripción y el nombre de tickets siguen
// en SystemSettings scoped por businessId. Business.slug define el namespace
// reficio.app/<slug> que alimenta la vitrina (/<slug>, /<slug>/market,
// /<slug>/order-status).
const KEY_DESCRIPTION = "public_description"
const KEY_BUSINESS_NAME = "ticket_business_name"

const MAX_NAME = 120
const MAX_PHONE = 30
const MAX_DESCRIPTION = 500
const MAX_ADDRESS = 200

// Solo paths generados por /api/upload/logo: /uploads/logo-<ts>-<rand>.<ext>
const LOGO_PATH_RE = /^\/uploads\/logo-[\w-]+\.(?:png|jpe?g|webp)$/i

/** Borra el archivo de un logo reemplazado/eliminado (best effort). */
function removeLogoFile(logoPath: string) {
  try {
    if (!LOGO_PATH_RE.test(logoPath)) return
    const abs = path.join(process.cwd(), "public", logoPath.replace(/^\/+/, ""))
    fs.unlink(abs, () => {})
  } catch {
    // El archivo puede no existir ya; no bloquea el guardado.
  }
}

/** URLs públicas relativas del negocio; null mientras no haya slug. */
function publicUrls(slug: string) {
  if (!slug) return null
  return {
    home: `/${slug}`,
    market: `/${slug}/market`,
    orderStatus: `/${slug}/order-status`,
  }
}

/** Prisma P2002 (unique violado): Business.slug chocó con otro negocio. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "P2002"
  )
}

async function readProfile(businessId: string) {
  const [business, settings] = await Promise.all([
    prisma.business.findUnique({
      where: { id: businessId },
      select: { name: true, slug: true, phone: true, address: true, logoUrl: true, showInDirectory: true, lat: true, lng: true },
    }),
    getBusinessSettingsMap(businessId, [KEY_DESCRIPTION, KEY_BUSINESS_NAME]),
  ])
  const slug = normalizeSlug(business?.slug ?? "")
  const logo = business?.logoUrl ?? ""
  return {
    slug,
    phone: business?.phone ?? "",
    description: settings.get(KEY_DESCRIPTION) ?? "",
    address: business?.address ?? "",
    businessName: settings.get(KEY_BUSINESS_NAME) || business?.name || "",
    logo: LOGO_PATH_RE.test(logo) ? logo : "",
    showInDirectory: business?.showInDirectory ?? true,
    lat: business?.lat ?? null,
    lng: business?.lng ?? null,
    urls: publicUrls(slug),
  }
}

// GET - Perfil público del negocio (módulo configuración)
export async function GET() {
  try {
    const auth = await requireModule("configuracion")
    if (auth.error) return auth.error
    return NextResponse.json(await readProfile(auth.session.user.businessId), {
      headers: { "Cache-Control": "private, no-store" },
    })
  } catch (error) {
    console.error("Error fetching public profile:", error)
    return NextResponse.json(
      { error: "Error al obtener el perfil público" },
      { status: 500 }
    )
  }
}

// POST - Guardar perfil público (módulo configuración)
// body: { slug?, phone?, description?, address?, logo?, businessName?, showInDirectory? } —
// `logo` es el path devuelto por /api/upload/logo (vacío/null quita el logo).
// `businessName` actualiza Business.name Y ticket_business_name scoped.
// `showInDirectory` controla si el negocio aparece en el directorio /mercado.
// `lat`/`lng` ubican el negocio en el mapa de /mercado: llegan juntos, ambos
// números en rango, o ambos null para quitar la ubicación.
// El slug no puede quedar vacío: Business.slug es obligatorio.
export async function POST(req: Request) {
  try {
    const auth = await requireModule("configuracion")
    if (auth.error) return auth.error
    const businessId = auth.session.user.businessId

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Cuerpo de la solicitud inválido" }, { status: 400 })
    }
    const { slug, phone, description, address, logo, businessName, showInDirectory, lat, lng } = body as Record<string, unknown>

    // Campos de la tabla Business (nullables salvo slug/name) y settings scoped.
    const businessUpdate: { slug?: string; name?: string; phone?: string | null; address?: string | null; logoUrl?: string | null; showInDirectory?: boolean; lat?: number | null; lng?: number | null } = {}
    const settingUpserts: { key: string; value: string }[] = []
    let newLogo: string | null = null

    if (slug !== undefined) {
      if (typeof slug !== "string") {
        return NextResponse.json({ error: "El slug debe ser texto" }, { status: 400 })
      }
      const clean = normalizeSlug(slug)
      // Business.slug es obligatorio: ya no se puede "apagar" la vitrina
      // dejándolo vacío como antes con SystemSettings.
      if (!clean) {
        return NextResponse.json(
          { error: "El link público no puede quedar vacío: elige un slug para tu vitrina" },
          { status: 400 }
        )
      }
      if (clean.length < 3) {
        return NextResponse.json(
          { error: "El slug debe tener al menos 3 caracteres" },
          { status: 400 }
        )
      }
      if (!isValidSlug(clean)) {
        return NextResponse.json(
          { error: "Slug inválido o reservado: usa minúsculas, números y guiones internos" },
          { status: 400 }
        )
      }
      // Colisiones del namespace: otro negocio (Business.slug es único — el
      // pre-check da un mensaje claro y la tx atrapa P2002 por carreras) o un
      // taller aliado (User.publicSlug, único global).
      const [otherBusiness, takenByWorkshop] = await Promise.all([
        prisma.business.findFirst({
          where: { slug: clean, NOT: { id: businessId } },
          select: { id: true },
        }),
        prisma.user.findFirst({
          where: { publicSlug: clean },
          select: { id: true },
        }),
      ])
      if (otherBusiness) {
        return NextResponse.json(
          { error: "Ese slug ya lo usa otro negocio" },
          { status: 409 }
        )
      }
      if (takenByWorkshop) {
        return NextResponse.json(
          { error: "Ese slug ya lo usa un taller aliado" },
          { status: 409 }
        )
      }
      businessUpdate.slug = clean
    }

    if (businessName !== undefined) {
      if (typeof businessName !== "string") {
        return NextResponse.json({ error: "El nombre del negocio debe ser texto" }, { status: 400 })
      }
      const value = businessName.trim()
      if (!value) {
        return NextResponse.json(
          { error: "El nombre del negocio no puede quedar vacío" },
          { status: 400 }
        )
      }
      if (value.length > MAX_NAME) {
        return NextResponse.json(
          { error: `El nombre del negocio no puede exceder ${MAX_NAME} caracteres` },
          { status: 400 }
        )
      }
      // Nombre público: Business.name (vitrina) + ticket_business_name (tickets).
      businessUpdate.name = value
      settingUpserts.push({ key: KEY_BUSINESS_NAME, value })
    }

    // Campos de texto: phone/address van a Business (nullable), description a
    // SystemSettings scoped.
    const businessTextFields: [unknown, "phone" | "address", number, string][] = [
      [phone, "phone", MAX_PHONE, "El teléfono"],
      [address, "address", MAX_ADDRESS, "La dirección"],
    ]
    for (const [field, column, max, label] of businessTextFields) {
      if (field === undefined) continue
      if (typeof field !== "string") {
        return NextResponse.json({ error: `${label} debe ser texto` }, { status: 400 })
      }
      const value = field.trim()
      if (value.length > max) {
        return NextResponse.json(
          { error: `${label} no puede exceder ${max} caracteres` },
          { status: 400 }
        )
      }
      businessUpdate[column] = value || null
    }

    if (description !== undefined) {
      if (typeof description !== "string") {
        return NextResponse.json({ error: "La descripción debe ser texto" }, { status: 400 })
      }
      const value = description.trim()
      if (value.length > MAX_DESCRIPTION) {
        return NextResponse.json(
          { error: `La descripción no puede exceder ${MAX_DESCRIPTION} caracteres` },
          { status: 400 }
        )
      }
      settingUpserts.push({ key: KEY_DESCRIPTION, value })
    }

    if (showInDirectory !== undefined) {
      if (typeof showInDirectory !== "boolean") {
        return NextResponse.json({ error: "showInDirectory debe ser booleano" }, { status: 400 })
      }
      businessUpdate.showInDirectory = showInDirectory
    }

    // Ubicación del mapa: lat y lng siempre viajan juntos. null+null quita
    // la ubicación (el negocio deja de salir en el mapa de /mercado).
    if (lat !== undefined || lng !== undefined) {
      if (lat === null && lng === null) {
        businessUpdate.lat = null
        businessUpdate.lng = null
      } else {
        if (
          typeof lat !== "number" || typeof lng !== "number" ||
          !Number.isFinite(lat) || !Number.isFinite(lng)
        ) {
          return NextResponse.json(
            { error: "La ubicación debe ser lat y lng numéricos (o ambos null para quitarla)" },
            { status: 400 }
          )
        }
        if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
          return NextResponse.json(
            { error: "Coordenadas fuera de rango: lat entre -90 y 90, lng entre -180 y 180" },
            { status: 400 }
          )
        }
        businessUpdate.lat = lat
        businessUpdate.lng = lng
      }
    }

    if (logo !== undefined) {
      if (logo !== null && typeof logo !== "string") {
        return NextResponse.json({ error: "El logo debe ser texto o null" }, { status: 400 })
      }
      const value = (logo ?? "").trim()
      if (value && !LOGO_PATH_RE.test(value)) {
        return NextResponse.json(
          { error: "Ruta de logo inválida: sube el archivo desde esta pantalla" },
          { status: 400 }
        )
      }
      newLogo = value || null
      businessUpdate.logoUrl = newLogo
    }

    if (Object.keys(businessUpdate).length === 0 && settingUpserts.length === 0) {
      return NextResponse.json({ error: "No hay cambios por guardar" }, { status: 400 })
    }

    // Logo anterior para borrar el archivo huérfano tras el update.
    let oldLogo = ""
    if (logo !== undefined) {
      const current = await prisma.business.findUnique({
        where: { id: businessId },
        select: { logoUrl: true },
      })
      oldLogo = current?.logoUrl ?? ""
    }

    try {
      await prisma.$transaction(async (tx) => {
        if (Object.keys(businessUpdate).length > 0) {
          await tx.business.update({ where: { id: businessId }, data: businessUpdate })
        }
        for (const { key, value } of settingUpserts) {
          await tx.systemSettings.upsert({
            where: { businessId_key: { businessId, key } },
            create: { businessId, key, value },
            update: { value },
          })
        }
      })
    } catch (error) {
      if (isUniqueViolation(error)) {
        return NextResponse.json(
          { error: "Ese slug ya lo usa otro negocio" },
          { status: 409 }
        )
      }
      throw error
    }

    if (logo !== undefined && oldLogo && oldLogo !== newLogo) {
      removeLogoFile(oldLogo)
    }

    return NextResponse.json(await readProfile(businessId))
  } catch (error) {
    console.error("Error updating public profile:", error)
    return NextResponse.json(
      { error: "Error al guardar el perfil público" },
      { status: 500 }
    )
  }
}
