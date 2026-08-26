// Tests for scripts/sdd-specs.ts — canonical SDD specs (new/sync/archive).
// Runs the real script against a temp specs dir; contracts come from the repo.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { after, describe, test } from 'node:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SCRIPT = join(import.meta.dirname, 'sdd-specs.ts')
const CONTRACTS = join(import.meta.dirname, '..', 'contracts')

const tempDirs: string[] = []
const makeWs = (): string => {
  const ws = mkdtempSync(join(tmpdir(), 'dsh-specs-'))
  tempDirs.push(ws)
  return ws
}
// Higiene: ninguna fixture sobrevive a la suite (el TMPDIR queda limpio).
after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
})

const run = (ws: string, args: string[]) =>
  spawnSync(process.execPath, [SCRIPT, ...args, '--specs-dir', ws], { cwd: ws, encoding: 'utf8' })

describe('sdd-specs.ts', () => {
  test('new scaffolds one section per contract stage with valid front matter', () => {
    const ws = makeWs()
    const r = run(ws, ['new', '--workflow', 'mini-sdd', '--mission', 'feat-x'])
    assert.equal(r.status, 0, r.stderr)
    const body = readFileSync(join(ws, 'feat-x', 'spec.md'), 'utf8')
    assert.match(body, /^mission: feat-x$/m)
    assert.match(body, /^workflow: mini-sdd$/m)
    for (const heading of ['Propuesta breve', 'Confirmación', 'Verificación independiente']) {
      assert.match(body, new RegExp(`^## ${heading}$`, 'm'))
    }
  })

  test('sync passes on a fresh spec and fails when a contract section is removed', () => {
    const ws = makeWs()
    assert.equal(run(ws, ['new', '--workflow', 'full-sdd', '--mission', 'big-y']).status, 0)
    assert.equal(run(ws, ['sync', '--mission', 'big-y']).status, 0)

    const p = join(ws, 'big-y', 'spec.md')
    // elimina la PRIMERA etapa contractual del full-sdd ('explore — explorer')
    writeFileSync(p, readFileSync(p, 'utf8').replace(/^## explore — explorer\n[\s\S]*?(?=^## )/m, '\n'))
    const r = run(ws, ['sync', '--mission', 'big-y'])
    assert.equal(r.status, 1)
    assert.match(r.stderr, /explore/)
  })

  test('a mission directory without spec.md is skipped loudly, never crashes', () => {
    const ws = makeWs()
    mkdirSync(join(ws, 'ghost'), { recursive: true }) // dir sin spec.md
    const st = run(ws, ['status'])
    assert.equal(st.status, 0)
    assert.match(st.stdout, /SIN spec\.md/)
    const r = run(ws, ['archive', '--mission', 'ghost'])
    assert.equal(r.status, 1)
    assert.match(r.stderr, /nada que archivar/)
    assert.ok(!existsSync(join(ws, '_archive')), 'no se crea _archive sin archivar nada')
  })

  test('archive with a corrupt index fails BEFORE mutating the specs tree', () => {
    const ws = makeWs()
    run(ws, ['new', '--workflow', 'direct', '--mission', 'keep-me'])
    mkdirSync(join(ws, '_archive'), { recursive: true })
    writeFileSync(join(ws, '_archive', 'index.json'), '{ corrupt')
    const before = readFileSync(join(ws, 'keep-me', 'spec.md'), 'utf8')
    const r = run(ws, ['archive', '--mission', 'keep-me'])
    assert.equal(r.status, 1)
    assert.match(r.stderr, /corrupto/)
    assert.ok(existsSync(join(ws, 'keep-me', 'spec.md')), 'la misión NO se movió con índice roto')
    assert.equal(readFileSync(join(ws, 'keep-me', 'spec.md'), 'utf8'), before)
  })

  test('archive refuses an invalid spec and archives a valid one with sha256 index', () => {    const ws = makeWs()
    // invalid first: remove a section → archive must refuse
    run(ws, ['new', '--workflow', 'direct', '--mission', 'hot-z'])
    const p = join(ws, 'hot-z', 'spec.md')
    writeFileSync(p, readFileSync(p, 'utf8').replace(/^## Summarize\n[\s\S]*$/m, ''))
    const refused = run(ws, ['archive', '--mission', 'hot-z'])
    assert.equal(refused.status, 1)
    assert.ok(existsSync(p), 'la spec inválida NO se mueve')

    // repair via new --force, then archive succeeds and indexes the sha256
    assert.equal(run(ws, ['new', '--workflow', 'direct', '--mission', 'hot-z', '--force']).status, 0)
    const ok = run(ws, ['archive', '--mission', 'hot-z'])
    assert.equal(ok.status, 0, ok.stderr)
    assert.match(ok.stdout, /sha256 [0-9a-f]{12}…/)
    assert.ok(!existsSync(join(ws, 'hot-z')), 'el directorio vivo se movió')
    assert.ok(existsSync(join(ws, '_archive', 'index.json')))
    const index = JSON.parse(readFileSync(join(ws, '_archive', 'index.json'), 'utf8')) as Array<{ mission: string; specSha256: string }>
    const first = index[0]
    assert.ok(first !== undefined)
    assert.equal(first.mission, 'hot-z')
    assert.match(first.specSha256, /^[0-9a-f]{64}$/)
  })

  test('new refuses duplicates without --force and rejects path-traversal missions', () => {
    const ws = makeWs()
    assert.equal(run(ws, ['new', '--workflow', 'mini-sdd', '--mission', 'dup']).status, 0)
    const dup = run(ws, ['new', '--workflow', 'mini-sdd', '--mission', 'dup'])
    assert.equal(dup.status, 2)
    assert.match(dup.stderr, /--force/)
    const evil = run(ws, ['new', '--workflow', 'mini-sdd', '--mission', '../escape'])
    assert.equal(evil.status, 2)
    assert.match(evil.stderr, /A-Za-z0-9/)
    assert.ok(!existsSync(join(ws, 'escape')))
  })
})
