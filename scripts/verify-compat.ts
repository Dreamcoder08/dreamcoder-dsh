#!/usr/bin/env node
// verify-compat.ts — suite de compatibilidad del bundle Dreamcoder contra la
// instalación local de DSH.
//
// Compone el perfil `engineering` offline (dsh --dump-config usa el mismo
// algoritmo de capas que el arranque real) y afirma que las filas objetivo
// existen con los contratos esperados. Un cambio upstream que rompa un id o
// una config hace fallar esta suite ANTES de arrancar una sesión.
//
// Se ejecuta con el type-stripping nativo de Node (≥26), sin build, y se tipa con tsgo 7.x.

import { spawnSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const profile = process.argv[2] ?? 'engineering'
const skillsDir = join(repoRoot, 'bundles', 'engineering', 'skills')
const personaMarker = process.env.DC_PERSONA_MARKER ?? 'Dreamcoder'
const dshHome = process.env.DSH_HOME ?? join(process.env.HOME ?? '', '.dsh')

const SKILL_NAMES = [
  'workflow-router',
  'tdd-evidence',
  'review-4r',
  'evidence-ledger',
  'memory-gate',
  'model-router',
  'autonomous-mission',
] as const

const PRESET_ROLES = ['explorer', 'architect', 'implementer', 'tester', 'reviewer', 'security'] as const

let failures = 0
const check = (name: string, ok: boolean, detail = ''): void => {
  console.log(`${ok ? '  ✔' : '  ✘'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures += 1
}

console.log(`==> Componiendo perfil '${profile}' (dsh --dump-config)…`)
const dump = spawnSync('dsh', ['--profile', profile, '--dump-config'], {
  encoding: 'utf8',
  cwd: repoRoot,
  maxBuffer: 64 * 1024 * 1024,
})
if (dump.status !== 0) {
  console.error('ERROR: la composición del perfil falló:\n' + dump.stderr)
  process.exit(1)
}
const config = dump.stdout ?? ''

console.log('==> Afirmaciones de composición:')
check('fila system-prompt presente', /id: system-prompt/.test(config))
check(
  'persona Gentle-AI aplicada',
  new RegExp(`persona: [\\s\\S]{0,4000}${personaMarker}`).test(config),
  `marcador '${personaMarker}' en la sección system-prompt`,
)
check('fila skill-filesystem presente', /id: skill-filesystem/.test(config))
const skillsUserDir = join(dshHome, 'skills')
check(
  'skills enlazadas en $DSH_HOME/skills (raíz user-dsh por defecto)',
  SKILL_NAMES.every((s) => existsSync(join(skillsUserDir, s, 'SKILL.md'))),
  skillsUserDir,
)
check('fila agent-presets presente (roster de presets)', /id: agent-presets/.test(config))
check('fila permission presente (presets de riesgo)', /id: permission/.test(config))
check('bundle engineering cargado como capa', config.includes('dsh-engineering-bundle'))

console.log('==> Artefactos del bundle:')
for (const dir of [
  'bundles/engineering/cordis.patch.yml',
  'policy/AGENTS.md',
  'workflows/direct.md',
  'workflows/mini-sdd.md',
  'workflows/full-sdd.md',
  'memory/engram.cordis.yml',
  'scripts/red-green.ts',
  'scripts/evidence-ledger.ts',
  'scripts/dream-doctor.sh',
]) {
  check(`${dir} existe`, existsSync(join(repoRoot, dir)))
}
for (const skill of SKILL_NAMES) {
  const p = join(skillsDir, skill, 'SKILL.md')
  let frontmatterOk = false
  if (existsSync(p)) {
    const head = readFileSync(p, 'utf8').split('---').slice(0, 3)
    frontmatterOk = head.length >= 3 && /^name:/m.test(head[1] ?? '')
  }
  check(`skill ${skill} con frontmatter válido`, frontmatterOk, p)
}
for (const preset of PRESET_ROLES) {
  const p = join(repoRoot, 'agents', preset, 'agent.cordis.yml')
  let okShape = false
  if (existsSync(p)) {
    // Forma mínima de composición: lista de filas nombradas (id + name).
    const text = readFileSync(p, 'utf8')
    okShape = /- id: persona/.test(text) && /name: '@deepseek-ai\//.test(text)
  }
  check(`preset ${preset} existe y es una composición de filas`, okShape, p)
}
// Los presets enlazados deben componer: el roster los descubre vía
// $DSH_HOME/.agent-presets; un preset roto aparecería como broken.
const presetsLinkOk = PRESET_ROLES.every((role) => existsSync(join(dshHome, '.agent-presets', role, 'agent.cordis.yml')))
check('presets accesibles desde $DSH_HOME/.agent-presets (instalados)', presetsLinkOk)

console.log(
  failures === 0
    ? '\n✔ Compatibilidad verificada: la composición del perfil cumple los contratos esperados.'
    : `\n✘ ${failures} verificación(es) fallaron — revisa arriba antes de arrancar el perfil.`,
)
process.exit(failures === 0 ? 0 : 1)
