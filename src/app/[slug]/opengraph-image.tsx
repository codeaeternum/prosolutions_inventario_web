import { ImageResponse } from "next/og"
import { resolvePublicSlug } from "@/lib/public-slug"

// Tarjeta OG de la vitrina: el negocio comparte reficio.app/<slug> por
// WhatsApp y el preview debe llevar SU nombre, no el genérico de Reficio.
// Slug no reclamado → tarjeta genérica (la página igual da 404).
export const alt = "Vitrina en Reficio"
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"
export const dynamic = "force-dynamic"

interface Props {
  params: Promise<{ slug: string }>
}

export default async function OpengraphImage({ params }: Props) {
  const { slug } = await params
  const target = await resolvePublicSlug(slug)

  const name = target?.name ?? "Reficio"
  const initial = name.trim().charAt(0).toUpperCase() || "R"
  const tagline =
    target?.kind === "workshop"
      ? `Taller aliado de ${target.businessName}`
      : "Refacciones, accesorios y servicio técnico"

  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          width: "100%",
          height: "100%",
          padding: 72,
          color: "#ffffff",
          background:
            "linear-gradient(135deg, #2e1065 0%, #4c1d95 45%, #1e1b4b 100%)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 120,
              height: 120,
              borderRadius: 28,
              fontSize: 64,
              fontWeight: 800,
              color: "#ffffff",
              background: "linear-gradient(135deg, #8b5cf6, #6366f1)",
            }}
          >
            {initial}
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 30,
              color: "#c4b5fd",
              letterSpacing: 4,
            }}
          >
            VITRINA EN REFICIO
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div
            style={{
              display: "flex",
              fontSize: name.length > 24 ? 60 : 76,
              fontWeight: 800,
              lineHeight: 1.08,
              letterSpacing: -2,
            }}
          >
            {name}
          </div>
          <div style={{ display: "flex", fontSize: 32, color: "#c4b5fd" }}>
            {tagline} · Rastrea tu reparación en línea
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontSize: 26,
            color: "#a78bfa",
          }}
        >
          <div style={{ display: "flex" }}>reficio.app/{target?.slug ?? slug}</div>
          <div style={{ display: "flex" }}>Powered by Reficio</div>
        </div>
      </div>
    ),
    { ...size },
  )
}
