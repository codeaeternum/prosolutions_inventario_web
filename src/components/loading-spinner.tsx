import { Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

interface LoadingSpinnerProps {
  className?: string
  size?: "sm" | "md" | "lg"
}

const sizeClasses = {
  sm: "h-6 w-6",
  md: "h-10 w-10",
  lg: "h-12 w-12",
}

export function LoadingSpinner({ className, size = "md" }: LoadingSpinnerProps) {
  return (
    <div
      className={cn("flex items-center justify-center p-8", className)}
      role="status"
      aria-label="Cargando"
    >
      <Loader2
        className={cn("animate-spin text-primary", sizeClasses[size])}
        aria-hidden
      />
    </div>
  )
}
