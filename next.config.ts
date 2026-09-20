import type { NextConfig } from "next"
const nextConfig: NextConfig = {
  output: "standalone",
  turbopack: {},
  // Los fs dinámicos (process.cwd() + realpath) hacen que nft arrastre el repo
  // entero al standalone — incluidos .env con secretos, que terminarían
  // horneados en la imagen Docker. Los datos viven en volúmenes de runtime;
  // nada de esto es asset del bundle.
  outputFileTracingExcludes: {
    "*": [
      "./.env*",
      "./**/.env*",
      "./data/**/*",
      "./storage/**/*",
      "./public/uploads/**/*",
      "./**/*.md",
      "./Dockerfile*",
      "./docker-compose*",
      "./deploy-*.ps1",
    ],
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "api.qrserver.com",
      },
      // Añadir aquí otros dominios cuando se usen (ej. CDN, almacenamiento de imágenes del proyecto).
    ],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
  async redirects() {
    return [
      // Dominio retirado: todo tráfico del host viejo migra a reficio.app
      // conservando la ruta (QRs impresos y links viejos siguen sirviendo).
      {
        source: "/:path*",
        has: [{ type: "host", value: "prosolutions.ascnex.com" }],
        destination: "https://reficio.app/:path*",
        permanent: true,
      },
    ]
  },
  async headers() {
    const securityHeaders = [
      { key: "X-Frame-Options", value: "SAMEORIGIN" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
    ]
    if (process.env.NODE_ENV === "production") {
      securityHeaders.push({
        key: "Strict-Transport-Security",
        value: "max-age=31536000; includeSubDomains; preload",
      })
    }
    // CSP en modo report-only: no bloquea, solo reporta. Ajustar y pasar a enforce cuando esté estable.
    const cspReportOnly = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'", // Compatibilidad de Next.js; pendiente endurecer con nonces
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: blob: https:",
      "connect-src 'self' https:",
      "frame-ancestors 'self'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; ")
    securityHeaders.push({
      key: "Content-Security-Policy-Report-Only",
      value: cspReportOnly,
    })
    return [
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-store" }] },
      // Comprobantes de pago son objetos privados: nunca permitir caché pública, sea cual sea el handler.
      { source: "/api/payment-proofs/:path*", headers: [{ key: "Cache-Control", value: "private, no-store" }] },
      { source: "/uploads/payments/:path*", headers: [{ key: "Cache-Control", value: "private, no-store" }] },
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ]
  },
}

export default nextConfig
