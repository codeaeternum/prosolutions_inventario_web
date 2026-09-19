import type { Metadata } from "next"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { VerifyContactForm } from "./verify-contact-form"

/**
 * /verificar — verificación de contacto (correo/teléfono) tras el registro.
 * Pública: el código del correo se puede consumir sin sesión. Con sesión se
 * muestra el estado de ambos canales y los botones de reenvío/Telegram.
 * Coexiste con /verificar/[qrCode] (entrega de reservas — otra cosa).
 */
export const metadata: Metadata = {
  title: "Verifica tu contacto",
  description: "Confirma tu correo o teléfono para activar las notificaciones de tu cuenta.",
  robots: { index: false, follow: false },
}
export const dynamic = "force-dynamic"

export default async function VerificarPage({
  searchParams,
}: {
  searchParams: Promise<{ identifier?: string; sent?: string; tg?: string }>
}) {
  const params = await searchParams
  const identifierParam = (params.identifier ?? "").slice(0, 120)
  const sent = params.sent === "1"
  // El deep-link solo se acepta si apunta a t.me (viene del signup o de /api/verify/start).
  const telegramUrl =
    typeof params.tg === "string" && params.tg.startsWith("https://t.me/") ? params.tg : null

  const session = await auth()
  const account = session?.user?.id
    ? await prisma.user.findUnique({
        where: { id: session.user.id },
        select: {
          name: true,
          email: true,
          phone: true,
          emailVerifiedAt: true,
          phoneVerifiedAt: true,
        },
      })
    : null

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <main id="main-content" role="main" className="w-full flex justify-center">
        <VerifyContactForm
          initialIdentifier={identifierParam || account?.email || ""}
          sent={sent}
          telegramUrl={telegramUrl}
          account={
            account
              ? {
                  name: account.name,
                  email: account.email,
                  phone: account.phone,
                  emailVerified: Boolean(account.emailVerifiedAt),
                  phoneVerified: Boolean(account.phoneVerifiedAt),
                }
              : null
          }
        />
      </main>
    </div>
  )
}
