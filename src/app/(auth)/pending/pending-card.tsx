"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { signOut, useSession } from "next-auth/react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { CheckCircle2, Clock, Loader2, LogOut, RefreshCw, Wrench } from "lucide-react"

export function PendingCard({ alreadyApproved }: { alreadyApproved: boolean }) {
  const router = useRouter()
  const { update } = useSession()
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [notice, setNotice] = useState("")

  // Refresca la sesión sin re-login: update() dispara el jwt callback de
  // auth.ts, que relee la fila del usuario en la BD (status, rol, módulos) y
  // regraba la cookie con el estado fresco. Si ya está aprobado, /post-login
  // elige el destino por rol; si la sesión fue revocada, ese handler manda a
  // /login por sí solo.
  const refreshAndContinue = async () => {
    setIsRefreshing(true)
    setNotice("")
    try {
      const session = await update({})
      if (session?.user?.status === "APPROVED" || !session?.user) {
        router.push("/post-login")
        router.refresh()
        return
      }
      router.refresh()
      setNotice("Tu cuenta sigue en espera de aprobación. Te avisaremos cuando esté lista.")
    } finally {
      setIsRefreshing(false)
    }
  }

  if (alreadyApproved) {
    // La BD ya dice APPROVED aunque el JWT viejo decía PENDING: basta
    // refrescar la sesión, no reingresar credenciales.
    return (
      <Card className="w-full max-w-md text-center">
        <CardHeader>
          <div className="flex justify-center mb-2">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
              <Wrench className="h-7 w-7" />
            </div>
          </div>
          <p className="text-lg font-bold tracking-tight mb-4">Reficio</p>
          <div className="flex justify-center mb-4">
            <div className="p-4 bg-green-500/10 rounded-full">
              <CheckCircle2 className="h-12 w-12 text-green-500" />
            </div>
          </div>
          <CardTitle className="text-2xl">Cuenta activa</CardTitle>
          <CardDescription>
            Tu cuenta ya fue verificada. Continúa para entrar a tu panel.
          </CardDescription>
        </CardHeader>
        <CardFooter className="flex flex-col gap-2">
          <Button
            className="w-full"
            onClick={refreshAndContinue}
            disabled={isRefreshing}
          >
            {isRefreshing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Continuar a mi panel
          </Button>
          <Button
            variant="ghost"
            className="w-full"
            onClick={() => signOut({ callbackUrl: "/login" })}
          >
            <LogOut className="mr-2 h-4 w-4" />
            Usar otra cuenta
          </Button>
        </CardFooter>
      </Card>
    )
  }

  return (
      <Card className="w-full max-w-md text-center">
        <CardHeader>
          <div className="flex justify-center mb-2">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
              <Wrench className="h-7 w-7" />
            </div>
          </div>
          <p className="text-lg font-bold tracking-tight mb-4">Reficio</p>
          <div className="flex justify-center mb-4">
            <div className="p-4 bg-warning/10 rounded-full">
              <Clock className="h-12 w-12 text-warning" />
            </div>
          </div>
          <CardTitle className="text-2xl">Cuenta Pendiente</CardTitle>
          <CardDescription>
            Tu cuenta está en espera de aprobación
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            El administrador revisará tu solicitud pronto.
            Una vez aprobada, podrás acceder al catálogo completo
            y realizar reservaciones.
          </p>
          {notice && (
            <p className="mt-3 text-sm text-muted-foreground" role="status">
              {notice}
            </p>
          )}
        </CardContent>
        <CardFooter className="flex flex-col gap-2">
          {/* Cubre también al que verificó su contacto en otra pestaña:
              update() relee la BD y, si ya quedó aprobado, entra directo. */}
          <Button
            className="w-full"
            onClick={refreshAndContinue}
            disabled={isRefreshing}
          >
            {isRefreshing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Actualizar mi estado
          </Button>
          <Button
            variant="outline"
            className="w-full"
            onClick={() => signOut({ callbackUrl: "/login" })}
          >
            <LogOut className="mr-2 h-4 w-4" />
            Cerrar Sesión
          </Button>
        </CardFooter>
      </Card>
  )
}
