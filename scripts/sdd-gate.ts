#!/usr/bin/env node
// sdd-gate.ts — gate runtime del pipeline SDD (workflows/ + contracts/).
//
// Los contratos declaran etapas con orden y exit criteria; este gate hace que
// saltarse una etapa FALLE mecánicamente: cada transición se registra en
// .evidence/sdd-<mission>.json validando que la etapa sea exactamente la
// siguiente esperada por el contrato del workflow declarado.
//
// Uso:
//   node scripts/sdd-gate.ts start   --workflow mini-sdd --mission feat-x
//   node scripts/sdd-gate.ts advance --mission feat-x --stage propuesta --note "…"
//   node scripts/sdd-gate.ts status  --mission feat-x
//   node scripts/sdd-gate.ts verify  --mission feat-x
//
// Exit codes: 0 OK · 1 gate violado o misión incompleta · 2 uso inválido.
//
// Se ejecuta con el type-stripping nativo de Node (≥26), sin build.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

interface Stage {
  id: string
  heading: string
}

interface Contract {
  workflow: string
  risk: string[]
  stages: Stage[]
}

interface StageState {
  id: string
  completedAt: string
  note: string
}

interface MissionState {
  mission: string
  workflow: string
  contractStages: string[]
  stages: StageState[]
  startedAt: string
}

const USAGE =
  'Uso:\n' +
  '  node scripts/sdd-gate.ts start   --workflow <direct|mini-sdd|full-sdd> --mission <nombre>\n' +
  '  node scripts/sdd-gate.ts advance --mission <nombre> --stage <id> --note "evidencia"\n' +
  '  node scripts/sdd-gate.ts status  --mission <nombre>\n' +
  '  node scripts/sdd-gate.ts verify  --mission <nombre>\n'

const repoRoot = join(import.meta.dirname, '..')

function parseNamedArgs(argv: readonly string[]): Record<string, string | true> {
  const KNOWN = new Set(['workflow', 'mission', 'stage', 'note', 'force'])
  const out: Record<string, string | true> = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === undefined) continue
    if (!a.startsWith('--')) throw new Error(`Argumento desconocido: ${a}`)
    const key = a.slice(2)
    if (!KNOWN.has(key)) throw new Error(`Argumento desconocido: ${a}`)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) out[key] = true
    else {
      out[key] = next
      i++
    }
  }
  return out
}

function statePath(mission: string): string {
  const dir = join(process.cwd(), '.evidence')
  mkdirSync(dir, { recursive: true })
  return join(dir, `sdd-${mission}.json`)
}

function loadContract(workflow: string): Contract {
  const p = join(repoRoot, 'contracts', `${workflow}.json`)
  if (!existsSync(p)) throw new Error(`Contrato inexistente: ${p}`)
  return JSON.parse(readFileSync(p, 'utf8')) as Contract
}

function loadMission(mission: string): MissionState {
  const p = statePath(mission)
  if (!existsSync(p)) throw new Error(`No hay estado SDD para la misión '${mission}' (${p}). ¿Corriste 'start'?`)
  return JSON.parse(readFileSync(p, 'utf8')) as MissionState
}

const argv = process.argv.slice(2)
const cmd = argv[0]

try {
  if (cmd === 'start') {
    const args = parseNamedArgs(argv.slice(1))
    const workflow = String(args.workflow ?? '')
    const mission = String(args.mission ?? '')
    if (workflow === '' || mission === '') {
      console.error(USAGE)
      process.exit(2)
    }
    if (/[/\\]|\.\./.test(mission)) throw new Error('Nombre de misión inválido')
    const contract = loadContract(workflow)
    if (existsSync(statePath(mission)) && args.force !== true) {
      console.error(
        `✘ La misión '${mission}' ya tiene estado SDD. Re-iniciar borraría el progreso ` +
          `(y con él un futuro receipt --sdd). Usa --force solo si de verdad quieres empezar de cero.`,
      )
      process.exit(1)
    }
    const state: MissionState = {
      mission,
      workflow,
      contractStages: contract.stages.map((s) => s.id),
      stages: [],
      startedAt: new Date().toISOString(),
    }
    writeFileSync(statePath(mission), JSON.stringify(state, null, 2) + '\n')
    console.log(`✔ Misión '${mission}' iniciada (${workflow}, ${contract.stages.length} etapas)`)
    process.exit(0)
  }

  if (cmd === 'advance') {
    const args = parseNamedArgs(argv.slice(1))
    const mission = String(args.mission ?? '')
    const stage = String(args.stage ?? '')
    const note = String(args.note ?? '')
    if (mission === '' || stage === '' || note.trim() === '') {
      console.error(USAGE)
      process.exit(2)
    }
    const state = loadMission(mission)
    const done = new Set(state.stages.map((s) => s.id))
    const nextExpected = state.contractStages.find((id) => !done.has(id))
    if (nextExpected === undefined) {
      console.error(`✘ Todas las etapas ya están completas para '${mission}'.`)
      process.exit(1)
    }
    if (stage !== nextExpected) {
      console.error(
        `✘ GATE VIOLADO: la etapa esperada es '${nextExpected}', no '${stage}'. ` +
          `El contrato ${state.workflow} exige orden estricto.`,
      )
      process.exit(1)
    }
    state.stages.push({ id: stage, completedAt: new Date().toISOString(), note })
    writeFileSync(statePath(mission), JSON.stringify(state, null, 2) + '\n')
    const remaining = state.contractStages.filter((id) => !done.has(id)).length - 1
    console.log(`✔ Etapa '${stage}' completada${remaining > 0 ? ` — faltan ${remaining}` : ' — misión completa'}`)
    process.exit(0)
  }

  if (cmd === 'status') {
    const args = parseNamedArgs(argv.slice(1))
    const state = loadMission(String(args.mission ?? ''))
    for (const id of state.contractStages) {
      const s = state.stages.find((x) => x.id === id)
      console.log(`${s !== undefined ? '✔' : '·'} ${id}${s !== undefined ? ` — ${s.note}` : ''}`)
    }
    process.exit(0)
  }

  if (cmd === 'verify') {
    const args = parseNamedArgs(argv.slice(1))
    const mission = String(args.mission ?? '')
    const state = loadMission(mission)
    const missing = state.contractStages.filter((id) => !state.stages.some((s) => s.id === id))
    if (missing.length > 0) {
      console.error(`✘ SDD incompleto para '${mission}' (${state.workflow}): faltan ${missing.join(', ')}`)
      process.exit(1)
    }
    console.log(`✔ SDD completo para '${mission}' (${state.workflow}): ${state.contractStages.length} etapas en orden`)
    process.exit(0)
  }

  console.error(USAGE)
  process.exit(2)
} catch (err) {
  // Uso inválido (argumentos) → 2; gate violado o estado problemático → 1.
  const msg = err instanceof Error ? err.message : String(err)
  if (/Argumento desconocido/.test(msg)) {
    console.error(`✘ ${msg}`)
    process.exit(2)
  }
  console.error(`✘ ${msg}`)
  process.exit(1)
}
