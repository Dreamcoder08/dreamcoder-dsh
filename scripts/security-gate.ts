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
// El matching se hace sobre una línea NORMALIZADA (flags globales como
// `git -C dir` o `terraform -chdir=d` se separan antes) para cerrar las
// formas canónicas que la adyacencia simple dejaría pasar.
export const DESTRUCTIVE_PATTERNS: readonly { re: RegExp; why: string }[] = [
  // rm recursivo/forzado: formas cortas (-rf, -r, -f…) y largas (--recursive,
  // --force). La alternativa larga está anclada al binario rm, por lo que no
  // criminaliza `grep/cp --recursive`.
  { re: /\brm\s+(?:-{1,2}[\w-]+\s+)*-\w*[rRfF]\w*\s|\brm\s+(?:--recursive|--force)\b/, why: 'rm recursivo/forzado' },
  { re: /\bgit\s+reset\s+--hard\b/, why: 'git reset --hard' },
  { re: /\bgit\s+clean\b[^|;&]*-[a-zA-Z]*[fdx]/, why: 'git clean -fdx' },
  { re: /\bgit\s+push\b[^|;&]*(--force\b|--force-with-lease\b|-f\b|\s\+[\w./-]+)/, why: 'git push forzado (flag o refspec +ref)' },
  { re: /\bdrop\s+(database|table)\b/i, why: 'DROP DATABASE/TABLE' },
  { re: /\btruncate\s+table\b/i, why: 'TRUNCATE TABLE (alto radio: requiere bypass auditable)' },
  { re: /\bterraform\s+destroy\b/, why: 'terraform destroy' },
  { re: /\bkubectl\s+delete\b/i, why: 'kubectl delete (verificar recurso con estado)' },
  { re: /\bmkfs(\.\w+)?\b/, why: 'mkfs' },
  { re: /\bdd\b[^\n]*of=\/dev\//, why: 'dd hacia dispositivo de bloques' },
]

// ── Rutas sensibles denegadas por defecto (policy/AGENTS.md §4) ──────────────
// Se evalúan SOLO sobre argumentos con forma de ruta (contienen separador o
// empiezan con punto), para no criminalizar palabras sueltas en flags.
export const SENSITIVE_PATH_PATTERNS: readonly RegExp[] = [
  /(^|[\\/])\.ssh([\\/]|$)/i,
  /(^|[\\/])\.aws([\\/]|$)/i,
  /(^|[\\/])\.gnupg([\\/]|$)/i,
  /(^|[\\/])\.env(\.[^/]*)?$/i,
  /\.pem$/i,
  /\.key$/i,
  /\.p12$/i,
  /(^|[\\/])id_(rsa|ed25519|ecdsa)/i,
  /credential/i,
  /secret/i,
  /token/i,
]

const PRIVATE_KEY_MARKER = /-----BEGIN [A-Z ]*PRIVATE KEY-----/

/** Un argumento "parece ruta" si lleva separador o comienza con punto. */
function looksLikePath(arg: string): boolean {
  return arg.includes('/') || arg.includes('\\') || arg.startsWith('.')
}

/**
 * Normaliza la línea de comando para el matching destructivo: separa los
 * valores de flags globales conocidos (`git -C dir …`, `terraform
 * -chdir=dir …`, `kubectl -n ns …`) para que la adyacencia del patrón no
 * dependa de ellos.
 */
export function normalizeCommand(argv: readonly string[]): string {
  // binario → flags que consumen valor y son ajenos a la operación.
  const GLOBAL_FLAGS: Record<string, RegExp> = {
    git: /^(-C|--git-dir|--work-tree)$/,
    terraform: /^(-chdir)$/,
    kubectl: /^(-n|--namespace|--context|--kubeconfig)$/,
    psql: /^(-h|-p|-U|-d)$/,
  }
  // Flags con valor PEGADO (`-chdir=prod`): se omiten enteras.
  const GLOBAL_FLAGS_ATTACHED: Record<string, RegExp> = {
    git: /^--git-dir=|^--work-tree=/,
    terraform: /^-chdir=/,
    kubectl: /^--namespace=|^--context=|^--kubeconfig=/,
  }
  const out: string[] = []
  let skipValue = false
  for (const rawArg of argv) {
    const a = rawArg ?? ''
    if (skipValue) {
      skipValue = false
      continue
    }
    const headRe = out.length > 0 ? (GLOBAL_FLAGS[out[0] as string] ?? null) : null
    const attachedRe = out.length > 0 ? (GLOBAL_FLAGS_ATTACHED[out[0] as string] ?? null) : null
    if (a.startsWith('-') && headRe !== null && headRe.test(a)) {
      // Flag y su valor se omiten de la línea normalizada.
      skipValue = true
      continue
    }
    if (a.startsWith('-') && attachedRe !== null && attachedRe.test(a)) continue
    out.push(a)
  }
  return out.join(' ')
}

export interface Classification {
  level: 'P0' | 'P1' | 'P2' | 'P3' | 'P4' | 'P5' | 'UNKNOWN'
  blocked: boolean
  reasons: string[]
}

export function classifyCommand(argv: readonly string[]): Classification {
  const line = normalizeCommand(argv)
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

  for (const a of argv) {
    if (!looksLikePath(a)) continue
    for (const p of SENSITIVE_PATH_PATTERNS) {
      if (p.test(a)) bump('P5', `ruta sensible: patrón ${p.source}`)
    }
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

/** Escribe el audit log; devuelve false si NO pudo registrarse (fail-closed). */
function audit(event: string, detail: Record<string, string>): boolean {
  try {
    const dir = join(process.cwd(), '.evidence')
    mkdirSync(dir, { recursive: true })
    appendFileSync(
      join(dir, 'security-gate-audit.jsonl'),
      JSON.stringify({ event, at: new Date().toISOString(), user: process.env.USER ?? 'unknown', ...detail }) + '\n',
    )
    return true
  } catch {
    // El invariante "el único escape es auditable" es fail-closed: si la
    // traza no puede escribirse, el bypass no se otorga.
    return false
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
    if (!audit('bypass', { command: cmd.join(' '), reason: bypass.trim(), level: c.level })) {
      console.error(
        '✘ BYPASS DENEGADO: no se pudo escribir la traza de auditoría en .evidence/.' +
          ' El escape exige registro; libera permisos de escritura y reintenta.',
      )
      process.exit(1)
    }
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
