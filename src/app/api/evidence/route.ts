import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { readRepairPhoto } from "@/lib/repair-evidence"

// Sirve una evidencia por id de RepairPhoto. Público a propósito: el cliente
// la ve en /seguimiento y el técnico en el enlace /evidencia. Los ids son cuid
// no adivinables; el acceso al disco va por readRepairPhoto (confinado al dir
// base, magic bytes re-verificados — solo jpeg/png/webp, nunca SVG).
const HEADERS = {
  "Cache-Control": "private, max-age=300",
  "X-Content-Type-Options": "nosniff",
} as const

export async function GET(req: Request) {
  try {
    const id = (new URL(req.url).searchParams.get("id") ?? "").trim()
    if (!/^[a-zA-Z0-9_-]{8,64}$/.test(id)) return new NextResponse(null, { status: 404, headers: HEADERS })
    const photo = await prisma.repairPhoto.findUnique({ where: { id }, select: { filePath: true } })
    if (!photo) return new NextResponse(null, { status: 404, headers: HEADERS })
    const file = await readRepairPhoto(photo.filePath)
    if (!file) return new NextResponse(null, { status: 404, headers: HEADERS })
    return new NextResponse(new Uint8Array(file.bytes), {
      headers: { ...HEADERS, "Content-Type": file.mime, "Content-Disposition": `inline; filename="${id}"` },
    })
  } catch {
    return new NextResponse(null, { status: 404, headers: HEADERS })
  }
}
