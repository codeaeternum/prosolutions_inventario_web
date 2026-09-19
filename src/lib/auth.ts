import NextAuth, { CredentialsSignin } from "next-auth"
import Credentials from "next-auth/providers/credentials"
import bcrypt from "bcryptjs"
import { prisma } from "./prisma"
import { authConfig } from "./auth.config"
import { refreshSessionToken } from "./session-policy"
import { checkAndRecord } from "./rate-limit"

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
      async authorize(credentials) {
        if (typeof credentials?.identifier !== "string" || typeof credentials?.password !== "string" || !credentials.identifier.trim() || credentials.identifier.length > 254 || credentials.password.length > 1024) {
          throw new Error("Credenciales inválidas")
        }

        const identifier = credentials.identifier.trim()
        // Account limit cannot be bypassed by a forged proxy header or encoded form field.
        if (!checkAndRecord("login-account", identifier.toLowerCase(), 15 * 60 * 1000, 10)) return null

        // Try to find user by email or phone (con su empresa para el chequeo de suspensión)
        const user = await prisma.user.findFirst({
          where: {
            OR: [
              { email: identifier },
              { phone: identifier }
            ]
          },
          include: { business: { select: { isActive: true } } }
        })

        if (!user) {
          return null
        }

        // Bot-registered users may not have a password
        if (!user.password) {
          return null
        }

        const passwordMatch = await bcrypt.compare(
          credentials.password as string,
          user.password
        )

        if (!passwordMatch) {
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
