"use client"

import { MessageCircle } from "lucide-react"

export type WorkshopEvent = { id: string; type: string; detail: string; isPublic: boolean; createdAt: string; actor: { name: string } }

const date = (value: string) => new Date(value).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" })

let businessNamePromise: Promise<string> | null = null
function businessName() {
  if (!businessNamePromise) {
    businessNamePromise = fetch("/api/business")
      .then(res => res.json())
      .then(data => typeof data?.name === "string" && data.name.trim() ? data.name.trim() : "ProSolutions")
      .catch(() => "ProSolutions")
  }
  return businessNamePromise
}

export function OrderHistory({ events, folio, phone }: { events: WorkshopEvent[] | undefined; folio: string; phone: string }) {
  async function shareNote(detail: string) {
    const name = await businessName()
    const digits = phone.replace(/\D/g, "")
    const base = digits ? `https://wa.me/${digits}` : "https://wa.me/"
    window.open(`${base}?text=${encodeURIComponent(`${folio} · ${name}: ${detail}`)}`, "_blank", "noopener,noreferrer")
  }
  return <section className="h-fit rounded-xl border bg-card p-5">
    <h2 className="mb-5 font-semibold">Historial de la orden</h2>
    <ol className="space-y-5">{(events ?? []).map(event => <li key={event.id} className="border-l-2 border-primary/30 pl-4">
      <p className="whitespace-pre-wrap text-sm">{event.detail}</p>
      <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span>{event.actor.name} · {date(event.createdAt)}</span>
        {event.type === "NOTE" && <>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${event.isPublic ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-muted text-muted-foreground"}`}>{event.isPublic ? "Pública" : "Privada"}</span>
          <button type="button" onClick={() => void shareNote(event.detail)} className="inline-flex items-center gap-1 font-medium text-primary underline-offset-2 hover:underline"><MessageCircle size={12} />WhatsApp</button>
        </>}
      </p>
    </li>)}</ol>
  </section>
}
