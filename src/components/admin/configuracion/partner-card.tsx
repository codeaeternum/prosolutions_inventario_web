"use client"

import { useEffect, useState } from "react"
import { Handshake, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

interface PartnerOption {
  id: string
  name: string
  slug: string
}

// Valor del Select cuando no hay taller reparador vinculado ("" muestra el
// placeholder en vez del ítem; el sentinel evita ese caso borde).
const NONE_VALUE = "__none__"

/**
 * Tarjeta «Taller asociado»: dos ajustes del modelo captador.
 *
 * - `partner_intake_enabled`: este negocio funge como taller reparador y
 *   acepta órdenes delegadas (lo lista GET /api/directory/partners).
 * - `repair_partner_business_id`: este negocio es captador y envía sus
 *   equipos al taller elegido (los captura desde el portal /aliado).
 *
 * Solo edita el estado; el guardado lo hace el botón «Guardar» de la página
 * contra PATCH /api/settings.
 */
export function PartnerCard({
  intakeEnabled,
  partnerId,
  onIntakeChange,
  onPartnerChange,
}: {
  intakeEnabled: boolean
  partnerId: string
  onIntakeChange: (value: boolean) => void
  onPartnerChange: (value: string) => void
}) {
  const [partners, setPartners] = useState<PartnerOption[] | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch("/api/directory/partners")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data) => {
        if (cancelled) return
        setPartners(Array.isArray(data.partners) ? data.partners : [])
      })
      .catch(() => {
        if (cancelled) return
        setPartners([])
        toast.error("No se pudo cargar la lista de talleres asociados")
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Handshake className="h-5 w-5" />
          Taller asociado
        </CardTitle>
        <CardDescription>
          Delega reparaciones a otro taller de la plataforma o acepta equipos
          que otros negocios te envían a reparar.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="repairPartner">Taller reparador</Label>
          {partners === null ? (
            <div className="flex items-center gap-2 py-1 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Cargando talleres…
            </div>
          ) : (
            <Select
              value={partnerId || NONE_VALUE}
              onValueChange={(value) =>
                onPartnerChange(value === NONE_VALUE ? "" : value)
              }
            >
              <SelectTrigger id="repairPartner" className="max-w-sm">
                <SelectValue placeholder="Ninguno" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_VALUE}>Ninguno</SelectItem>
                {partners.map((partner) => (
                  <SelectItem key={partner.id} value={partner.id}>
                    {partner.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <p className="text-xs text-muted-foreground">
            Los equipos que captes en el portal «Aliado» llegan a este taller.
            Solo aparecen negocios que aceptan órdenes de talleres asociados.
          </p>
        </div>

        <div className="flex items-start gap-3 border-t pt-5">
          <Checkbox
            id="partnerIntake"
            checked={intakeEnabled}
            onCheckedChange={(checked) => onIntakeChange(checked === true)}
            className="mt-0.5"
          />
          <div className="space-y-1">
            <Label htmlFor="partnerIntake" className="font-medium cursor-pointer">
              Acepto recibir órdenes de talleres asociados
            </Label>
            <p className="text-xs text-muted-foreground">
              Tu negocio aparece como taller reparador para que otros negocios
              te envíen equipos a reparar.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
