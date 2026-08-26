// sdd-gate.test.ts — orden estricto de etapas y verificación de misión completa.
// Cada test corre en un cwd temporal: el estado vive en <tmp>/.evidence/.

import { spawnSync } from 'node:child_process'
import { ok, strictEqual } from 'node:assert'
import { after, before, test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const script = join(import.meta.dirname, 'sdd-gate.ts')
let workdir = ''

before(() => {
  workdir = mkdtempSync(join(tmpdir(), 'sdd-gate-'))
})
after(() => {
  rmSync(workdir, { recursive: true, force: true })
})

const gate = (args: string[]) =>
  spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', cwd: workdir })

test('start crea estado con las etapas del contrato', () => {
  const r = gate(['start', '--workflow', 'mini-sdd', '--mission', 'feat-t1'])
  strictEqual(r.status, 0, r.stderr)
  ok(/5 etapas/.test(r.stdout), r.stdout)
})

test('advance rechaza saltarse la primera etapa', () => {
  const r = gate(['advance', '--mission', 'feat-t1', '--stage', 'implementacion', '--note', 'x'])
  strictEqual(r.status, 1)
  ok(/GATE VIOLADO/.test(r.stderr), r.stderr)
})

test('avance en orden completo llega a misión completa', () => {
  const stages = ['propuesta', 'confirmacion', 'implementacion', 'verificacion-independiente', 'resumen-evidencia']
  for (const s of stages) {
    const r = gate(['advance', '--mission', 'feat-t1', '--stage', s, '--note', `nota ${s}`])
    strictEqual(r.status, 0, `${s}: ${r.stderr}`)
  }
  const v = gate(['verify', '--mission', 'feat-t1'])
  strictEqual(v.status, 0)
})

test('verify falla si faltan etapas', () => {
  gate(['start', '--workflow', 'direct', '--mission', 'fix-t2'])
  const v = gate(['verify', '--mission', 'fix-t2'])
  strictEqual(v.status, 1)
  ok(/faltan/.test(v.stderr), v.stderr)
})

test('workflow inexistente → error limpio', () => {
  const r = gate(['start', '--workflow', 'no-existe', '--mission', 'x'])
  strictEqual(r.status, 1)
  ok(/Contrato inexistente|No hay estado/.test(r.stderr), r.stderr)
})
