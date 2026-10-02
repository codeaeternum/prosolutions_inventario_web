import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import PerfilClient from "./perfil-client"

export const dynamic = 'force-dynamic'

export default async function PerfilPage() {
    const session = await auth()

    if (!session?.user?.id) {
        redirect("/login")
    }

    // phone, email y los verifiedAt no viajan en el JWT (la sesión usa como
    // email el teléfono cuando no hay correo): se leen frescos de la BD para
    // pintar las insignias de verificación y llenar el form de contacto.
    const contact = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { email: true, phone: true, emailVerifiedAt: true, phoneVerifiedAt: true },
    })

    return (
        <PerfilClient
            user={session.user}
            contact={{
                email: contact?.email ?? null,
                phone: contact?.phone ?? null,
                emailVerified: Boolean(contact?.emailVerifiedAt),
                phoneVerified: Boolean(contact?.phoneVerifiedAt),
            }}
        />
    )
}
