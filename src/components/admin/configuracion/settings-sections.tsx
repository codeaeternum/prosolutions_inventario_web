"use client"

import Link from "next/link"
import {
  BookOpen,
  Building2,
  CheckCircle,
  ChevronRight,
  ClipboardPen,
  Clock,
  DollarSign,
  FileText,
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
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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
  // Folio de órdenes de taller: prefijo impreso y dígitos del consecutivo.
  orderPrefix?: string
  orderFolioDigits?: number
  // Modelo taller asociado: este negocio acepta órdenes de captadores y/o
  // tiene un taller reparador al que delega las suyas.
  partnerIntakeEnabled?: boolean
  repairPartnerBusinessId?: string
  // Mostrador: abrir el ticket automáticamente al registrar la venta.
  saleAutoTicket?: boolean
  // Recepción de equipos: cómo acredita el cliente ("canvas" | "ticket" | "pin").
  repairSignatureMode?: string
  // Cotización pública: días de vigencia (1–90) y términos del pie.
  quoteValidityDays?: number
  quoteTerms?: string
  // Etiqueta 50×40 del equipo: imprimir falla reportada y desbloqueo.
  labelShowProblem?: boolean
  labelShowAccess?: boolean
  updatedAt?: string
}

export type NumericField = "tempReservationMinutes" | "depositPercentage" | "depositReservationHours" | "pendingVerificationHours" | "exchangeRate" | "orderFolioDigits" | "quoteValidityDays"
export type TextField = "bankTransferInfo" | "bankCashInfo" | "ticketBusinessName" | "ticketSubtitle" | "ticketFooter" | "orderPrefix" | "repairPartnerBusinessId" | "quoteTerms" | "repairSignatureMode"
export type BoolField = "saleAutoTicket" | "labelShowProblem" | "labelShowAccess"

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

export function TicketCard({ settings, onText, onNumber, onBool }: {
  settings: GeneralSettings
  onText: (field: TextField, value: string) => void
  onNumber: (field: NumericField, value: string) => void
  onBool: (field: BoolField, value: boolean) => void
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

        <div className="border-t pt-4">
          <h4 className="text-sm font-medium mb-3">Folio de órdenes de servicio</h4>
          <div className="grid gap-6 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="orderPrefix">Prefijo de folio</Label>
              <Input
                id="orderPrefix"
                value={settings.orderPrefix || ""}
                onChange={(e) => onText("orderPrefix", e.target.value)}
                placeholder="OT"
                maxLength={8}
                className="w-28 uppercase"
              />
              <p className="text-xs text-muted-foreground">
                Letras y dígitos, máx. 8. Vacío = OT. Ejemplo: PS → PS-000001.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="orderFolioDigits">Dígitos del folio</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="orderFolioDigits"
                  type="number"
                  inputMode="numeric"
                  min={4}
                  max={8}
                  value={settings.orderFolioDigits ?? 6}
                  onChange={(e) => onNumber("orderFolioDigits", e.target.value)}
                  className="w-24"
                />
                <span className="text-muted-foreground text-sm">dígitos</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Longitud del consecutivo, entre 4 y 8 (6 → OT-000001).
              </p>
            </div>
          </div>
        </div>

        <div className="border-t pt-4">
          <h4 className="text-sm font-medium mb-3">Impresión</h4>
          <div className="flex items-start gap-3">
            <Checkbox
              id="saleAutoTicket"
              checked={settings.saleAutoTicket !== false}
              onCheckedChange={(checked) => onBool("saleAutoTicket", checked === true)}
              className="mt-0.5"
            />
            <div className="space-y-1">
              <Label htmlFor="saleAutoTicket" className="font-medium cursor-pointer">
                Abrir el ticket automáticamente al cobrar
              </Label>
              <p className="text-xs text-muted-foreground">
                Al registrar una venta el ticket se abre en una pestaña nueva listo para imprimir. Si el pago incluye tarjeta se imprime también la copia para la caja.
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

const SIGNATURE_MODE_OPTIONS: { value: string; label: string; hint: string }[] = [
  { value: "canvas", label: "Firma digital (pantalla)", hint: "El cliente firma en el teléfono o pantalla al entregar el equipo (comportamiento actual)." },
  { value: "ticket", label: "Firma en ticket impreso", hint: "La recepción no exige firma digital: el comprobante del cliente imprime una línea de firma y la leyenda de aceptación." },
  { value: "pin", label: "Terminación telefónica", hint: "El cliente confirma con los últimos 4 dígitos de su teléfono; la recepción lo registra en el historial de la orden." },
]

export function ReceptionCard({ settings, onText, onBool }: {
  settings: GeneralSettings
  onText: (field: TextField, value: string) => void
  onBool: (field: BoolField, value: boolean) => void
}) {
  const mode = settings.repairSignatureMode === "ticket" || settings.repairSignatureMode === "pin"
    ? settings.repairSignatureMode
    : "canvas"
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ClipboardPen className="h-5 w-5" />
          Recepción y etiqueta de equipos
        </CardTitle>
        <CardDescription>
          Cómo acredita el cliente la entrega del equipo y qué imprime la etiqueta de la orden.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="repairSignatureMode">Confirmación del cliente al recibir</Label>
          <Select value={mode} onValueChange={(value) => onText("repairSignatureMode", value)}>
            <SelectTrigger id="repairSignatureMode" className="max-w-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SIGNATURE_MODE_OPTIONS.map(option => (
                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {SIGNATURE_MODE_OPTIONS.find(o => o.value === mode)?.hint}
          </p>
        </div>

        <div className="border-t pt-4">
          <h4 className="text-sm font-medium mb-3">Etiqueta de la orden (50 × 40 mm)</h4>
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <Checkbox
                id="labelShowProblem"
                checked={settings.labelShowProblem !== false}
                onCheckedChange={(checked) => onBool("labelShowProblem", checked === true)}
                className="mt-0.5"
              />
              <div className="space-y-1">
                <Label htmlFor="labelShowProblem" className="font-medium cursor-pointer">
                  Imprimir la falla reportada en la etiqueta
                </Label>
                <p className="text-xs text-muted-foreground">
                  Apágalo si la etiqueta pegada al equipo no debe describir el problema.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Checkbox
                id="labelShowAccess"
                checked={settings.labelShowAccess !== false}
                onCheckedChange={(checked) => onBool("labelShowAccess", checked === true)}
                className="mt-0.5"
              />
              <div className="space-y-1">
                <Label htmlFor="labelShowAccess" className="font-medium cursor-pointer">
                  Imprimir el código de desbloqueo en la etiqueta
                </Label>
                <p className="text-xs text-muted-foreground">
                  PIN, contraseña o patrón del equipo. Apágalo si prefieres consultarlo solo en la hoja interna.
                </p>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export function QuoteCard({ settings, onNumber, onText }: {
  settings: GeneralSettings
  onNumber: (field: NumericField, value: string) => void
  onText: (field: TextField, value: string) => void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5" />
          Cotizaciones
        </CardTitle>
        <CardDescription>
          Vigencia del enlace público que recibe el cliente y términos impresos al pie del documento.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="quoteValidityDays">Vigencia de la cotización</Label>
          <div className="flex items-center gap-2">
            <Input
              id="quoteValidityDays"
              type="number"
              inputMode="numeric"
              min={1}
              max={90}
              value={settings.quoteValidityDays ?? 15}
              onChange={(e) => onNumber("quoteValidityDays", e.target.value)}
              className="w-24"
            />
            <span className="text-muted-foreground text-sm">días naturales</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Entre 1 y 90. El enlace público deja de mostrar el documento cuando vence («Válida por N días»).
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="quoteTerms">Términos de la cotización</Label>
          <Textarea
            id="quoteTerms"
            value={settings.quoteTerms || ""}
            onChange={(e) => onText("quoteTerms", e.target.value)}
            placeholder="Esta cotización es un estimado basado en el diagnóstico inicial. Si se detectan daños adicionales se le contactará antes de proceder."
            className="resize-none h-24"
            maxLength={2000}
          />
          <p className="text-xs text-muted-foreground">
            Garantías y condiciones al pie de la cotización pública y del ticket. Vacío = texto por defecto.
          </p>
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
