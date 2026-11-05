"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

// Giro del negocio (Business.businessKind): no restringe módulos, solo adapta
// el onboarding y las opciones visibles del panel.
type BusinessKindOption = "FULL" | "REPAIR" | "PARTNER" | "PARTS"

const BUSINESS_KINDS: { value: BusinessKindOption; label: string; description: string }[] = [
  { value: "FULL", label: "Completo", description: "Taller de reparación + venta de refacciones" },
  { value: "REPAIR", label: "Solo taller de reparación", description: "Recibes equipos, los reparas y los entregas" },
  { value: "PARTNER", label: "Captador", description: "Mando equipos a reparar a otro taller" },
  { value: "PARTS", label: "Solo venta de refacciones", description: "Inventario, mostrador y mercado de refacciones" },
]

type SignupResult = {
  slug: string
  verification?: {
    emailSent: boolean
    telegramUrl: string | null
  }
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
  const router = useRouter()
  const [form, setForm] = useState({
    businessName: "",
    slug: "",
    businessKind: "FULL" as BusinessKindOption,
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
          businessKind: form.businessKind,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        error?: string
        slug?: string
        urls?: SignupResult["urls"]
        verification?: SignupResult["verification"]
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
        // Siguiente paso: verificar el contacto (correo / teléfono vía Telegram).
        // El deep-link viaja como ?tg= — ese link ES el canal de entrega del código.
        const params = new URLSearchParams({
          identifier: form.email.trim().toLowerCase(),
          sent: data.verification?.emailSent ? "1" : "0",
        })
        if (data.verification?.telegramUrl) params.set("tg", data.verification.telegramUrl)
        router.push(`/verificar?${params.toString()}`)
        setResult({ slug: data.slug, urls: data.urls, verification: data.verification })
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
          <p className="text-xs text-muted-foreground text-center">
            ¿Solo buscas comprar refacciones o consultar tus pedidos como cliente?{" "}
            <Link href="/register" className="font-medium text-primary hover:underline">
              Solicita tu cuenta de cliente →
            </Link>
          </p>
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
  const slugInvalid = slugInfo.state === "invalid" || slugInfo.state === "reserved"
  const passwordTouched = form.password.length > 0
  const passwordValid = form.password.length >= 8
  const emailInvalid = form.email.length > 0 && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())
  const businessNameInvalid = form.businessName.length > 0 && form.businessName.trim().length < 2

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
          <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">
            ¿Solo buscas comprar refacciones o consultar tus pedidos como cliente?{" "}
            <Link href="/register" className="font-semibold text-primary hover:underline">
              Solicita tu cuenta de cliente →
            </Link>
          </div>

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
              aria-invalid={businessNameInvalid}
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
                  slugInvalid &&
                    "border-destructive focus-visible:ring-destructive"
                )}
                autoComplete="off"
                maxLength={50}
                aria-invalid={slugInvalid}
                aria-describedby="signup-slug-help"
              />
            </div>
            <p
              id="signup-slug-help"
              className={cn(
                "text-xs",
                slugInvalid
                  ? "text-destructive"
                  : "text-muted-foreground"
              )}
            >
              {slugMessage}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="businessKind">Tipo de negocio</Label>
            <Select
              value={form.businessKind}
              onValueChange={(value) =>
                setForm((f) => ({ ...f, businessKind: value as BusinessKindOption }))
              }
            >
              <SelectTrigger
                id="businessKind"
                disabled={isLoading}
                aria-describedby="signup-business-kind-help"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BUSINESS_KINDS.map((kind) => (
                  <SelectItem key={kind.value} value={kind.value}>
                    {kind.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p id="signup-business-kind-help" className="text-xs text-muted-foreground">
              {BUSINESS_KINDS.find((kind) => kind.value === form.businessKind)?.description}
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
              aria-invalid={emailInvalid}
              aria-describedby="signup-email-help"
            />
            <p id="signup-email-help" className="text-xs text-muted-foreground">
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
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Contraseña</Label>
              <span
                className={cn(
                  "text-xs font-medium transition-colors",
                  !passwordTouched
                    ? "text-muted-foreground"
                    : passwordValid
                      ? "text-green-600 dark:text-green-400"
                      : "text-amber-600 dark:text-amber-400"
                )}
              >
                {passwordValid
                  ? "✓ 8+ caracteres"
                  : passwordTouched
                    ? `${form.password.length}/8 caracteres`
                    : "8+ caracteres"}
              </span>
            </div>
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
                aria-invalid={passwordTouched && !passwordValid}
                aria-describedby="signup-password-help"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <Eye className="h-4 w-4 text-muted-foreground" />
                )}
              </Button>
            </div>
            <p
              id="signup-password-help"
              className={cn(
                "text-xs",
                passwordTouched && !passwordValid
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-muted-foreground"
              )}
            >
              {passwordTouched && !passwordValid
                ? `Te faltan ${8 - form.password.length} caracteres para alcanzar el mínimo de 8.`
                : "Debe contener al menos 8 caracteres."}
            </p>
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
