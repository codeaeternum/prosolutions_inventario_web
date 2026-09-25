import { NextRequest, NextResponse } from "next/server"
import { requireModule } from "@/lib/api-auth"
import * as fs from "fs"
import * as path from "path"
import { randomBytes } from "crypto"
import { imageFormat } from "@/lib/payment-proofs"

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"]
const MAX_SIZE_MB = 5
const MAX_SIZE = MAX_SIZE_MB * 1024 * 1024

export async function POST(request: NextRequest) {
  try {
    const result = await requireModule("inventario")
    if (result.error) return result.error

    const formData = await request.formData()
    const file = formData.get("file") as File | null
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "No se envió ningún archivo" }, { status: 400 })
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: "Tipo de archivo no permitido. Usa JPEG, PNG, WebP o GIF." },
        { status: 400 }
      )
    }
    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { error: `La imagen no debe superar ${MAX_SIZE_MB} MB` },
        { status: 400 }
      )
    }

    // El MIME declarado y la extensión del nombre son forjables: el formato
    // real se detecta por magic bytes y de ahí sale la extensión guardada.
    const bytes = await file.arrayBuffer()
    const format = imageFormat(new Uint8Array(bytes))
    if (!format || !ALLOWED_TYPES.includes(format.mime)) {
      return NextResponse.json(
        { error: "El contenido no es una imagen válida (JPEG, PNG, WebP o GIF)." },
        { status: 400 }
      )
    }

    const filename = `${Date.now()}_${randomBytes(8).toString("hex")}.${format.extension}`

    const uploadDir = path.join(process.cwd(), "public", "uploads", "products")
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true })
    }

    const filePath = path.join(uploadDir, filename)
    fs.writeFileSync(filePath, Buffer.from(bytes))

    const url = `/uploads/products/${filename}`
    return NextResponse.json({ url })
  } catch (error) {
    console.error("[upload/product]", error)
    return NextResponse.json({ error: "Error al subir la imagen" }, { status: 500 })
  }
}
