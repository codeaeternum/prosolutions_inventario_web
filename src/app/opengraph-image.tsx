import { ImageResponse } from "next/og"

// Tarjeta OG de Reficio para links compartidos (WhatsApp, Telegram, X):
// sin og:image el preview sale vacío y el negocio pierde la venta del click.
// Cubre toda ruta que no tenga su propio opengraph-image (p. ej. /<slug>).
export const alt = "Reficio — software para talleres de reparación"
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"

export default function OpengraphImage() {
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
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 96,
              height: 96,
              borderRadius: 24,
              fontSize: 52,
              fontWeight: 800,
              color: "#ffffff",
              background: "linear-gradient(135deg, #8b5cf6, #6366f1)",
            }}
          >
            R
          </div>
          <div style={{ fontSize: 44, fontWeight: 800, letterSpacing: -1 }}>
            Reficio
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div
            style={{
              fontSize: 68,
              fontWeight: 800,
              lineHeight: 1.08,
              letterSpacing: -2,
              maxWidth: 920,
            }}
          >
            El sistema operativo de tu taller de reparación
          </div>
          <div style={{ fontSize: 30, color: "#c4b5fd", maxWidth: 880 }}>
            Reparaciones, refacciones, caja y clientes en un solo sistema —
            en español y pensado para México.
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
          <div style={{ display: "flex" }}>reficio.app</div>
          <div style={{ display: "flex" }}>Gratis durante el piloto</div>
        </div>
      </div>
    ),
    { ...size },
  )
}
