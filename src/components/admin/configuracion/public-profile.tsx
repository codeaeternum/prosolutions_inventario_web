"use client"

import { useEffect, useRef, useState } from "react"
import { Copy, ExternalLink, Globe, Info, Loader2, Save } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  SlugField,
  normalizeSlugInput,
  slugFieldError,
  usePublicHost,
} from "@/components/admin/slug-input"

interface PublicProfile {
  slug: string
  phone: string
  description: string
  address: string
  businessName: string
}

const EMPTY_PROFILE: PublicProfile = {
  slug: "",
  phone: "",
  description: "",
  address: "",
  businessName: "",
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // Fallback para contextos sin clipboard API (permisos denegados, HTTP viejo)
    try {
      const area = document.createElement("textarea")
      area.value = text
      area.style.position = "fixed"
      area.style.opacity = "0"
      document.body.appendChild(area)
      area.select()
      const ok = document.execCommand("copy")
      document.body.removeChild(area)
      return ok
    } catch {
      return false
    }
  }
}

/**
 * Tarjeta «Perfil público»: edita business_slug + datos públicos del negocio
 * contra GET/POST /api/settings/public-profile y muestra los links copiables.
 */
export function PublicProfileCard() {
  const [profile, setProfile] = useState<PublicProfile>(EMPTY_PROFILE)
  const [initial, setInitial] = useState<PublicProfile>(EMPTY_PROFILE)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  // Último slug confirmado por el servidor: de él salen los chips de links.
  const [savedSlug, setSavedSlug] = useState("")
  const inFlight = useRef(false)
  const host = usePublicHost()

  useEffect(() => {
    let cancelled = false
    fetch("/api/settings/public-profile")
      .then(res => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data: Partial<PublicProfile>) => {
        if (cancelled) return
        const next: PublicProfile = {
          slug: data.slug ?? "",
          phone: data.phone ?? "",
          description: data.description ?? "",
          address: data.address ?? "",
          businessName: data.businessName ?? "",
        }
        setProfile(next)
        setInitial(next)
        setSavedSlug(next.slug)
      })
      .catch(() => {
        if (!cancelled) toast.error("No se pudo cargar el perfil público")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const slugError = slugFieldError(profile.slug)
  const dirty =
    profile.slug !== initial.slug ||
    profile.phone !== initial.phone ||
    profile.description !== initial.description ||
    profile.address !== initial.address

  async function save() {
    if (inFlight.current) return
    const cleanSlug = normalizeSlugInput(profile.slug)
    if (slugError) {
      toast.error(slugError)
      return
    }
    inFlight.current = true
    setSaving(true)
    try {
      const res = await fetch("/api/settings/public-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: cleanSlug,
          phone: profile.phone,
          description: profile.description,
          address: profile.address,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || "No se pudo guardar el perfil público")
        return
      }
      const next: PublicProfile = {
        slug: data.slug ?? cleanSlug,
        phone: data.phone ?? profile.phone.trim(),
        description: data.description ?? profile.description.trim(),
        address: data.address ?? profile.address.trim(),
        businessName: data.businessName ?? profile.businessName,
      }
      setProfile(next)
      setInitial(next)
      setSavedSlug(next.slug)
      toast.success("Perfil público guardado")
    } catch {
      toast.error("Error de conexión")
    } finally {
      inFlight.current = false
      setSaving(false)
    }
  }

  async function copyLink(path: string) {
    const ok = await copyToClipboard(`${window.location.origin}${path}`)
    if (ok) {
      toast.success("Link copiado")
    } else {
      toast.error("No se pudo copiar el link")
    }
  }

  const links = savedSlug
    ? [
        { path: `/${savedSlug}`, label: "Vitrina" },
        { path: `/${savedSlug}/market`, label: "Mercado" },
        { path: `/${savedSlug}/order-status`, label: "Rastreo de órdenes" },
      ]
    : []

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Globe className="h-5 w-5" />
          Perfil público
        </CardTitle>
        <CardDescription>
          Configura el link público del negocio y los datos que ven tus clientes en la vitrina.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {loading ? (
          <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Cargando perfil público…
          </div>
        ) : (
          <>
            <div className="grid gap-6 md:grid-cols-2">
              <SlugField
                id="public-slug"
                label="Link público (slug)"
                value={profile.slug}
                onChange={(value) => setProfile(prev => ({ ...prev, slug: value }))}
                placeholder="prosolutions"
                hint={`Tu vitrina quedará en ${host}/<slug> — déjalo vacío para desactivarla.`}
                disabled={saving}
              />
              <div className="space-y-2">
                <Label htmlFor="public-phone">Teléfono público / WhatsApp</Label>
                <Input
                  id="public-phone"
                  value={profile.phone}
                  onChange={(e) => setProfile(prev => ({ ...prev, phone: e.target.value }))}
                  placeholder="Ej: 771 123 4567"
                  maxLength={30}
                  disabled={saving}
                />
              </div>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="public-description">Descripción pública</Label>
                <Textarea
                  id="public-description"
                  value={profile.description}
                  onChange={(e) => setProfile(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="Venta de refacciones, accesorios y servicio de reparación."
                  className="resize-none h-24"
                  maxLength={500}
                  disabled={saving}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="public-address">Dirección pública</Label>
                <Textarea
                  id="public-address"
                  value={profile.address}
                  onChange={(e) => setProfile(prev => ({ ...prev, address: e.target.value }))}
                  placeholder={"Ej: Av. Principal 123, Centro\nLun-Sáb 10:00 a 19:00"}
                  className="resize-none h-24"
                  maxLength={200}
                  disabled={saving}
                />
              </div>
            </div>

            <div className="flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-muted-foreground">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span>
                Este es el link que compartes con tus clientes: ahí ven tu catálogo
                y rastrean sus reparaciones sin llamarte.
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t pt-5">
              <Button onClick={() => void save()} disabled={saving || !dirty || !!slugError}>
                {saving ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
                Guardar perfil público
              </Button>
              {dirty && !slugError && (
                <p className="text-xs text-muted-foreground">Hay cambios sin guardar.</p>
              )}
            </div>

            {links.length > 0 && (
              <div className="space-y-2 border-t pt-5">
                <h4 className="text-sm font-medium">Tus links públicos</h4>
                <div className="flex flex-wrap gap-2">
                  {links.map(link => (
                    <span
                      key={link.path}
                      className="inline-flex items-center gap-1 rounded-full border bg-muted/40 px-3 py-1 text-sm"
                    >
                      <span className="mr-1 text-xs text-muted-foreground">{link.label}</span>
                      <code className="font-mono text-xs sm:text-sm">{link.path}</code>
                      <button
                        type="button"
                        aria-label={`Copiar ${link.path}`}
                        onClick={() => void copyLink(link.path)}
                        className="rounded-full p-1 text-muted-foreground transition hover:bg-background hover:text-foreground"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                      <a
                        href={link.path}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Abrir ${link.path} en una pestaña nueva`}
                        className="rounded-full p-1 text-muted-foreground transition hover:bg-background hover:text-foreground"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </span>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Copiar guarda el link completo ({host}
                  {links[0].path}…).
                </p>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
