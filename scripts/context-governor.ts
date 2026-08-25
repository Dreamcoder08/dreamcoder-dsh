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
//   bun run scripts/context-governor.ts [--sessions-dir <dir>] [--session <name>]
//        [--window <tokens>] [--warning <ratio>] [--critical <ratio>]
//        [--evidence-dir <dir>] [--json]
//
// Exit codes (gate para scripts y CI):
//   0 ok · 1 warning · 2 critical · 3 sin datos de uso (limitación declarada)
//
// Se ejecuta con Bun o type-stripping nativo de Node (≥22.18). Sin build ni
// dependencias: aritmética entera, coma flotante solo para el ratio impreso.

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, appendFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

interface GovernorEvent {
  timestamp: string
  event: 'context:ok' | 'context:warning' | 'context:critical'
  session: string
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
let sessionsDirArg: string | undefined
let sessionArg: string | undefined
let windowArg: number | undefined
let warningArg: number | undefined
let criticalArg: number | undefined
let evidenceDirArg: string | undefined
let asJson = false

const die = (msg: string): never => {
  console.error(`Argumento inválido: ${msg}`)
  process.exit(2)
}
for (let i = 2; i < argv.length; i++) {
  const a = argv[i]
  if (a === '--sessions-dir') sessionsDirArg = argv[++i]
  else if (a === '--session') sessionArg = argv[++i]
  else if (a === '--window') {
    windowArg = Number(argv[++i])
    if (!(windowArg! > 0)) die('--window requiere un entero positivo')
  } else if (a === '--warning') {
    warningArg = Number(argv[++i])
    if (!(warningArg! > 0 && warningArg! < 1)) die('--warning requiere un ratio en (0,1)')
  } else if (a === '--critical') {
    criticalArg = Number(argv[++i])
    if (!(criticalArg! > 0 && criticalArg! < 1)) die('--critical requiere un ratio en (0,1)')
  } else if (a === '--evidence-dir') evidenceDirArg = argv[++i]
  else if (a === '--json') asJson = true
  else die(String(a))
}
if (warningArg !== undefined && criticalArg !== undefined && criticalArg <= warningArg) {
  die('--critical debe ser mayor que --warning')
}

const windowTokens = windowArg ?? DEFAULT_WINDOW
const warnAt = Math.min(warningArg ?? DEFAULT_WARNING, (criticalArg ?? DEFAULT_CRITICAL) - 0.001)
const critAt = criticalArg ?? DEFAULT_CRITICAL

const sessionsDir =
  sessionsDirArg !== undefined ? resolve(sessionsDirArg) : defaultSessionsDir()
const evidenceDir =
  evidenceDirArg !== undefined ? resolve(evidenceDirArg) : join(process.cwd(), '.evidence')

/**
 * Presión de contexto estimada: máximo inputTokens visto en los chunks usage
 * del session log. El input del último paso es el mejor proxy disponible del
 * tamaño de la superficie actual sin acoplar este script al token-meter.
 */
const measureSession = (sessionPath: string): { logFound: boolean; maxInput: number } => {
  const zstdPath = join(sessionPath, 'session.jsonl.zstd')
  const plainPath = join(sessionPath, 'session.jsonl')
  let text: string | null = null
  if (existsSync(zstdPath)) {
    const r = spawnSync('zstd', ['-dc', zstdPath], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })
    if (r.status === 0 && r.stdout) text = r.stdout
  } else if (existsSync(plainPath)) {
    text = readFileSync(plainPath, 'utf8')
  }
  if (text === null) return { logFound: false, maxInput: 0 }

  let maxInput = 0
  for (const line of text.split('\n')) {
    if (!line.includes('"usage"')) continue
    try {
      const evt = JSON.parse(line) as {
        data?: { chunk?: { type?: string; usage?: { inputTokens?: number; outputTokens?: number } } }
      }
      const chunk = evt.data?.chunk
      if (chunk?.type !== 'usage' || typeof chunk.usage?.inputTokens !== 'number') continue
      if (chunk.usage.inputTokens > maxInput) maxInput = chunk.usage.inputTokens
    } catch {
      // Línea corrupta dentro del log: se ignora sin abortar la medición.
    }
  }
  return { logFound: true, maxInput }
}

// ── Selección de sesión ──────────────────────────────────────────────────────
let sessionName = sessionArg
if (sessionName !== undefined) {
  if (!existsSync(join(sessionsDir, sessionName))) {
    console.error(`ERROR: la sesión '${sessionName}' no existe bajo ${sessionsDir}`)
    process.exit(3)
  }
} else {
  let best: { name: string; mtime: number } | null = null
  if (existsSync(sessionsDir)) {
    for (const e of readdirSync(sessionsDir, { withFileTypes: true })) {
      if (!e.isDirectory() || !e.name.startsWith('session-')) continue
      const mtime = statSync(join(sessionsDir, e.name)).mtimeMs
      if (best === null || mtime > best.mtime) best = { name: e.name, mtime }
    }
  }
  if (best === null) {
    console.error(`ERROR: sin sesiones bajo ${sessionsDir} — limitación declarada, nada simulado`)
    process.exit(3)
  }
  sessionName = best.name
}

const { logFound, maxInput } = measureSession(join(sessionsDir, sessionName))
if (!logFound || maxInput === 0) {
  console.error(
    `ERROR: sin datos de uso LLM para '${sessionName}' (¿sesión recién abierta?) — limitación declarada, nada simulado`,
  )
  process.exit(3)
}

const ratio = maxInput / windowTokens
const verdict: GovernorEvent['event'] =
  ratio >= critAt ? 'context:critical' : ratio >= warnAt ? 'context:warning' : 'context:ok'

const event: GovernorEvent = {
  timestamp: new Date().toISOString(),
  event: verdict,
  session: sessionName,
  tokens: maxInput,
  window: windowTokens,
  ratio,
  thresholds: { warning: warnAt, critical: critAt },
}

// ── Registro duradero (.evidence/context-events.jsonl) ───────────────────────
try {
  mkdirSync(evidenceDir, { recursive: true })
  appendFileSync(join(evidenceDir, 'context-events.jsonl'), JSON.stringify(event) + '\n')
} catch {
  // Sin registro no hay gate: pero la medición sigue siendo válida en stdout.
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
  console.log(`  sesión: ${sessionName}`)
  console.log(`  acción: ${advice[verdict]}`)
}

process.exit(verdict === 'context:critical' ? 2 : verdict === 'context:warning' ? 1 : 0)
