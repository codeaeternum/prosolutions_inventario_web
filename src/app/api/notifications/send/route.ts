import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "@/lib/api-auth"
import { sendNotificationToAdmins, NotificationType } from "../stream/route"

// API para enviar notificaciones programáticamente
export async function POST(req: NextRequest) {
  const result = await requireAdmin()
  if (result.error) return result.error

  try {
    const body = await req.json()
    const { type, title, message, data } = body as {
      type: NotificationType
      title: string
      message: string
      data?: Record<string, unknown>
    }

    if (!type || !title || !message) {
      return NextResponse.json(
        { error: "type, title y message son requeridos" },
        { status: 400 }
      )
    }

    sendNotificationToAdmins({ type, title, message, data })

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json(
      { error: "Error al procesar la notificación" },
      { status: 500 }
    )
  }
}
