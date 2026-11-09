"use client"

import { MessageCircle } from "lucide-react"
import { CollapsibleSection } from "@/components/admin/taller/collapsible-section"
import { openWhatsApp } from "@/lib/whatsapp"

export type WorkshopEvent = { id: string; type: string; detail: string; isPublic: boolean; createdAt: string; actor: { name: string } }

const date = (value: string) => new Date(value).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" })

let businessNamePromise: Promise<string> | null = null
function businessName() {
  if (!businessNamePromise) {
    businessNamePromise = fetch("/api/business")
      .then(res => res.json())
      .then(data => typeof data?.name === "string" && data.name.trim() ? data.name.trim() : "Reficio")
      .catch(() => "Reficio")
  }
  return businessNamePromise
}

export function OrderHistory({ events, folio, phone, defaultOpen = false }: { events: WorkshopEvent[] | undefined; folio: string; phone: string; defaultOpen?: boolean }) {
  const count = events?.length ?? 0
  async function shareNote(detail: string) {
    const name = await businessName()
    openWhatsApp(phone, `${folio} · ${name}: ${detail}`)
  }
  // Sección de consulta — la más larga de la ficha: arranca colapsada.
  return <CollapsibleSection
    title="Historial de la orden"
    defaultOpen={defaultOpen}
    badge={<span>{count} evento{count === 1 ? "" : "s"}</span>}
    className="h-fit"
  >
    {count === 0
      ? <p className="text-sm text-muted-foreground">Sin eventos todavía.</p>
      : <ol className="space-y-4">{(events ?? []).map(event => <li key={event.id} className="border-l-2 border-primary/30 pl-4">
        <p className="whitespace-pre-wrap text-sm">{event.detail}</p>
        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span>{event.actor.name} · {date(event.createdAt)}</span>
          {event.type === "NOTE" && <>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${event.isPublic ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-muted text-muted-foreground"}`}>{event.isPublic ? "Pública" : "Privada"}</span>
            <button type="button" onClick={() => void shareNote(event.detail)} className="inline-flex items-center gap-1 font-medium text-primary underline-offset-2 hover:underline"><MessageCircle size={12} />WhatsApp</button>
          </>}
        </p>
      </li>)}</ol>}
  </CollapsibleSection>
}
