"use client"

import { useEffect, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { ArrowLeft, Building2, KeyRound, Loader2 } from "lucide-react"
import { toast } from "sonner"

interface StaffMember {
  id: string
  name: string
  role: "ADMIN" | "EMPLOYEE" | "CUSTOMER"
  jobTitle: string | null
  hasPin: boolean
  homeBranch: { id: string; name: string } | null
}

interface UserSwitcherProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentUserId: string
  // ADMIN entra a cualquier cuenta sin PIN; el resto debe conocer el PIN del destino.
  isAdmin: boolean
}

function initials(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)
}

export function UserSwitcher({ open, onOpenChange, currentUserId, isAdmin }: UserSwitcherProps) {
  // null = aún cargando
  const [staff, setStaff] = useState<StaffMember[] | null>(null)
  const [selected, setSelected] = useState<StaffMember | null>(null)
  const [pin, setPin] = useState("")
  const [switching, setSwitching] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    fetch("/api/staff")
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => { if (!cancelled) setStaff(Array.isArray(data) ? data : []) })
      .catch(() => {
        if (!cancelled) {
          setStaff([])
          toast.error("No se pudo cargar el personal")
        }
      })
    return () => { cancelled = true }
  }, [open])

  // Reset del estado interno al cerrar (en event handler, no en effect).
  const handleOpenChange = (value: boolean) => {
    if (switching) return
    onOpenChange(value)
    if (!value) {
      setSelected(null)
      setPin("")
      setStaff(null)
    }
  }

  const switchTo = async (userId: string, pinValue?: string) => {
    if (switching) return
    setSwitching(true)
    try {
      const res = await fetch("/api/auth/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pinValue !== undefined ? { userId, pin: pinValue } : { userId }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        // Recarga completa: el switch reescribe la cookie de sesión JWT.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.assign("/admin")
      } else {
        toast.error(data.error || "No se pudo cambiar de usuario")
        setSwitching(false)
      }
    } catch {
      toast.error("Error de conexión")
      setSwitching(false)
    }
  }

  const handlePick = (member: StaffMember) => {
    if (member.id === currentUserId || switching) return
    if (isAdmin) {
      void switchTo(member.id)
    } else {
      setSelected(member)
      setPin("")
    }
  }

  const handlePinSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!selected) return
    if (!/^\d{4,6}$/.test(pin)) {
      toast.error("El PIN debe tener de 4 a 6 dígitos")
      return
    }
    void switchTo(selected.id, pin)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {selected ? `Entrar como ${selected.name}` : "Cambiar de usuario"}
          </DialogTitle>
        </DialogHeader>

        {selected ? (
          <form onSubmit={handlePinSubmit} className="space-y-4 py-2">
            <div className="flex items-center gap-3 p-3 bg-muted rounded-lg">
              <Avatar className="h-10 w-10">
                <AvatarFallback className="bg-primary text-primary-foreground text-sm">
                  {initials(selected.name)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="font-medium truncate">{selected.name}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {selected.jobTitle ?? (selected.role === "ADMIN" ? "Administrador" : "Empleado")}
                </p>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="switch-pin">PIN rápido</Label>
              <Input
                id="switch-pin"
                type="password"
                inputMode="numeric"
                maxLength={6}
                autoComplete="off"
                autoFocus
                placeholder="4 a 6 dígitos"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                disabled={switching}
              />
              {!selected.hasPin && (
                <p className="text-xs text-muted-foreground">
                  Esta cuenta no tiene PIN configurado.
                </p>
              )}
            </div>
            <div className="flex justify-between gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => { setSelected(null); setPin("") }}
                disabled={switching}
              >
                <ArrowLeft className="mr-1 h-4 w-4" />
                Volver
              </Button>
              <Button type="submit" disabled={switching || pin.length < 4}>
                {switching && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Entrar
              </Button>
            </div>
          </form>
        ) : staff === null ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : staff.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No hay personal disponible
          </p>
        ) : (
          <div className="max-h-80 overflow-y-auto -mx-2 px-2 py-1 space-y-1">
            {staff.map((member) => {
              const isCurrent = member.id === currentUserId
              return (
                <button
                  key={member.id}
                  type="button"
                  onClick={() => handlePick(member)}
                  disabled={isCurrent || switching}
                  className="w-full flex items-center gap-3 p-2.5 rounded-lg text-left transition-colors hover:bg-muted disabled:opacity-60 disabled:cursor-default"
                >
                  <Avatar className="h-9 w-9 shrink-0">
                    <AvatarFallback className="bg-primary/10 text-primary text-xs">
                      {initials(member.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{member.name}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {member.jobTitle ?? (member.role === "ADMIN" ? "Administrador" : "Empleado")}
                      {member.homeBranch && (
                        <span className="inline-flex items-center gap-0.5">
                          {" · "}
                          <Building2 className="inline h-3 w-3" />
                          {member.homeBranch.name}
                        </span>
                      )}
                    </p>
                  </div>
                  {isCurrent ? (
                    <Badge variant="secondary" className="shrink-0">Actual</Badge>
                  ) : (
                    member.hasPin && <KeyRound className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  {switching && !isCurrent && (
                    <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                  )}
                </button>
              )
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
