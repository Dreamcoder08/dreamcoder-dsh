#!/usr/bin/env node
// dream-metrics.ts — observabilidad del proceso de ingeniería, derivada de los
// recibos que el propio sistema registra en `.evidence/` (misiones de
// evidence-ledger y ciclos RED→GREEN de red-green.ts).
//
// No opina sobre trabajo "hecho": solo agrega lo que los recibos DEMUESTRAN.
//
// Uso:
//   node scripts/dream-metrics.ts [--evidence-dir <dir>] [--json]
//
// Exit code siempre 0 si la ejecución fue correcta: es una herramienta de
// reporte, no una verificación.
//
// Se ejecuta con el type-stripping nativo de Node (≥26): sin build ni
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

/** Agregado de las proyecciones nativas de @deepseek-ai/dsh-token-meter. */
interface TokenMeterAggregate {
  /** Sesiones con proyección tokenUsage presente en el projcache. */
  sessions: number
  uncachedInputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  /** Presión de contexto máxima observada (tokens) y su ventana, si se reportó. */
  peakPressureTokens: number | null
  peakContextWindow: number | null
}

interface Metrics {
  evidenceDir: string
  missions: { total: number; pass: number; fail: number; passRate: string }
  tdd: { cycles: number; valid: number; invalid: number; complete: number; pending: number }
  sessions: SessionTelemetry
  tokenMeter: TokenMeterAggregate
  tokensPerMission: string | null
  rework: { fixCommits: number; sampleSize: number; percent: string } | null
  latest: MissionRecord | null
}

const argv: readonly string[] = process.argv

let explicitDir: string | undefined
let explicitSessions: string | undefined
let explicitProjcache: string | undefined
let asJson = false
for (let i = 2; i < argv.length; i++) {
  if (argv[i] === '--evidence-dir') explicitDir = argv[++i]
  else if (argv[i] === '--sessions-dir') explicitSessions = argv[++i]
  else if (argv[i] === '--projcache') explicitProjcache = argv[++i]
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

/** Checkpoint JSON de las proyecciones nativas de token-meter (@deepseek-ai/dsh-token-meter). */
const defaultProjcachePath = (): string =>
  join(process.env.HOME ?? '', '.dsh', 'storages', 'session_projcache.json')
const projcachePath =
  explicitProjcache !== undefined ? resolve(explicitProjcache) : defaultProjcachePath()

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
  tdd: { cycles: 0, valid: 0, invalid: 0, complete: 0, pending: 0 },
  sessions: { count: 0, withUsage: 0, inputTokens: 0, outputTokens: 0 },
  tokenMeter: {
    sessions: 0,
    uncachedInputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    peakPressureTokens: null,
    peakContextWindow: null,
  },
  tokensPerMission: null,
  rework: null,
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
        const cycle = JSON.parse(readFileSync(path, 'utf8')) as { cycle?: string; complete?: boolean }
        if (cycle.cycle === 'VALID' || cycle.cycle === 'INVALID') {
          metrics.tdd.cycles++
          if (cycle.cycle === 'VALID') metrics.tdd.valid++
          else metrics.tdd.invalid++
          if (cycle.complete === true) metrics.tdd.complete++
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

// ── Proyecciones nativas de token-meter (session_projcache.json). ──
// Fuente: @deepseek-ai/dsh-token-meter registra por sesión las unidades
// `tokenUsage` (buckets de uso duradero) y `contextPressure` (presión de la
// última petición reportada por el proveedor). Es la MISMA contabilidad que
// consume el host — no una heurística propia del script. Un projcache ausente
// o corrupto degrada a ceros/null, jamás aborta el reporte.
{
  const readBucket = (v: unknown): number | null =>
    typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null

  type Projcache = {
    tables?: {
      sessions?: Record<
        string,
        {
          rows?: {
            tokenUsage?: { val?: { totals?: Record<string, unknown> } }
            contextPressure?: { val?: { pressureTokens?: unknown; contextWindow?: unknown } }
          }
        }
      >
    }
  }

  if (existsSync(projcachePath)) {
    try {
      const cache = JSON.parse(readFileSync(projcachePath, 'utf8')) as Projcache
      const sessions = cache.tables?.sessions ?? {}
      let peakPressure: number | null = null
      let peakWindow: number | null = null
      for (const id of Object.keys(sessions)) {
        const rows = sessions[id]?.rows ?? {}
        const totals = rows.tokenUsage?.val?.totals
        if (totals !== undefined) {
          // Una sesión cuenta solo si su proyección es legible completa:
          // datos parciales entrarían en la suma como ceros silenciosos.
          const uncached = readBucket(totals.uncachedInputTokens)
          const out = readBucket(totals.outputTokens)
          const cacheRead = readBucket(totals.cacheReadTokens)
          const cacheWrite = readBucket(totals.cacheWriteTokens)
          if (
            uncached !== null &&
            out !== null &&
            cacheRead !== null &&
            cacheWrite !== null
          ) {
            metrics.tokenMeter.sessions++
            metrics.tokenMeter.uncachedInputTokens += uncached
            metrics.tokenMeter.outputTokens += out
            metrics.tokenMeter.cacheReadTokens += cacheRead
            metrics.tokenMeter.cacheWriteTokens += cacheWrite
          }
        }
        const pressureVal = rows.contextPressure?.val
        if (pressureVal !== undefined) {
          const p = readBucket(pressureVal.pressureTokens)
          if (p !== null && (peakPressure === null || p > peakPressure)) {
            peakPressure = p
            const w = readBucket(pressureVal.contextWindow)
            peakWindow = w
          }
        }
      }
      metrics.tokenMeter.peakPressureTokens = peakPressure
      metrics.tokenMeter.peakContextWindow = peakWindow
    } catch {
      // projcache corrupto o con forma inesperada: se degrada sin valores.
    }
  }
}

// ── tokens/task (aproximado): tokens de entrada de sesión / misiones cerradas.
// Es una aproximación honesta: los tokens son por workspace, las misiones por
// repo; se etiqueta como tal y no se inventa precisión.
if (metrics.missions.total > 0 && metrics.sessions.inputTokens > 0) {
  const avg = BigInt(metrics.sessions.inputTokens) / BigInt(metrics.missions.total)
  metrics.tokensPerMission = `~${avg.toString()} tokens entrada/misión (aprox)`
}

// ── rework%: commits de fix/revert sobre la muestra de los últimos 100
// commits (derivado solo de Git, sin opinión del agente).
const gitLog = spawnSync('git', ['log', '--oneline', '-100'], { encoding: 'utf8' })
if (gitLog.status === 0) {
  const lines = gitLog.stdout.split('\n').filter((l) => l.trim() !== '')
  const fixCommits = lines.filter((l) => /^\s*[0-9a-f]+\s+(fix|hotfix|revert)(\b|[(])/i.test(l)).length
  if (lines.length > 0) {
    const pct = (BigInt(fixCommits) * 10000n) / BigInt(lines.length)
    const digits = pct.toString().padStart(3, '0')
    metrics.rework = {
      fixCommits,
      sampleSize: lines.length,
      percent: `${digits.slice(0, -2)},${digits.slice(-2)}%`,
    }
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
  console.log(
    `  válidos ${t.valid} · inválidos ${t.invalid} · COMPLETE (4 fases) ${t.complete} · abiertos pendientes ${t.pending}`,
  )
  if (metrics.tokensPerMission !== null) console.log(`Tokens/task: ${metrics.tokensPerMission}`)
  if (metrics.rework !== null) {
    const r = metrics.rework
    console.log(`Rework: ${r.fixCommits}/${r.sampleSize} commits de fix/revert (${r.percent})`)
  }
  const s = metrics.sessions
  console.log('Sesiones DSH (telemetría):')
  console.log(
    `  ${s.count} sesión(es) · con uso LLM ${s.withUsage} · tokens entrada/salida ${s.inputTokens}/${s.outputTokens}`,
  )
  const tm = metrics.tokenMeter
  console.log('Token-meter nativo (proyecciones del host):')
  console.log(
    `  ${tm.sessions} sesión(es) · entrada sin caché ${tm.uncachedInputTokens} · salida ${tm.outputTokens} · caché leída/escrita ${tm.cacheReadTokens}/${tm.cacheWriteTokens}`,
  )
  if (tm.peakPressureTokens !== null) {
    let occupancy = ''
    if (tm.peakContextWindow !== null && tm.peakContextWindow > 0) {
      const tenths = (BigInt(tm.peakPressureTokens) * 10000n) / BigInt(tm.peakContextWindow)
      const digits = tenths.toString().padStart(3, '0')
      occupancy = ` (${digits.slice(0, -2)},${digits.slice(-2)}% de la ventana)`
    }
    console.log(`  presión pico de contexto: ${tm.peakPressureTokens} tokens${occupancy}`)
  }
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
