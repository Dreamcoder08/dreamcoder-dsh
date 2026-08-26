#!/usr/bin/env node
// cc-hook-guard.ts — puente del security-gate hacia hooks estilo Claude Code.
//
// Un hook PreToolUse (dialecto Claude Code, ejecutado por el bridge
// @deepseek-ai/dsh-hooks-claude-code) recibe por stdin el payload JSON del
// evento y decide con su EXIT CODE:
//   0  permitir · 2 bloquear con feedback (stderr llega al modelo)
//
// Aquí la decisión la toma scripts/security-gate.ts (deny-list P5 §3 +
// rutas sensibles §4): enforcement mecánico DENTRO de cada sesión, sin
// depender de que el modelo obedezca la política.
//
// Uso (desde claude-hooks.json): node …/scripts/cc-hook-guard.ts
//
// Política de fallo del gate (env CC_HOOK_GUARD_FAIL_MODE):
//   open   (default) — si security-gate no pudo correr/crashea, PERMITE y lo
//           declara en stderr: disponibilidad ante cada Bash de la sesión.
//   closed — si el gate no corrió, BLOCA (exit 2): para sesiones donde un
//           bypass silencioso es inaceptable.
// Distinto del payload malformado (siempre fail-open: fuera de contrato).

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const repoRoot = join(import.meta.dirname, '..')
const GATE = join(repoRoot, 'scripts', 'security-gate.ts')

function main(): number {
  let raw = ''
  try {
    // fd 0 síncrono: el bridge escribe el payload y cierra stdin.
    raw = readFileSync(0, 'utf8')
  } catch {
    return 0 // stdin ilegible: no hay nada que decidir, no se bloquea por ruido
  }

  let command: unknown
  try {
    const payload = JSON.parse(raw) as {
      tool_name?: string
      tool_input?: { command?: unknown }
    }
    // Solo custodiamos comandos de shell; otras tools pasan sin tocarlas.
    if (payload.tool_name !== undefined && payload.tool_name !== 'Bash' && payload.tool_name !== 'bash') return 0
    command = payload.tool_input?.command
  } catch {
    return 0 // payload no-JSON: fuera del contrato del gate, no se bloquea
  }
  if (typeof command !== 'string' || command.trim() === '') return 0

  const probe = spawnSync(process.execPath, [GATE, 'classify', '--', command], {
    encoding: 'utf8',
    timeout: 15_000,
    maxBuffer: 1024 * 1024,
  })
  const failClosed = process.env.CC_HOOK_GUARD_FAIL_MODE === 'closed'
  if (probe.status !== 0 || probe.error !== undefined) {
    // El GATE no corrió limpio (crash, timeout, binario ausente): decisión de
    // política explícita, no un bypass silencioso.
    console.error(
      `cc-hook-guard: security-gate NO corrió limpio (exit ${probe.status ?? 'signal'}) — fail-${failClosed ? 'CLOSED' : 'OPEN'} declarado`,
    )
    return failClosed ? 2 : 0
  }
  if (/bloqueado:\s*true/.test(probe.stdout)) {
    console.error(
      `[dreamcoder] COMANDO BLOQUEADO por policy/AGENTS.md §3–§4 (security-gate).\n` +
        `Comando: ${command.slice(0, 300)}\n${probe.stdout.trim()}\n` +
        `Si un humano lo aprueba, ejecútalo tú mismo o usa DC_SECURITY_BYPASS según política §3.`,
    )
    return 2
  }
  return 0
}

process.exit(main())
