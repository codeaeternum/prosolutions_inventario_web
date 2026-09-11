#!/usr/bin/env node
import { promises as fs, constants } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'

async function sha(file) { return createHash('sha256').update(await fs.readFile(file)).digest('hex') }
/** Run once with app and bot stopped. URLs/database rows are intentionally unchanged. */
export async function migratePrivateProofs({ legacyDirectory, privateDirectory, apply = false }) {
  const legacy = path.resolve(legacyDirectory)
  const target = path.resolve(privateDirectory)
  if (legacy === target || target.startsWith(`${legacy}${path.sep}`)) throw new Error('Private directory must be outside the public payment directory')
  let names
  try { names = await fs.readdir(legacy) } catch (error) { if (error.code === 'ENOENT') return { mode: apply ? 'apply' : 'dry-run', files: 0, moved: 0 }; throw error }
  const plans = []
  // Preflight every file before deleting or copying any: unexpected files and collisions stop the job.
  for (const name of names) {
    if (!/^[a-zA-Z0-9_-]+\.(?:jpe?g|png|webp|gif)$/.test(name)) throw new Error('Unexpected entry in legacy payment directory')
    const source = path.join(legacy, name); const destination = path.join(target, name)
    if (!(await fs.lstat(source)).isFile()) throw new Error('Legacy entry must be a regular file')
    const sourceSha = await sha(source)
    try {
      if (!(await fs.lstat(destination)).isFile() || await sha(destination) !== sourceSha) throw new Error('Private file collision; migration stopped without overwriting')
    } catch (error) { if (error.code !== 'ENOENT') throw error }
    plans.push({ source, destination, sourceSha })
  }
  if (!apply) return { mode: 'dry-run', files: plans.length, moved: 0 }
  await fs.mkdir(target, { recursive: true, mode: 0o700 })
  if ((await fs.lstat(target)).isSymbolicLink()) throw new Error('Private directory must not be a symlink')
  const lockPath = path.join(target, '.migration.lock')
  const lock = await fs.open(lockPath, 'wx', 0o600)
  let moved = 0
  try {
    for (const item of plans) {
      try { await fs.copyFile(item.source, item.destination, constants.COPYFILE_EXCL) } catch (error) { if (error.code !== 'EEXIST') throw error }
      if (!(await fs.lstat(item.destination)).isFile() || await sha(item.destination) !== item.sourceSha || await sha(item.source) !== item.sourceSha) throw new Error('Verification failed; original retained')
      await fs.chmod(item.destination, 0o600)
      // Flush the copied file before removing its legacy name.
      const file = await fs.open(item.destination, 'r'); try { await file.sync() } finally { await file.close() }
      await fs.unlink(item.source)
      moved++
    }
    return { mode: 'apply', files: plans.length, moved }
  } finally { await lock.close(); await fs.unlink(lockPath) }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const result = await migratePrivateProofs({
      legacyDirectory: process.env.LEGACY_PAYMENT_PROOFS_DIR || path.join(process.cwd(), 'public', 'uploads', 'payments'),
      privateDirectory: process.env.PAYMENT_PROOFS_DIR || path.join(process.cwd(), 'storage', 'payment-proofs'),
      apply: process.argv.includes('--apply'),
    })
    console.log(JSON.stringify(result))
  } catch (error) {
    console.error(`Payment proof migration failed: ${error.message}`)
    process.exitCode = 1
  }
}
