#!/usr/bin/env node
// evidence-ledger.ts — receipt de misión derivado de Git.
//
// Genera el registro probatorio de una misión: SHAs base/candidato, archivos
// cambiados vs esperados, verificaciones ejecutadas (comando + exit code) y
// hash SHA256 del receipt completo. El agente AFIRMA menos y el sistema
// REGISTRA más: este script solo acepta hechos que Git y los comandos
// ejecutados pueden demostrar.
//
// Uso:
//   node scripts/evidence-ledger.ts \
//     --mission feat-auth-refresh \
//     --base 82ac31 \
//     [--expected 9] \
//     [--sdd feat-auth-refresh] \
//     --check "unit tests" -- "pnpm test" \
//     [--check "lint" -- "pnpm lint"] ...
//
// Escribe .evidence/mission-<mission>-<ts>.yaml y su SHA256. Exit code 0 solo
// si todas las verificaciones pasan y el conteo de archivos coincide.
//
// Se ejecuta con el type-stripping nativo de Node (≥26), sin build, y se tipa con tsgo 7.x.

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

type YamlScalar = string | number | boolean | null | undefined | YamlValue[] | { [k: string]: YamlValue }
type YamlValue = YamlScalar

interface CheckSpec {
  label: string
  command: string[]
}

interface CheckResult {
  label: string
  command: string
  exitCode: number
  passed: boolean
  outputTail: string
}

interface CliOptions {
  mission: string
  base: string
  candidate?: string
  expected?: number
  sdd?: string
  checks: CheckSpec[]
}

/** Estado del parser antes de validar los campos obligatorios. */
interface PartialCliOptions {
  mission?: string
  base?: string
  candidate?: string
  expected?: number
  sdd?: string
  checks: CheckSpec[]
}

/** Serializa un valor como YAML de una línea (arrays/objetos anidan con flow style). */
const yamlValue = (v: YamlValue): string => {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) return '[' + v.map(yamlValue).join(', ') + ']'
  if (typeof v === 'object') {
    const entries = Object.entries(v).map(([k, val]) => `${k}: ${yamlValue(val)}`)
    return '{' + entries.join(', ') + '}'
  }
  const s = String(v)
  // Cita si contiene caracteres que YAML reservaría o romperían el flujo.
  return /[:#{}[\],&*'" \n]|^[\s-]|[\s]$/.test(s) ? JSON.stringify(s) : s
}

function parseArgs(argv: readonly string[]): CliOptions {
  const out: PartialCliOptions = { checks: [] }
  const isOptionBoundary = (token: string | undefined): boolean =>
    token === undefined || token === '--check' ||
    token === '--mission' || token === '--base' ||
    token === '--candidate' || token === '--expected' || token === '--sdd'
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--mission') out.mission = argv[++i] as string
    else if (a === '--base') out.base = argv[++i] as string
    else if (a === '--candidate') out.candidate = argv[++i] as string
    else if (a === '--expected') out.expected = Number(argv[++i])
    else if (a === '--sdd') out.sdd = argv[++i] as string
    else if (a === '--check') {
      const label = argv[++i] as string
      if (argv[++i] !== '--') throw new Error('--check requiere "-- <comando>"')
      const cmd: string[] = []
      while (!isOptionBoundary(argv[i + 1])) cmd.push(argv[++i] as string)
      // Un único token con espacios = comando citado como string completo.
      const resolved = cmd.length === 1 && /\s/.test(cmd[0] ?? '') ? (cmd[0] as string).trim().split(/\s+/) : cmd
      if (resolved.length === 0) throw new Error(`--check '${label}' sin comando`)
      out.checks.push({ label, command: resolved })
    } else throw new Error(`Argumento desconocido: ${a}`)
  }
  if (!out.mission) throw new Error('--mission es obligatorio')
  if (!out.base) throw new Error('--base es obligatorio')
  return out as CliOptions
}

const opts = parseArgs(process.argv.slice(2))

const git = (args: string[]): string => {
  const r = spawnSync('git', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} falló:\n${r.stderr}`)
  return (r.stdout ?? '').trim()
}

const candidate = opts.candidate ?? git(['rev-parse', 'HEAD'])
const base = opts.base
const ancestorOk =
  spawnSync('git', ['merge-base', '--is-ancestor', base, candidate], { encoding: 'utf8' }).status === 0

const changedFiles = git(['diff', '--name-only', `${base}..${candidate}`]).split('\n').filter(Boolean)
const shortstat = git(['diff', '--shortstat', `${base}..${candidate}`])
const insertions = Number(shortstat.match(/(\d+) insertion/)?.[1] ?? 0)
const deletions = Number(shortstat.match(/(\d+) deletion/)?.[1] ?? 0)

const runCheck = (c: CheckSpec): CheckResult => {
  const r = spawnSync(c.command[0] as string, c.command.slice(1), { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  return {
    label: c.label,
    command: c.command.join(' '),
    exitCode: r.status ?? -1,
    passed: r.status === 0,
    outputTail: ((r.stdout ?? '') + (r.stderr ?? '')).slice(-4000),
  }
}
const checks = opts.checks.map(runCheck)

// Gate SDD opcional (--sdd <misión>): el recibo solo puede ser PASS si el
// estado de sdd-gate.ts muestra todas las etapas del contrato completadas.
interface SddStateFile {
  mission: string
  workflow: string
  contractStages: string[]
  stages: { id: string; completedAt: string; note: string }[]
}
let sddVerdict: { mission: string; workflow: string; complete: boolean; missing: string[] } | null = null
if (opts.sdd !== undefined) {
  const p = join(process.cwd(), '.evidence', `sdd-${opts.sdd}.json`)
  if (!existsSync(p)) {
    console.error(`✘ --sdd '${opts.sdd}': no existe .evidence/sdd-${opts.sdd}.json (¿corriste sdd-gate start?)`)
    process.exit(1)
  }
  const state = JSON.parse(readFileSync(p, 'utf8')) as SddStateFile
  const missing = state.contractStages.filter((id) => !state.stages.some((s) => s.id === id))
  sddVerdict = { mission: state.mission, workflow: state.workflow, complete: missing.length === 0, missing }
}

const scopeMatch: boolean | null = opts.expected === undefined ? null : changedFiles.length === opts.expected

const receipt: {
  mission: string
  recordedAt: string
  repository: string
  git: Record<string, unknown>
  verification: { label: string; command: string; exitCode: number; passed: boolean }[]
  sdd?: Record<string, unknown>
} = {
  mission: opts.mission,
  recordedAt: new Date().toISOString(),
  repository: process.cwd(),
  git: {
    baseSha: base,
    candidateSha: candidate,
    baseIsAncestorOfCandidate: ancestorOk,
    changedFiles: changedFiles.length,
    expectedFiles: opts.expected ?? null,
    scopeMatchesExpectation: scopeMatch,
    filesChanged: changedFiles,
    insertions,
    deletions,
  },
  verification: checks.map((c) => ({ label: c.label, command: c.command, exitCode: c.exitCode, passed: c.passed })),
}
if (sddVerdict !== null) {
  receipt.sdd = {
    mission: sddVerdict.mission,
    workflow: sddVerdict.workflow,
    complete: sddVerdict.complete,
    missingStages: sddVerdict.missing,
  }
}

const allChecksPass = checks.length > 0 && checks.every((c) => c.passed)
const sddOk = sddVerdict === null || sddVerdict.complete
const verdict: 'PASS' | 'FAIL' = ancestorOk && allChecksPass && sddOk && scopeMatch !== false ? 'PASS' : 'FAIL'

const dir = join(process.cwd(), '.evidence')
mkdirSync(dir, { recursive: true })
const body =
  `# Evidence receipt — generado por scripts/evidence-ledger.ts\n` +
  Object.entries(receipt)
    .map(([k, v]) => `${k}: ${yamlValue(v as YamlValue)}`)
    .join('\n') +
  `\nverdict: ${verdict}\n`
const sha256 = createHash('sha256').update(body).digest('hex')
const file = join(dir, `mission-${opts.mission}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.yaml`)
writeFileSync(file, body + `sha256: ${sha256}\n`)

for (const c of checks) console.error(`${c.passed ? '✔' : '✘'} ${c.label}: ${c.command} → exit ${c.exitCode}`)
console.error(
  `==> diff ${base.slice(0, 7)}..${candidate.slice(0, 7)}: ${changedFiles.length} archivo(s)` +
    (opts.expected !== undefined ? ` (esperados: ${opts.expected})` : ''),
)
if (verdict === 'PASS') {
  console.log(`✔ Receipt PASS — ${file}\n  sha256: ${sha256}`)
  process.exit(0)
} else {
  console.error(`✘ Receipt FAIL — ${file}\n  sha256: ${sha256}`)
  process.exit(1)
}
