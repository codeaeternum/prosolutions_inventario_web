"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import QRCode from "qrcode"
import {
  Copy, Download, ExternalLink, Globe, ImagePlus, Info, Loader2, Printer,
  QrCode, Save, Trash2, Upload,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
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
  logo: string
  showInDirectory: boolean
}

const EMPTY_PROFILE: PublicProfile = {
  slug: "",
  phone: "",
  description: "",
  address: "",
  businessName: "",
  logo: "",
  showInDirectory: true,
}

// QRs del mostrador: violeta oscuro sobre blanco — contraste que imprime bien.
const QR_OPTIONS = {
  width: 256,
  margin: 2,
  errorCorrectionLevel: "M" as const,
  color: { dark: "#4c1d95", light: "#ffffff" },
}

const LOGO_MAX_BYTES = 2 * 1024 * 1024
const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"]

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
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
 * Tarjeta «Perfil público»: edita el slug de Business + datos públicos del
 * negocio contra GET/POST /api/settings/public-profile y muestra los links
 * copiables.
 */
export function PublicProfileCard() {
  const [profile, setProfile] = useState<PublicProfile>(EMPTY_PROFILE)
  const [initial, setInitial] = useState<PublicProfile>(EMPTY_PROFILE)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [logoDrag, setLogoDrag] = useState(false)
  // Data URLs de los QR por path público (/{slug}, /{slug}/market, …).
  const [qrCodes, setQrCodes] = useState<Record<string, string>>({})
  // Último slug confirmado por el servidor: de él salen los chips de links.
  const [savedSlug, setSavedSlug] = useState("")
  const inFlight = useRef(false)
  const logoInputRef = useRef<HTMLInputElement>(null)
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
          logo: data.logo ?? "",
          showInDirectory: data.showInDirectory ?? true,
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
    profile.address !== initial.address ||
    profile.showInDirectory !== initial.showInDirectory

  async function save() {
    if (inFlight.current) return
    const cleanSlug = normalizeSlugInput(profile.slug)
    if (slugError) {
      toast.error(slugError)
      return
    }
    // Business.slug es obligatorio: la vitrina ya no se "apaga" vaciándolo.
    if (!cleanSlug) {
      toast.error("El link público no puede quedar vacío: elige un slug para tu vitrina")
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
          showInDirectory: profile.showInDirectory,
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
        logo: data.logo ?? profile.logo,
        showInDirectory: data.showInDirectory ?? profile.showInDirectory,
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

  // Guarda solo el logo (upsert de una sola key): no pisa cambios sin guardar
  // del resto del formulario.
  async function persistLogo(logoPath: string): Promise<boolean> {
    try {
      const res = await fetch("/api/settings/public-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ logo: logoPath }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || "No se pudo guardar el logo")
        return false
      }
      const next = typeof data.logo === "string" ? data.logo : logoPath
      setProfile(prev => ({ ...prev, logo: next }))
      setInitial(prev => ({ ...prev, logo: next }))
      return true
    } catch {
      toast.error("Error de conexión")
      return false
    }
  }

  async function uploadLogo(file: File) {
    if (!LOGO_TYPES.includes(file.type)) {
      toast.error("Usa una imagen PNG, JPG o WebP")
      return
    }
    if (file.size > LOGO_MAX_BYTES) {
      toast.error("El logo no debe superar 2 MB")
      return
    }
    setUploadingLogo(true)
    try {
      const formData = new FormData()
      formData.append("file", file)
      const res = await fetch("/api/upload/logo", { method: "POST", body: formData })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || typeof data.path !== "string") {
        toast.error(data.error || "No se pudo subir el logo")
        return
      }
      if (await persistLogo(data.path)) {
        toast.success("Logo actualizado")
      }
    } catch {
      toast.error("Error de conexión")
    } finally {
      setUploadingLogo(false)
      if (logoInputRef.current) logoInputRef.current.value = ""
    }
  }

  const links = useMemo(
    () =>
      savedSlug
        ? [
            { path: `/${savedSlug}`, label: "Vitrina", file: "vitrina" },
            { path: `/${savedSlug}/market`, label: "Mercado", file: "mercado" },
            { path: `/${savedSlug}/order-status`, label: "Rastreo de órdenes", file: "rastreo" },
          ]
        : [],
    [savedSlug]
  )

  // Genera los PNGs de los QR en cliente apuntando al host actual.
  // Si no hay links no se renderiza la sección, así que no hace falta limpiar.
  useEffect(() => {
    if (links.length === 0) return
    let cancelled = false
    const origin = `${window.location.protocol}//${host}`
    void Promise.all(
      links.map(async link => {
        const dataUrl = await QRCode.toDataURL(`${origin}${link.path}`, QR_OPTIONS)
        return [link.path, dataUrl] as const
      })
    )
      .then(entries => {
        if (!cancelled) setQrCodes(Object.fromEntries(entries))
      })
      .catch(() => {
        if (!cancelled) toast.error("No se pudieron generar los códigos QR")
      })
    return () => {
      cancelled = true
    }
  }, [links, host])

  // Ventana imprimible: logo de impresora con nombre del negocio + URL legible.
  function printQr(link: { path: string; label: string }, dataUrl: string) {
    const url = `${window.location.protocol}//${host}${link.path}`
    const win = window.open("", "_blank", "width=480,height=640")
    if (!win) {
      toast.error("El navegador bloqueó la ventana de impresión")
      return
    }
    const name = escapeHtml(profile.businessName || "Reficio")
    const label = escapeHtml(link.label)
    win.document.write(`<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>${name} — ${label}</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 95vh; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; padding: 24px; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: #1e1b2e; text-align: center; }
  h1 { font-size: 24px; margin: 0; }
  .label { font-size: 13px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: #6d28d9; margin: 0; }
  img { width: 280px; height: 280px; }
  code { font-size: 13px; color: #444; word-break: break-all; }
  .hint { font-size: 12px; color: #777; margin: 0; }
</style>
</head>
<body>
  <h1>${name}</h1>
  <p class="label">${label}</p>
  <img src="${dataUrl}" alt="Código QR — ${label}" onload="setTimeout(function(){window.print()},60)">
  <code>${escapeHtml(url)}</code>
  <p class="hint">Escanea con la cámara de tu teléfono</p>
</body>
</html>`)
    win.document.close()
  }

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
                hint={`Tu vitrina pública vive en ${host}/<slug>.`}
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

            <div className="flex items-start justify-between gap-4 rounded-lg border px-4 py-3">
              <div className="space-y-1">
                <Label htmlFor="show-in-directory" className="text-sm font-medium">
                  Aparecer en el directorio reficio.app/mercado
                </Label>
                <p className="text-xs text-muted-foreground">
                  Tu negocio se lista en el directorio público y tus productos
                  visibles aparecen en la búsqueda global. Si lo apagas, tu
                  vitrina sigue funcionando por su link directo.
                </p>
              </div>
              <Switch
                id="show-in-directory"
                checked={profile.showInDirectory}
                onCheckedChange={(checked) =>
                  setProfile(prev => ({ ...prev, showInDirectory: checked === true }))
                }
                disabled={saving}
                aria-label="Aparecer en el directorio reficio.app/mercado"
              />
            </div>

            <div className="space-y-2">
              <Label>Logo del negocio</Label>
              <div className="flex flex-wrap items-center gap-4">
                <button
                  type="button"
                  aria-label={profile.logo ? "Cambiar logo" : "Subir logo"}
                  disabled={uploadingLogo || saving}
                  onClick={() => logoInputRef.current?.click()}
                  onDragOver={(e) => {
                    e.preventDefault()
                    setLogoDrag(true)
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault()
                    setLogoDrag(false)
                  }}
                  onDrop={(e) => {
                    e.preventDefault()
                    setLogoDrag(false)
                    const file = e.dataTransfer.files?.[0]
                    if (file) void uploadLogo(file)
                  }}
                  className={`flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border-2 transition-colors ${
                    logoDrag
                      ? "border-primary bg-primary/5"
                      : "border-dashed border-muted-foreground/30 bg-muted/30 hover:border-primary/50"
                  }`}
                >
                  {uploadingLogo ? (
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  ) : profile.logo ? (
                    // eslint-disable-next-line @next/next/no-img-element -- logo subido por el negocio, path dinámico
                    <img
                      src={profile.logo}
                      alt="Logo del negocio"
                      className="h-full w-full object-contain"
                    />
                  ) : (
                    <ImagePlus className="h-6 w-6 text-muted-foreground" />
                  )}
                </button>
                <div className="min-w-48 flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={uploadingLogo || saving}
                      onClick={() => logoInputRef.current?.click()}
                    >
                      {uploadingLogo ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Upload className="mr-2 h-4 w-4" />
                      )}
                      {profile.logo ? "Cambiar logo" : "Subir logo"}
                    </Button>
                    {profile.logo && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={uploadingLogo || saving}
                        onClick={() => void persistLogo("")}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Quitar
                      </Button>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    PNG, JPG o WebP, máx. 2 MB. Aparece en tu vitrina y los encabezados públicos.
                  </p>
                </div>
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) void uploadLogo(file)
                  }}
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
              <Button
                onClick={() => void save()}
                disabled={saving || !dirty || !!slugError || !normalizeSlugInput(profile.slug)}
              >
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

            {links.length > 0 && (
              <div className="space-y-3 border-t pt-5">
                <div className="space-y-1">
                  <h4 className="flex items-center gap-2 text-sm font-medium">
                    <QrCode className="h-4 w-4" />
                    QR para tu mostrador
                  </h4>
                  <p className="text-xs text-muted-foreground">
                    Descarga o imprime un QR por link: tu cliente lo escanea y entra directo.
                  </p>
                </div>
                <div className="grid gap-4 sm:grid-cols-3">
                  {links.map(link => {
                    const dataUrl = qrCodes[link.path]
                    return (
                      <div
                        key={link.path}
                        className="flex flex-col items-center gap-3 rounded-xl border bg-card p-4"
                      >
                        <div className="flex h-32 w-32 items-center justify-center rounded-lg bg-white p-1">
                          {dataUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element -- data URL generada en cliente
                            <img
                              src={dataUrl}
                              alt={`QR — ${link.label}`}
                              className="h-full w-full"
                            />
                          ) : (
                            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                          )}
                        </div>
                        <div className="space-y-0.5 text-center">
                          <p className="text-sm font-medium">{link.label}</p>
                          <p className="break-all font-mono text-[11px] text-muted-foreground">
                            {host}
                            {link.path}
                          </p>
                        </div>
                        <div className="mt-auto flex gap-2">
                          <Button variant="outline" size="sm" asChild disabled={!dataUrl}>
                            <a
                              href={dataUrl || "#"}
                              download={`qr-${savedSlug}-${link.file}.png`}
                            >
                              <Download className="mr-1.5 h-3.5 w-3.5" />
                              PNG
                            </a>
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={!dataUrl}
                            onClick={() => dataUrl && printQr(link, dataUrl)}
                          >
                            <Printer className="mr-1.5 h-3.5 w-3.5" />
                            Imprimir
                          </Button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
