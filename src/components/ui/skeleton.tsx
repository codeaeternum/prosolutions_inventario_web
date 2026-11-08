import { cn } from "@/lib/utils"

/**
 * Placeholder animado para estados de carga. Sin "use client": es markup
 * puro, así que puede renderizarse tanto en loading.tsx (server) como en
 * componentes cliente.
 */
export function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
    return (
        <div
            aria-hidden
            className={cn("animate-pulse rounded-md bg-muted", className)}
            {...props}
        />
    )
}
