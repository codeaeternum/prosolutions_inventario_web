"use client"

import * as React from "react"
import * as SelectPrimitive from "@radix-ui/react-select"
import { Check, ChevronDown, ChevronUp } from "lucide-react"
import { cn } from "@/lib/utils"

// Select sobre @radix-ui/react-select (patrón shadcn, mismas clases que
// tenía la versión casera): navegación por teclado, typeahead, cierre con
// Escape/clic fuera, portal (z-index correcto dentro de dialogs/sheets),
// scroll lock del menú abierto y focus management — todo nativo de Radix.
// El Value muestra el contenido del SelectItem elegido incluso antes de
// abrir el menú: Radix monta los items en un fragmento oculto cuando el
// select está cerrado.

const Select = SelectPrimitive.Root

const SelectGroup = SelectPrimitive.Group

// Ojo: Radix descarta className/style en SelectValue (el nodo de valor se
// usa internamente para portalizar ahí el contenido del ítem elegido), así
// que el truncado vive en el trigger vía [&>span].
const SelectValue = SelectPrimitive.Value

const SelectTrigger = React.forwardRef<
    React.ElementRef<typeof SelectPrimitive.Trigger>,
    React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
    <SelectPrimitive.Trigger
        ref={ref}
        className={cn(
            "group flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 data-[placeholder]:text-muted-foreground [&>span]:truncate [&>span]:min-w-0",
            className
        )}
        {...props}
    >
        {children}
        <SelectPrimitive.Icon asChild>
            <ChevronDown className="h-4 w-4 shrink-0 opacity-50 transition-transform group-data-[state=open]:rotate-180" />
        </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
))
SelectTrigger.displayName = "SelectTrigger"

const SelectScrollUpButton = React.forwardRef<
    React.ElementRef<typeof SelectPrimitive.ScrollUpButton>,
    React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollUpButton>
>(({ className, ...props }, ref) => (
    <SelectPrimitive.ScrollUpButton
        ref={ref}
        className={cn("flex cursor-default items-center justify-center py-1", className)}
        {...props}
    >
        <ChevronUp className="h-4 w-4" />
    </SelectPrimitive.ScrollUpButton>
))
SelectScrollUpButton.displayName = "SelectScrollUpButton"

const SelectScrollDownButton = React.forwardRef<
    React.ElementRef<typeof SelectPrimitive.ScrollDownButton>,
    React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollDownButton>
>(({ className, ...props }, ref) => (
    <SelectPrimitive.ScrollDownButton
        ref={ref}
        className={cn("flex cursor-default items-center justify-center py-1", className)}
        {...props}
    >
        <ChevronDown className="h-4 w-4" />
    </SelectPrimitive.ScrollDownButton>
))
SelectScrollDownButton.displayName = "SelectScrollDownButton"

// position="popper" reproduce el comportamiento anterior: el menú se abre
// debajo del trigger con al menos su mismo ancho (variables --radix-* que
// inyecta Radix), en vez de alinearse sobre el ítem seleccionado.
const SelectContent = React.forwardRef<
    React.ElementRef<typeof SelectPrimitive.Content>,
    React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = "popper", ...props }, ref) => (
    <SelectPrimitive.Portal>
        <SelectPrimitive.Content
            ref={ref}
            className={cn(
                "relative z-50 max-h-60 min-w-[8rem] overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-md",
                "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
                position === "popper" &&
                "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
                className
            )}
            position={position}
            {...props}
        >
            <SelectScrollUpButton />
            <SelectPrimitive.Viewport
                className={cn(
                    "p-1",
                    position === "popper" && "h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)]"
                )}
            >
                {children}
            </SelectPrimitive.Viewport>
            <SelectScrollDownButton />
        </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
))
SelectContent.displayName = "SelectContent"

const SelectLabel = React.forwardRef<
    React.ElementRef<typeof SelectPrimitive.Label>,
    React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => (
    <SelectPrimitive.Label
        ref={ref}
        className={cn("py-1.5 pl-8 pr-2 text-sm font-semibold", className)}
        {...props}
    />
))
SelectLabel.displayName = "SelectLabel"

const SelectItem = React.forwardRef<
    React.ElementRef<typeof SelectPrimitive.Item>,
    React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
    <SelectPrimitive.Item
        ref={ref}
        className={cn(
            "relative flex w-full cursor-pointer select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground data-[state=checked]:bg-accent data-[state=checked]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
            className
        )}
        {...props}
    >
        <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
            <SelectPrimitive.ItemIndicator>
                <Check className="h-4 w-4" />
            </SelectPrimitive.ItemIndicator>
        </span>
        <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
))
SelectItem.displayName = "SelectItem"

const SelectSeparator = React.forwardRef<
    React.ElementRef<typeof SelectPrimitive.Separator>,
    React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(({ className, ...props }, ref) => (
    <SelectPrimitive.Separator
        ref={ref}
        className={cn("-mx-1 my-1 h-px bg-muted", className)}
        {...props}
    />
))
SelectSeparator.displayName = "SelectSeparator"

export {
    Select,
    SelectGroup,
    SelectValue,
    SelectTrigger,
    SelectContent,
    SelectLabel,
    SelectItem,
    SelectSeparator,
    SelectScrollUpButton,
    SelectScrollDownButton,
}
