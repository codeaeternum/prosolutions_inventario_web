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
    // AVIF ~30-50% más ligero que WebP; el optimizador negocia por Accept.
    formats: ["image/avif", "image/webp"],
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
    // "radix-ui" es un barrel que re-exporta ~40 primitivas; sin optimización
    // cada chunk cliente que toca un Dialog/Tabs arrastra el paquete entero.
    // (lucide-react ya viene optimizado por defecto en Next).
    optimizePackageImports: ["radix-ui"],
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
    // La CSP NO vive aquí: es enforce con nonce por request y la emite el
    // proxy (src/proxy.ts) — necesita el header en el REQUEST upstream para
    // que el renderer estampe el nonce en sus scripts, algo imposible desde
    // la capa estática de headers(). Fijarla también aquí produciría DOS
    // headers CSP en la respuesta y el browser aplicaría la intersección
    // (rompiendo los scripts nonced). Test: security/headers.test.ts.
    return [
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-store" }] },
      // Comprobantes de pago son objetos privados: nunca permitir caché pública, sea cual sea el handler.
      { source: "/api/payment-proofs/:path*", headers: [{ key: "Cache-Control", value: "private, no-store" }] },
      { source: "/uploads/payments/:path*", headers: [{ key: "Cache-Control", value: "private, no-store" }] },
      // Fotos de catálogo: nombres con timestamp+aleatorio (contenido
      // direccionable), las sirve app/uploads/[[...path]] — caché inmutable
      // segura. SOLO este prefijo: el resto de /uploads (logos raíz, proofs
      // legacy) conserva el control del handler.
      { source: "/uploads/products/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ]
  },
}

export default nextConfig
