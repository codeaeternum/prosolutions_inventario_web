// Beep de confirmación del mostrador: una pistola/escáner físico pita al
// leer; que el POS pite al agregar da la misma certeza sin mirar la pantalla.
// WebAudio best-effort: sin AudioContext o con el contexto suspendido por
// falta de gesto del usuario, simplemente no suena — nunca bloquea el flujo.

const PREF_KEY = "pos:sound"

let ctx: AudioContext | null = null

export function posSoundEnabled(): boolean {
    try {
        return localStorage.getItem(PREF_KEY) !== "0"
    } catch {
        return true
    }
}

export function setPosSoundEnabled(on: boolean): void {
    try {
        localStorage.setItem(PREF_KEY, on ? "1" : "0")
    } catch { /* sin storage: la preferencia vive solo en memoria */ }
}

/** "add" = alta confirmada (beep corto agudo); "error" = rechazo (buzz grave). */
export function playPosTone(kind: "add" | "error"): void {
    try {
        if (typeof window === "undefined") return
        const AC = window.AudioContext
            ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        if (!AC) return
        ctx ??= new AC()
        if (ctx.state === "suspended") void ctx.resume()
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        const now = ctx.currentTime
        const duration = kind === "error" ? 0.18 : 0.055
        osc.type = kind === "error" ? "square" : "sine"
        osc.frequency.value = kind === "error" ? 200 : 950
        gain.gain.setValueAtTime(kind === "error" ? 0.08 : 0.09, now)
        gain.gain.exponentialRampToValueAtTime(0.001, now + duration)
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.start(now)
        osc.stop(now + duration)
    } catch { /* el sonido es best-effort: jamás interrumpe la venta */ }
}
