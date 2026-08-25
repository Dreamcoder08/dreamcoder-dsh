#!/usr/bin/env node
// context-governor.ts — gobernanza de contexto OPERATIVA, no solo documental.
//
// Lee la telemetría de uso LLM de la sesión DSH en curso (los chunks `usage`
// del session log, la misma fuente que dream-metrics), estima la presión de
// contexto actual y emite un evento machine-readable por ejecución:
//
//   context:ok                presión < warning (seguir trabajando)
//   context:warning           presión ≥ warning  (cerrar la unidad en curso)
//   context:critical          presión ≥ critical  (compactar YA; persistir
//                             por memory-gate lo imprescindible antes)
//
// Umbrales coherentes con la compactación nativa del perfil (thresholdRatio
// nativo 0.8): warning 0.80, critical 0.92. El presupuesto por franjas vive
// en policy/AGENTS.md §7; este script aplica el gate global.
//
// Uso:
//   node scripts/context-governor.ts [--sessions-dir <dir>] [--session <name>]
//        [--window <tokens>] [--warning <ratio>] [--critical <ratio>]
//        [--evidence-dir <dir>] [--json]
//
// Exit codes — tabla completa, cada código es exclusivo:
//   0  context:ok            seguir trabajando
//   1  context:warning       cerrar la unidad en curso
//   2  context:critical      compactar ya
//   3  sin datos de uso      limitación declarada (sesión recién abierta)
//   4  uso inválido de CLI   argumentos mal formados (NUNCA un veredicto)
//   5  error de infra        log encontrado pero ilegible (zstd ausente,
//                            .zstd corrupto, EACCES) — jamás se simula medición
//
// Se ejecuta con type-stripping nativo de Node (≥22.18). Sin build ni
// dependencias. Los logs se leen por streaming incremental (chunks de 1 MB):
// un session log de cualquier tamaño no rompe el gate ni la memoria.

import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  statSync,
  unlinkSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'

interface GovernorEvent {
  timestamp: string
  event: 'context:ok' | 'context:warning' | 'context:critical'
  /** Hash corto del nombre de sesión: trazable sin filtrar usuario ni rutas. */
  sessionId: string
  tokens: number
  window: number
  ratio: number
  thresholds: { warning: number; critical: number }
}

const DEFAULT_WINDOW = 128000
const DEFAULT_WARNING = 0.8 // alineado con compaction thresholdRatio nativo
const DEFAULT_CRITICAL = 0.92

/** DSH stores sessions under ~/.dsh/sessions/--home-...-cwd-encoded--/. */
const defaultSessionsDir = (): string => {
  const home = process.env.HOME ?? ''
  const encoded = '--' + process.cwd().replace(/^\//, '').split('/').join('-') + '--'
  return join(home, '.dsh', 'sessions', encoded)
}

// ── CLI ──────────────────────────────────────────────────────────────────────
const argv = process.argv

/** Exit 4: uso inválido de CLI — NUNCA colisiona con un veredicto (0/1/2). */
const die = (msg: string): never => {
  console.error(`Argumento inválido: ${msg}`)
  process.exit(4)
}
/** Valor de flag obligatorio: presente y no-starting-with '--'. */
const valueOf = (i: number): string => {
  const v = argv[i + 1]
  if (v === undefined) die(`${String(argv[i])} requiere un valor`)
  if (v !== undefined && v.startsWith('--')) die(`${String(argv[i])} requiere un valor`)
  return v as string
}

let sessionsDirArg: string | undefined
let sessionArg: string | undefined
let windowArg: number | undefined
let warningArg: number | undefined
let criticalArg: number | undefined
let evidenceDirArg: string | undefined
let asJson = false

for (let i = 2; i < argv.length; i++) {
  const a = argv[i]!
  if (a === '--sessions-dir') sessionsDirArg = valueOf(i++)
  else if (a === '--session') sessionArg = valueOf(i++)
  else if (a === '--evidence-dir') evidenceDirArg = valueOf(i++)
  else if (a === '--window') {
    const v = Number(valueOf(i++))
    if (!Number.isInteger(v) || v <= 0) die('--window requiere un entero positivo')
    windowArg = v
  } else if (a === '--warning') {
    const v = Number(valueOf(i++))
    if (!(v > 0 && v < 1)) die('--warning requiere un ratio en (0,1)')
    warningArg = v
  } else if (a === '--critical') {
    const v = Number(valueOf(i++))
    if (!(v > 0 && v < 1)) die('--critical requiere un ratio en (0,1)')
    criticalArg = v
  } else if (a === '--json') asJson = true
  else die(String(a))
}

const effectiveWarning = warningArg ?? DEFAULT_WARNING
if (criticalArg !== undefined && criticalArg <= effectiveWarning) {
  // Regla simétrica: igual que cuando se pasan ambos, fuera de orden es error
  // duro — nunca un clamp silencioso que cambie el umbral pedido.
  die('--critical debe ser mayor que el umbral de warning efectivo')
}

const windowTokens = windowArg ?? DEFAULT_WINDOW
const warnAt = effectiveWarning
const critAt = criticalArg ?? DEFAULT_CRITICAL

const sessionsDir =
  sessionsDirArg !== undefined ? resolve(sessionsDirArg) : defaultSessionsDir()
const evidenceDir =
  evidenceDirArg !== undefined ? resolve(evidenceDirArg) : join(process.cwd(), '.evidence')

/**
 * Escanea un archivo línea a línea con lectura incremental (chunks de 1 MB):
 * un log de cualquier tamaño se procesa en memoria constante.
 */
const scanLines = (path: string, visit: (line: string) => void): void => {
  const fd = openSync(path, 'r')
  try {
    const buf = Buffer.alloc(1024 * 1024)
    let rest = ''
    for (;;) {
      const n = readSync(fd, buf, 0, buf.length, null)
      if (n === 0) break
      rest += buf.toString('utf8', 0, n)
      const lines = rest.split('\n')
      rest = lines.pop() ?? ''
      for (const l of lines) visit(l)
    }
    if (rest.length > 0) visit(rest)
  } finally {
    closeSync(fd)
  }
}

type MeasureOutcome =
  | { kind: 'ok'; maxInput: number }
  | { kind: 'no-log' }
  | { kind: 'unreadable'; detail: string }

/** Extrae max(inputTokens) de una línea JSON de usage; ignora basura. */
const visitUsageLine = (line: string, state: { maxInput: number }): void => {
  if (!line.includes('"usage"')) return
  try {
    const evt = JSON.parse(line) as {
      data?: { chunk?: { type?: string; usage?: { inputTokens?: number } } }
    }
    const chunk = evt.data?.chunk
    if (chunk?.type !== 'usage' || typeof chunk.usage?.inputTokens !== 'number') return
    if (chunk.usage.inputTokens > state.maxInput) state.maxInput = chunk.usage.inputTokens
  } catch {
    // Línea corrupta dentro del log: se ignora sin abortar la medición.
  }
}

/**
 * Presión de contexto estimada: máximo inputTokens visto en los chunks usage
 * del session log. El input del último paso es el mejor proxy disponible del
 * tamaño de la superficie actual sin acoplar este script al token-meter.
 *
 * Descompresión zstd VÍA ARCHIVO TEMPORAL (stdout redirigido por fd): el
 * tamaño del log descomprimido queda acotado por disco, no por maxBuffer —
 * las sesiones más pesadas son exactamente las que pueden estar en critical,
 * así que perderlas silenciosamente invalidaría el gate.
 */
const measureSession = (sessionPath: string): MeasureOutcome => {
  const zstdPath = join(sessionPath, 'session.jsonl.zstd')
  const plainPath = join(sessionPath, 'session.jsonl')
  const state = { maxInput: 0 }

  if (existsSync(zstdPath)) {
    const tmpOut = join(tmpdir(), `dsh-governor-${process.pid}-${Date.now()}.out`)
    let fd: number | null = null
    try {
      fd = openSync(tmpOut, 'w')
      const r = spawnSync('zstd', ['-dc', zstdPath], { stdio: ['ignore', fd, 'pipe'] })
      if (r.error !== undefined || r.status !== 0) {
        const why =
          r.error?.message ??
          `zstd exit ${r.status}${r.signal !== null ? ` (${String(r.signal)})` : ''}`
        return { kind: 'unreadable', detail: `log .zstd ilegible: ${why}` }
      }
    } catch (e) {
      return { kind: 'unreadable', detail: `log .zstd ilegible: ${String(e)}` }
    } finally {
      if (fd !== null) closeSync(fd)
    }
    try {
      scanLines(tmpOut, (l) => visitUsageLine(l, state))
    } finally {
      unlinkSync(tmpOut)
    }
  } else if (existsSync(plainPath)) {
    try {
      scanLines(plainPath, (l) => visitUsageLine(l, state))
    } catch (e) {
      return { kind: 'unreadable', detail: `log plano ilegible: ${String(e)}` }
    }
  } else {
    return { kind: 'no-log' }
  }

  return { kind: 'ok', maxInput: state.maxInput }
}

// ── Selección de sesión ──────────────────────────────────────────────────────
let sessionName = sessionArg
if (sessionName !== undefined) {
  // Validación de formato: cierra el path traversal vía join(sessionsDir, …).
  if (!/^[A-Za-z0-9._-]+$/.test(sessionName)) {
    die("--session solo acepta [A-Za-z0-9._-]; no rutas")
  }
  if (!existsSync(join(sessionsDir, sessionName))) {
    console.error(`ERROR: la sesión '${sessionName}' no existe bajo ${sessionsDir}`)
    process.exit(3)
  }
} else {
  // Solo directorios con session log real: los dirs sin log no son sesiones.
  let best: { name: string; mtime: number } | null = null
  if (existsSync(sessionsDir)) {
    for (const e of readdirSync(sessionsDir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue
      const p = join(sessionsDir, e.name)
      const hasLog =
        existsSync(join(p, 'session.jsonl')) || existsSync(join(p, 'session.jsonl.zstd'))
      if (!hasLog) continue
      const mtime = statSync(p).mtimeMs
      if (best === null || mtime > best.mtime) best = { name: e.name, mtime }
    }
  }
  if (best === null) {
    console.error(`ERROR: sin sesiones bajo ${sessionsDir} — limitación declarada, nada simulado`)
    process.exit(3)
  }
  sessionName = best.name
}

const outcome = measureSession(join(sessionsDir, sessionName))
if (outcome.kind === 'unreadable') {
  console.error(`ERROR: ${outcome.detail} — sesión '${sessionName}' bajo ${sessionsDir}`)
  process.exit(5)
}
if (outcome.kind === 'no-log' || outcome.maxInput === 0) {
  console.error(
    `ERROR: sin datos de uso LLM para '${sessionName}' (¿sesión recién abierta?) — limitación declarada, nada simulado`,
  )
  process.exit(3)
}
const maxInput = outcome.maxInput

const ratio = maxInput / windowTokens
const verdict: GovernorEvent['event'] =
  ratio >= critAt ? 'context:critical' : ratio >= warnAt ? 'context:warning' : 'context:ok'

const event: GovernorEvent = {
  timestamp: new Date().toISOString(),
  event: verdict,
  sessionId: createHash('sha256').update(sessionName).digest('hex').slice(0, 12),
  tokens: maxInput,
  window: windowTokens,
  ratio,
  thresholds: { warning: warnAt, critical: critAt },
}

// ── Registro duradero (.evidence/context-events.jsonl) ───────────────────────
try {
  mkdirSync(evidenceDir, { recursive: true })
  appendFileSync(join(evidenceDir, 'context-events.jsonl'), JSON.stringify(event) + '\n')
} catch (e) {
  // Sin registro no hay evidencia duradera: se señala, jamás se calla.
  console.error(`AVISO: no se pudo escribir el evento en ${evidenceDir}: ${String(e)}`)
}

const advice: Record<GovernorEvent['event'], string> = {
  'context:ok': 'presión bajo control — continúa la unidad en curso',
  'context:warning': 'cierra la unidad en curso y prepara compactación (§7: antes de que degrade)',
  'context:critical':
    'COMPACTA YA: persiste por memory-gate lo imprescindible y re-ancla con objetivo + evidencia',
}

if (asJson) {
  console.log(JSON.stringify({ ...event, advice: advice[verdict] }, null, 2))
} else {
  console.log(
    `context-governor: ${verdict} — ${maxInput}/${windowTokens} tokens (ratio ${ratio.toFixed(2)}, umbral w/c ${warnAt}/${critAt})`,
  )
  console.log(`  sesión: ${sessionName} (id ${event.sessionId})`)
  console.log(`  acción: ${advice[verdict]}`)
}

process.exit(verdict === 'context:critical' ? 2 : verdict === 'context:warning' ? 1 : 0)
