#!/usr/bin/env node
// security-gate.ts — enforcement mecánico de la jerarquía de permisos P0–P5
// (policy/AGENTS.md §3–§4). La política deja de ser solo prosa: este gate
// clasifica comandos, bloquea operaciones P5 y rutas sensibles, y alimenta el
// hook pre-commit que impide commitear secretos.
//
// Modos:
//   classify   -- <comando [args…]>     Clasifica el comando (P0–P5). Informativo.
//   command    -- <comando [args…]>     Bloquea el comando si es P5 o toca rutas
//                                       sensibles. Escape explícito con
//                                       DC_SECURITY_BYPASS=razón (auditado).
//   stage-check                         Revisa los archivos staged (pre-commit):
//                                       rutas sensibles o claves privadas en el
//                                       diff bloquean el commit.
//
// Exit codes: 0 permitido · 1 bloqueado · 2 uso inválido.
//
// Se ejecuta con el type-stripping nativo de Node (≥26), sin build, y se tipa
// con tsgo 7.x.

import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

// ── Patrones P5 (policy/AGENTS.md §3): irreversible o alto radio ─────────────
export const DESTRUCTIVE_PATTERNS: readonly { re: RegExp; why: string }[] = [
  { re: /\brm\s+(-[a-zA-Z]*[rf][a-zA-Z]*\s+)+|--recursive/, why: 'rm recursivo/forzado' },
  { re: /\bgit\s+reset\s+--hard\b/, why: 'git reset --hard' },
  { re: /\bgit\s+clean\b.*-[a-zA-Z]*[fdx]/, why: 'git clean -fdx' },
  { re: /\bgit\s+push\s+(--force|-f)\b/, why: 'git push --force' },
  { re: /\bdrop\s+(database|table)\b/i, why: 'DROP DATABASE/TABLE' },
  { re: /\btruncate\s+table\b.*\bcascade\b/i, why: 'TRUNCATE … CASCADE masivo' },
  { re: /\bterraform\s+destroy\b/, why: 'terraform destroy' },
  { re: /\bkubectl\s+delete\b.*\b(pvc|persistentvolumeclaim|namespace|crd|customresourcedefinition)\b/i, why: 'kubectl delete sobre recursos con estado' },
  { re: /\bmkfs(\.\w+)?\b/, why: 'mkfs' },
  { re: /\bdd\b[^\n]*of=\/dev\//, why: 'dd hacia dispositivo de bloques' },
]

// ── Rutas sensibles denegadas por defecto (policy/AGENTS.md §4) ──────────────
export const SENSITIVE_PATH_PATTERNS: readonly RegExp[] = [
  /(^|[\\/])\.ssh([\\/]|$)/,
  /(^|[\\/])\.aws([\\/]|$)/,
  /(^|[\\/])\.gnupg([\\/]|$)/,
  /(^|[\\/])\.env($|\.[^.]*$)/,
  /\.pem$/,
  /\.key$/,
  /\.p12$/,
  /(^|[\\/])id_rsa/,
  /(credential|credentials)/i,
  /(secret|secrets)([\\/.$_-]|$)/i,
  /(token|tokens)([\\/.$_-]|$)/i,
]

const PRIVATE_KEY_MARKER = /-----BEGIN [A-Z ]*PRIVATE KEY-----/

export interface Classification {
  level: 'P0' | 'P1' | 'P2' | 'P3' | 'P4' | 'P5' | 'UNKNOWN'
  blocked: boolean
  reasons: string[]
}

export function classifyCommand(argv: readonly string[]): Classification {
  const line = argv.join(' ')
  const reasons: string[] = []
  const ORDER = ['UNKNOWN', 'P0', 'P1', 'P2', 'P3', 'P4', 'P5'] as const
  let rank = 0
  let level: Classification['level'] = 'UNKNOWN'

  const bump = (l: Classification['level'], why?: string): void => {
    if (ORDER.indexOf(l) > rank) {
      rank = ORDER.indexOf(l)
      level = l
    }
    if (why !== undefined) reasons.push(why)
  }

  for (const p of SENSITIVE_PATH_PATTERNS) {
    if (argv.some((a) => p.test(a))) bump('P5', `ruta sensible: patrón ${p.source}`)
  }
  for (const d of DESTRUCTIVE_PATTERNS) {
    if (d.re.test(line)) bump('P5', d.why)
  }
  if (rank === ORDER.indexOf('P5')) return { level, blocked: true, reasons }

  if (/\b(git\s+push|npm\s+publish|pnpm\s+publish|gh\s+release|docker\s+push)\b/.test(line)) bump('P4', 'publicación externa')
  if (/\b(curl|wget|npm\s+(install|i|add)|pnpm\s+add|pip\s+install|go\s+install|brew\s+install)\b/.test(line)) bump('P3', 'red explícita')
  if (/\b(test|lint|build|fmt|format|typecheck|verify)\b/.test(line)) bump('P2', 'ejecución segura reversible')
  return { level, blocked: false, reasons }
}

export function isSensitivePath(p: string): boolean {
  return SENSITIVE_PATH_PATTERNS.some((re) => re.test(p))
}

function stagedFiles(): string[] {
  const out = execFileSync('git', ['diff', '--cached', '--name-only'], { encoding: 'utf8' })
  return out.split('\n').filter(Boolean)
}

function stagedAddedLines(): string[] {
  const out = execFileSync('git', ['diff', '--cached', '--unified=0', '--', ':!*.lock'], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
  return out
    .split('\n')
    .filter((l) => l.startsWith('+') && !l.startsWith('+++'))
}

function audit(event: string, detail: Record<string, string>): void {
  try {
    const dir = join(process.cwd(), '.evidence')
    mkdirSync(dir, { recursive: true })
    appendFileSync(
      join(dir, 'security-gate-audit.jsonl'),
      JSON.stringify({ event, at: new Date().toISOString(), user: process.env.USER ?? 'unknown', ...detail }) + '\n',
    )
  } catch {
    // El audit log es best-effort: jamás bloquea por fallas propias.
  }
}

const USAGE =
  'Uso:\n' +
  '  node scripts/security-gate.ts classify    -- <comando [args…]>\n' +
  '  node scripts/security-gate.ts command     -- <comando [args…]>\n' +
  '  node scripts/security-gate.ts stage-check\n'

const argv = process.argv.slice(2)
const mode = argv[0]
const sep = argv.indexOf('--')

if (mode === 'stage-check') {
  const files = stagedFiles()
  const badPaths = files.filter(isSensitivePath)
  const leakedKeys = stagedAddedLines().filter((l) => PRIVATE_KEY_MARKER.test(l))
  if (badPaths.length === 0 && leakedKeys.length === 0) {
    console.log(`✔ stage-check OK — ${files.length} archivo(s) staged sin rutas sensibles ni claves privadas`)
    process.exit(0)
  }
  for (const f of badPaths) console.error(`✘ ruta sensible staged: ${f}`)
  for (const _ of leakedKeys) console.error('✘ clave privada detectada en el diff staged')
  console.error('✘ Commit bloqueado por security-gate (policy/AGENTS.md §4)')
  process.exit(1)
}

if ((mode === 'classify' || mode === 'command') && sep !== -1 && sep + 1 < argv.length) {
  const cmd = argv.slice(sep + 1)
  const c = classifyCommand(cmd)
  console.log(`nivel: ${c.level} · bloqueado: ${c.blocked}${c.reasons.length > 0 ? `\nmotivos: ${c.reasons.join('; ')}` : ''}`)
  if (mode === 'classify') process.exit(0)

  const bypass = process.env.DC_SECURITY_BYPASS
  if (!c.blocked) process.exit(0)
  if (bypass !== undefined && bypass.trim() !== '') {
    audit('bypass', { command: cmd.join(' '), reason: bypass.trim(), level: c.level })
    console.error(`⚠ BYPASS auditado (${bypass.trim()}) — registrado en .evidence/security-gate-audit.jsonl`)
    process.exit(0)
  }
  audit('block', { command: cmd.join(' '), level: c.level, reasons: c.reasons.join('; ') })
  console.error(
    `✘ BLOQUEADO (P5): ${c.reasons.join('; ')}. ` +
      `Requiere aprobación humana explícita (policy/AGENTS.md §3). ` +
      `Escape auditable: DC_SECURITY_BYPASS="quién aprobó y cuándo" antes del comando.`,
  )
  process.exit(1)
}

console.error(USAGE)
process.exit(2)
