"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { signOut } from "next-auth/react"
import { toast } from "sonner"
import { ThemeToggle } from "@/components/theme-toggle"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { KeyRound, Loader2, LogIn, LogOut, Shield, ShieldOff, Store, UserPlus } from "lucide-react"

interface PlatformHeaderActionsProps {
  canAccessAdmin: boolean
}

export function PlatformHeaderActions({ canAccessAdmin }: PlatformHeaderActionsProps) {
  return (
    <div className="flex items-center gap-2 shrink-0">
      {canAccessAdmin && (
        <Button asChild variant="outline" size="sm" className="gap-2 shrink-0">
          <Link href="/admin">
            <Store className="h-4 w-4" />
            <span className="hidden sm:inline">Panel del negocio</span>
            <span className="sm:hidden">Mi panel</span>
          </Link>
        </Button>
      )}
      <ThemeToggle />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="gap-1.5 shrink-0"
        aria-label="Cerrar sesión"
        onClick={() => signOut({ callbackUrl: "/login" })}
      >
        <LogOut className="h-4 w-4" />
        <span>Salir</span>
      </Button>
    </div>
  )
}

interface SupportAccessButtonProps {
  userId: string
  /** Nombre del usuario impersonado — para el confirm y el aria-label. */
  userName: string
  /** Negocio al que se entra — contexto del modo soporte. */
  businessName: string
}

/**
 * Acceso de soporte: cambia la sesión del operador a la del usuario del
 * negocio (claim `impersonator` en el JWT). El panel del tenant muestra un
 * banner ambar "Actuando como…" con "Volver a mi cuenta" para salir.
 */
export function SupportAccessButton({ userId, userName, businessName }: SupportAccessButtonProps) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleSupportLogin = async () => {
    if (loading) return
    setLoading(true)
    try {
      const res = await fetch("/api/auth/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        toast.success(`Entrando al panel de ${businessName} como ${userName}...`)
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.assign("/admin")
      } else {
        toast.error(data.error || "No se pudo iniciar sesión de soporte")
        setLoading(false)
        setOpen(false)
      }
    } catch {
      toast.error("No se pudo iniciar sesión de soporte")
      setLoading(false)
      setOpen(false)
    }
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="gap-1.5"
        disabled={loading}
        aria-label={`Entrar al panel de ${businessName} como ${userName} (modo soporte)`}
        onClick={() => setOpen(true)}
      >
        {loading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <LogIn className="h-3.5 w-3.5" aria-hidden="true" />
        )}
        Entrar al panel
      </Button>
      <AlertDialog open={open} onOpenChange={(next) => { if (!loading) setOpen(next) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Entrar como {userName}?</AlertDialogTitle>
            <AlertDialogDescription>
              Verás el panel de <strong>{businessName}</strong> exactamente como lo ve
              esta cuenta, con un banner amarillo de modo soporte en la parte
              superior. Todo lo que hagas queda registrado a nombre de tu cuenta
              de operador. Para salir, usa «Volver a mi cuenta» en ese banner.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); void handleSupportLogin() }}
              disabled={loading}
            >
              {loading && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Entrar en modo soporte
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

interface SuperAdminToggleButtonProps {
  userId: string
  userName: string
  isSuperAdmin: boolean
  isSelf: boolean
}

export function SuperAdminToggleButton({
  userId,
  userName,
  isSuperAdmin,
  isSelf,
}: SuperAdminToggleButtonProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  if (isSelf) {
    return (
      <Badge variant="outline" className="text-muted-foreground">
        Tu cuenta
      </Badge>
    )
  }

  const handleToggle = async () => {
    if (loading) return
    setLoading(true)
    try {
      const nextValue = !isSuperAdmin
      const res = await fetch(`/api/platform/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isSuperAdmin: nextValue }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        toast.success(
          nextValue
            ? `Permiso de plataforma otorgado a ${userName}`
            : `Permiso de plataforma revocado a ${userName}`
        )
        setOpen(false)
        router.refresh()
      } else {
        toast.error(data.error || "No se pudo actualizar el permiso de superadmin")
        setOpen(false)
      }
    } catch {
      toast.error("No se pudo actualizar el permiso de superadmin")
      setOpen(false)
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="gap-1.5"
        disabled={loading}
        aria-label={isSuperAdmin
          ? `Quitar acceso de superadmin a ${userName}`
          : `Dar acceso de superadmin a ${userName}`}
        onClick={() => setOpen(true)}
      >
        {loading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        ) : isSuperAdmin ? (
          <ShieldOff className="h-3.5 w-3.5" aria-hidden="true" />
        ) : (
          <Shield className="h-3.5 w-3.5" aria-hidden="true" />
        )}
        {isSuperAdmin ? "Quitar plataforma" : "Hacer superadmin"}
      </Button>
      <AlertDialog open={open} onOpenChange={(next) => { if (!loading) setOpen(next) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isSuperAdmin
                ? `¿Quitar acceso de plataforma a ${userName}?`
                : `¿Hacer superadmin a ${userName}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isSuperAdmin
                ? "Dejará de poder entrar a esta consola y de administrar negocios ajenos. Su cuenta de negocio sigue igual."
                : "Un superadmin ve y administra TODOS los negocios de la instancia: puede suspenderlos, crear usuarios y entrar en modo soporte a cualquier panel. Otorga este acceso solo a operadores de confianza."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant={isSuperAdmin ? "destructive" : "default"}
              onClick={(e) => { e.preventDefault(); void handleToggle() }}
              disabled={loading}
            >
              {loading && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              {isSuperAdmin ? "Quitar acceso" : "Otorgar acceso"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

interface EditPlatformUserDialogProps {
  user: {
    id: string
    name: string
    email: string | null
    status: string
  }
  /** El operador editándose a sí mismo: el servidor rechaza cambiar su estado. */
  isSelf?: boolean
}

export function EditPlatformUserDialog({ user, isSelf = false }: EditPlatformUserDialogProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [name, setName] = useState(user.name)
  const [email, setEmail] = useState(user.email ?? "")
  const [status, setStatus] = useState(user.status)
  const [newPassword, setNewPassword] = useState("")

  const handleOpenChange = (nextOpen: boolean) => {
    if (loading) return
    if (nextOpen) {
      setName(user.name)
      setEmail(user.email ?? "")
      setStatus(user.status)
      setNewPassword("")
    }
    setOpen(nextOpen)
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (loading) return
    if (!name.trim()) {
      toast.error("El nombre es obligatorio")
      return
    }
    if (newPassword && newPassword.length < 8) {
      toast.error("La contraseña debe tener al menos 8 caracteres")
      return
    }

    setLoading(true)
    try {
      const res = await fetch(`/api/platform/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim() || null,
          status,
          ...(newPassword ? { newPassword } : {}),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        toast.success(
          newPassword
            ? "Contraseña y datos actualizados"
            : "Datos del usuario actualizados"
        )
        setOpen(false)
        setNewPassword("")
        router.refresh()
      } else {
        toast.error(data.error || "No se pudo actualizar el usuario")
      }
    } catch {
      toast.error("No se pudo actualizar el usuario")
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="gap-1.5"
        title="Editar cuenta o restablecer contraseña"
        aria-label={`Editar cuenta de ${user.name}`}
        onClick={() => handleOpenChange(true)}
      >
        <KeyRound className="h-3.5 w-3.5" />
        Clave / Editar
      </Button>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Editar cuenta de usuario</DialogTitle>
            <DialogDescription>
              Modifica los datos de acceso o asigna una nueva contraseña para {user.name}.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor={`platform-user-name-${user.id}`}>Nombre</Label>
              <Input
                id={`platform-user-name-${user.id}`}
                value={name}
                disabled={loading}
                onChange={e => setName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`platform-user-email-${user.id}`}>Correo de acceso</Label>
              <Input
                id={`platform-user-email-${user.id}`}
                type="email"
                value={email}
                disabled={loading}
                onChange={e => setEmail(e.target.value)}
                placeholder="correo@ejemplo.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`platform-user-status-${user.id}`}>Estado</Label>
              <Select value={status} onValueChange={(v) => { if (!isSelf) setStatus(v) }}>
                <SelectTrigger id={`platform-user-status-${user.id}`} disabled={loading || isSelf}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="APPROVED">Aprobado</SelectItem>
                  <SelectItem value="PENDING">Pendiente</SelectItem>
                  <SelectItem value="REJECTED">Rechazado</SelectItem>
                </SelectContent>
              </Select>
              {isSelf && (
                <p className="text-xs text-muted-foreground">
                  No puedes cambiar el estado de tu propia cuenta de operador.
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor={`platform-user-password-${user.id}`}>
                Nueva contraseña (opcional)
              </Label>
              <Input
                id={`platform-user-password-${user.id}`}
                type="password"
                autoComplete="new-password"
                value={newPassword}
                disabled={loading}
                onChange={e => setNewPassword(e.target.value)}
                placeholder="Dejar vacío para no cambiar (mín. 8 caracteres)"
              />
            </div>
            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={loading}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={loading}>
                {loading && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                Guardar cambios
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

interface CreatePlatformUserDialogProps {
  businessId: string
  businessName: string
}

export function CreatePlatformUserDialog({
  businessId,
  businessName,
}: CreatePlatformUserDialogProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [role, setRole] = useState("EMPLOYEE")
  const [jobTitle, setJobTitle] = useState("")
  const [password, setPassword] = useState("")

  const resetForm = () => {
    setName("")
    setEmail("")
    setRole("EMPLOYEE")
    setJobTitle("")
    setPassword("")
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (loading) return
    if (!nextOpen) {
      resetForm()
    }
    setOpen(nextOpen)
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (loading) return
    if (!name.trim()) {
      toast.error("El nombre es obligatorio")
      return
    }
    if (!email.trim()) {
      toast.error("El correo electrónico es obligatorio")
      return
    }
    if (password.length < 8) {
      toast.error("La contraseña debe tener al menos 8 caracteres")
      return
    }

    setLoading(true)
    try {
      const res = await fetch(`/api/platform/businesses/${businessId}/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          role,
          jobTitle: jobTitle.trim() || undefined,
          password,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        toast.success("Usuario creado y aprobado")
        resetForm()
        setOpen(false)
        router.refresh()
      } else {
        toast.error(data.error || "No se pudo crear el usuario")
      }
    } catch {
      toast.error("No se pudo crear el usuario")
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="gap-1.5"
        onClick={() => handleOpenChange(true)}
      >
        <UserPlus className="h-3.5 w-3.5" />
        Agregar usuario
      </Button>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Agregar usuario a {businessName}</DialogTitle>
            <DialogDescription>
              Crea una cuenta aprobada para un miembro del equipo de este negocio.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor={`create-platform-user-name-${businessId}`}>
                Nombre completo *
              </Label>
              <Input
                id={`create-platform-user-name-${businessId}`}
                value={name}
                disabled={loading}
                onChange={e => setName(e.target.value)}
                placeholder="Ej. Juan Pérez"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`create-platform-user-email-${businessId}`}>
                Correo electrónico *
              </Label>
              <Input
                id={`create-platform-user-email-${businessId}`}
                type="email"
                value={email}
                disabled={loading}
                onChange={e => setEmail(e.target.value)}
                placeholder="correo@ejemplo.com"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`create-platform-user-role-${businessId}`}>Rol</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger id={`create-platform-user-role-${businessId}`} disabled={loading}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ADMIN">Administrador</SelectItem>
                  <SelectItem value="EMPLOYEE">Empleado</SelectItem>
                  <SelectItem value="WORKSHOP">Taller aliado</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`create-platform-user-job-title-${businessId}`}>
                Puesto (opcional)
              </Label>
              <Input
                id={`create-platform-user-job-title-${businessId}`}
                value={jobTitle}
                disabled={loading}
                onChange={e => setJobTitle(e.target.value)}
                placeholder="Ej. Técnico, Mostrador"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`create-platform-user-password-${businessId}`}>
                Contraseña inicial *
              </Label>
              <Input
                id={`create-platform-user-password-${businessId}`}
                type="password"
                autoComplete="new-password"
                value={password}
                disabled={loading}
                onChange={e => setPassword(e.target.value)}
                placeholder="Mínimo 8 caracteres"
                minLength={8}
                required
              />
            </div>
            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={loading}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={loading}>
                {loading && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                Crear usuario
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
