import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "@/lib/api-auth"
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

export async function POST(request: NextRequest) {
  try {
    const result = await requireAdmin()
    if (result.error) return result.error

    const formData = await request.formData()
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

    return NextResponse.json({ path: `/uploads/${filename}` })
  } catch (error) {
    console.error("[upload/logo]", error)
    return NextResponse.json({ error: "Error al subir el logo" }, { status: 500 })
  }
}
