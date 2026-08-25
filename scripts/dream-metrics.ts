#!/usr/bin/env node
// dream-metrics.ts — observabilidad del proceso de ingeniería, derivada de los
// recibos que el propio sistema registra en `.evidence/` (misiones de
// evidence-ledger y ciclos RED→GREEN de red-green.ts).
//
// No opina sobre trabajo "hecho": solo agrega lo que los recibos DEMUESTRAN.
//
// Uso:
//   bun run scripts/dream-metrics.ts [--evidence-dir <dir>] [--json]
//
// Exit code siempre 0 si la ejecución fue correcta: es una herramienta de
// reporte, no una verificación.
//
// Se ejecuta con Bun o con type-stripping nativo de Node (≥22.18): sin build ni
// dependencias de runtime. Solo sintaxis erasable. Todo el cálculo de tasas es
// aritmética entera exacta (BigInt), sin coma flotante.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

interface MissionRecord {
  mission: string
  verdict: 'PASS' | 'FAIL'
  recordedAt: string
  sha256: string | null
}

interface Metrics {
  evidenceDir: string
  missions: { total: number; pass: number; fail: number; passRate: string }
  tdd: { cycles: number; valid: number; invalid: number; pending: number }
  latest: MissionRecord | null
}

const argv: readonly string[] = process.argv

let explicitDir: string | undefined
let asJson = false
for (let i = 2; i < argv.length; i++) {
  if (argv[i] === '--evidence-dir') explicitDir = argv[++i]
  else if (argv[i] === '--json') asJson = true
  else {
    console.error(`Argumento desconocido: ${String(argv[i])}`)
    process.exit(2)
  }
}

const dir = explicitDir !== undefined ? resolve(explicitDir) : join(process.cwd(), '.evidence')

const parseMissionYaml = (body: string): MissionRecord | null => {
  const line = (re: RegExp): string | null => re.exec(body)?.[1] ?? null
  const mission = line(/^mission: (.+)$/m)
  const verdict = line(/^verdict: (PASS|FAIL)$/m)
  if (mission === null || verdict === null) return null // not a mission receipt
  return {
    mission,
    verdict: verdict as 'PASS' | 'FAIL',
    recordedAt: line(/^recordedAt: (.+)$/m) ?? '',
    sha256: line(/^sha256: ([0-9a-f]{64})$/m),
  }
}

/**
 * Success rate in tenths of a percent as "II.T%", computed with exact BigInt
 * integer arithmetic (tenths = floor(pass * 1000 / total)) and formatted by
 * slicing digits — no floating-point semantics anywhere.
 */
const successRateLabel = (pass: number, total: number): string => {
  const tenths = total > 0 ? (BigInt(pass) * 1000n) / BigInt(total) : 0n
  const digits = tenths.toString()
  const intPart = digits.slice(0, -1)
  return `${intPart === '' ? '0' : intPart}.${digits.slice(-1)}%`
}

const metrics: Metrics = {
  evidenceDir: dir,
  missions: { total: 0, pass: 0, fail: 0, passRate: '' },
  tdd: { cycles: 0, valid: 0, invalid: 0, pending: 0 },
  latest: null,
}

if (existsSync(dir)) {
  const latestByDateDesc = (a: MissionRecord, b: MissionRecord): number =>
    b.recordedAt.localeCompare(a.recordedAt)

  for (const f of readdirSync(dir)) {
    const path = join(dir, f)
    if (f.startsWith('mission-') && f.endsWith('.yaml')) {
      const rec = parseMissionYaml(readFileSync(path, 'utf8'))
      if (rec === null) continue // not a mission receipt; ignore silently
      metrics.missions.total++
      if (rec.verdict === 'PASS') metrics.missions.pass++
      else metrics.missions.fail++
      if (metrics.latest === null || latestByDateDesc(rec, metrics.latest) < 0) metrics.latest = rec
    } else if (f.startsWith('red-green-') && f.endsWith('.json')) {
      try {
        const cycle = (JSON.parse(readFileSync(path, 'utf8')) as { cycle?: string }).cycle
        if (cycle === 'VALID' || cycle === 'INVALID') {
          metrics.tdd.cycles++
          if (cycle === 'VALID') metrics.tdd.valid++
          else metrics.tdd.invalid++
        }
      } catch {
        // Un recibo corrupto no detiene el reporte: se ignora.
      }
    } else if (f === 'red-green.pending.json') {
      metrics.tdd.pending = 1
    }
  }
}
metrics.missions.passRate = successRateLabel(metrics.missions.pass, metrics.missions.total)

if (asJson) {
  console.log(JSON.stringify(metrics, null, 2))
} else {
  const m = metrics.missions
  const t = metrics.tdd
  console.log(`Dreamcoder Engineering Metrics — ${dir}`)
  console.log('')
  console.log('Misiones (evidence-ledger):')
  console.log(`  total ${m.total} · PASS ${m.pass} · FAIL ${m.fail} · tasa de éxito ${m.passRate}`)
  console.log('Ciclos TDD (red-green):')
  console.log(`  válidos ${t.valid} · inválidos ${t.invalid} · abiertos pendientes ${t.pending}`)
  if (metrics.latest !== null) {
    const l = metrics.latest
    console.log('Última misión:')
    console.log(
      `  ${l.mission} → ${l.verdict} @ ${l.recordedAt}` +
        (l.sha256 !== null ? ` (sha256 ${l.sha256.slice(0, 12)}…)` : ''),
    )
  } else {
    console.log('Última misión: (sin registros todavía)')
  }
}
process.exit(0)
