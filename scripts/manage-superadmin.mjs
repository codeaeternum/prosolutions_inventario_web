#!/usr/bin/env node
/**
 * Gestor CLI de cuentas de Operador Superadmin de Reficio (/platform).
 *
 * Permite separar la cuenta de operador de plataforma (tuya) de la cuenta
 * de administrador del negocio de tu amigo (ej. admin@prosolutions.com):
 *
 *   1. Listar superadmins actuales:
 *      npm run platform:superadmin -- --list
 *
 *   2. Crear tu propia cuenta dedicada de Superadmin (en su propio negocio
 *      operador "Reficio HQ", oculto del directorio público):
 *      npm run platform:superadmin -- --create tu@correo.com TuPasswordSegura "Tu Nombre"
 *
 *   3. Otorgar superadmin a una cuenta existente:
 *      npm run platform:superadmin -- --grant tu@correo.com
 *
 *   4. Quitar superadmin a la cuenta de tu amigo (conserva su rol ADMIN
 *      dentro de su propio negocio, pero ya no entra a /platform):
 *      npm run platform:superadmin -- --revoke admin@prosolutions.com
 */

import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const { Pool } = require("pg")
const bcrypt = require("bcryptjs")

const args = process.argv.slice(2)
const command = args[0]

function usage() {
  console.log(`
Uso:
  npm run platform:superadmin -- --list
  npm run platform:superadmin -- --create <email> <password> [nombre]
  npm run platform:superadmin -- --grant <email>
  npm run platform:superadmin -- --revoke <email>
`)
}

async function run() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    console.error("ERROR: DATABASE_URL no está definida en el entorno (.env).")
    process.exit(1)
  }

  const pool = new Pool({ connectionString })
  const client = await pool.connect()

  try {
    if (!command || command === "--help" || command === "-h") {
      usage()
      return
    }

    if (command === "--list") {
      const res = await client.query(`
        SELECT u.id, u.name, u.email, u.role, u.status, u."isSuperAdmin", b.name AS "businessName", b.slug AS "businessSlug"
        FROM "User" u
        JOIN "Business" b ON b.id = u."businessId"
        WHERE u."isSuperAdmin" = true OR u.role = 'ADMIN'
        ORDER BY u."isSuperAdmin" DESC, u."createdAt" ASC
      `)
      console.table(res.rows)
      return
    }

    if (command === "--grant" || command === "--revoke") {
      const email = (args[1] || "").trim().toLowerCase()
      if (!email) {
        console.error(`ERROR: Indica el correo. Ejemplo: npm run platform:superadmin -- ${command} usuario@correo.com`)
        process.exit(1)
      }
      const nextValue = command === "--grant"
      const res = await client.query(
        `UPDATE "User" SET "isSuperAdmin" = $1, "updatedAt" = NOW() WHERE LOWER(email) = $2 RETURNING id, name, email, role, "isSuperAdmin", "businessId"`,
        [nextValue, email]
      )
      if (res.rowCount === 0) {
        console.error(`No se encontró ningún usuario con el correo "${email}".`)
        process.exit(1)
      }
      const u = res.rows[0]
      console.log(
        nextValue
          ? `OK: "${u.name}" (${u.email}) ahora es Superadmin de plataforma (/platform).`
          : `OK: "${u.name}" (${u.email}) ya NO es Superadmin de plataforma (conserva su rol ${u.role} en su negocio).`
      )
      return
    }

    if (command === "--create") {
      const email = (args[1] || "").trim().toLowerCase()
      const password = args[2] || ""
      const name = (args[3] || "Operador Reficio").trim()

      if (!email || !email.includes("@") || password.length < 8) {
        console.error("ERROR: Debes indicar un correo válido y una contraseña de al menos 8 caracteres.")
        console.error('Ejemplo: npm run platform:superadmin -- --create admin@reficio.app MiClave1234 "Daniel Galindo"')
        process.exit(1)
      }

      await client.query("BEGIN")
      // Asegurar negocio operador "Reficio HQ" oculto del directorio público
      let bizRes = await client.query(`SELECT id FROM "Business" WHERE slug = 'reficio-hq' LIMIT 1`)
      let bizId = bizRes.rows[0]?.id
      if (!bizId) {
        bizId = "biz-reficio-hq"
        await client.query(
          `INSERT INTO "Business" (id, name, slug, category, "businessKind", "isActive", "showInDirectory", "createdAt", "updatedAt")
           VALUES ($1, 'Reficio HQ', 'reficio-hq', 'electronics-repair', 'FULL', true, false, NOW(), NOW())
           ON CONFLICT (id) DO NOTHING`,
          [bizId]
        )
        await client.query(
          `INSERT INTO "WorkshopBranch" (id, "businessId", name, "isActive", "createdAt")
           VALUES ('branch-reficio-hq', $1, 'Operación Plataforma', true, NOW())
           ON CONFLICT (id) DO NOTHING`,
          [bizId]
        )
      }

      const hash = await bcrypt.hash(password, 12)
      const existing = await client.query(`SELECT id FROM "User" WHERE LOWER(email) = $1 LIMIT 1`, [email])
      if (existing.rowCount > 0) {
        await client.query(
          `UPDATE "User"
           SET password = $1, name = $2, role = 'ADMIN', status = 'APPROVED', "isSuperAdmin" = true, "updatedAt" = NOW()
           WHERE id = $3`,
          [hash, name, existing.rows[0].id]
        )
        console.log(`OK: Cuenta existente ${email} actualizada con nueva contraseña y permisos de Superadmin.`)
      } else {
        const userId = `op-${Date.now().toString(36)}`
        await client.query(
          `INSERT INTO "User" (id, "businessId", email, password, name, role, status, "customerType", "isSuperAdmin", "emailVerifiedAt", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, 'ADMIN', 'APPROVED', 'NORMAL', true, NOW(), NOW(), NOW())`,
          [userId, bizId, email, hash, name]
        )
        console.log(`OK: Cuenta dedicada de Superadmin creada: ${email} (Negocio operador: Reficio HQ).`)
      }
      await client.query("COMMIT")
      return
    }

    usage()
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {})
    console.error("ERROR:", err.message || err)
    process.exit(1)
  } finally {
    client.release()
    await pool.end().catch(() => {})
  }
}

run()
