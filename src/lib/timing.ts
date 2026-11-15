import { randomInt } from "node:crypto"

/**
 * Piso de latencia anti-enumeración para endpoints cuya respuesta es
 * constante pero cuyo TRABAJO no lo es (p. ej. password-reset: la rama
 * "la cuenta existe" paga issueVerificationCode + Resend + Telegram,
 * ~200-800 ms, y la "no existe" responde en ~10 ms — un request >300 ms
 * confirma la cuenta aunque status y body sean idénticos).
 *
 * `withLatencyFloor` no resuelve antes de un delay aleatorio uniforme en
 * [floorMinMs, floorMaxMs]: ninguna rama puede bajar del piso, y el jitter
 * por request evita que el propio umbral del piso se convierta en marca
 * (un piso fijo distinguiría "cayó justo en el límite" de "cayó encima").
 *
 * El jitter sale de crypto.randomInt, no de Math.random: el PRNG del
 * runtime no es criptográfico y su semilla es inferible, lo que dejaría
 * predecir el piso sorteado en cada request.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** Entero uniforme en [minMs, maxMs] con randomInt criptográfico. */
export function jitterMs(minMs: number, maxMs: number): number {
  return randomInt(minMs, maxMs + 1)
}

/**
 * Ejecuta `work` y resuelve su resultado, pero nunca antes de un delay
 * aleatorio en [floorMinMs, floorMaxMs] ms (500-800 por defecto). Si work
 * tarda más que el piso sorteado, resuelve cuando work termina — el piso
 * es un mínimo, no un techo. Un work que rechaza propaga el error sin
 * esperar el resto del delay (los errores ya se distinguen por status).
 */
export async function withLatencyFloor<T>(
  work: () => Promise<T>,
  floorMinMs = 500,
  floorMaxMs = 800,
): Promise<T> {
  const [result] = await Promise.all([work(), sleep(jitterMs(floorMinMs, floorMaxMs))])
  return result
}
