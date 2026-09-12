import type { Metadata, Viewport } from "next"
import { Inter } from "next/font/google"
import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { CurrencyProvider } from "@/components/currency-provider"
import { SessionProvider } from "@/components/session-provider"
import { MobileNav } from "@/components/mobile-nav"
import { CartProvider } from "@/components/cart-context"
import { ToastProvider } from "@/components/toast-provider"
import { PwaInstallBanner } from "@/components/pwa-install-banner"
import { PwaUpdateBanner } from "@/components/pwa-update-banner"
import { auth } from "@/lib/auth"

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
})

const siteName = "Reficio"
const defaultTitle = "Reficio | Software para talleres de reparación"
const defaultDescription = "Órdenes de reparación, inventario por sucursal, punto de venta, crédito y catálogo web — el sistema operativo de tu taller."

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXTAUTH_URL ?? "https://reficio.app"
  ),
  title: {
    default: defaultTitle,
    template: "%s | Reficio",
  },
  description: defaultDescription,
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: siteName,
  },
  icons: {
    icon: "/favicon.ico",
    apple: "/icons/icon-192x192.png",
  },
  openGraph: {
    type: "website",
    locale: "es_MX",
    siteName,
    title: defaultTitle,
    description: defaultDescription,
  },
  twitter: {
    card: "summary_large_image",
    title: defaultTitle,
    description: defaultDescription,
  },
  robots: {
    index: true,
    follow: true,
  },
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0d0d0d" },
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: "cover",
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const session = await auth()
  const canAccessAdmin = session?.user?.role === "ADMIN" || session?.user?.role === "EMPLOYEE"

  return (
    <html lang="es" suppressHydrationWarning>
      <body className={`${inter.variable} font-sans antialiased`}>
        <a href="#main-content" className="skip-link">Saltar al contenido</a>
        <SessionProvider>
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
            <CurrencyProvider>
              <CartProvider>
                <ToastProvider />
                <PwaUpdateBanner />
                <div className="min-h-screen safe-area-page">
                  {children}
                </div>
                <MobileNav isAdmin={canAccessAdmin} />
                <PwaInstallBanner />
              </CartProvider>
            </CurrencyProvider>
          </ThemeProvider>
        </SessionProvider>
      </body>
    </html>
  )
}
