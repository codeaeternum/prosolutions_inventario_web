"use client"

import { useState } from "react"
import { CheckCircle2, XCircle, Loader2, FileCheck, Ban, AlertCircle } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { formatDate, formatPrice } from "@/lib/utils"

type Decision = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED" | "DECIDED"

interface QuoteApprovalProps {
  token: string
  folio: string
  status: string
  quoteApprovedAt: string | null
  // Importe total mostrado en la confirmación (mano de obra + refacciones).
  totalCents: number | null
  // Mano de obra que el cliente VE en el documento: viaja al POST como
  // expectedLaborCents — si el taller cambió el presupuesto, la API responde
  // 409 QUOTE_CHANGED en vez de autorizar una cifra distinta (anti-TOCTOU).
  laborCents: number | null
  // Sin presupuesto ni refacciones no hay nada que autorizar todavía.
  hasQuote: boolean
}

function initialDecision(status: string, quoteApprovedAt: string | null): Decision {
  if (quoteApprovedAt) return "APPROVED"
  if (status === "NOT_AUTHORIZED") return "REJECTED"
  if (status === "CANCELLED") return "CANCELLED"
  return "PENDING"
}

// Bloque de decisión que ve el cliente debajo del documento de cotización.
// El token del enlace es el secreto: la decisión se registra sin sesión.
export function QuoteApproval({ token, folio, status, quoteApprovedAt, totalCents, laborCents, hasQuote }: QuoteApprovalProps) {
  const [decision, setDecision] = useState<Decision>(() => initialDecision(status, quoteApprovedAt))
  const [approvedAt, setApprovedAt] = useState<string | null>(quoteApprovedAt)
  const [signerName, setSignerName] = useState("")
  const [pending, setPending] = useState<"APPROVE" | "REJECT" | null>(null)
  const [error, setError] = useState("")

  async function decide(action: "APPROVE" | "REJECT") {
    if (pending) return
    setPending(action)
    setError("")
    try {
      const res = await fetch(`/api/cotizacion/${encodeURIComponent(token)}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          signerName: signerName.trim() || undefined,
          expectedLaborCents: laborCents ?? 0,
        }),
      })
      const data = await res.json().catch(() => null) as {
        decision?: "APPROVED" | "REJECTED"
        quoteApprovedAt?: string | null
        error?: string
        code?: string
      } | null
      if (res.status === 409) {
        if (data?.code === "QUOTE_CHANGED") {
          // El presupuesto cambió desde que se cargó la página: mensaje
          // visible y el cliente reabre el link para ver la cifra nueva.
          setError(data.error ?? "La cotización cambió; vuelve a abrir el link.")
          return
        }
        // Ya fue decidida (otro dispositivo o el taller): no insistir.
        setDecision("DECIDED")
        return
      }
      if (!res.ok || !data?.decision) {
        setError(data?.error ?? "No pudimos registrar tu respuesta. Intenta de nuevo.")
        return
      }
      setDecision(data.decision)
      if (data.quoteApprovedAt) setApprovedAt(data.quoteApprovedAt)
      toast.success(data.decision === "APPROVED" ? "Cotización aprobada. ¡Gracias!" : "Respuesta registrada.")
    } catch {
      setError("Sin conexión. Revisa tu internet e intenta de nuevo.")
    } finally {
      setPending(null)
    }
  }

  if (decision === "APPROVED") {
    return (
      <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-6 text-center space-y-2" role="status">
        <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600 dark:text-emerald-400" />
        <h2 className="text-lg font-bold text-emerald-700 dark:text-emerald-300">Cotización aprobada</h2>
        <p className="text-sm text-emerald-700/80 dark:text-emerald-200/80">
          {approvedAt ? `Aprobada el ${formatDate(approvedAt)}.` : "Tu autorización quedó registrada."} El taller ya fue notificado y continuará con tu equipo.
        </p>
      </div>
    )
  }

  if (decision === "REJECTED") {
    return (
      <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-6 text-center space-y-2" role="status">
        <XCircle className="mx-auto h-10 w-10 text-destructive" />
        <h2 className="text-lg font-bold">Cotización no autorizada</h2>
        <p className="text-sm text-muted-foreground">
          El taller no realizará el trabajo. Si fue un error o quieres renegociar, contáctalos directamente.
        </p>
      </div>
    )
  }

  if (decision === "CANCELLED") {
    return (
      <div className="rounded-2xl border border-dashed p-6 text-center space-y-2" role="status">
        <AlertCircle className="mx-auto h-10 w-10 text-muted-foreground" />
        <h2 className="text-lg font-bold">Orden cancelada</h2>
        <p className="text-sm text-muted-foreground">Esta orden fue cancelada; la cotización ya no está vigente.</p>
      </div>
    )
  }

  if (decision === "DECIDED") {
    return (
      <div className="rounded-2xl border border-dashed p-6 text-center space-y-2" role="status">
        <AlertCircle className="mx-auto h-10 w-10 text-muted-foreground" />
        <h2 className="text-lg font-bold">Esta cotización ya fue respondida</h2>
        <p className="text-sm text-muted-foreground">Recarga la página para ver el estado actual.</p>
      </div>
    )
  }

  if (!hasQuote) {
    return (
      <div className="rounded-2xl border border-dashed p-6 text-center space-y-2" role="status">
        <FileCheck className="mx-auto h-10 w-10 text-muted-foreground" />
        <h2 className="text-lg font-bold">Cotización en preparación</h2>
        <p className="text-sm text-muted-foreground">
          El taller aún está preparando el presupuesto de tu equipo. Vuelve a abrir este enlace más tarde.
        </p>
      </div>
    )
  }

  // PENDING: nombre opcional + dos botones grandes con confirmación.
  return (
    <div className="rounded-2xl border bg-card p-6 shadow-sm space-y-5">
      <div className="text-center space-y-1">
        <h2 className="text-lg font-bold">¿Autorizas esta cotización?</h2>
        <p className="text-sm text-muted-foreground">
          Revisa el desglose del documento{totalCents !== null ? <> — total <span className="font-semibold text-foreground">{formatPrice(totalCents / 100)}</span></> : ""} y confirma tu decisión.
        </p>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="signer-name" className="text-sm font-medium">Tu nombre (opcional)</label>
        <Input
          id="signer-name"
          value={signerName}
          onChange={e => setSignerName(e.target.value.slice(0, 80))}
          placeholder="¿Quién autoriza?"
          autoComplete="name"
          className="h-11"
          disabled={pending !== null}
        />
        <p className="text-xs text-muted-foreground">Queda registrado quién respondió la cotización.</p>
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm font-medium text-center">
          {error}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              size="lg"
              disabled={pending !== null}
              className="h-12 w-full gap-2 bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-500"
            >
              {pending === "APPROVE" ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />}
              Aprobar cotización
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Autorizar cotización</AlertDialogTitle>
              <AlertDialogDescription>
                Confirmas que autorizas el trabajo descrito{totalCents !== null ? <> por un total de <span className="font-semibold text-foreground">{formatPrice(totalCents / 100)}</span></> : ""}.
                El taller continuará con la reparación de tu equipo ({folio}).
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Volver</AlertDialogCancel>
              <AlertDialogAction
                disabled={pending !== null}
                onClick={() => void decide("APPROVE")}
                className="bg-emerald-600 text-white hover:bg-emerald-700"
              >
                {pending === "APPROVE" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Sí, autorizar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              size="lg"
              variant="outline"
              disabled={pending !== null}
              className="h-12 w-full gap-2 border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              {pending === "REJECT" ? <Loader2 className="h-5 w-5 animate-spin" /> : <Ban className="h-5 w-5" />}
              No autorizo
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>No autorizar la cotización</AlertDialogTitle>
              <AlertDialogDescription>
                El taller no realizará el trabajo de {folio} y te contactará para la devolución de tu equipo.
                ¿Seguro que deseas continuar?
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Volver</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                disabled={pending !== null}
                onClick={() => void decide("REJECT")}
              >
                {pending === "REJECT" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Sí, no autorizo
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  )
}
