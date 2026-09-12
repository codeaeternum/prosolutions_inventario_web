"use client"

import * as React from "react"
import { ChevronDown, Check } from "lucide-react"
import { cn } from "@/lib/utils"

interface SelectContextValue {
    value: string
    onValueChange: (value: string) => void
    open: boolean
    setOpen: (open: boolean) => void
    labels: Map<string, React.ReactNode>
}

const SelectContext = React.createContext<SelectContextValue | null>(null)

function useSelectContext() {
    const context = React.useContext(SelectContext)
    if (!context) {
        throw new Error("Select components must be used within a Select")
    }
    return context
}

interface SelectProps {
    value?: string
    defaultValue?: string
    onValueChange?: (value: string) => void
    children: React.ReactNode
}

function collectItemLabels(children: React.ReactNode, labels: Map<string, React.ReactNode>) {
    React.Children.forEach(children, (child) => {
        if (!React.isValidElement(child)) return
        const props = child.props as { value?: string; children?: React.ReactNode }
        if (child.type === SelectItem && typeof props.value === "string") {
            labels.set(props.value, props.children)
            return
        }
        if (props.children) collectItemLabels(props.children, labels)
    })
}

function Select({ value, defaultValue = "", onValueChange, children }: SelectProps) {
    const [internalValue, setInternalValue] = React.useState(defaultValue)
    const [open, setOpen] = React.useState(false)

    const currentValue = value !== undefined ? value : internalValue

    const handleValueChange = React.useCallback((newValue: string) => {
        if (value === undefined) {
            setInternalValue(newValue)
        }
        onValueChange?.(newValue)
        setOpen(false)
    }, [value, onValueChange])

    const labels = new Map<string, React.ReactNode>()
    collectItemLabels(children, labels)

    return (
        <SelectContext.Provider value={{ value: currentValue, onValueChange: handleValueChange, open, setOpen, labels }}>
            <div className="relative">
                {children}
            </div>
        </SelectContext.Provider>
    )
}

interface SelectTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    children: React.ReactNode
}

const SelectTrigger = React.forwardRef<HTMLButtonElement, SelectTriggerProps>(
    ({ className, children, ...props }, ref) => {
        const { open, setOpen } = useSelectContext()

        return (
            <button
                type="button"
                ref={ref}
                className={cn(
                    "flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
                    className
                )}
                onClick={() => setOpen(!open)}
                {...props}
            >
                {children}
                <ChevronDown className={cn("h-4 w-4 opacity-50 transition-transform", open && "rotate-180")} />
            </button>
        )
    }
)
SelectTrigger.displayName = "SelectTrigger"

interface SelectValueProps {
    placeholder?: string
}

function SelectValue({ placeholder }: SelectValueProps) {
    const { value, labels } = useSelectContext()
    const label = value ? (labels.get(value) ?? value) : null
    return <span className={cn("truncate", !value && "text-muted-foreground")}>{label || placeholder}</span>
}

interface SelectContentProps {
    children: React.ReactNode
}

function SelectContent({ children }: SelectContentProps) {
    const { open, setOpen } = useSelectContext()
    const ref = React.useRef<HTMLDivElement>(null)

    React.useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (ref.current && !ref.current.contains(event.target as Node)) {
                setOpen(false)
            }
        }
        if (open) {
            document.addEventListener("mousedown", handleClickOutside)
            return () => document.removeEventListener("mousedown", handleClickOutside)
        }
    }, [open, setOpen])

    if (!open) return null

    return (
        <div
            ref={ref}
            data-select-content
            className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95"
        >
            {children}
        </div>
    )
}

interface SelectItemProps extends React.HTMLAttributes<HTMLDivElement> {
    value: string
    children: React.ReactNode
}

function SelectItem({ value, children, className, ...props }: SelectItemProps) {
    const { value: selectedValue, onValueChange } = useSelectContext()
    const isSelected = selectedValue === value

    return (
        <div
            data-select-item
            className={cn(
                "relative flex w-full cursor-pointer select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground",
                isSelected && "bg-accent text-accent-foreground",
                className
            )}
            onClick={() => onValueChange(value)}
            {...props}
        >
            {isSelected && (
                <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
                    <Check className="h-4 w-4" />
                </span>
            )}
            {children}
        </div>
    )
}

export { Select, SelectTrigger, SelectValue, SelectContent, SelectItem }
