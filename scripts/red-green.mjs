#!/usr/bin/env node
// red-green.mjs — evidencia observable de un ciclo RED→GREEN de TDD.
//
// El ciclo se registra en DOS fases con una ventana de edición real entre
// ellas (el agente corrige el código entre ambos comandos):
//
//   node scripts/red-green.mjs record-red  -- <comando de test [args…]>
//   ...editar código...
//   node scripts/red-green.mjs record-green -- <comando de test [args…]>
//
// record-red exige fallo (exit ≠ 0) y deja el ciclo pendiente en
// .evidence/red-green.pending.json. record-green exige pase (exit = 0),
// valida el par y escribe .evidence/red-green-<ts>.json definitivo.
// Exit code 0 solo en un ciclo RED→GREEN completo y válido.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const USAGE =
  'Uso:\n' +
  '  node scripts/red-green.mjs record-red   -- <comando de test [args…]>\n' +
  '  node scripts/red-green.mjs record-green -- <comando de test [args…]>\n'

const sep = process.argv.indexOf('--')
const phase = process.argv[2]
if (!phase || !['record-red', 'record-green'].includes(phase) || sep === -1 || sep + 1 >= process.argv.length) {
  console.error(USAGE)
  process.exit(2)
}
const cmd = process.argv[sep + 1]
const args = process.argv.slice(sep + 2)

const run = () => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  return {
    command: [cmd, ...args].join(' '),
    exitCode: r.status ?? -1,
    signal: r.signal ?? null,
    stdout: (r.stdout ?? '').slice(-20000),
    stderr: (r.stderr ?? '').slice(-20000),
  }
}

const evidenceDir = join(process.cwd(), '.evidence')
mkdirSync(evidenceDir, { recursive: true })
const pendingPath = join(evidenceDir, 'red-green.pending.json')

if (phase === 'record-red') {
  if (existsSync(pendingPath)) {
    console.error(`✘ Ya hay un ciclo RED pendiente sin GREEN (${pendingPath}). Ciérralo o bórralo antes de empezar otro.`)
    process.exit(1)
  }
  const red = run()
  console.error(`==> RED terminó con exit code ${red.exitCode}`)
  if (red.exitCode === 0) {
    // El test pasa a la primera: no hay comportamiento ausente que probar.
    console.error('✘ RED inválida: el comando pasó (exit 0). El test no prueba nada nuevo; reescribe o elimina.')
    process.exit(1)
  }
  writeFileSync(pendingPath, JSON.stringify({ red, recordedAt: new Date().toISOString() }, null, 2) + '\n')
  console.log(`✔ RED registrada — edita el código y cierra con record-green (pendiente: ${pendingPath})`)
  process.exit(0)
}

// record-green
if (!existsSync(pendingPath)) {
  console.error('✘ No hay RED pendiente. Registra primero: node scripts/red-green.mjs record-red -- <cmd>')
  process.exit(1)
}
let pending
try {
  pending = JSON.parse(readFileSync(pendingPath, 'utf8'))
} catch {
  console.error(`✘ ${pendingPath} no es JSON válido; elimínalo y vuelve a registrar la RED.`)
  process.exit(1)
}
const green = run()
console.error(`==> GREEN terminó con exit code ${green.exitCode}`)
if (green.exitCode !== 0) {
  console.error('✘ GREEN falló: el ciclo sigue abierto; sigue implementando y re-ejecuta record-green.')
  process.exit(1)
}
const valid = pending.red.exitCode !== 0
const record = {
  cycle: valid ? 'VALID' : 'INVALID',
  expectation: 'RED falla y GREEN pasa',
  red: pending.red,
  green,
  capturedAt: new Date().toISOString(),
}
const file = join(evidenceDir, `red-green-${Date.now()}.json`)
rmSync(pendingPath)
writeFileSync(file, JSON.stringify(record, null, 2) + '\n')
if (valid) {
  console.log(`✔ Ciclo RED→GREEN VÁLIDO — evidencia: ${file}`)
  process.exit(0)
} else {
  console.error(`✘ Ciclo INVÁLIDO — evidencia: ${file}`)
  process.exit(1)
}
