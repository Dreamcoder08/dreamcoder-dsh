#!/usr/bin/env node
// red-green.ts — evidencia observable del ciclo TDD completo
// RED → GREEN → TRIANGULATE → REFACTOR (skill tdd-evidence).
//
//   node scripts/red-green.ts record-red         -- <comando de test [args…]>
//   ...editar código...
//   node scripts/red-green.ts record-green       -- <comando de test [args…]>
//   ...añadir caso que generaliza...
//   node scripts/red-green.ts record-triangulate -- <comando de test [args…]>
//   ...refactorizar sin cambiar comportamiento...
//   node scripts/red-green.ts record-refactor    -- <comando de test [args…]>
//
// record-red exige fallo (exit ≠ 0); record-green exige pase y cierra el par
// escribiendo .evidence/red-green-<ts>.json más un puntero
// .evidence/red-green.latest.json. TRIANGULATE exige un ciclo previo sin
// triangulación registrada y un pase (el segundo caso confirma la
// generalización). REFACTOR exige triangulación previa y un pase posterior a
// la refactorización; al completarse marca el ciclo COMPLETE.
// Exit code 0 solo en una fase válida del ciclo.
//
// Se ejecuta con el type-stripping nativo de Node (≥22.18): sin build ni
// dependencias de runtime. Solo sintaxis erasable (ver tsconfig).

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

interface CommandRun {
  command: string
  exitCode: number
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
}

interface PendingCycle {
  red: CommandRun
  recordedAt: string
}

interface CycleRecord {
  cycle: 'VALID' | 'INVALID'
  expectation: string
  red: CommandRun
  green: CommandRun
  triangulate?: CommandRun
  refactor?: CommandRun
  complete: boolean
  capturedAt: string
}

const PHASES = ['record-red', 'record-green', 'record-triangulate', 'record-refactor'] as const

const USAGE =
  'Uso:\n' +
  '  node scripts/red-green.ts record-red         -- <comando de test [args…]>\n' +
  '  node scripts/red-green.ts record-green       -- <comando de test [args…]>\n' +
  '  node scripts/red-green.ts record-triangulate -- <comando de test [args…]>\n' +
  '  node scripts/red-green.ts record-refactor    -- <comando de test [args…]>\n'

const argv: readonly string[] = process.argv
const sep: number = argv.indexOf('--')
const phase: string | undefined = argv[2]
if (
  phase === undefined ||
  !PHASES.includes(phase as (typeof PHASES)[number]) ||
  sep === -1 ||
  sep + 1 >= argv.length
) {
  console.error(USAGE)
  process.exit(2)
}
const cmd: string = argv[sep + 1] as string
const args: string[] = argv.slice(sep + 2)

const run = (): CommandRun => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  return {
    command: [cmd, ...args].join(' '),
    exitCode: r.status ?? -1,
    signal: r.signal ?? null,
    stdout: (r.stdout ?? '').slice(-20000),
    stderr: (r.stderr ?? '').slice(-20000),
  }
}

const evidenceDir: string = join(process.cwd(), '.evidence')
mkdirSync(evidenceDir, { recursive: true })
const pendingPath: string = join(evidenceDir, 'red-green.pending.json')

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
  const pending: PendingCycle = { red, recordedAt: new Date().toISOString() }
  writeFileSync(pendingPath, JSON.stringify(pending, null, 2) + '\n')
  console.log(`✔ RED registrada — edita el código y cierra con record-green (pendiente: ${pendingPath})`)
  process.exit(0)
}

// Fases posteriores al par: operan sobre el último ciclo cerrado (puntero).
const latestPath = join(evidenceDir, 'red-green.latest.json')

if (phase === 'record-triangulate' || phase === 'record-refactor') {
  if (!existsSync(latestPath)) {
    console.error(`✘ No hay ciclo RED→GREEN previo (${latestPath}). Cierra un par antes de ${phase}.`)
    process.exit(1)
  }
  let latest: { file: string }
  try {
    latest = JSON.parse(readFileSync(latestPath, 'utf8')) as { file: string }
  } catch {
    console.error(`✘ ${latestPath} no es JSON válido.`)
    process.exit(1)
  }
  if (!existsSync(latest.file)) {
    console.error(`✘ El ciclo apuntado no existe: ${latest.file}`)
    process.exit(1)
  }
  const record = JSON.parse(readFileSync(latest.file, 'utf8')) as CycleRecord
  if (phase === 'record-triangulate' && record.triangulate !== undefined) {
    console.error('✘ Este ciclo ya tiene TRIANGULATE registrado.')
    process.exit(1)
  }
  if (phase === 'record-refactor' && record.triangulate === undefined) {
    console.error('✘ REFACTOR exige TRIANGULATE registrado primero (tdd-evidence).')
    process.exit(1)
  }
  const runResult = run()
  console.error(`==> ${phase.toUpperCase()} terminó con exit code ${runResult.exitCode}`)
  if (runResult.exitCode !== 0) {
    console.error(`✘ La fase ${phase} exige que el comando pase (exit 0); el ciclo queda como está.`)
    process.exit(1)
  }
  if (phase === 'record-triangulate') record.triangulate = runResult
  else record.refactor = runResult
  record.complete =
    record.cycle === 'VALID' && record.triangulate !== undefined && record.refactor !== undefined
  writeFileSync(latest.file, JSON.stringify(record, null, 2) + '\n')
  if (record.complete) {
    console.log(`✔ Ciclo TDD COMPLETE (RED→GREEN→TRIANGULATE→REFACTOR) — evidencia: ${latest.file}`)
  } else {
    console.log(`✔ ${phase} registrado — evidencia: ${latest.file}`)
  }
  process.exit(0)
}

// record-green
if (!existsSync(pendingPath)) {
  console.error('✘ No hay RED pendiente. Registra primero: node scripts/red-green.ts record-red -- <cmd>')
  process.exit(1)
}
let pending: PendingCycle
try {
  pending = JSON.parse(readFileSync(pendingPath, 'utf8')) as PendingCycle
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
const valid: boolean = pending.red.exitCode !== 0
const record: CycleRecord = {
  cycle: valid ? 'VALID' : 'INVALID',
  expectation: 'RED falla y GREEN pasa',
  red: pending.red,
  green,
  complete: false,
  capturedAt: new Date().toISOString(),
}
const file: string = join(evidenceDir, `red-green-${Date.now()}.json`)
rmSync(pendingPath)
writeFileSync(file, JSON.stringify(record, null, 2) + '\n')
writeFileSync(latestPath, JSON.stringify({ file }, null, 2) + '\n')
if (valid) {
  console.log(`✔ Ciclo RED→GREEN VÁLIDO — evidencia: ${file}\n  Continúa con record-triangulate y record-refactor.`)
  process.exit(0)
} else {
  console.error(`✘ Ciclo INVÁLIDO — evidencia: ${file}`)
  process.exit(1)
}
