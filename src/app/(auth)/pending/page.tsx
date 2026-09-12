"use client"

import { signOut } from "next-auth/react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Clock, LogOut, Wrench } from "lucide-react"

export default function PendingPage() {
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
        </CardContent>
        <CardFooter className="flex flex-col gap-2">
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
