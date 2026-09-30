"use client"

import * as React from "react"
import { createPortal } from "react-dom"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"

interface DialogContextValue {
    open: boolean
    setOpen: (open: boolean) => void
}

const DialogContext = React.createContext<DialogContextValue | null>(null)

function useDialogContext() {
    const context = React.useContext(DialogContext)
    if (!context) {
        throw new Error("Dialog components must be used within a Dialog")
    }
    return context
}

interface DialogProps {
    open?: boolean
    onOpenChange?: (open: boolean) => void
    children: React.ReactNode
}

function Dialog({ open: controlledOpen, onOpenChange, children }: DialogProps) {
    const [internalOpen, setInternalOpen] = React.useState(false)

    const open = controlledOpen !== undefined ? controlledOpen : internalOpen

    const setOpen = React.useCallback((value: boolean) => {
        if (controlledOpen === undefined) {
            setInternalOpen(value)
        }
        onOpenChange?.(value)
    }, [controlledOpen, onOpenChange])

    return (
        <DialogContext.Provider value={{ open, setOpen }}>
            {children}
        </DialogContext.Provider>
    )
}

interface DialogTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    asChild?: boolean
}

const DialogTrigger = React.forwardRef<HTMLButtonElement, DialogTriggerProps>(
    ({ children, asChild, ...props }, ref) => {
        const { setOpen } = useDialogContext()

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
DialogTrigger.displayName = "DialogTrigger"

type DialogContentProps = React.HTMLAttributes<HTMLDivElement>

const DialogContent = React.forwardRef<HTMLDivElement, DialogContentProps>(
    ({ className, children, ...props }, ref) => {
        const { open, setOpen } = useDialogContext()

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

        if (!open || typeof document === "undefined") return null

        // Portal a body: sin él, un ancestro con transform/filter convierte
        // el `fixed` en relativo al documento y el diálogo se desplaza fuera
        // de la ventana (aparecía "escondido" al fondo de la página).
        return createPortal(
            <div className="fixed inset-0 z-50">
                {/* Overlay */}
                <div
                    className="fixed inset-0 bg-black/80 animate-in fade-in-0"
                    onClick={() => setOpen(false)}
                />

                {/* Content: en móvil ocupa altura útil y hace scroll interno.
                    El className del caller va al CONTENEDOR posicionado para
                    que los overrides de ancho (sm:max-w-4xl, etc.) apliquen;
                    el scroll vive en el div interior fijo. */}
                <div
                    role="dialog"
                    aria-modal="true"
                    className={cn("fixed left-[50%] top-[50%] z-50 flex w-full max-w-lg max-h-[90dvh] translate-x-[-50%] translate-y-[-50%] flex-col gap-4 border bg-background p-6 shadow-lg duration-200 animate-in fade-in-0 zoom-in-95 slide-in-from-left-1/2 slide-in-from-top-[48%] sm:rounded-lg overflow-hidden", className)}
                    {...props}
                >
                    <div ref={ref} className="overflow-y-auto min-h-0 flex-1 pr-8">
                        {children}
                    </div>
                    <button
                        className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none"
                        onClick={() => setOpen(false)}
                    >
                        <X className="h-4 w-4" />
                        <span className="sr-only">Cerrar</span>
                    </button>
                </div>
            </div>,
            document.body
        )
    }
)
DialogContent.displayName = "DialogContent"

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div className={cn("flex flex-col space-y-1.5 text-center sm:text-left", className)} {...props} />
)
DialogHeader.displayName = "DialogHeader"

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2", className)} {...props} />
)
DialogFooter.displayName = "DialogFooter"

const DialogTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
    ({ className, ...props }, ref) => (
        <h2 ref={ref} className={cn("text-lg font-semibold leading-none tracking-tight", className)} {...props} />
    )
)
DialogTitle.displayName = "DialogTitle"

const DialogDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
    ({ className, ...props }, ref) => (
        <p ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
    )
)
DialogDescription.displayName = "DialogDescription"

export { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription }
