import { test } from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { migratePrivateProofs } from './migrate-private-proofs.mjs'

async function fixture(action) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'proof-migration-test-'))
  const legacyDirectory = path.join(directory, 'public', 'payments'); const privateDirectory = path.join(directory, 'private')
  await fs.mkdir(legacyDirectory, { recursive: true })
  try { await action({ legacyDirectory, privateDirectory }) } finally { await fs.rm(directory, { recursive: true, force: true }) }
}
test('dry run leaves bytes in place; apply verifies content and preserves name; rerun is safe', () => fixture(async options => {
  await fs.writeFile(path.join(options.legacyDirectory, 'pay_1.jpg'), 'synthetic image bytes')
  assert.equal((await migratePrivateProofs(options)).moved, 0)
  assert.equal(await fs.readFile(path.join(options.legacyDirectory, 'pay_1.jpg'), 'utf8'), 'synthetic image bytes')
  assert.equal((await migratePrivateProofs({ ...options, apply: true })).moved, 1)
  assert.equal(await fs.readFile(path.join(options.privateDirectory, 'pay_1.jpg'), 'utf8'), 'synthetic image bytes')
  assert.equal((await migratePrivateProofs({ ...options, apply: true })).moved, 0)
}))
test('different destination content aborts without modifying either file', () => fixture(async options => {
  await fs.mkdir(options.privateDirectory)
  await fs.writeFile(path.join(options.legacyDirectory, 'pay_1.jpg'), 'original')
  await fs.writeFile(path.join(options.privateDirectory, 'pay_1.jpg'), 'different')
  await assert.rejects(migratePrivateProofs({ ...options, apply: true }), /collision/)
  assert.equal(await fs.readFile(path.join(options.legacyDirectory, 'pay_1.jpg'), 'utf8'), 'original')
  assert.equal(await fs.readFile(path.join(options.privateDirectory, 'pay_1.jpg'), 'utf8'), 'different')
}))
test('matching existing destination safely resumes an interrupted copy', () => fixture(async options => {
  await fs.mkdir(options.privateDirectory)
  for (const directory of [options.legacyDirectory, options.privateDirectory]) await fs.writeFile(path.join(directory, 'pay_1.png'), 'same original')
  assert.equal((await migratePrivateProofs({ ...options, apply: true })).moved, 1)
  await assert.rejects(fs.stat(path.join(options.legacyDirectory, 'pay_1.png')), { code: 'ENOENT' })
}))
test('symlinks and unexpected entries stop before any file migration', () => fixture(async options => {
  await fs.writeFile(path.join(options.legacyDirectory, 'pay_1.png'), 'original')
  await fs.symlink('pay_1.png', path.join(options.legacyDirectory, 'link.png'))
  await assert.rejects(migratePrivateProofs({ ...options, apply: true }), /regular file/)
  assert.equal(await fs.readFile(path.join(options.legacyDirectory, 'pay_1.png'), 'utf8'), 'original')
}))
