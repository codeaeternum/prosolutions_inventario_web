"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { signOut, useSession } from "next-auth/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { CheckCircle2, Loader2, Mail, Send, ShieldCheck } from "lucide-react"

type Account = {
  name: string
  email: string | null
  phone: string | null
  emailVerified: boolean
  phoneVerified: boolean
}

type Props = {
  initialIdentifier: string
  sent: boolean
  telegramUrl: string | null
  account: Account | null
  /** Alta de negocio pendiente: la verificación desbloquea el acceso. */
  requiresVerification?: boolean
}

export function VerifyContactForm({ initialIdentifier, sent, telegramUrl, account, requiresVerification = false }: Props) {
  const router = useRouter()
  const { update } = useSession()
  const [identifier, setIdentifier] = useState(initialIdentifier)
  const [code, setCode] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [isContinuing, setIsContinuing] = useState(false)
  const [isStarting, setIsStarting] = useState<"EMAIL" | "PHONE" | null>(null)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState(
    sent ? "Te enviamos un código de 6 dígitos a tu correo." : ""
  )
  const [verifiedChannel, setVerifiedChannel] = useState<string | null>(null)

  // Entrar sin re-login: update() dispara el jwt callback, que relee la fila
  // en la BD (status ya APPROVED tras verificar) y regraba la cookie;
  // /post-login elige el destino según el rol fresco.
  const continueToPanel = async () => {
    setIsContinuing(true)
    try {
      await update({})
      router.push("/post-login")
      router.refresh()
    } finally {
      setIsContinuing(false)
    }
  }

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setNotice("")
    setIsLoading(true)
    try {
      const res = await fetch("/api/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: identifier.trim(), code: code.trim() }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        error?: string
        verified?: boolean
        channel?: string
      }
      if (!res.ok || !data.verified) {
        setError(data.error ?? "No se pudo verificar el código.")
        return
      }
      setVerifiedChannel(data.channel ?? "EMAIL")
    } catch {
      setError("No se pudo conectar. Revisa tu conexión e intenta de nuevo.")
    } finally {
      setIsLoading(false)
    }
  }

  const handleStart = async (channel: "EMAIL" | "PHONE") => {
    setError("")
    setNotice("")
    setIsStarting(channel)
    try {
      const res = await fetch("/api/verify/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        error?: string
        emailSent?: boolean
        telegramUrl?: string | null
        alreadyVerified?: boolean
      }
      if (!res.ok) {
        setError(data.error ?? "No se pudo generar el código.")
        return
      }
      if (data.alreadyVerified) {
        setNotice("Ese canal ya está verificado. ✅")
        return
      }
      if (channel === "EMAIL") {
        setNotice(
          data.emailSent
            ? "Listo: revisa tu correo, el código expira en 15 minutos."
            : "Generamos el código pero el correo no está configurado en este servidor."
        )
        return
      }
      if (data.telegramUrl) {
        window.open(data.telegramUrl, "_blank", "noopener,noreferrer")
        setNotice("Abre Telegram y toca «Iniciar»: el bot confirma tu teléfono al instante.")
        return
      }
      setError("El bot de Telegram no está disponible ahora.")
    } catch {
      setError("No se pudo conectar. Revisa tu conexión e intenta de nuevo.")
    } finally {
      setIsStarting(null)
    }
  }

  if (verifiedChannel) {
    return (
      <Card className="w-full max-w-md text-center">
        <CardHeader>
          <div className="flex justify-center mb-4">
            <CheckCircle2 className="h-16 w-16 text-green-500" />
          </div>
          <CardTitle className="text-2xl">
            {verifiedChannel === "EMAIL" ? "Correo verificado" : "Teléfono verificado"}
          </CardTitle>
          <CardDescription>
            {!account
              ? "Tu negocio ya está activo. Inicia sesión para entrar al panel."
              : requiresVerification
                ? "Tu negocio ya está activo. Continúa para entrar a tu panel."
                : "Tu cuenta ya muestra el contacto confirmado."}
          </CardDescription>
        </CardHeader>
        <CardFooter className="flex flex-col gap-3">
          {/* Con sesión: update() refresca el JWT (antes el status quedaba
              PENDING hasta reingresar). Sin sesión el login sigue siendo el
              único camino. */}
          {account ? (
            <Button className="w-full" onClick={continueToPanel} disabled={isContinuing}>
              {isContinuing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Ir a mi panel
            </Button>
          ) : (
            <Button className="w-full" asChild>
              <Link href="/login">Iniciar sesión</Link>
            </Button>
          )}
          {account && (
            <Button
              variant="ghost"
              className="w-full"
              onClick={() => signOut({ callbackUrl: "/login" })}
            >
              Usar otra cuenta
            </Button>
          )}
        </CardFooter>
      </Card>
    )
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <div className="flex justify-center mb-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
            <ShieldCheck className="h-7 w-7" />
          </div>
        </div>
        <CardTitle className="text-2xl">Verifica tu contacto</CardTitle>
        <CardDescription>
          Escribe el correo o teléfono con el que te registraste y el código de 6
          dígitos que te enviamos.
        </CardDescription>
      </CardHeader>

      <form onSubmit={handleVerify}>
        <CardContent className="space-y-4">
          {notice && (
            <div className="p-3 text-sm rounded-md bg-primary/10 text-primary" role="status">
              {notice}
            </div>
          )}
          {error && (
            <div className="p-3 text-sm text-destructive bg-destructive/10 rounded-md" role="alert">
              {error}
            </div>
          )}

          {account && (
            <div className="rounded-lg border p-3 space-y-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate">{account.email ?? "Sin correo"}</span>
                <Badge variant={account.emailVerified ? "default" : "secondary"}>
                  {account.emailVerified ? "Correo verificado" : "Correo pendiente"}
                </Badge>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="truncate">{account.phone ?? "Sin teléfono"}</span>
                <Badge variant={account.phoneVerified ? "default" : "secondary"}>
                  {account.phoneVerified ? "Teléfono verificado" : "Teléfono pendiente"}
                </Badge>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="identifier">Correo o teléfono</Label>
            <Input
              id="identifier"
              type="text"
              placeholder="tucorreo@gmail.com"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              required
              maxLength={120}
              disabled={isLoading}
              autoComplete="username"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="code">Código de verificación</Label>
            <Input
              id="code"
              type="text"
              inputMode="numeric"
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              required
              minLength={6}
              maxLength={6}
              disabled={isLoading}
              className="text-center text-lg tracking-[0.5em]"
              autoComplete="one-time-code"
            />
          </div>
        </CardContent>

        <CardFooter className="flex flex-col gap-3">
          <Button type="submit" className="w-full" disabled={isLoading || code.length !== 6}>
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Verificar
          </Button>

          {account && (
            <div className="w-full grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={isStarting !== null || !account.email || account.emailVerified}
                onClick={() => handleStart("EMAIL")}
              >
                {isStarting === "EMAIL" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Mail className="mr-2 h-4 w-4" />
                )}
                Reenviar por correo
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={isStarting !== null || !account.phone || account.phoneVerified}
                onClick={() => handleStart("PHONE")}
              >
                {isStarting === "PHONE" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Send className="mr-2 h-4 w-4" />
                )}
                Verificar por Telegram
              </Button>
            </div>
          )}

          {!account && telegramUrl && (
            <Button type="button" variant="outline" className="w-full" asChild>
              <a href={telegramUrl} target="_blank" rel="noopener noreferrer">
                <Send className="mr-2 h-4 w-4" />
                Verificar teléfono por Telegram
              </a>
            </Button>
          )}

          <p className="text-xs text-muted-foreground text-center">
            {requiresVerification
              ? "Tu negocio se activa al verificar tu correo o tu teléfono por Telegram — basta con un canal."
              : "Verificar tu contacto es opcional y no bloquea tu cuenta: solo activa las notificaciones y la insignia de confianza."}
          </p>
        </CardFooter>
      </form>
    </Card>
  )
}
