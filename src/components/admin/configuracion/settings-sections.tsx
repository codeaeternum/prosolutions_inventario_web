"use client"

import Link from "next/link"
import {
  BookOpen,
  Building2,
  CheckCircle,
  ChevronRight,
  Clock,
  DollarSign,
  LayoutGrid,
  Loader2,
  Percent,
  Printer,
  Save,
  Users,
  Wrench,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { WorkshopConfigEditor } from "./taller-config"

export interface GeneralSettings {
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

export type NumericField = "tempReservationMinutes" | "depositPercentage" | "depositReservationHours" | "pendingVerificationHours" | "exchangeRate"
export type TextField = "bankTransferInfo" | "bankCashInfo" | "ticketBusinessName" | "ticketSubtitle" | "ticketFooter"

export function IdentityCard({ value, saving, onChange, onSave }: {
  value: string
  saving: boolean
  onChange: (value: string) => void
  onSave: () => void
}) {
  return (
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
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder="ProSolutions"
              maxLength={80}
            />
            <p className="text-xs text-muted-foreground">
              Entre 2 y 80 caracteres. Es el mismo nombre que aparece en los tickets.
            </p>
          </div>
          <Button onClick={onSave} disabled={saving}>
            {saving ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            Guardar nombre
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

export function WorkshopCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wrench className="h-5 w-5" />
          Taller
        </CardTitle>
        <CardDescription>
          Tipos de equipo y locaciones físicas disponibles al catalogar servicios y recibir equipos.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <WorkshopConfigEditor />
      </CardContent>
    </Card>
  )
}

const ADMIN_LINKS = [
  {
    href: "/admin/sucursales",
    icon: Building2,
    title: "Sucursales",
    description: "Locales con inventario, caja y recepción de equipos independientes.",
  },
  {
    href: "/admin/usuarios",
    icon: Users,
    title: "Usuarios y roles",
    description: "Cuentas del personal, roles y accesos al panel de administración.",
  },
  {
    href: "/admin/taller/catalogo",
    icon: BookOpen,
    title: "Catálogo de servicios",
    description: "Precios sugeridos por servicio, modelos de equipo y listas del taller.",
  },
] as const

export function AdminLinksCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <LayoutGrid className="h-5 w-5" />
          Administración
        </CardTitle>
        <CardDescription>
          Áreas relacionadas con la operación del negocio.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-3">
          {ADMIN_LINKS.map(link => (
            <Link
              key={link.href}
              href={link.href}
              className="group flex items-start gap-3 rounded-lg border p-4 transition hover:border-primary/60 hover:bg-muted/40"
            >
              <span className="rounded-lg bg-primary/10 p-2 text-primary">
                <link.icon className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2 font-medium">
                  {link.title}
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">{link.description}</span>
              </span>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

export function TimingCard({ settings, onNumber }: {
  settings: GeneralSettings
  onNumber: (field: NumericField, value: string) => void
}) {
  return (
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
                  onChange={(e) => onNumber("tempReservationMinutes", e.target.value)}
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
                  onChange={(e) => onNumber("depositPercentage", e.target.value)}
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
                  onChange={(e) => onNumber("depositReservationHours", e.target.value)}
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
                onChange={(e) => onNumber("pendingVerificationHours", e.target.value)}
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
  )
}

export function FinanceCard({ settings, onNumber, onText }: {
  settings: GeneralSettings
  onNumber: (field: NumericField, value: string) => void
  onText: (field: TextField, value: string) => void
}) {
  return (
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
              onChange={(e) => onNumber("exchangeRate", e.target.value)}
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
                onChange={(e) => onText("bankTransferInfo", e.target.value)}
                placeholder={"Ej:\nBanco: BBVA\nTitular: ProSolutions SA\nCuenta: 0123456789"}
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
                onChange={(e) => onText("bankCashInfo", e.target.value)}
                placeholder={"Ej:\nTienda: OXXO / Spin\nTitular: Juan Pérez\nTarjeta: 4152 3133 4444 5555"}
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
  )
}

export function TicketCard({ settings, onText }: {
  settings: GeneralSettings
  onText: (field: TextField, value: string) => void
}) {
  return (
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
            onChange={(e) => onText("ticketSubtitle", e.target.value)}
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
            onChange={(e) => onText("ticketFooter", e.target.value)}
            placeholder="¡Gracias por tu preferencia!"
          />
          <p className="text-xs text-muted-foreground">Aparece al final del ticket, debajo del total.</p>
        </div>
      </CardContent>
    </Card>
  )
}

export function SummaryCard({ settings }: { settings: GeneralSettings }) {
  return (
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
  )
}
