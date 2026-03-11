import Link from "next/link"
import { ChevronRight, Home } from "lucide-react"

interface BreadcrumbItem {
  label: string
  href?: string
}

export function Breadcrumbs({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav className="flex items-center space-x-1 text-sm text-muted-foreground mb-4">
      <Link href="/admin" className="hover:text-foreground flex items-center">
        <Home className="h-4 w-4" />
        <span className="sr-only">Dashboard</span>
      </Link>
      
      {items.map((item, index) => (
        <div key={item.label} className="flex items-center space-x-1">
          <ChevronRight className="h-4 w-4 flex-shrink-0" />
          {item.href ? (
            <Link href={item.href} className="hover:text-foreground truncate max-w-[150px] sm:max-w-xs">
              {item.label}
            </Link>
          ) : (
            <span className="text-foreground font-medium truncate max-w-[150px] sm:max-w-xs">
              {item.label}
            </span>
          )}
        </div>
      ))}
    </nav>
  )
}
