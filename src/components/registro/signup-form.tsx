"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
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
import {
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  Globe,
  Loader2,
  Lock,
  PackageSearch,
  Store,
  Wrench,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { generateSlug } from "@/lib/utils"
import { normalizeSlug, RESERVED_SLUGS, SLUG_RE } from "@/lib/slug-rules"

type SignupResult = {
  slug: string
  urls: {
    home: string
    market: string
    orderStatus: string
    admin: string
  }
}

type SlugState = "empty" | "invalid" | "reserved" | "ok"

const SLUG_HELP: Record<Exclude<SlugState, "ok" | "empty">, string> = {
  invalid: "Usa solo minúsculas, números y guiones internos (mín. 3 caracteres)",
  reserved: "Ese slug está reservado por la plataforma",
}

export function SignupForm({ signupEnabled }: { signupEnabled: boolean }) {
  const [form, setForm] = useState({
    businessName: "",
    slug: "",
    adminName: "",
    email: "",
    phone: "",
    password: "",
  })
  // Mientras el usuario no toque el slug, se auto-sugiere desde el nombre.
  const [slugTouched, setSlugTouched] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState("")
  const [closed, setClosed] = useState(!signupEnabled)
  const [result, setResult] = useState<SignupResult | null>(null)

  const slugInfo = useMemo((): { state: SlugState; value: string } => {
    const value = normalizeSlug(form.slug)
    if (!value) return { state: "empty", value }
    if (!SLUG_RE.test(value)) return { state: "invalid", value }
    if (RESERVED_SLUGS.has(value)) return { state: "reserved", value }
    return { state: "ok", value }
  }, [form.slug])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target
    if (name === "businessName") {
      setForm((f) => ({
        ...f,
        businessName: value,
        slug: slugTouched ? f.slug : generateSlug(value).slice(0, 50),
      }))
      return
    }
    if (name === "slug") {
      // Si lo borra por completo, vuelve el modo automático.
      setSlugTouched(value.trim() !== "")
      setForm((f) => ({ ...f, slug: value }))
      return
    }
    setForm((f) => ({ ...f, [name]: value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")

    if (slugInfo.state === "invalid" || slugInfo.state === "reserved") {
      setError(SLUG_HELP[slugInfo.state])
      return
    }
    if (form.password.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres")
      return
    }

    setIsLoading(true)
    try {
      const res = await fetch("/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessName: form.businessName.trim(),
          slug: slugInfo.value || undefined,
          adminName: form.adminName.trim(),
          email: form.email.trim(),
          phone: form.phone.trim() || undefined,
          password: form.password,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        error?: string
        slug?: string
        urls?: SignupResult["urls"]
      }

      if (res.status === 403) {
        setClosed(true)
        return
      }
      if (!res.ok) {
        setError(data.error ?? "No se pudo registrar el negocio. Revisa los datos e intenta de nuevo.")
        return
      }
      if (data.slug && data.urls) {
        setResult({ slug: data.slug, urls: data.urls })
      } else {
        setError("Respuesta inesperada del servidor")
      }
    } catch {
      setError("No se pudo conectar. Revisa tu conexión e intenta de nuevo.")
    } finally {
      setIsLoading(false)
    }
  }

  // ── Estado: registro cerrado por flag (env o 403 del API) ──────────────
  if (closed) {
    return (
      <Card className="w-full max-w-md text-center">
        <CardHeader>
          <div className="flex justify-center mb-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
              <Lock className="h-8 w-8" />
            </div>
          </div>
          <p className="text-lg font-bold tracking-tight mb-1">Reficio</p>
          <CardTitle className="text-2xl">El registro aún no está abierto</CardTitle>
          <CardDescription>
            Estamos preparando el alta de nuevos negocios. Vuelve pronto o
            contáctanos para conseguir acceso anticipado.
          </CardDescription>
        </CardHeader>
        <CardFooter className="flex flex-col gap-4">
          <Button className="w-full" asChild>
            <Link href="/login">Ir a iniciar sesión</Link>
          </Button>
        </CardFooter>
      </Card>
    )
  }

  // ── Estado: empresa creada ─────────────────────────────────────────────
  if (result) {
    const publicLinks = [
      { href: result.urls.home, icon: Globe, label: "Tu vitrina", path: result.urls.home },
      { href: result.urls.market, icon: Store, label: "Mercado de refacciones", path: result.urls.market },
      { href: result.urls.orderStatus, icon: PackageSearch, label: "Rastreo de reparaciones", path: result.urls.orderStatus },
    ]
    return (
      <Card className="w-full max-w-md text-center">
        <CardHeader>
          <div className="flex justify-center mb-4">
            <CheckCircle2 className="h-16 w-16 text-green-500" />
          </div>
          <CardTitle className="text-2xl">Tu negocio está listo</CardTitle>
          <CardDescription>
            Ya puedes entrar a tu panel con el correo y la contraseña que registraste.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button className="w-full" size="lg" asChild>
            <Link href={result.urls.admin}>
              Ir a mi panel
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>

          <div className="p-4 bg-muted rounded-lg text-left space-y-3">
            <p className="text-sm font-medium">Tus links públicos:</p>
            {publicLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="group flex items-center gap-3 text-sm rounded-md px-2 py-1.5 -mx-2 hover:bg-accent transition-colors"
              >
                <link.icon className="h-4 w-4 shrink-0 text-primary" />
                <span className="font-medium">{link.label}</span>
                <span className="ml-auto truncate text-muted-foreground group-hover:text-foreground">
                  {link.path}
                </span>
              </Link>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Comparte tu vitrina: reficio.app/{result.slug}
          </p>
        </CardContent>
      </Card>
    )
  }

  // ── Formulario de alta ─────────────────────────────────────────────────
  const slugMessage =
    slugInfo.state === "ok"
      ? `Tu vitrina quedará en reficio.app/${slugInfo.value}`
      : slugInfo.state === "empty"
        ? "Lo generamos automáticamente desde el nombre del negocio"
        : SLUG_HELP[slugInfo.state]

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <div className="flex justify-center mb-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
            <Wrench className="h-7 w-7" />
          </div>
        </div>
        <p className="text-lg font-bold tracking-tight mb-1">Reficio</p>
        <CardTitle className="text-2xl">Crea tu negocio</CardTitle>
        <CardDescription>
          Registra tu taller o tienda y obtén tu panel y vitrina pública al instante.
        </CardDescription>
      </CardHeader>

      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-4">
          {error && (
            <div className="p-3 text-sm text-destructive bg-destructive/10 rounded-md" role="alert">
              {error}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="businessName">Nombre del negocio</Label>
            <Input
              id="businessName"
              name="businessName"
              type="text"
              placeholder="Taller Móvil Express"
              value={form.businessName}
              onChange={handleChange}
              required
              minLength={2}
              maxLength={80}
              disabled={isLoading}
              autoComplete="organization"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="slug">Link público (slug)</Label>
            <div className="flex items-center">
              <span className="flex h-10 items-center rounded-l-md border border-r-0 bg-muted px-3 text-sm text-muted-foreground">
                reficio.app/
              </span>
              <Input
                id="slug"
                name="slug"
                type="text"
                placeholder="tu-negocio"
                value={form.slug}
                onChange={handleChange}
                disabled={isLoading}
                className={cn(
                  "rounded-l-none",
                  (slugInfo.state === "invalid" || slugInfo.state === "reserved") &&
                    "border-destructive focus-visible:ring-destructive"
                )}
                autoComplete="off"
                maxLength={50}
              />
            </div>
            <p
              className={cn(
                "text-xs",
                slugInfo.state === "invalid" || slugInfo.state === "reserved"
                  ? "text-destructive"
                  : "text-muted-foreground"
              )}
            >
              {slugMessage}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="adminName">Tu nombre</Label>
            <Input
              id="adminName"
              name="adminName"
              type="text"
              placeholder="Juan Pérez"
              value={form.adminName}
              onChange={handleChange}
              required
              maxLength={80}
              disabled={isLoading}
              autoComplete="name"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Correo electrónico</Label>
            <Input
              id="email"
              name="email"
              type="email"
              placeholder="tucorreo@gmail.com"
              value={form.email}
              onChange={handleChange}
              required
              disabled={isLoading}
              autoComplete="email"
            />
            <p className="text-xs text-muted-foreground">
              Será tu usuario para entrar al panel de administración.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="phone">
              Teléfono <span className="text-muted-foreground font-normal">(opcional)</span>
            </Label>
            <Input
              id="phone"
              name="phone"
              type="tel"
              placeholder="+52 55 1234 5678"
              value={form.phone}
              onChange={handleChange}
              disabled={isLoading}
              autoComplete="tel"
              maxLength={30}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Contraseña</Label>
            <div className="relative">
              <Input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                placeholder="Mínimo 8 caracteres"
                value={form.password}
                onChange={handleChange}
                required
                minLength={8}
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
        </CardContent>

        <CardFooter className="flex flex-col gap-4">
          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Crear mi negocio
          </Button>

          <p className="text-sm text-muted-foreground text-center">
            ¿Ya tienes cuenta?{" "}
            <Link href="/login" className="text-primary hover:underline">
              Inicia sesión
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  )
}
