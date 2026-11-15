import { NextRequest, NextResponse } from "next/server"
import { getSession, requireModule } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { recordAudit } from "@/lib/audit"
import { checkAndRecord } from "@/lib/rate-limit"
import { readBoundedBody, requestWithBody } from "@/lib/bounded-body"
import * as fs from "fs"
import * as path from "path"
import { randomBytes } from "crypto"
import { imageFormat } from "@/lib/payment-proofs"

// Logo de marca blanca del negocio (setting "public_logo"). Se guarda plano en
// public/uploads con prefijo logo- para distinguirlo de fotos de productos.
// SVG queda fuera a propósito: puede traer <script> embebido.
const ALLOWED_TYPES: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
}
const MAX_SIZE_MB = 2
const MAX_SIZE = MAX_SIZE_MB * 1024 * 1024
// Margen para el framing multipart (boundary, headers de parte).
const MULTIPART_OVERHEAD_BYTES = 64 * 1024
const UPLOAD_WINDOW_MS = 60 * 60 * 1000
const MAX_UPLOADS_PER_HOUR = 10 // el logo cambia rara vez; tope por usuario

export async function POST(request: NextRequest) {
  try {
    const result = await requireModule("configuracion")
    if (result.error) return result.error
    const session = getSession(result)!
    const businessId = businessIdOf(session)

    // Tope por usuario: el logo se cambia esporádicamente y cada subida
    // escribe disco público — sin freno el endpoint llenaba el volumen.
    if (!checkAndRecord("upload-logo", session.user.id, UPLOAD_WINDOW_MS, MAX_UPLOADS_PER_HOUR)) {
      return NextResponse.json(
        { error: "Demasiadas subidas. Intenta de nuevo en una hora." },
        { status: 429 }
      )
    }

    // Cota real del cuerpo (chunked no declara Content-Length): se cuentan
    // los bytes del stream y se aborta al pasar el tope — ver bounded-body.
    const bounded = await readBoundedBody(request, MAX_SIZE + MULTIPART_OVERHEAD_BYTES)
    if (!bounded.ok) {
      return NextResponse.json(
        { error: bounded.reason === "too_large" ? `El logo no debe superar ${MAX_SIZE_MB} MB` : "No se envió ningún archivo" },
        { status: bounded.reason === "too_large" ? 413 : 400 }
      )
    }

    const formData = await requestWithBody(request, bounded.bytes).formData()
    const file = formData.get("file") as File | null
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "No se envió ningún archivo" }, { status: 400 })
    }

    // La extensión sale del MIME declarado, no del nombre del archivo.
    const ext = ALLOWED_TYPES[file.type]
    if (!ext) {
      return NextResponse.json(
        { error: "Tipo de archivo no permitido. Usa PNG, JPG o WebP." },
        { status: 400 }
      )
    }
    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { error: `El logo no debe superar ${MAX_SIZE_MB} MB` },
        { status: 400 }
      )
    }

    // El MIME declarado es forjable: el formato real se detecta por magic
    // bytes (PNG/JPEG/WebP) y de ahí sale la extensión guardada.
    const bytes = await file.arrayBuffer()
    const format = imageFormat(new Uint8Array(bytes))
    if (!format || !(format.mime in ALLOWED_TYPES)) {
      return NextResponse.json(
        { error: "El contenido no es una imagen válida (PNG, JPG o WebP)." },
        { status: 400 }
      )
    }

    const filename = `logo-${Date.now()}-${randomBytes(6).toString("hex")}.${format.extension}`

    const uploadDir = path.join(process.cwd(), "public", "uploads")
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true })
    }

    fs.writeFileSync(path.join(uploadDir, filename), Buffer.from(bytes))

    // Bitácora: el logo es la cara pública del negocio (vitrina y tickets).
    await recordAudit(prisma, {
      businessId,
      actorId: session.user.id,
      action: "BUSINESS_LOGO",
      entity: "business",
      entityId: businessId,
      summary: `Subió un nuevo logo del negocio (${filename})`,
      changes: { logo: { before: null, after: `/uploads/${filename}` } },
    })

    return NextResponse.json({ path: `/uploads/${filename}` })
  } catch (error) {
    console.error("[upload/logo]", error)
    return NextResponse.json({ error: "Error al subir el logo" }, { status: 500 })
  }
}
