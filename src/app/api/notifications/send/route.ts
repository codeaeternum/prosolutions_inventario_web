import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { getSession, requireModule } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { sendNotificationToAdmins, NOTIFICATION_TYPES } from "../stream/route"

// `data` viaja por SSE y se persiste en Notification: se acota en tamaño y
// profundidad para que un payload gigante/anidado no infle la fila ni el frame.
const MAX_DATA_BYTES = 4096
const MAX_DATA_DEPTH = 4

function jsonBounded(value: unknown): boolean {
  try {
    if (JSON.stringify(value).length > MAX_DATA_BYTES) return false
  } catch {
    return false
  }
  const stack: [unknown, number][] = [[value, 0]]
  while (stack.length) {
    const [v, depth] = stack.pop()!
    if (depth > MAX_DATA_DEPTH) return false
    if (v !== null && typeof v === "object") {
      for (const child of Object.values(v)) stack.push([child, depth + 1])
    }
  }
  return true
}

const bodySchema = z.object({
  type: z.enum(NOTIFICATION_TYPES),
  title: z.string().trim().min(1).max(120),
  message: z.string().trim().min(1).max(500),
  data: z.record(z.string(), z.unknown())
    .refine(jsonBounded, { message: "data excede el tamaño o profundidad permitidos" })
    .optional(),
})

// API para enviar notificaciones programáticamente
export async function POST(req: NextRequest) {
  const result = await requireModule("notificaciones")
  if (result.error) return result.error
  const businessId = businessIdOf(getSession(result)!)

  try {
    const parsed = bodySchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "type, title y message son requeridos" },
        { status: 400 }
      )
    }

    sendNotificationToAdmins(parsed.data, businessId)

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json(
      { error: "Error al procesar la notificación" },
      { status: 500 }
    )
  }
}
