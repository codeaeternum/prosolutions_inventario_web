"use client"

import { Toaster, toast } from "sonner"

// Sonner no ofrece duración por tipo en toastOptions: se envuelve toast.error
// UNA vez (singleton del paquete) para que los errores —que suelen traer
// instrucciones de recuperación— duren 8 s y lleven botón de cierre, mientras
// los éxitos conservan los 3 s globales. Un duration/closeButton explícito en
// la llamada siempre gana (spread al final). La marca evita doble envoltura
// en recargas de HMR.
type ErrorToast = typeof toast.error & { __psPatched?: boolean }
const errorToast = toast.error as ErrorToast
if (!errorToast.__psPatched) {
    const original = errorToast
    const patched = ((message: Parameters<ErrorToast>[0], data?: Parameters<ErrorToast>[1]) =>
        original(message, { duration: 8000, closeButton: true, ...data })) as ErrorToast
    patched.__psPatched = true
    toast.error = patched
}

export function ToastProvider() {
    return (
        <Toaster
            position="top-center"
            richColors
            closeButton
            toastOptions={{
                duration: 3000,
            }}
        />
    )
}
