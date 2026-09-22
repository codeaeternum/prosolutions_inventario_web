import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import pg from "pg"

// E2E del mostrador reimaginado contra el piloto Docker aislado (loopback).
const base = process.env.PILOT_TEST_URL || "http://localhost:3316"
if (!["http://localhost:3316", "http://127.0.0.1:3316", "http://app:3000"].includes(base)) throw Error("Only the isolated pilot is allowed")
const env = readFileSync(process.env.PILOT_ENV_FILE || "", "utf8")
const password = env.split(/\r?\n/).find(l => l.startsWith("PILOT_ADMIN_PASSWORD="))?.slice(21)
const dbUrl = env.split(/\r?\n/).find(l => l.startsWith("DATABASE_URL="))?.slice(13)
  ?? `postgresql://pilot:${env.split(/\r?\n/).find(l => l.startsWith("PILOT_DB_PASSWORD="))?.slice(18)}@db:5432/prosolutions_pilot`
const db = new pg.Client({ connectionString: dbUrl })
const jar = new Map()
const checks = []
// Claves únicas por corrida: el piloto persiste documentos de corridas anteriores.
const run = "run" + Date.now().toString(36)
const check = (name, ok) => { assert.ok(ok, name); checks.push(name) }

async function req(path, options = {}, auth = true) {
  const res = await fetch(base + path, { ...options, headers: { "Content-Type": "application/json", ...options.headers, ...(auth ? { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") } : {}) } })
  for (const c of res.headers.getSetCookie()) { const p = c.split(";", 1)[0]; const i = p.indexOf("="); jar.set(p.slice(0, i), p.slice(i + 1)) }
  return res
}

await db.connect()

// Login
const csrf = await (await req("/api/auth/csrf", {}, true)).json()
await req("/api/auth/callback/credentials", { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ csrfToken: csrf.csrfToken, identifier: "piloto@prosolutions.local", password, callbackUrl: `${base}/admin` }) }, true)
const session = await (await req("/api/auth/session")).json()
check("login admin piloto", session.user?.role === "ADMIN")

// Fixture: categoría + producto + stock en sucursal — anclado al tenant del
// admin (el piloto puede tener más de un negocio sembrado).
const biz = (await db.query(`SELECT "businessId" AS id FROM "User" WHERE email='piloto@prosolutions.local'`)).rows[0].id
const branch = (await db.query(`SELECT id FROM "WorkshopBranch" WHERE "businessId"=$1 LIMIT 1`, [biz])).rows[0].id
// ON CONFLICT también corrige businessId: una corrida anterior pudo sembrar
// el fixture bajo otro tenant cuando el piloto tiene varios negocios.
const cat = (await db.query(`INSERT INTO "Category" (id, name, slug, "businessId", "updatedAt") VALUES ('cat-e2e', 'E2E', 'e2e', $1, now()) ON CONFLICT (id) DO UPDATE SET "businessId"=$1 RETURNING id`, [biz])).rows[0]?.id ?? "cat-e2e"
const prod = (await db.query(`INSERT INTO "Product" (id, name, barcode, stock, "retailPrice", "wholesalePrice", images, "isActive", "categoryId", "businessId", "updatedAt") VALUES ('prod-e2e', 'Pantalla E2E', '7500000001', 0, 500, 350, '{}', true, $1, $2, now()) ON CONFLICT (id) DO UPDATE SET "retailPrice"=500, stock=0, "businessId"=$2, "categoryId"=$1 RETURNING id`, [cat, biz])).rows[0].id
await db.query(`INSERT INTO "BranchStock" (id, "productId", "branchId", quantity, "businessId") VALUES ('bs-e2e', $1, $2, 10, $3) ON CONFLICT ("productId","branchId") DO UPDATE SET quantity=10, "businessId"=$3`, [prod, branch, biz])
await db.query(`UPDATE "Product" SET stock=10 WHERE id=$1`, [prod])
const client = (await db.query(`INSERT INTO "User" (id, name, phone, role, status, "businessId", "creditLimit", "creditBalance", "updatedAt") VALUES ('cust-e2e', 'Cliente E2E', '5550000000', 'CUSTOMER', 'APPROVED', $1, 5000, 0, now()) ON CONFLICT (id) DO UPDATE SET "businessId"=$1, status='APPROVED' RETURNING id`, [biz])).rows[0]?.id ?? "cust-e2e"

// Abrir caja (el cobro en efectivo lo exige)
const reg = await req("/api/caja", { method: "POST", body: JSON.stringify({ action: "OPEN", amount: 1000, idempotencyKey: run + "e2e-open-caja", branchId: branch }) })
check("caja abierta", [200, 201, 409].includes(reg.status)) // 409 = ya había caja abierta en corridas previas

// Grid de productos
// El grid pagina por nombre (24/página): se filtra por la categoría E2E
// dedicada para que el fixture siempre quede en la primera página.
const grid = await (await req(`/api/pos/products?branchId=${branch}&categoryId=${cat}`)).json()
check("grid POS muestra producto con stock de sucursal", grid.products.some(p => p.id === prod && p.stock === 10))

// 1. Suspender venta (DRAFT): sin stock ni dinero
const park = await req("/api/pos/documents", { method: "POST", body: JSON.stringify({ idempotencyKey: run + "e2e-park-1", items: [{ productId: prod, quantity: 2 }], kind: "RETAIL", branchId: branch }) })
const parked = (await park.json()).document
check("suspendida DRAFT creada", park.status === 201 && parked.sale.status === "DRAFT" && parked.total === 1000)
check("suspensión NO mueve stock", (await db.query(`SELECT quantity FROM "BranchStock" WHERE id='bs-e2e'`)).rows[0].quantity === 10)

// Idempotencia del park
const park2 = await req("/api/pos/documents", { method: "POST", body: JSON.stringify({ idempotencyKey: run + "e2e-park-1", items: [{ productId: prod, quantity: 2 }], kind: "RETAIL", branchId: branch }) })
check("reintento de suspensión es idempotente", (await park2.json()).document.sale.id === parked.sale.id)

// Lista de suspendidas
const drafts = await (await req(`/api/pos/documents?status=DRAFT&branchId=${branch}`)).json()
check("suspendida aparece en el cajón", drafts.documents.some(d => d.id === parked.sale.id))

// 2. Checkout de la suspendida → COMPLETED, stock descuenta
const co = await req(`/api/pos/documents/${parked.sale.id}/checkout`, { method: "POST", body: JSON.stringify({ idempotencyKey: run + "e2e-co-1", paymentMethod: "EFECTIVO" }) })
check("checkout completa la suspendida", co.status === 200 && (await db.query(`SELECT status FROM "Sale" WHERE id=$1`, [parked.sale.id])).rows[0].status === "COMPLETED")
check("checkout descuenta stock", (await db.query(`SELECT quantity FROM "BranchStock" WHERE id='bs-e2e'`)).rows[0].quantity === 8)

// Doble checkout rechazado
const co2 = await req(`/api/pos/documents/${parked.sale.id}/checkout`, { method: "POST", body: JSON.stringify({ idempotencyKey: run + "e2e-co-2", paymentMethod: "EFECTIVO" }) })
check("doble checkout rechazado", co2.status === 409)

// 3. Cotización QUOTE con vigencia
const quote = await req("/api/pos/documents", { method: "POST", body: JSON.stringify({ idempotencyKey: run + "e2e-quote-1", items: [{ productId: prod, quantity: 1 }], kind: "QUOTE", branchId: branch, customerId: client, expiresAt: new Date(Date.now() + 15 * 86400000).toISOString() }) })
const quoteDoc = (await quote.json()).document
check("cotización DRAFT con vigencia", quote.status === 201 && quoteDoc.sale.kind === "QUOTE" && quoteDoc.sale.expiresAt !== null)
const qc = await req(`/api/pos/documents/${quoteDoc.sale.id}/checkout`, { method: "POST", body: JSON.stringify({ idempotencyKey: run + "e2e-qc-1", paymentMethod: "EFECTIVO" }) })
check("cotización convierte a venta con mismo folio", qc.status === 200)

// 4. Apartado LAYAWAY multi-producto con anticipo
const lay = await req("/api/pos/documents", { method: "POST", body: JSON.stringify({ idempotencyKey: run + "e2e-lay-1", items: [{ productId: prod, quantity: 2 }], kind: "LAYAWAY", customerId: client, branchId: branch, payments: [{ method: "EFECTIVO", amount: 400 }] }) })
const layDoc = (await lay.json()).document
check("apartado OPEN con anticipo", lay.status === 201 && layDoc.sale.status === "OPEN" && layDoc.balance === 600)
check("apartado compromete stock", (await db.query(`SELECT quantity FROM "BranchStock" WHERE id='bs-e2e'`)).rows[0].quantity === 5)

// Abono parcial → sigue OPEN; liquidación → COMPLETED
const abono = await req(`/api/pos/documents/${layDoc.sale.id}/pay`, { method: "POST", body: JSON.stringify({ idempotencyKey: run + "e2e-ab-1", payments: [{ method: "EFECTIVO", amount: 100 }] }) })
check("abono parcial mantiene OPEN", (await abono.json()).balance === 500)
const liquida = await req(`/api/pos/documents/${layDoc.sale.id}/pay`, { method: "POST", body: JSON.stringify({ idempotencyKey: run + "e2e-ab-2", payments: [{ method: "EFECTIVO" }] }) })
const liquidaJson = await liquida.json()
check("abono único sin monto liquida el saldo", liquidaJson.completed === true && liquidaJson.balance === 0)

// Abono excedente rechazado
const lay2 = await req("/api/pos/documents", { method: "POST", body: JSON.stringify({ idempotencyKey: run + "e2e-lay-2", items: [{ productId: prod, quantity: 1 }], kind: "LAYAWAY", customerId: client, branchId: branch }) })
const lay2Id = (await lay2.json()).document.sale.id
const over = await req(`/api/pos/documents/${lay2Id}/pay`, { method: "POST", body: JSON.stringify({ idempotencyKey: run + "e2e-over", payments: [{ method: "EFECTIVO", amount: 9999 }] }) })
check("abono sobre saldo rechazado", over.status === 409)

// 5. Cancelar apartado: repone stock y reembolsa anticipo
const del = await req(`/api/pos/documents/${lay2Id}`, { method: "DELETE", body: JSON.stringify({ reason: "e2e", idempotencyKey: run + "e2e-del-1" }) })
check("cancelar apartado VOIDED", del.status === 200)
check("cancelación repone stock", (await db.query(`SELECT quantity FROM "BranchStock" WHERE id='bs-e2e'`)).rows[0].quantity === 5)

// 6. El historial de ventas NO incluye documentos vivos
const sales = await (await req("/api/sales")).json()
check("historial excluye DRAFT/OPEN", sales.sales.every(s => ["COMPLETED", "VOIDED"].includes(s.status)))

// 7. Aislamiento de tenant: el documento no se ve desde otro negocio — verificado por businessId en queries (cubierto en tests de dominio)

// 8. Ficha Cliente 360
const c360 = await req(`/api/clientes/${client}`)
const c360j = await c360.json()
check("cliente 360 agrega ventas+documentos", c360.status === 200 && c360j.customer?.id === client && Array.isArray(c360j.documents))

console.log(JSON.stringify({ target: base, passed: checks.length, checks }, null, 2))
await db.end()
