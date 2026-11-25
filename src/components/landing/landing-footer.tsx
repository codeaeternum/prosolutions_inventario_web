import Link from "next/link"
import { ReficioMark } from "@/components/brand/reficio-mark"

const productLinks = [
  { href: "#producto", label: "Producto" },
  { href: "#vitrina", label: "Vitrina" },
  { href: "#precio", label: "Precio" },
  { href: "#faq", label: "FAQ" },
]
const resourceLinks = [
  { href: "/seguimiento", label: "Rastrear reparación" },
  { href: "/mercado", label: "Mercado" },
  { href: "/login", label: "Iniciar sesión" },
]

export function LandingFooter() {
  return (
    <footer className="border-t">
      <div className="container mx-auto max-w-6xl px-4 py-10">
        <div className="grid gap-8 sm:grid-cols-[2fr_1fr_1fr] items-start">
          <Link href="/" className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-primary flex items-center justify-center">
              <ReficioMark className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="font-bold tracking-tight">Reficio</span>
            <span className="text-sm text-muted-foreground">· reficio.app</span>
          </Link>

          {[
            { title: "Producto", links: productLinks },
            { title: "Recursos", links: resourceLinks },
          ].map(({ title, links }) => (
            <nav key={title} aria-label={title} className="space-y-3 text-sm">
              <h2 className="font-semibold">{title}</h2>
              <ul className="space-y-2 text-muted-foreground">
                {links.map(link => (
                  <li key={link.href}>
                    <Link href={link.href} className="hover:text-foreground transition-colors">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <div className="mt-8 pt-6 border-t text-center sm:text-left text-xs text-muted-foreground">
          <p>
            © {new Date().getFullYear()} Reficio — del latín <em>reficere</em>,
            reparar. Software para talleres de reparación.
          </p>
        </div>
      </div>
    </footer>
  )
}
