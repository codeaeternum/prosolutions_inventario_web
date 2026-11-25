import { ImageResponse } from "next/og"

// Tarjeta OG de Reficio para links compartidos (WhatsApp, Telegram, X):
// sin og:image el preview sale vacío y el negocio pierde la venta del click.
// Cubre toda ruta que no tenga su propio opengraph-image (p. ej. /<slug>).
// Satori no renderiza <svg> inline: el isotipo viaja como data URI en <img>.
export const alt = "Reficio — software para talleres de reparación"
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"

const MARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><g transform="rotate(15 50 50)"><path d="M 94 50 L 72 12.1 L 28 12.1 L 6 50 L 28 87.9 L 72 87.9 Z M 50 50 m -22 0 a 22 22 0 1 0 44 0 a 22 22 0 1 0 -44 0" fill="#FFFFFF" fill-rule="evenodd"/></g><rect x="43.5" y="10" width="13" height="80" fill="#FFFFFF" transform="rotate(-45 50 50)"/></svg>`
const MARK_URI = `data:image/svg+xml;base64,${Buffer.from(MARK_SVG).toString("base64")}`

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
              background: "linear-gradient(135deg, #8b5cf6, #6366f1)",
            }}
          >
            <img src={MARK_URI} width={68} height={68} alt="" />
          </div>
          <div style={{ fontSize: 44, fontWeight: 800, letterSpacing: -1 }}>
            Reficio
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div
            style={{
              fontSize: 62,
              fontWeight: 800,
              lineHeight: 1.08,
              letterSpacing: -2,
              maxWidth: 960,
            }}
          >
            Controla reparaciones, refacciones y caja de tu taller
          </div>
          <div style={{ fontSize: 30, color: "#c4b5fd", maxWidth: 880 }}>
            Órdenes con evidencia, inventario por sucursal, punto de venta y
            tu propia vitrina — en español y pensado para México.
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
