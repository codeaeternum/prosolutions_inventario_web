import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { isValidSlug, normalizeSlug } from "@/lib/public-slug"

// Perfil público del negocio en SystemSettings. "business_slug" define el
// namespace reficio.app/<slug>; los demás datos alimentan la vitrina pública
// (/<slug>, /<slug>/market, /<slug>/order-status).
const KEY_SLUG = "business_slug"
const KEY_PHONE = "public_phone"
const KEY_DESCRIPTION = "public_description"
const KEY_ADDRESS = "public_address"
const KEY_BUSINESS_NAME = "ticket_business_name"

const PROFILE_KEYS = [
  KEY_SLUG,
  KEY_PHONE,
  KEY_DESCRIPTION,
  KEY_ADDRESS,
  KEY_BUSINESS_NAME,
] as const

const MAX_PHONE = 30
const MAX_DESCRIPTION = 500
const MAX_ADDRESS = 200

/** URLs públicas relativas del negocio; null mientras no haya slug. */
function publicUrls(slug: string) {
  if (!slug) return null
  return {
    home: `/${slug}`,
    market: `/${slug}/market`,
    orderStatus: `/${slug}/order-status`,
  }
}

async function readProfile() {
  const rows = await prisma.systemSettings.findMany({
    where: { key: { in: [...PROFILE_KEYS] } },
    select: { key: true, value: true },
  })
  const map = new Map(rows.map(row => [row.key, row.value]))
  const slug = normalizeSlug(map.get(KEY_SLUG) ?? "")
  return {
    slug,
    phone: map.get(KEY_PHONE) ?? "",
    description: map.get(KEY_DESCRIPTION) ?? "",
    address: map.get(KEY_ADDRESS) ?? "",
    businessName: map.get(KEY_BUSINESS_NAME) ?? "",
    urls: publicUrls(slug),
  }
}

// GET - Perfil público del negocio (solo admin)
export async function GET() {
  try {
    const auth = await requireAdmin()
    if (auth.error) return auth.error
    return NextResponse.json(await readProfile(), {
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

// POST - Guardar perfil público (solo admin)
// body: { slug?, phone?, description?, address? } — slug vacío quita el link.
export async function POST(req: Request) {
  try {
    const auth = await requireAdmin()
    if (auth.error) return auth.error

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Cuerpo de la solicitud inválido" }, { status: 400 })
    }
    const { slug, phone, description, address } = body as Record<string, unknown>

    const upserts: { key: string; value: string }[] = []

    if (slug !== undefined) {
      if (typeof slug !== "string") {
        return NextResponse.json({ error: "El slug debe ser texto" }, { status: 400 })
      }
      const clean = normalizeSlug(slug)
      if (clean) {
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
        // Un taller aliado ya reclamó ese namespace (User.publicSlug es único).
        const taken = await prisma.user.findFirst({
          where: { publicSlug: clean },
          select: { id: true },
        })
        if (taken) {
          return NextResponse.json(
            { error: "Ese slug ya lo usa un taller aliado" },
            { status: 409 }
          )
        }
      }
      upserts.push({ key: KEY_SLUG, value: clean })
    }

    const textFields: [unknown, string, number, string][] = [
      [phone, KEY_PHONE, MAX_PHONE, "El teléfono"],
      [description, KEY_DESCRIPTION, MAX_DESCRIPTION, "La descripción"],
      [address, KEY_ADDRESS, MAX_ADDRESS, "La dirección"],
    ]
    for (const [field, key, max, label] of textFields) {
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
      upserts.push({ key, value })
    }

    if (upserts.length === 0) {
      return NextResponse.json({ error: "No hay cambios por guardar" }, { status: 400 })
    }

    for (const { key, value } of upserts) {
      await prisma.systemSettings.upsert({
        where: { key },
        create: { key, value },
        update: { value },
      })
    }

    return NextResponse.json(await readProfile())
  } catch (error) {
    console.error("Error updating public profile:", error)
    return NextResponse.json(
      { error: "Error al guardar el perfil público" },
      { status: 500 }
    )
  }
}
