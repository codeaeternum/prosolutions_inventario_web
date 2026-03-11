"use client"

import { useState, useRef, useEffect } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import Image from "next/image"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { ThemeToggle } from "@/components/theme-toggle"
import { Loader2, Eye, EyeOff, CheckCircle, Store, ShoppingBag, Mail, Phone, ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

// Lista de dominios de correo populares para autocompletado
const emailDomains = [
  "gmail.com",
  "hotmail.com",
  "outlook.com",
  "yahoo.com",
  "icloud.com",
  "live.com",
  "protonmail.com",
  "mail.com",
]

// Lista de ladas de países (enfocado en Latinoamérica)
const countryCodes = [
  { code: "+52", country: "México", flag: "🇲🇽" },
  { code: "+1", country: "USA/Canadá", flag: "🇺🇸" },
  { code: "+57", country: "Colombia", flag: "🇨🇴" },
  { code: "+54", country: "Argentina", flag: "🇦🇷" },
  { code: "+56", country: "Chile", flag: "🇨🇱" },
  { code: "+51", country: "Perú", flag: "🇵🇪" },
  { code: "+58", country: "Venezuela", flag: "🇻🇪" },
  { code: "+593", country: "Ecuador", flag: "🇪🇨" },
  { code: "+502", country: "Guatemala", flag: "🇬🇹" },
  { code: "+503", country: "El Salvador", flag: "🇸🇻" },
  { code: "+504", country: "Honduras", flag: "🇭🇳" },
  { code: "+505", country: "Nicaragua", flag: "🇳🇮" },
  { code: "+506", country: "Costa Rica", flag: "🇨🇷" },
  { code: "+507", country: "Panamá", flag: "🇵🇦" },
  { code: "+591", country: "Bolivia", flag: "🇧🇴" },
  { code: "+595", country: "Paraguay", flag: "🇵🇾" },
  { code: "+598", country: "Uruguay", flag: "🇺🇾" },
  { code: "+34", country: "España", flag: "🇪🇸" },
]

type ContactMethod = "email" | "phone"

export default function RegisterPage() {
  const router = useRouter()

  const [contactMethod, setContactMethod] = useState<ContactMethod>("email")
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone: "",
    countryCode: "+52",
    password: "",
    confirmPassword: "",
    customerType: "NORMAL" as "NORMAL" | "STORE",
  })
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState(false)

  // Email autocomplete
  const [emailSuggestions, setEmailSuggestions] = useState<string[]>([])
  const [showEmailSuggestions, setShowEmailSuggestions] = useState(false)
  const emailInputRef = useRef<HTMLInputElement>(null)

  // Country code dropdown
  const [showCountryDropdown, setShowCountryDropdown] = useState(false)
  const countryDropdownRef = useRef<HTMLDivElement>(null)

  // Click outside to close dropdowns
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (countryDropdownRef.current && !countryDropdownRef.current.contains(e.target as Node)) {
        setShowCountryDropdown(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target
    setFormData({ ...formData, [name]: value })

    // Email autocomplete logic
    if (name === "email") {
      if (value.includes("@")) {
        const [localPart, domainPart] = value.split("@")
        if (domainPart === "") {
          setEmailSuggestions(emailDomains.map(d => `${localPart}@${d}`))
          setShowEmailSuggestions(true)
        } else {
          const filtered = emailDomains
            .filter(d => d.startsWith(domainPart))
            .map(d => `${localPart}@${d}`)
          setEmailSuggestions(filtered)
          setShowEmailSuggestions(filtered.length > 0 && filtered[0] !== value)
        }
      } else {
        setShowEmailSuggestions(false)
      }
    }
  }

  const selectEmailSuggestion = (email: string) => {
    setFormData({ ...formData, email })
    setShowEmailSuggestions(false)
    emailInputRef.current?.focus()
  }

  const selectCountryCode = (code: string) => {
    setFormData({ ...formData, countryCode: code })
    setShowCountryDropdown(false)
  }

  const formatPhoneNumber = (value: string) => {
    // Remove non-digits
    const digits = value.replace(/\D/g, "")
    // Format for Mexico (10 digits: XXX XXX XXXX)
    if (digits.length <= 3) return digits
    if (digits.length <= 6) return `${digits.slice(0, 3)} ${digits.slice(3)}`
    return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6, 10)}`
  }

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatPhoneNumber(e.target.value)
    setFormData({ ...formData, phone: formatted })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError("")

    // Validations
    if (contactMethod === "email" && !formData.email) {
      setError("El correo electrónico es requerido")
      setIsLoading(false)
      return
    }

    if (contactMethod === "phone" && !formData.phone) {
      setError("El número de teléfono es requerido")
      setIsLoading(false)
      return
    }

    if (formData.password !== formData.confirmPassword) {
      setError("Las contraseñas no coinciden")
      setIsLoading(false)
      return
    }

    if (formData.password.length < 6) {
      setError("La contraseña debe tener al menos 6 caracteres")
      setIsLoading(false)
      return
    }

    // Prepare contact info
    const contactInfo = contactMethod === "email"
      ? { email: formData.email, phone: null }
      : { email: null, phone: `${formData.countryCode}${formData.phone.replace(/\s/g, "")}` }

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.name,
          ...contactInfo,
          password: formData.password,
          customerType: formData.customerType,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || "No se pudo crear la cuenta. Revisa los datos e intenta de nuevo.")
        return
      }

      setSuccess(true)
    } catch {
      setError("No se pudo conectar. Revisa tu conexión e intenta de nuevo.")
    } finally {
      setIsLoading(false)
    }
  }

  const selectedCountry = countryCodes.find(c => c.code === formData.countryCode)

  if (success) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-background">
        <div className="absolute top-4 right-4">
          <ThemeToggle />
        </div>

        <main id="main-content" role="main" className="w-full flex justify-center">
        <Card className="w-full max-w-md text-center">
          <CardHeader>
            <div className="flex justify-center mb-4">
              <CheckCircle className="h-16 w-16 text-green-500" />
            </div>
            <CardTitle className="text-2xl">Solicitud enviada</CardTitle>
            <CardDescription>
              Tu solicitud de cuenta se envió correctamente. Te avisaremos cuando sea aprobada.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-muted-foreground">
              El administrador revisará tu solicitud y te notificará cuando sea aprobada.
            </p>
            <div className="p-4 bg-muted rounded-lg">
              <p className="text-sm font-medium">Tipo de cuenta solicitada:</p>
              <p className="text-primary font-bold">
                {formData.customerType === "STORE" ? "Mayorista" : "Menudeo"}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                El administrador determinará el tipo final de tu cuenta
              </p>
            </div>
          </CardContent>
          <CardFooter>
            <Button
              className="w-full"
              onClick={() => router.push("/login")}
            >
              Ir a iniciar sesión
            </Button>
          </CardFooter>
        </Card>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-background">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>

      <main id="main-content" role="main" className="w-full flex justify-center">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <Image
              src="/logo.jpg"
              alt="Pro-Solutions"
              width={100}
              height={100}
              className="rounded-lg"
            />
          </div>
          <CardTitle className="text-2xl">Solicitar acceso</CardTitle>
          <CardDescription>
            Completa el formulario. Un administrador revisará tu solicitud y te notificará por correo.
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
              <Label htmlFor="name">Nombre completo</Label>
              <Input
                id="name"
                name="name"
                type="text"
                placeholder="Juan Pérez"
                value={formData.name}
                onChange={handleChange}
                required
                disabled={isLoading}
              />
            </div>

            {/* Contact Method Toggle */}
            <div className="space-y-3">
              <Label>Método de contacto</Label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setContactMethod("email")}
                  className={cn(
                    "flex items-center justify-center gap-2 p-3 rounded-lg border-2 transition-all",
                    contactMethod === "email"
                      ? "border-primary bg-primary/10"
                      : "border-muted hover:border-muted-foreground/50"
                  )}
                  disabled={isLoading}
                >
                  <Mail className={cn(
                    "h-5 w-5",
                    contactMethod === "email" ? "text-primary" : "text-muted-foreground"
                  )} />
                  <span className={cn(
                    "font-medium text-sm",
                    contactMethod === "email" ? "text-primary" : ""
                  )}>
                    Correo
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setContactMethod("phone")}
                  className={cn(
                    "flex items-center justify-center gap-2 p-3 rounded-lg border-2 transition-all",
                    contactMethod === "phone"
                      ? "border-primary bg-primary/10"
                      : "border-muted hover:border-muted-foreground/50"
                  )}
                  disabled={isLoading}
                >
                  <Phone className={cn(
                    "h-5 w-5",
                    contactMethod === "phone" ? "text-primary" : "text-muted-foreground"
                  )} />
                  <span className={cn(
                    "font-medium text-sm",
                    contactMethod === "phone" ? "text-primary" : ""
                  )}>
                    Teléfono
                  </span>
                </button>
              </div>
            </div>

            {/* Email Input with Autocomplete */}
            {contactMethod === "email" && (
              <div className="space-y-2 relative">
                <Label htmlFor="email">Correo electrónico</Label>
                <Input
                  ref={emailInputRef}
                  id="email"
                  name="email"
                  type="email"
                  placeholder="tucorreo@gmail.com"
                  value={formData.email}
                  onChange={handleChange}
                  onFocus={() => formData.email.includes("@") && setShowEmailSuggestions(emailSuggestions.length > 0)}
                  onBlur={() => setTimeout(() => setShowEmailSuggestions(false), 200)}
                  required={contactMethod === "email"}
                  disabled={isLoading}
                  autoComplete="off"
                />
                {showEmailSuggestions && emailSuggestions.length > 0 && (
                  <div className="absolute z-10 w-full mt-1 bg-popover border rounded-md shadow-lg max-h-48 overflow-auto">
                    {emailSuggestions.map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        className="w-full px-3 py-2 text-left text-sm hover:bg-accent transition-colors"
                        onMouseDown={() => selectEmailSuggestion(suggestion)}
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Phone Input with Country Code */}
            {contactMethod === "phone" && (
              <div className="space-y-2">
                <Label htmlFor="phone">Número de teléfono</Label>
                <div className="flex gap-2">
                  {/* Country Code Dropdown */}
                  <div className="relative" ref={countryDropdownRef}>
                    <button
                      type="button"
                      onClick={() => setShowCountryDropdown(!showCountryDropdown)}
                      className="flex items-center gap-1 h-10 px-3 border rounded-md bg-muted hover:bg-accent transition-colors min-w-[100px]"
                      disabled={isLoading}
                    >
                      <span className="text-lg">{selectedCountry?.flag}</span>
                      <span className="text-sm font-medium">{formData.countryCode}</span>
                      <ChevronDown className="h-4 w-4 text-muted-foreground ml-auto" />
                    </button>
                    {showCountryDropdown && (
                      <div className="absolute z-20 w-56 mt-1 bg-popover border rounded-md shadow-lg max-h-64 overflow-auto">
                        {countryCodes.map((country) => (
                          <button
                            key={country.code}
                            type="button"
                            className="w-full px-3 py-2 text-left text-sm hover:bg-accent transition-colors flex items-center gap-2"
                            onClick={() => selectCountryCode(country.code)}
                          >
                            <span className="text-lg">{country.flag}</span>
                            <span className="flex-1">{country.country}</span>
                            <span className="text-muted-foreground">{country.code}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <Input
                    id="phone"
                    name="phone"
                    type="tel"
                    placeholder="55 1234 5678"
                    value={formData.phone}
                    onChange={handlePhoneChange}
                    required={contactMethod === "phone"}
                    disabled={isLoading}
                    className="flex-1"
                    maxLength={14}
                  />
                </div>
              </div>
            )}

            {/* Customer Type Selection */}
            <div className="space-y-3">
              <Label>Tipo de cuenta que solicitas</Label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, customerType: "NORMAL" })}
                  className={cn(
                    "flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-all",
                    formData.customerType === "NORMAL"
                      ? "border-primary bg-primary/10"
                      : "border-muted hover:border-muted-foreground/50"
                  )}
                  disabled={isLoading}
                >
                  <ShoppingBag className={cn(
                    "h-8 w-8",
                    formData.customerType === "NORMAL" ? "text-primary" : "text-muted-foreground"
                  )} />
                  <span className={cn(
                    "font-medium",
                    formData.customerType === "NORMAL" ? "text-primary" : ""
                  )}>
                    Menudeo
                  </span>
                  <span className="text-xs text-muted-foreground text-center">
                    Compras pequeñas
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, customerType: "STORE" })}
                  className={cn(
                    "flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-all",
                    formData.customerType === "STORE"
                      ? "border-primary bg-primary/10"
                      : "border-muted hover:border-muted-foreground/50"
                  )}
                  disabled={isLoading}
                >
                  <Store className={cn(
                    "h-8 w-8",
                    formData.customerType === "STORE" ? "text-primary" : "text-muted-foreground"
                  )} />
                  <span className={cn(
                    "font-medium",
                    formData.customerType === "STORE" ? "text-primary" : ""
                  )}>
                    Mayoreo
                  </span>
                  <span className="text-xs text-muted-foreground text-center">
                    Compras por volumen
                  </span>
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                El administrador determinará el tipo final de tu cuenta
              </p>
            </div>

            {/* Password Fields */}
            <div className="space-y-2">
              <Label htmlFor="password">Contraseña</Label>
              <div className="relative">
                <Input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Mínimo 6 caracteres"
                  value={formData.password}
                  onChange={handleChange}
                  required
                  disabled={isLoading}
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
              <Label htmlFor="confirmPassword">Confirmar contraseña</Label>
              <Input
                id="confirmPassword"
                name="confirmPassword"
                type={showPassword ? "text" : "password"}
                placeholder="Repite la contraseña"
                value={formData.confirmPassword}
                onChange={handleChange}
                required
                disabled={isLoading}
              />
            </div>
          </CardContent>

          <CardFooter className="flex flex-col gap-4">
            <Button
              type="submit"
              className="w-full"
              disabled={isLoading}
            >
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Enviar Solicitud
            </Button>

            <p className="text-sm text-muted-foreground text-center">
              ¿Ya tienes cuenta?{" "}
              <Link href="/login" className="text-primary hover:underline">
                Iniciar sesión
              </Link>
            </p>
          </CardFooter>
        </form>
      </Card>
      </main>
    </div>
  )
}
