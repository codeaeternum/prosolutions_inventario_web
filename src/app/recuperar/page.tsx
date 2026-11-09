"use client"

import { useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
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
import { CheckCircle2, Eye, EyeOff, KeyRound, Loader2 } from "lucide-react"

type Step = "request" | "confirm" | "done"

export default function RecuperarPage() {
  const [step, setStep] = useState<Step>("request")
  const [identifier, setIdentifier] = useState("")
  const [code, setCode] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState("")
  const [notice, setNotice] = useState("")

  const handleRequestCode = async (e: React.FormEvent) => {
    e.preventDefault()
    const cleanId = identifier.trim()
    if (!cleanId) {
      setErrorMsg("Ingresa tu correo o teléfono")
      return
    }
    setIsLoading(true)
    setErrorMsg("")
    setNotice("")
    try {
      const res = await fetch("/api/auth/password-reset/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: cleanId }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        message?: string
        error?: string
      }
      if (!res.ok) {
        setErrorMsg(data.error ?? "No se pudo procesar la solicitud.")
        return
      }
      const msg = data.message ?? "Si la cuenta existe, enviamos un código de 6 dígitos."
      setNotice(msg)
      toast.success(msg)
      setStep("confirm")
    } catch {
      setErrorMsg("No se pudo conectar. Revisa tu conexión e intenta de nuevo.")
    } finally {
      setIsLoading(false)
    }
  }

  const handleConfirmReset = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg("")

    if (!/^\d{6}$/.test(code.trim())) {
      setErrorMsg("El código debe ser de 6 dígitos")
      return
    }
    if (newPassword.length < 8) {
      setErrorMsg("La contraseña debe tener al menos 8 caracteres")
      return
    }
    if (newPassword !== confirmPassword) {
      setErrorMsg("Las contraseñas no coinciden")
      return
    }

    setIsLoading(true)
    try {
      const res = await fetch("/api/auth/password-reset/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identifier: identifier.trim(),
          code: code.trim(),
          newPassword,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        error?: string
      }
      if (!res.ok || !data.ok) {
        setErrorMsg(data.error ?? "Código inválido o expirado")
        return
      }
      toast.success("Contraseña restablecida correctamente")
      setStep("done")
    } catch {
      setErrorMsg("No se pudo conectar. Revisa tu conexión e intenta de nuevo.")
    } finally {
      setIsLoading(false)
    }
  }

  if (step === "done") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <main id="main-content" role="main" className="w-full flex justify-center">
          <Card className="w-full max-w-md text-center">
            <CardHeader>
              <div className="flex justify-center mb-4">
                <CheckCircle2 className="h-16 w-16 text-green-500" />
              </div>
              <CardTitle className="text-2xl">Contraseña actualizada</CardTitle>
              <CardDescription>
                Tu contraseña se restableció exitosamente. Ya puedes iniciar sesión con tu nueva contraseña.
              </CardDescription>
            </CardHeader>
            <CardFooter className="flex flex-col gap-3">
              <Button className="w-full" asChild>
                <Link href="/login">Ir a iniciar sesión</Link>
              </Button>
            </CardFooter>
          </Card>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <main id="main-content" role="main" className="w-full flex justify-center">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
                <KeyRound className="h-7 w-7" />
              </div>
            </div>
            <CardTitle className="text-2xl">Recuperar contraseña</CardTitle>
            <CardDescription>
              {step === "request"
                ? "Ingresa tu correo electrónico o teléfono y te enviaremos un código de 6 dígitos."
                : "Ingresa el código de 6 dígitos que recibiste y elige tu nueva contraseña."}
            </CardDescription>
          </CardHeader>

          {step === "request" ? (
            <form onSubmit={handleRequestCode}>
              <CardContent className="space-y-4">
                {errorMsg && (
                  <div className="p-3 text-sm text-destructive bg-destructive/10 rounded-md" role="alert">
                    {errorMsg}
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="identifier">Correo electrónico o teléfono</Label>
                  <Input
                    id="identifier"
                    type="text"
                    placeholder="tu@correo.com o 5512345678"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    required
                    maxLength={254}
                    disabled={isLoading}
                    autoComplete="username"
                  />
                </div>
              </CardContent>

              <CardFooter className="flex flex-col gap-3">
                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Enviar código
                </Button>

                <Button
                  type="button"
                  variant="ghost"
                  className="w-full"
                  disabled={isLoading}
                  onClick={() => {
                    setErrorMsg("")
                    setStep("confirm")
                  }}
                >
                  Ya tengo un código
                </Button>

                <p className="text-sm text-muted-foreground text-center">
                  <Link href="/login" className="font-medium text-primary hover:underline">
                    ← Volver a iniciar sesión
                  </Link>
                </p>
              </CardFooter>
            </form>
          ) : (
            <form onSubmit={handleConfirmReset}>
              <CardContent className="space-y-4">
                {notice && (
                  <div className="p-3 text-sm rounded-md bg-primary/10 text-primary" role="status">
                    {notice}
                  </div>
                )}
                {errorMsg && (
                  <div className="p-3 text-sm text-destructive bg-destructive/10 rounded-md" role="alert">
                    {errorMsg}
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="confirm-identifier">Correo electrónico o teléfono</Label>
                  <Input
                    id="confirm-identifier"
                    type="text"
                    placeholder="tu@correo.com o 5512345678"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    required
                    maxLength={254}
                    disabled={isLoading}
                    autoComplete="username"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="code">Código de 6 dígitos</Label>
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

                <div className="space-y-2">
                  <Label htmlFor="newPassword">Nueva contraseña</Label>
                  <div className="relative">
                    <Input
                      id="newPassword"
                      type={showPassword ? "text" : "password"}
                      placeholder="Mínimo 8 caracteres"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      required
                      minLength={8}
                      maxLength={128}
                      disabled={isLoading}
                      autoComplete="new-password"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      {showPassword ? (
                        <EyeOff className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <Eye className="h-4 w-4 text-muted-foreground" />
                      )}
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirmPassword">Confirmar nueva contraseña</Label>
                  <Input
                    id="confirmPassword"
                    type={showPassword ? "text" : "password"}
                    placeholder="Repite tu nueva contraseña"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    minLength={8}
                    maxLength={128}
                    disabled={isLoading}
                    autoComplete="new-password"
                  />
                </div>
              </CardContent>

              <CardFooter className="flex flex-col gap-3">
                <Button
                  type="submit"
                  className="w-full"
                  disabled={isLoading || code.length !== 6}
                >
                  {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Restablecer contraseña
                </Button>

                <Button
                  type="button"
                  variant="ghost"
                  className="w-full"
                  disabled={isLoading}
                  onClick={() => {
                    setErrorMsg("")
                    setNotice("")
                    setStep("request")
                  }}
                >
                  Solicitar un nuevo código
                </Button>

                <p className="text-sm text-muted-foreground text-center">
                  <Link href="/login" className="font-medium text-primary hover:underline">
                    ← Volver a iniciar sesión
                  </Link>
                </p>
              </CardFooter>
            </form>
          )}
        </Card>
      </main>
    </div>
  )
}
