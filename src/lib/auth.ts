import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import bcrypt from "bcryptjs"
import { prisma } from "./prisma"
import { authConfig } from "./auth.config"

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        identifier: { label: "Email o Teléfono", type: "text" },
        password: { label: "Password", type: "password" }
      },
      async authorize(credentials) {
        if (!credentials?.identifier || !credentials?.password) {
          throw new Error("Credenciales inválidas")
        }

        const identifier = credentials.identifier as string

        // Try to find user by email or phone
        let user = await prisma.user.findFirst({
          where: {
            OR: [
              { email: identifier },
              { phone: identifier }
            ]
          }
        })

        if (!user) {
          throw new Error("Usuario no encontrado")
        }

        // Bot-registered users may not have a password
        if (!user.password) {
          throw new Error("Esta cuenta fue creada vía Telegram. Por favor usa el Bot para acceder.")
        }

        const passwordMatch = await bcrypt.compare(
          credentials.password as string,
          user.password
        )

        if (!passwordMatch) {
          throw new Error("Contraseña incorrecta")
        }

        if (user.status === "REJECTED") {
          throw new Error("Tu cuenta ha sido rechazada")
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
