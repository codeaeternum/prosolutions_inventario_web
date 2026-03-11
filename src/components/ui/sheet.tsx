"use client"

import * as React from "react"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"

interface SheetContextValue {
    open: boolean
    setOpen: (open: boolean) => void
}

const SheetContext = React.createContext<SheetContextValue | null>(null)

function useSheetContext() {
    const context = React.useContext(SheetContext)
    if (!context) {
        throw new Error("Sheet components must be used within a Sheet")
    }
    return context
}

interface SheetProps {
    open?: boolean
    onOpenChange?: (open: boolean) => void
    children: React.ReactNode
}

function Sheet({ open: controlledOpen, onOpenChange, children }: SheetProps) {
    const [internalOpen, setInternalOpen] = React.useState(false)

    const open = controlledOpen !== undefined ? controlledOpen : internalOpen

    const setOpen = React.useCallback((value: boolean) => {
        if (controlledOpen === undefined) {
            setInternalOpen(value)
        }
        onOpenChange?.(value)
    }, [controlledOpen, onOpenChange])

    return (
        <SheetContext.Provider value={{ open, setOpen }}>
            {children}
        </SheetContext.Provider>
    )
}

interface SheetTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    asChild?: boolean
}

const SheetTrigger = React.forwardRef<HTMLButtonElement, SheetTriggerProps>(
    ({ children, asChild, ...props }, ref) => {
        const { setOpen } = useSheetContext()

        if (asChild && React.isValidElement(children)) {
            return React.cloneElement(children as React.ReactElement<{ onClick?: () => void }>, {
                onClick: () => setOpen(true),
            })
        }

        return (
            <button ref={ref} onClick={() => setOpen(true)} {...props}>
                {children}
            </button>
        )
    }
)
SheetTrigger.displayName = "SheetTrigger"

interface SheetContentProps extends React.HTMLAttributes<HTMLDivElement> {
    side?: "top" | "bottom" | "left" | "right"
}

const SheetContent = React.forwardRef<HTMLDivElement, SheetContentProps>(
    ({ className, children, side = "right", ...props }, ref) => {
        const { open, setOpen } = useSheetContext()

        React.useEffect(() => {
            const handleEscape = (e: KeyboardEvent) => {
                if (e.key === "Escape") setOpen(false)
            }
            if (open) {
                document.addEventListener("keydown", handleEscape)
                document.body.style.overflow = "hidden"
                return () => {
                    document.removeEventListener("keydown", handleEscape)
                    document.body.style.overflow = ""
                }
            }
        }, [open, setOpen])

        if (!open) return null

        const sideClasses = {
            top: "inset-x-0 top-0 border-b",
            bottom: "inset-x-0 bottom-0 border-t",
            left: "inset-y-0 left-0 h-full w-3/4 border-r sm:max-w-sm",
            right: "inset-y-0 right-0 h-full w-3/4 border-l sm:max-w-sm",
        }

        return (
            <div className="fixed inset-0 z-50 flex justify-end">
                {/* Overlay */}
                <div
                    className="fixed inset-0 bg-black/80 animate-in fade-in-0"
                    onClick={() => setOpen(false)}
                />

                {/* Content: scroll interno en móvil cuando el contenido es largo */}
                <div
                    ref={ref}
                    className={cn(
                        "fixed z-50 bg-background p-6 shadow-lg transition ease-in-out duration-300 animate-in overflow-y-auto max-h-[90dvh]",
                        sideClasses[side],
                        (side === "bottom" || side === "top") && "touch-pan-y",
                        className
                    )}
                    {...props}
                >
                    {children}
                    <button
                        className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none"
                        onClick={() => setOpen(false)}
                    >
                        <X className="h-4 w-4" />
                        <span className="sr-only">Cerrar</span>
                    </button>
                </div>
            </div>
        )
    }
)
SheetContent.displayName = "SheetContent"

const SheetHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div className={cn("flex flex-col space-y-2 text-center sm:text-left", className)} {...props} />
)
SheetHeader.displayName = "SheetHeader"

const SheetFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2", className)} {...props} />
)
SheetFooter.displayName = "SheetFooter"

const SheetTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
    ({ className, ...props }, ref) => (
        <h2 ref={ref} className={cn("text-lg font-semibold text-foreground", className)} {...props} />
    )
)
SheetTitle.displayName = "SheetTitle"

const SheetDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
    ({ className, ...props }, ref) => (
        <p ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
    )
)
SheetDescription.displayName = "SheetDescription"

export { Sheet, SheetTrigger, SheetContent, SheetHeader, SheetFooter, SheetTitle, SheetDescription }
