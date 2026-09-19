import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto"

// Cifrado en reposo del dato de desbloqueo del equipo (PIN / patrón /
// contraseña que el cliente deja en recepción). AES-256-GCM da
// confidencialidad + etiqueta de autenticación: un texto alterado o una
// clave equivocada LANZAN al descifrar en vez de devolver basura.
//
// Formato almacenado: v1:<ivB64>:<tagB64>:<cipherB64>. Los valores sin el
// prefijo "v1:" se tratan como texto plano heredado (órdenes creadas antes
// del cifrado) y decryptAccessValue los devuelve tal cual — no hace falta
// migrar las filas viejas.
const VERSION = "v1"

/** true si el valor almacenado ya va cifrado con este esquema. */
export function isEncryptedValue(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(`${VERSION}:`)
}

/** Clave simétrica de 32 bytes: sale de DEVICE_SECRET_KEY (hex o base64,
 *  p.ej. `openssl rand -hex 32`) y como respaldo de NEXTAUTH_SECRET. Se
 *  decodifica al material binario cuando viene codificada y se deriva con
 *  sha256, así cualquier formato/entropía de origen sirve para AES-256.
 *  Se deriva en cada llamada: la rotación de env no exige reiniciar y los
 *  tests pueden cambiar la clave entre casos. */
function key(): Buffer {
  // Cadena vacía cuenta como "no definida" y cae al respaldo.
  const raw = (process.env.DEVICE_SECRET_KEY || process.env.NEXTAUTH_SECRET || "").trim()
  if (!raw) throw new Error("[device-secret] Define DEVICE_SECRET_KEY o NEXTAUTH_SECRET para cifrar el dato de desbloqueo.")
  const material = /^[0-9a-f]+$/i.test(raw) && raw.length % 2 === 0 ? Buffer.from(raw, "hex")
    : /^[A-Za-z0-9+/]+={0,2}$/.test(raw) && raw.length % 4 === 0 ? Buffer.from(raw, "base64")
    : Buffer.from(raw, "utf8")
  return createHash("sha256").update(material).digest()
}

/** Cifra un dato de desbloqueo en claro → "v1:iv:tag:cipher" (base64). */
export function encryptAccessValue(plain: string): string {
  const iv = randomBytes(12) // nonce de 96 bits, el recomendado para GCM
  const cipher = createCipheriv("aes-256-gcm", key(), iv)
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()])
  return [VERSION, iv.toString("base64"), cipher.getAuthTag().toString("base64"), encrypted.toString("base64")].join(":")
}

/** Descifra un valor "v1:". El texto plano heredado (sin prefijo) se
 *  devuelve tal cual. Un "v1:" malformado, alterado o cifrado con otra
 *  clave LANZA (la etiqueta GCM lo detecta) — quien llama decide si la
 *  ficha/hoja se sirve sin el código o se propaga el error. */
export function decryptAccessValue(stored: string): string {
  if (!isEncryptedValue(stored)) return stored
  const parts = stored.split(":")
  if (parts.length !== 4 || parts.slice(1).some(part => !part)) throw new Error("[device-secret] Valor cifrado malformado.")
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(parts[1], "base64"))
  decipher.setAuthTag(Buffer.from(parts[2], "base64"))
  return Buffer.concat([decipher.update(Buffer.from(parts[3], "base64")), decipher.final()]).toString("utf8")
}
