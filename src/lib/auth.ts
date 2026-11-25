import NextAuth, { CredentialsSignin } from "next-auth"
import Credentials from "next-auth/providers/credentials"
import bcrypt from "bcryptjs"
import { prisma } from "./prisma"
import { authConfig } from "./auth.config"
import { refreshSessionToken } from "./session-policy"
import { getClientIp, loginAttemptAllowed, recordLoginFailure } from "./rate-limit"
import { normalizePhone } from "./utils"
// Hash bcrypt válido (cost 10) para igualar tiempos cuando la cuenta no existe
// o no tiene contraseña configurada y evitar enumeración por timing.
export const DUMMY_BCRYPT_HASH = "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy"

/**
 * Empresa suspendida (Business.isActive=false): las credenciales son válidas
 * pero el tenant está dado de baja. El `code` viaja al login como
 * ?code=empresa_suspendida para mostrar un mensaje claro.
 */
class BusinessSuspendedError extends CredentialsSignin {
  code = "empresa_suspendida"
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  callbacks: {
    ...authConfig.callbacks,
    async jwt({ token, user }) {
      const id = user?.id ?? token.id
      if (!id) return null
      const current = await prisma.user.findUnique({
        where: { id },
        include: { business: { select: { isActive: true } } },
      })
      return refreshSessionToken(token, current, !!user)
    },
  },
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        identifier: { label: "Email o Teléfono", type: "text" },
        password: { label: "Password", type: "password" }
      },
      async authorize(credentials, request) {
        if (typeof credentials?.identifier !== "string" || typeof credentials?.password !== "string" || !credentials.identifier.trim() || credentials.identifier.length > 254 || credentials.password.length > 1024) {
          throw new Error("Credenciales inválidas")
        }

        const identifier = credentials.identifier.trim()
        const phoneNorm = !identifier.includes("@") ? normalizePhone(identifier) : ""
        const rateKey = (phoneNorm || identifier).toLowerCase()

        // Anti lockout-DoS: el contador de fallos vive por par (IP, cuenta)
        // — ver loginAttemptAllowed en rate-limit.ts. Un atacante que fuerza
        // fallos contra una cuenta ajena solo llena SU bucket (comparte IP
        // consigo, no con la víctima); el techo por cuenta, más alto, frena
        // el stuffing distribuido. Backoff exponencial: insistir sobre el
        // par bloqueado rearma su ventana ×2 por ciclo (15 min → 4 h máx).
        // Un cliente sin IP confiable (LAN sin el secreto de proxy) comparte
        // el bucket "direct-clients": apretado pero acotado.
        const ip = getClientIp(request)
        // Account limit cannot be bypassed by a forged proxy header or encoded form field.
        // Solo los fallos incrementan el contador: un login legítimo no quema intentos.
        if (!loginAttemptAllowed(ip, rateKey)) return null

        // Try to find user by email or phone (con su empresa para el chequeo de suspensión)
        const user = await prisma.user.findFirst({
          where: {
            OR: [
              { email: identifier },
              { phone: identifier },
              ...(phoneNorm && phoneNorm !== identifier ? [{ phone: phoneNorm }] : []),
            ]
          },
          include: { business: { select: { isActive: true } } }
        })

        // Cuando la cuenta no existe o no tiene contraseña (alta por bot), se
        // corre bcrypt contra un hash dummy para no revelar existencia por timing.
        if (!user || !user.password) {
          await bcrypt.compare(credentials.password as string, DUMMY_BCRYPT_HASH)
          recordLoginFailure(ip, rateKey)
          return null
        }

        const passwordMatch = await bcrypt.compare(
          credentials.password as string,
          user.password
        )

        if (!passwordMatch) {
          recordLoginFailure(ip, rateKey)
          return null
        }

        if (user.status === "REJECTED") {
          return null
        }

        // Empresa suspendida: sus usuarios no pueden iniciar sesión. El
        // superadmin de plataforma sí entra (opera la consola Reficio).
        if (user.business?.isActive === false && !user.isSuperAdmin) {
          throw new BusinessSuspendedError()
        }

        return {
          id: user.id,
          email: user.email || user.phone || "",
          name: user.name,
          role: user.role,
          customerType: user.customerType,
          status: user.status,
          businessId: user.businessId,
          isSuperAdmin: user.isSuperAdmin,
          allowedModules: user.allowedModules,
          allowedBranchIds: user.allowedBranchIds,
        }
      }
    })
  ],
})
