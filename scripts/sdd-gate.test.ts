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

test('flag desconocida → exit 2 (regresión N2)', () => {
  gate(['start', '--workflow', 'direct', '--mission', 'fix-t3'])
  const r = gate(['advance', '--mission', 'fix-t3', '--stage', 'understand', '--note', 'x', '--bogus-flag'])
  strictEqual(r.status, 2)
})

test('start repetido sin --force no resetea el progreso', () => {
  gate(['start', '--workflow', 'mini-sdd', '--mission', 'feat-t4'])
  gate(['advance', '--mission', 'feat-t4', '--stage', 'propuesta', '--note', 'n'])
  const r = gate(['start', '--workflow', 'mini-sdd', '--mission', 'feat-t4'])
  strictEqual(r.status, 1)
  ok(/ya tiene estado/.test(r.stderr), r.stderr)
  // El progreso sobrevive: la siguiente etapa esperada sigue siendo la 2ª.
  const v = gate(['advance', '--mission', 'feat-t4', '--stage', 'implementacion', '--note', 'skip'])
  strictEqual(v.status, 1)
  ok(/GATE VIOLADO/.test(v.stderr), v.stderr)
})
