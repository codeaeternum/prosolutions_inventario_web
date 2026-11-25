import type { ReactNode } from "react"

export function LandingSection({ id, eyebrow, title, children, muted = false }: { id: string; eyebrow?: string; title: string; children: ReactNode; muted?: boolean }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={`scroll-mt-24 border-b ${muted ? "bg-muted/30" : ""}`}>
      <div className="mx-auto max-w-6xl px-4 py-14 sm:py-20">
        {eyebrow && <p className="mb-3 text-sm font-semibold text-primary">{eyebrow}</p>}
        <h2 id={`${id}-title`} className="mb-8 max-w-3xl text-3xl font-bold tracking-tight sm:text-4xl">{title}</h2>
        {children}
      </div>
    </section>
  )
}
