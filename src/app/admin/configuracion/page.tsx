"use client"

import { useState, useEffect, useRef } from "react"
import {
  Save,
  RefreshCw,
  CheckCircle,
  RotateCcw,
  AlertCircle,
  Settings2,
} from "lucide-react"
import { toast } from "sonner"
import { refreshBusinessName } from "@/components/admin/business-name"
import { Button } from "@/components/ui/button"
import {
  AdminLinksCard,
  FinanceCard,
  IdentityCard,
  SummaryCard,
  TicketCard,
  TimingCard,
  WorkshopCard,
  type GeneralSettings,
  type NumericField,
  type TextField,
} from "@/components/admin/configuracion/settings-sections"
import { PublicProfileCard } from "@/components/admin/configuracion/public-profile"

const DEFAULTS: GeneralSettings = {
  tempReservationMinutes: 30,
  depositPercentage: 50,
  depositReservationHours: 48,
  pendingVerificationHours: 24,
  exchangeRate: 17.5,
  // Sin cuentas de ejemplo: un negocio nuevo no debe mostrar el banco de otro.
  bankTransferInfo: "",
  bankCashInfo: "",
}

function formatDate(iso?: string) {
  if (!iso) return null
  try {
    return new Date(iso).toLocaleString("es-MX", {
      dateStyle: "short",
      timeStyle: "short",
    })
  } catch {
    return null
  }
}

export default function ConfiguracionPage() {
  const [settings, setSettings] = useState<GeneralSettings>(DEFAULTS)
  const [initialSettings, setInitialSettings] = useState<GeneralSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [savingBusiness, setSavingBusiness] = useState(false)
  const [fetchError, setFetchError] = useState(false)
  const isFirstLoad = useRef(true)

  useEffect(() => {
    fetchSettings()
  }, [])

  async function fetchSettings() {
    setLoading(true)
    setFetchError(false)
    try {
      const res = await fetch("/api/settings")
      if (res.ok) {
        const data = await res.json()
        const next: GeneralSettings = {
          tempReservationMinutes: data.tempReservationMinutes ?? DEFAULTS.tempReservationMinutes,
          depositPercentage: data.depositPercentage ?? DEFAULTS.depositPercentage,
          depositReservationHours: data.depositReservationHours ?? DEFAULTS.depositReservationHours,
          pendingVerificationHours: data.pendingVerificationHours ?? DEFAULTS.pendingVerificationHours,
          exchangeRate: Number(data.exchangeRate) ?? DEFAULTS.exchangeRate,
          bankTransferInfo: data.bankTransferInfo ?? DEFAULTS.bankTransferInfo,
          bankCashInfo: data.bankCashInfo ?? DEFAULTS.bankCashInfo,
          ticketBusinessName: data.ticketBusinessName ?? "PROSOLUTIONS",
          ticketSubtitle: data.ticketSubtitle ?? "Venta de refacciones y\nReparación profesional",
          ticketFooter: data.ticketFooter ?? "¡Gracias por tu preferencia!",
          updatedAt: data.updatedAt,
        }
        setSettings(next)
        if (isFirstLoad.current) {
          setInitialSettings(next)
          isFirstLoad.current = false
        }
      } else {
        setFetchError(true)
      }
    } catch (error) {
      console.error("Error fetching settings:", error)
      setFetchError(true)
    } finally {
      setLoading(false)
    }
  }

  async function handleSave() {
    setSaving(true)
    setSaved(false)
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      })

      if (res.ok) {
        const data = await res.json()
        setSettings((prev) => ({ ...prev, updatedAt: data.updatedAt }))
        setInitialSettings((prev) => (prev ? { ...prev, ...settings, updatedAt: data.updatedAt } : null))
        setSaved(true)
        refreshBusinessName()
        toast.success("Configuración guardada correctamente")
        setTimeout(() => setSaved(false), 3000)
      } else {
        toast.error("No se pudo guardar la configuración")
      }
    } catch (error) {
      console.error("Error saving settings:", error)
      toast.error("Error de conexión")
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveBusinessName() {
    const name = (settings.ticketBusinessName || "").trim()
    if (name.length < 2 || name.length > 80) {
      toast.error("El nombre del negocio debe tener entre 2 y 80 caracteres")
      return
    }
    setSavingBusiness(true)
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketBusinessName: name }),
      })

      if (res.ok) {
        const data = await res.json()
        setSettings((prev) => ({ ...prev, ticketBusinessName: name, updatedAt: data.updatedAt }))
        setInitialSettings((prev) =>
          prev ? { ...prev, ticketBusinessName: name, updatedAt: data.updatedAt } : null
        )
        refreshBusinessName()
        toast.success("Nombre del negocio guardado")
      } else {
        toast.error("No se pudo guardar el nombre del negocio")
      }
    } catch (error) {
      console.error("Error saving business name:", error)
      toast.error("Error de conexión")
    } finally {
      setSavingBusiness(false)
    }
  }

  function handleNumber(field: NumericField, value: string) {
    const numValue = parseFloat(value) || 0
    setSettings((prev) => ({ ...prev, [field]: numValue }))
  }

  function handleText(field: TextField, value: string) {
    setSettings((prev) => ({ ...prev, [field]: value }))
  }

  function handleResetDefaults() {
    setSettings(DEFAULTS)
    toast.info("Valores restablecidos. Pulsa «Guardar» para aplicarlos.")
  }

  const hasChanges =
    initialSettings &&
    (settings.tempReservationMinutes !== initialSettings.tempReservationMinutes ||
      settings.depositPercentage !== initialSettings.depositPercentage ||
      settings.depositReservationHours !== initialSettings.depositReservationHours ||
      settings.pendingVerificationHours !== initialSettings.pendingVerificationHours ||
      settings.exchangeRate !== initialSettings.exchangeRate ||
      settings.bankTransferInfo !== initialSettings.bankTransferInfo ||
      settings.bankCashInfo !== initialSettings.bankCashInfo ||
      settings.ticketBusinessName !== initialSettings.ticketBusinessName ||
      settings.ticketSubtitle !== initialSettings.ticketSubtitle ||
      settings.ticketFooter !== initialSettings.ticketFooter)

  const lastUpdated = formatDate(settings.updatedAt)

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <RefreshCw className="h-10 w-10 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Cargando configuración…</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Cabecera */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Settings2 className="h-7 w-7" />
            Configuración
          </h1>
          <p className="text-muted-foreground mt-1">
            Identidad del negocio, taller y parámetros del sistema en un solo lugar
          </p>
          {lastUpdated && (
            <p className="text-xs text-muted-foreground mt-1">
              Última actualización: {lastUpdated}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={fetchSettings} disabled={loading}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Recargar
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleResetDefaults}
            disabled={saving}
          >
            <RotateCcw className="h-4 w-4 mr-2" />
            Valores por defecto
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={saving || !hasChanges}
          >
            {saving ? (
              <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
            ) : saved ? (
              <CheckCircle className="h-4 w-4 mr-2 text-green-500" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            {saved ? "Guardado" : "Guardar"}
          </Button>
        </div>
      </div>

      {fetchError && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span>No se pudo cargar la configuración. Revisa la conexión y pulsa «Recargar».</span>
        </div>
      )}

      <IdentityCard
        value={settings.ticketBusinessName || ""}
        saving={savingBusiness}
        onChange={(value) => handleText("ticketBusinessName", value)}
        onSave={handleSaveBusinessName}
      />

      <PublicProfileCard />

      <WorkshopCard />

      <AdminLinksCard />

      <TimingCard settings={settings} onNumber={handleNumber} />

      <FinanceCard settings={settings} onNumber={handleNumber} onText={handleText} />

      <TicketCard settings={settings} onText={handleText} />

      <SummaryCard settings={settings} />
    </div>
  )
}
