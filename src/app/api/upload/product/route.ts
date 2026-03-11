import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "@/lib/api-auth"
import * as fs from "fs"
import * as path from "path"
import { randomBytes } from "crypto"

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"]
const MAX_SIZE_MB = 5
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

    const ext = path.extname(file.name) || ".jpg"
    const safeExt = [".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(ext.toLowerCase()) ? ext : ".jpg"
    const filename = `${Date.now()}_${randomBytes(8).toString("hex")}${safeExt}`

    const uploadDir = path.join(process.cwd(), "public", "uploads", "products")
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true })
    }

    const filePath = path.join(uploadDir, filename)
    const bytes = await file.arrayBuffer()
    fs.writeFileSync(filePath, Buffer.from(bytes))

    const url = `/uploads/products/${filename}`
    return NextResponse.json({ url })
  } catch (error) {
    console.error("[upload/product]", error)
    return NextResponse.json({ error: "Error al subir la imagen" }, { status: 500 })
  }
}
