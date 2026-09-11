import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import PerfilClient from "./perfil-client"

export const dynamic = 'force-dynamic'

export default async function PerfilPage() {
    const session = await auth()

    if (!session) {
        redirect("/login")
    }

    return <PerfilClient user={session.user} />
}
