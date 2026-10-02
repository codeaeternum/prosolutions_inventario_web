"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { CheckCircle2, Loader2, Mail, Pencil, Phone, Send, User, X } from "lucide-react"

/**
 * Tarjeta "Datos de contacto" del perfil: lectura con insignias de
 * verificación y modo edición contra PATCH /api/perfil. Cambiar correo o
 * teléfono invalida la verificación previa — el endpoint la re-emite.
 */
type Props = {
  name: string
  email: string | null
  phone: string | null
  emailVerified: boolean
  phoneVerified: boolean
}

function VerifiedBadge({ verified }: { verified: boolean }) {
  return verified ? (
    <Badge className="bg-green-500/15 text-green-700 dark:text-green-300 hover:bg-green-500/15">
      <CheckCircle2 className="mr-1 h-3 w-3" />
      Verificado
    </Badge>
  ) : (
    <Badge variant="secondary" className="text-amber-700 dark:text-amber-300">
      Pendiente de verificación
    </Badge>
  )
}

export function ContactCard({ name, email, phone, emailVerified, phoneVerified }: Props) {
  const router = useRouter()
  // update() dispara el jwt callback, que relee la fila en la BD y regraba
  // la cookie: el nombre/correo del header se refrescan sin re-login.
  const { update } = useSession()
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [phonePending, setPhonePending] = useState(false)
  const [form, setForm] = useState({ name: "", email: "", phone: "" })

  const startEdit = () => {
    setForm({ name, email: email ?? "", phone: phone ?? "" })
    setError("")
    setNotice("")
    setEditing(true)
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setNotice("")
    setPhonePending(false)
    setSaving(true)
    try {
      const res = await fetch("/api/perfil", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          email: form.email.trim(),
          phone: form.phone.trim(),
        }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        error?: string
        unchanged?: boolean
        verification?: { emailDispatched?: boolean; phoneIssued?: boolean }
      }
      if (!res.ok) {
        setError(data.error ?? "No se pudieron guardar los cambios.")
        return
      }
      if (data.unchanged) {
        setNotice("No hubo cambios.")
      } else if (data.verification?.emailDispatched) {
        setNotice("Listo. Te enviamos un código al nuevo correo para verificarlo.")
      } else if (data.verification?.phoneIssued) {
        setNotice("Listo. Tu teléfono quedó pendiente de verificación.")
        setPhonePending(true)
      } else {
        setNotice("Datos actualizados.")
      }
      setEditing(false)
      await update({})
      router.refresh()
    } catch {
      setError("No se pudo conectar. Revisa tu conexión e intenta de nuevo.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="border-none shadow-md overflow-hidden">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-muted-foreground">Datos de contacto</h2>
          {!editing && (
            <Button variant="ghost" size="sm" className="h-8 px-2" onClick={startEdit}>
              <Pencil className="mr-1.5 h-3.5 w-3.5" />
              Editar
            </Button>
          )}
        </div>

        {notice && (
          <div className="p-3 text-sm rounded-md bg-primary/10 text-primary" role="status">
            {notice}
            {phonePending && (
              <>
                {" "}
                <Link href="/verificar" className="underline font-medium">
                  Verificar por Telegram
                </Link>
              </>
            )}
          </div>
        )}
        {error && (
          <div className="p-3 text-sm text-destructive bg-destructive/10 rounded-md" role="alert">
            {error}
          </div>
        )}

        {editing ? (
          <form onSubmit={handleSave} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="perfil-name">Nombre</Label>
              <Input
                id="perfil-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                required
                maxLength={80}
                disabled={saving}
                autoComplete="name"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="perfil-email">Correo</Label>
              <Input
                id="perfil-email"
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                maxLength={254}
                disabled={saving}
                autoComplete="email"
                placeholder="tucorreo@gmail.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="perfil-phone">Teléfono</Label>
              <Input
                id="perfil-phone"
                type="tel"
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                maxLength={30}
                disabled={saving}
                autoComplete="tel"
                placeholder="81 1234 5678"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Si cambias tu correo o teléfono tendrás que verificarlo de nuevo. Tu cuenta
              necesita al menos uno de los dos.
            </p>
            <div className="flex gap-2">
              <Button type="submit" className="flex-1" disabled={saving || !form.name.trim()}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Guardar
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={saving}
                onClick={() => {
                  setEditing(false)
                  setError("")
                }}
              >
                <X className="mr-1.5 h-4 w-4" />
                Cancelar
              </Button>
            </div>
          </form>
        ) : (
          <div className="space-y-3 text-sm">
            <div className="flex items-center gap-3">
              <User className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="truncate font-medium">{name}</span>
            </div>
            <div className="flex items-center gap-3">
              <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="truncate flex-1" title={email ?? undefined}>
                {email || <span className="text-muted-foreground">Sin correo</span>}
              </span>
              {email ? (
                <VerifiedBadge verified={emailVerified} />
              ) : null}
            </div>
            <div className="flex items-center gap-3">
              <Phone className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="truncate flex-1" title={phone ?? undefined}>
                {phone || <span className="text-muted-foreground">Sin teléfono</span>}
              </span>
              {phone ? (
                <VerifiedBadge verified={phoneVerified} />
              ) : null}
            </div>
            {(email && !emailVerified) || (phone && !phoneVerified) ? (
              <Button variant="outline" size="sm" className="w-full" asChild>
                <Link href="/verificar">
                  <Send className="mr-2 h-3.5 w-3.5" />
                  Verificar mi contacto
                </Link>
              </Button>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
