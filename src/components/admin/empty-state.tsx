import { LucideIcon } from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description?: string
  action?: {
    label: string
    href: string
    icon?: LucideIcon
  }
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center p-8 text-center bg-card rounded-lg border border-border">
      <div className="flex items-center justify-center w-12 h-12 rounded-full bg-muted mb-4">
        <Icon className="h-6 w-6 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-medium">{title}</h3>
      {description && (
        <p className="text-sm text-muted-foreground mt-2 max-w-sm">
          {description}
        </p>
      )}
      {action && (
        <Button asChild className="mt-6" variant="outline">
          <Link href={action.href} className="flex items-center gap-2">
            {action.icon && <action.icon className="h-4 w-4" />}
            {action.label}
          </Link>
        </Button>
      )}
    </div>
  )
}
