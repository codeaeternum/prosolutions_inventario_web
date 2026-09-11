import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"

// This executable only targets the dedicated, fictional Docker pilot on loopback.
const base = process.env.PILOT_TEST_URL || "http://localhost:3316"
if (!["http://localhost:3316", "http://127.0.0.1:3316"].includes(base)) throw Error("Only the isolated local pilot is allowed")
const env = readFileSync(process.env.PILOT_ENV_FILE || "", "utf8")
const password = env.split(/\r?\n/).find(line => line.startsWith("PILOT_ADMIN_PASSWORD="))?.slice(21)
if (!password) throw Error("Private pilot credential file required")
const jar = new Map()
const checks = []
function check(name, condition) { assert.ok(condition, name); checks.push({ name, status: "PASS" }) }
async function request(path, options = {}, authenticated = false) {
  const response = await fetch(base + path, { ...options, redirect: "manual", headers: { ...options.headers, ...(authenticated ? { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") } : {}) } })
  if (authenticated) for (const cookie of response.headers.getSetCookie()) { const part = cookie.split(";", 1)[0]; const i = part.indexOf("="); jar.set(part.slice(0, i), part.slice(i + 1)) }
  return response
}
function fixtureSQL(sql) {
  const result = spawnSync("docker", ["exec", "-i", "prosolutions-pilot-db-1", "psql", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-U", "pilot", "-d", "prosolutions_pilot"], { input: sql, encoding: "utf8", timeout: 15000 })
  if (result.status !== 0) throw Error("Fixture update failed")
  return result.stdout.trim()
}
const fixtureCount = fixtureSQL(`SELECT count(*) FROM "User" WHERE email='piloto@prosolutions.local' AND name='Dueño · Demo';`)
assert.equal(fixtureCount, "1", "Dedicated pilot account must exist")
try {
  check("health requires installed schema", (await request("/api/health")).status === 200)
  const publicProducts = await request("/api/products?limit=1")
  check("catalog is anonymous and uncached", publicProducts.status === 200 && publicProducts.headers.get("cache-control").includes("no-store"))
  check("catalog page is public", (await request("/catalogo")).status === 200)
  for (const path of ["/api/workshop", "/api/users", "/api/reports", "/api/fix-catalog"]) check(`anonymous blocked: ${path}`, [401, 403].includes((await request(path)).status))
  check("anonymous write to maintenance blocked", [401, 403].includes((await request("/api/fix-catalog", { method: "POST" })).status))
  check("legacy proof file blocked before static handler", (await request("/uploads/payments/nonexistent.png")).status === 401)
  check("image optimizer cannot proxy private proof", (await request("/_next/image?url=%2Fuploads%2Fpayments%2Fnonexistent.png&w=64&q=75")).status === 403)
  const csrf = await (await request("/api/auth/csrf", {}, true)).json()
  await request("/api/auth/callback/credentials", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Auth-Return-Redirect": "1" }, body: new URLSearchParams({ csrfToken: csrf.csrfToken, identifier: "piloto@prosolutions.local", password, callbackUrl: `${base}/admin/taller` }) }, true)
  const session = await (await request("/api/auth/session", {}, true)).json()
  check("actual credentials login produces approved admin session", session.user?.role === "ADMIN" && session.user.status === "APPROVED")
  const list = await (await request("/api/workshop", {}, true)).json()
  check("authenticated pilot exposes two branches and six fictional cases", list.branches?.length === 2 && list.orders?.length === 6)
  check("workshop page renders in production", (await request("/admin/taller", {}, true)).status === 200)
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l1cAAAAASUVORK5CYII=", "base64")
  const form = new FormData(); form.set("file", new File([png], "fixture.png", { type: "image/png" }))
  const uploaded = await request("/api/payment-proofs", { method: "POST", body: form }, true)
  check("private multipart upload works in production image", uploaded.status === 201)
  const { url } = await uploaded.json()
  check("anonymous cannot read new proof", (await request(url)).status === 401)
  const proof = await request(url, {}, true)
  check("owner reads exact bytes without caching", proof.status === 200 && proof.headers.get("cache-control").includes("no-store") && Buffer.from(await proof.arrayBuffer()).equals(png))
  fixtureSQL(`UPDATE "User" SET role='EMPLOYEE' WHERE email='piloto@prosolutions.local';`)
  check("existing cookie immediately loses admin privileges", (await request("/api/workshop", {}, true)).status === 403)
  fixtureSQL(`UPDATE "User" SET status='REJECTED' WHERE email='piloto@prosolutions.local';`)
  check("existing cookie cannot upload after rejection", [401, 403].includes((await request("/api/payment-proofs", { method: "POST", body: form }, true)).status))
  fixtureSQL(`UPDATE "User" SET role='ADMIN', status='APPROVED' WHERE email='piloto@prosolutions.local';`)
  console.log(JSON.stringify({ target: base, environment: "fictional pilot only", checks }, null, 2))
} finally {
  fixtureSQL(`UPDATE "User" SET role='ADMIN', status='APPROVED' WHERE email='piloto@prosolutions.local';`)
}
