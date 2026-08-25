#!/usr/bin/env node
// evidence-ledger.mjs — receipt de misión derivado de Git.
//
// Genera el registro probatorio de una misión: SHAs base/candidato, archivos
// cambiados vs esperados, verificaciones ejecutadas (comando + exit code) y
// hash SHA256 del receipt completo. El agente AFIRMA menos y el sistema
// REGISTRA más: este script solo acepta hechos que Git y los comandos
// ejecutados pueden demostrar.
//
// Uso:
//   node scripts/evidence-ledger.mjs \
//     --mission feat-auth-refresh \
//     --base 82ac31 \
//     [--expected 9] \
//     --check "unit tests" -- "pnpm test --run" \
//     [--check "lint" -- "pnpm lint"] ...
//
// Escribe .evidence/mission-<mission>-<ts>.yaml y su SHA256. Exit code 0 solo
// si todas las verificaciones pasan y el conteo de archivos coincide.

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Serializa un valor como YAML de una línea (arrays/objetos anidan con flow style). */
const yamlValue = (v) => {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) return '[' + v.map(yamlValue).join(', ') + ']'
  if (typeof v === 'object') {
    const entries = Object.entries(v).map(([k, val]) => `${k}: ${yamlValue(val)}`)
    return '{' + entries.join(', ') + '}'
  }
  const s = String(v)
  // Cita si contiene caracteres que YAML reservaría o romperían el flujo.
  return /[:#{}\[\],&*'"\n]|^[\s-]|[\s]$/.test(s) ? JSON.stringify(s) : s
}

function parseArgs(argv) {
  const out = { checks: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--mission') out.mission = argv[++i]
    else if (a === '--base') out.base = argv[++i]
    else if (a === '--candidate') out.candidate = argv[++i]
    else if (a === '--expected') out.expected = Number(argv[++i])
    else if (a === '--check') {
      const label = argv[++i]
      if (argv[++i] !== '--') throw new Error('--check requiere "-- <comando>"')
      const cmd = []
      while (i + 1 < argv.length && argv[i + 1] !== '--check' && !argv[i + 1].startsWith('--mission') &&
             !argv[i + 1].startsWith('--base') && !argv[i + 1].startsWith('--candidate') &&
             !argv[i + 1].startsWith('--expected')) cmd.push(argv[++i])
      // Un único token con espacios = comando citado como string completo.
      const resolved = cmd.length === 1 && /\s/.test(cmd[0]) ? cmd[0].trim().split(/\s+/) : cmd
      if (resolved.length === 0) throw new Error(`--check '${label}' sin comando`)
      out.checks.push({ label, command: resolved })
    } else throw new Error(`Argumento desconocido: ${a}`)
  }
  if (!out.mission) throw new Error('--mission es obligatorio')
  if (!out.base) throw new Error('--base es obligatorio')
  return out
}

const opts = parseArgs(process.argv.slice(2))

const git = (args) => {
  const r = spawnSync('git', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} falló:\n${r.stderr}`)
  return r.stdout.trim()
}

const candidate = opts.candidate ?? git(['rev-parse', 'HEAD'])
const base = opts.base
const ancestorOk =
  spawnSync('git', ['merge-base', '--is-ancestor', base, candidate], { encoding: 'utf8' }).status === 0

const changedFiles = git(['diff', '--name-only', `${base}..${candidate}`]).split('\n').filter(Boolean)
const insertions = Number(git(['diff', '--shortstat', `${base}..${candidate}`]).match(/(\d+) insertion/)?.[1] ?? 0)
const deletions = Number(git(['diff', '--shortstat', `${base}..${candidate}`]).match(/(\d+) deletion/)?.[1] ?? 0)

const runCheck = (c) => {
  const r = spawnSync(c.command[0], c.command.slice(1), { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  return {
    label: c.label,
    command: c.command.join(' '),
    exitCode: r.status ?? -1,
    passed: r.status === 0,
    outputTail: ((r.stdout ?? '') + (r.stderr ?? '')).slice(-4000),
  }
}
const checks = opts.checks.map(runCheck)

const scopeMatch = opts.expected === undefined ? null : changedFiles.length === opts.expected

const receipt = {
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

const allChecksPass = checks.length > 0 && checks.every((c) => c.passed)
const verdict = ancestorOk && allChecksPass && scopeMatch !== false ? 'PASS' : 'FAIL'

const dir = join(process.cwd(), '.evidence')
mkdirSync(dir, { recursive: true })
const body =
  `# Evidence receipt — generado por scripts/evidence-ledger.mjs\n` +
  Object.entries(receipt)
    .map(([k, v]) => `${k}: ${yamlValue(v)}`)
    .join('\n') +
  `\nverdict: ${verdict}\n`
const sha256 = createHash('sha256').update(body).digest('hex')
const file = join(dir, `mission-${opts.mission}-${Date.now()}.yaml`)
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
