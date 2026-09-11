import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import bcrypt from "bcryptjs"
import { prisma } from "./prisma"
import { authConfig } from "./auth.config"
import { refreshSessionToken } from "./session-policy"
import { checkAndRecord } from "./rate-limit"

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  callbacks: {
    ...authConfig.callbacks,
    async jwt({ token, user }) {
      const id = user?.id ?? token.id
      if (!id) return null
      const current = await prisma.user.findUnique({ where: { id } })
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

        // Try to find user by email or phone
        const user = await prisma.user.findFirst({
          where: {
            OR: [
              { email: identifier },
              { phone: identifier }
            ]
          }
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

        return {
          id: user.id,
          email: user.email || user.phone || "",
          name: user.name,
          role: user.role,
          customerType: user.customerType,
          status: user.status,
        }
      }
    })
  ],
})
