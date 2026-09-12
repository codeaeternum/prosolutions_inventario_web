"use client"

import { useState, useEffect, useRef } from "react"
import {
  Save,
  RefreshCw,
  DollarSign,
  Clock,
  Percent,
  CheckCircle,
  RotateCcw,
  AlertCircle,
  Settings2,
  Printer,
  Building2,
} from "lucide-react"
import { toast } from "sonner"
import { refreshBusinessName } from "@/components/admin/business-name"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"

const DEFAULTS = {
  tempReservationMinutes: 30,
  depositPercentage: 50,
  depositReservationHours: 48,
  pendingVerificationHours: 24,
  exchangeRate: 17.5,
  bankTransferInfo: "BBVA\nProSolutions SA\n0123456789",
  bankCashInfo: "OXXO\nJuan Pérez\n4152 3133 4444 5555",
}

interface Settings {
  tempReservationMinutes: number
  depositPercentage: number
  depositReservationHours: number
  pendingVerificationHours: number
  exchangeRate: number
  bankTransferInfo?: string
  bankCashInfo?: string
  ticketBusinessName?: string
  ticketSubtitle?: string
  ticketFooter?: string
  updatedAt?: string
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
  const [settings, setSettings] = useState<Settings>(DEFAULTS)
  const [initialSettings, setInitialSettings] = useState<Settings | null>(null)
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
        const next: Settings = {
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

  function handleChange(field: keyof Settings, value: string) {
    const numValue = parseFloat(value) || 0
    setSettings((prev) => ({ ...prev, [field]: numValue }))
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
    <div className="space-y-8">
      {/* Cabecera */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight tracking-tight flex items-center gap-2">
            <Settings2 className="h-7 w-7" />
            Configuración
          </h1>
          <p className="text-muted-foreground mt-1">
            Ajusta reservas, tipo de cambio y tiempos del sistema
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

      {/* Bloque: Identidad del negocio */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Identidad del negocio
          </CardTitle>
          <CardDescription>
            Nombre del taller que se muestra en el panel, la barra lateral y los tickets térmicos.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <div className="space-y-2 flex-1 max-w-sm">
              <Label htmlFor="businessName">Nombre del negocio</Label>
              <Input
                id="businessName"
                value={settings.ticketBusinessName || ""}
                onChange={(e) => setSettings(prev => ({ ...prev, ticketBusinessName: e.target.value }))}
                placeholder="ProSolutions"
                maxLength={80}
              />
              <p className="text-xs text-muted-foreground">
                Entre 2 y 80 caracteres. Es el mismo nombre que aparece en los tickets.
              </p>
            </div>
            <Button onClick={handleSaveBusinessName} disabled={savingBusiness}>
              {savingBusiness ? (
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              Guardar nombre
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Bloque: Reservas */}
      <Card>
        <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Tiempos y Plazos
            </CardTitle>
            <CardDescription>
              Tiempos para reservas temporales y con depósito. El tipo de cambio (USD) ya no se usa públicamente, todo es en MXN.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-8">
          <div>
            <h4 className="text-sm font-medium mb-3">Reserva temporal (sin pago previo)</h4>
            <div className="flex flex-wrap items-center gap-4">
              <div className="space-y-2">
                <Label htmlFor="tempMinutes">Duración</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="tempMinutes"
                    type="number"
                    min="5"
                    max="1440"
                    value={settings.tempReservationMinutes}
                    onChange={(e) => handleChange("tempReservationMinutes", e.target.value)}
                    className="w-24"
                  />
                  <span className="text-muted-foreground text-sm">minutos</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Tiempo que tiene el cliente para recoger
                </p>
              </div>
            </div>
          </div>

          <div className="border-t pt-6">
            <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
              <Percent className="h-4 w-4" />
              Reserva con depósito
            </h4>
            <div className="grid gap-6 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="depositPercent">Porcentaje de anticipo</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="depositPercent"
                    type="number"
                    min="1"
                    max="100"
                    value={settings.depositPercentage}
                    onChange={(e) => handleChange("depositPercentage", e.target.value)}
                    className="w-24"
                  />
                  <span className="text-muted-foreground text-sm">%</span>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="depositHours">Horas para recoger (tras verificar depósito)</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="depositHours"
                    type="number"
                    min="1"
                    max="720"
                    value={settings.depositReservationHours}
                    onChange={(e) => handleChange("depositReservationHours", e.target.value)}
                    className="w-24"
                  />
                  <span className="text-muted-foreground text-sm">horas</span>
                </div>
              </div>
            </div>
          </div>

          <div className="border-t pt-6">
            <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
              <CheckCircle className="h-4 w-4" />
              Verificación de depósito
            </h4>
            <div className="space-y-2">
              <Label htmlFor="verifyHours">Plazo máximo para que un admin verifique el depósito</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="verifyHours"
                  type="number"
                  min="1"
                  max="168"
                  value={settings.pendingVerificationHours}
                  onChange={(e) => handleChange("pendingVerificationHours", e.target.value)}
                  className="w-24"
                />
                <span className="text-muted-foreground text-sm">horas</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Si no se verifica en este tiempo, la reserva puede expirar
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Bloque: Datos Financieros e Impuestos */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5" />
            Finanzas y Tipo de Cambio
          </CardTitle>
          <CardDescription>
            Ajustes generales de moneda y datos para transferencias/depósitos.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="exchangeRate">Tipo de Cambio (MXN por USD)</Label>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">$</span>
              <Input
                id="exchangeRate"
                type="number"
                min="0.01"
                step="0.01"
                value={settings.exchangeRate}
                onChange={(e) => handleChange("exchangeRate", e.target.value)}
                className="w-32 font-bold text-lg"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Se usa como referencia si importas productos en dólares.
            </p>
          </div>
          
          <div className="border-t pt-4">
            <h4 className="text-sm font-medium mb-3">Datos para Pagos (Web y Bot)</h4>
            
            <div className="grid gap-6 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="bankTransferInfo">Transferencia Bancaria (SPEI)</Label>
                <Textarea
                  id="bankTransferInfo"
                  value={settings.bankTransferInfo || ""}
                  onChange={(e) => setSettings(prev => ({ ...prev, bankTransferInfo: e.target.value }))}
                  placeholder="Ej:\nBanco: BBVA\nTitular: ProSolutions SA\nCuenta: 0123456789"
                  className="resize-none h-24"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Escribe los datos en líneas separadas (Banco, Titular, Cuenta/CLABE).
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="bankCashInfo">Depósito en Efectivo</Label>
                <Textarea
                  id="bankCashInfo"
                  value={settings.bankCashInfo || ""}
                  onChange={(e) => setSettings(prev => ({ ...prev, bankCashInfo: e.target.value }))}
                  placeholder="Ej:\nTienda: OXXO / Spin\nTitular: Juan Pérez\nTarjeta: 4152 3133 4444 5555"
                  className="resize-none h-24"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Escribe los datos en líneas separadas para pagos físicos.
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Bloque: Personalización de Ticket */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Printer className="h-5 w-5" />
            Personalización de Ticket
          </CardTitle>
          <CardDescription>
            Cambia el subtítulo y pie de página que aparecen en los tickets térmicos. El nombre del negocio se edita en «Identidad del negocio».
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="ticketSubtitle">Subtítulo / Giro</Label>
            <Textarea
              id="ticketSubtitle"
              value={settings.ticketSubtitle || ""}
              onChange={(e) => setSettings(prev => ({ ...prev, ticketSubtitle: e.target.value }))}
              placeholder={"Venta de refacciones y\nReparación profesional"}
              className="resize-none h-16"
            />
            <p className="text-xs text-muted-foreground">Aparece debajo del nombre. Usa saltos de línea para varias líneas.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="ticketFooter">Mensaje de Pie de Página</Label>
            <Input
              id="ticketFooter"
              value={settings.ticketFooter || ""}
              onChange={(e) => setSettings(prev => ({ ...prev, ticketFooter: e.target.value }))}
              placeholder="¡Gracias por tu preferencia!"
            />
            <p className="text-xs text-muted-foreground">Aparece al final del ticket, debajo del total.</p>
          </div>
        </CardContent>
      </Card>

      {/* Resumen */}
      <Card className="bg-muted/40">
        <CardHeader>
          <CardTitle>Resumen</CardTitle>
          <CardDescription>Valores actuales que se aplicarán al guardar</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
            <div className="rounded-lg border bg-background p-4 text-center">
              <p className="text-2xl font-bold tabular-nums">${settings.exchangeRate.toFixed(2)}</p>
              <p className="text-xs text-muted-foreground">MXN por USD</p>
            </div>
            <div className="rounded-lg border bg-background p-4 text-center">
              <p className="text-2xl font-bold tabular-nums">{settings.tempReservationMinutes}</p>
              <p className="text-xs text-muted-foreground">min. reserva temp.</p>
            </div>
            <div className="rounded-lg border bg-background p-4 text-center">
              <p className="text-2xl font-bold tabular-nums">{settings.depositPercentage}%</p>
              <p className="text-xs text-muted-foreground">anticipo</p>
            </div>
            <div className="rounded-lg border bg-background p-4 text-center">
              <p className="text-2xl font-bold tabular-nums">{settings.depositReservationHours}h</p>
              <p className="text-xs text-muted-foreground">para recoger</p>
            </div>
            <div className="rounded-lg border bg-background p-4 text-center">
              <p className="text-2xl font-bold tabular-nums">{settings.pendingVerificationHours}h</p>
              <p className="text-xs text-muted-foreground">para verificar</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
