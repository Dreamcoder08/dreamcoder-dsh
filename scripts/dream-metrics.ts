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
import { spawnSync } from 'node:child_process'

interface MissionRecord {
  mission: string
  verdict: 'PASS' | 'FAIL'
  recordedAt: string
  sha256: string | null
}

interface SessionTelemetry {
  count: number
  withUsage: number
  inputTokens: number
  outputTokens: number
}

interface Metrics {
  evidenceDir: string
  missions: { total: number; pass: number; fail: number; passRate: string }
  tdd: { cycles: number; valid: number; invalid: number; pending: number }
  sessions: SessionTelemetry
  latest: MissionRecord | null
}

const argv: readonly string[] = process.argv

let explicitDir: string | undefined
let explicitSessions: string | undefined
let asJson = false
for (let i = 2; i < argv.length; i++) {
  if (argv[i] === '--evidence-dir') explicitDir = argv[++i]
  else if (argv[i] === '--sessions-dir') explicitSessions = argv[++i]
  else if (argv[i] === '--json') asJson = true
  else {
    console.error(`Argumento desconocido: ${String(argv[i])}`)
    process.exit(2)
  }
}

const dir = explicitDir !== undefined ? resolve(explicitDir) : join(process.cwd(), '.evidence')

/** DSH stores sessions under ~/.dsh/sessions/--home-...-cwd-encoded--/. */
const defaultSessionsDir = (): string => {
  const home = process.env.HOME ?? ''
  const encoded = '--' + process.cwd().replace(/^\//, '').split('/').join('-') + '--'
  return join(home, '.dsh', 'sessions', encoded)
}
const sessionsDir = explicitSessions !== undefined ? resolve(explicitSessions) : defaultSessionsDir()

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

// Contadores enteros puro (estilo BigInt-safe): nada de coma flotante.
const metrics: Metrics = {
  evidenceDir: dir,
  missions: { total: 0, pass: 0, fail: 0, passRate: '' },
  tdd: { cycles: 0, valid: 0, invalid: 0, pending: 0 },
  sessions: { count: 0, withUsage: 0, inputTokens: 0, outputTokens: 0 },
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

// ── Telemetría de sesiones DSH (uso de tokens por paso en session.jsonl.zstd). ──
if (existsSync(sessionsDir)) {
  for (const entry of readdirSync(sessionsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('session-')) continue
    const logPath = join(sessionsDir, entry.name, 'session.jsonl.zstd')
    if (!existsSync(logPath)) continue
    metrics.sessions.count++
    const r = spawnSync('zstd', ['-dc', logPath], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })
    if (r.status !== 0 || !r.stdout) continue // log ilegible: se degrada, no aborta
    let sawUsage = false
    for (const line of r.stdout.split('\n')) {
      if (!line.includes('"usage"')) continue
      try {
        const evt = JSON.parse(line) as {
          data?: { chunk?: { type?: string; usage?: { inputTokens?: number; outputTokens?: number } } }
        }
        const chunk = evt.data?.chunk
        if (chunk?.type !== 'usage' || typeof chunk.usage?.inputTokens !== 'number') continue
        sawUsage = true
        metrics.sessions.inputTokens += chunk.usage.inputTokens ?? 0
        metrics.sessions.outputTokens += chunk.usage.outputTokens ?? 0
      } catch {
        // Línea corrupta dentro del log: se ignora sin abortar el reporte.
      }
    }
    if (sawUsage) metrics.sessions.withUsage++
  }
}

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
  const s = metrics.sessions
  console.log('Sesiones DSH (telemetría):')
  console.log(
    `  ${s.count} sesión(es) · con uso LLM ${s.withUsage} · tokens entrada/salida ${s.inputTokens}/${s.outputTokens}`,
  )
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
