"use client"

import { signOut } from "next-auth/react"
import Image from "next/image"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { ThemeToggle } from "@/components/theme-toggle"
import { Clock, LogOut } from "lucide-react"

export default function PendingPage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-background">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>

      <Card className="w-full max-w-md text-center">
        <CardHeader>
          <div className="flex justify-center mb-4">
            <Image
              src="/logo.jpg"
              alt="Pro-Solutions"
              width={100}
              height={100}
              className="rounded-lg"
            />
          </div>
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
    </div>
  )
}
