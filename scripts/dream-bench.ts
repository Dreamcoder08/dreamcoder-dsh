#!/usr/bin/env node
// dream-bench.ts — runner MODO DRIVEN del mini-bench Dreamcoder.
//
// Un test verde sobre bench/corpus.ts solo valida DECLARACIONES (análogo a
// `go test ./bench` en gentle-ai): jamás prueba ejecución. La única prueba de
// ejecución es ESTE script: ejecuta cada step real con `bash -c`, observa
// exit codes y salidas, y emite un veredicto por journey. Resumen honesto:
// completed/failed — jamás se fabrica un resultado para mover la columna.
//
// Recibo: .evidence/bench-<epoch>.json + .evidence/bench-latest.json
// Exit code: 0 si TODOS los journeys completaron; 1 si alguno falló;
//            2 si el corpus es inválido (declaraciones).
//
// Se ejecuta con type-stripping nativo de Node (≥26): sin build, sin deps.

import { spawnSync } from 'node:child_process'
import { mkdirSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'
import { journeys, AXES, type Journey, type BenchStep } from '../bench/corpus.ts'

const REPO_ROOT = resolve(import.meta.dirname, '..')
const EVIDENCE_DIR = join(REPO_ROOT, '.evidence')

/** Id único de corrida: journeys que tocan estado compartido lo usan para no colisionar. */
export const RUN_ID = `${process.pid}-${Date.now()}`

export interface StepResult {
  name: string
  exit: number | null
  ok: boolean
  detail: string
}

/** Valida declaraciones del corpus. Devuelve lista de errores; [] = válido. */
export function validateCorpus(list: readonly Journey[]): string[] {
  const errors: string[] = []
  const seen = new Set<string>()
  for (const j of list) {
    if (!/^j\d+$/.test(j.id)) errors.push(`${j.id}: id debe tener formato j<N>`)
    if (seen.has(j.id)) errors.push(`${j.id}: id duplicado en el corpus`)
    seen.add(j.id)
    if (!AXES.includes(j.axis)) errors.push(`${j.id}: axis '${j.axis}' fuera del vocabulario cerrado`)
    if (j.steps.length === 0) errors.push(`${j.id}: journey sin steps (journey muerto)`)
    if (!j.why || j.why.trim() === '') errors.push(`${j.id}: falta el POR QUÉ (why)`)
    for (const s of j.steps) {
      if (!s.shell || s.shell.trim() === '') errors.push(`${j.id}/${s.name}: step sin comando ejecutable`)
    }
  }
  return errors
}

const exitsAccepted = (step: BenchStep): number[] =>
  step.expectExit === undefined ? [0] : Array.isArray(step.expectExit) ? [...step.expectExit] : [step.expectExit]

const clip = (s: string, max = 160): string => {
  const flat = s.replace(/\n/g, '\\n')
  return flat.length <= max ? flat : `${flat.slice(0, max)}…(+${flat.length - max} chars)`
}

/** Evalúa el resultado crudo de un step contra sus expectativas. */
export function evaluateStep(step: BenchStep, res: { status: number | null; stdout: string; stderr: string }): StepResult {
  const accepted = exitsAccepted(step)
  const exit = res.status
  if (exit === null) {
    return { name: step.name, exit, ok: false, detail: 'el proceso fue terminado por timeout o señal' }
  }
  if (!accepted.includes(exit)) {
    return {
      name: step.name,
      exit,
      ok: false,
      detail: `exit ${exit}, esperado ${accepted.join('|')} · stderr: ${clip(res.stderr)}`,
    }
  }
  for (const [label, re, out] of [
    ['stdout', step.expectStdout, res.stdout],
    ['stderr', step.expectStderr, res.stderr],
  ] as const) {
    if (re !== undefined && !re.test(out)) {
      return { name: step.name, exit, ok: false, detail: `${label} no satisface ${String(re)} · ${label}: ${clip(out)}` }
    }
  }
  return { name: step.name, exit, ok: true, detail: '' }
}

export interface JourneyResult {
  id: string
  title: string
  axis: string
  status: 'completed' | 'failed'
  failedStep?: string
  detail?: string
}

/** Ejecuta UN journey completo (modo driven); los journeys se aíslan entre sí. */
export function runJourney(j: Journey): JourneyResult {
  for (const step of j.steps) {
    const res = spawnSync('bash', ['-c', step.shell], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout: 120_000,
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, DSH_BENCH_RUN_ID: RUN_ID },
    })
    const verdict = evaluateStep(step, { status: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' })
    if (!verdict.ok) {
      return { id: j.id, title: j.title, axis: j.axis, status: 'failed', failedStep: verdict.name, detail: verdict.detail }
    }
  }
  return { id: j.id, title: j.title, axis: j.axis, status: 'completed' }
}

/** Args aceptados por el runner. `only` null = corpus completo. */
export interface BenchArgs {
  only: Set<string> | null
  list: boolean
  json: boolean
}

export type ParsedArgs =
  | { ok: true; args: BenchArgs }
  | { ok: false; code: number; message: string }

/** Parseo puro de argv — testeable sin ejecutar journeys. Exit 4 = uso inválido. */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  const args: BenchArgs = { only: null, list: false, json: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--only') {
      const raw = argv[++i] ?? ''
      const ids = raw.split(',').map((s) => s.trim()).filter((s) => s !== '')
      if (ids.length === 0) {
        return { ok: false, code: 4, message: 'Argumento inválido: --only requiere ids separados por coma' }
      }
      args.only = new Set(ids)
    } else if (a === '--list') {
      args.list = true
    } else if (a === '--json') {
      args.json = true
    } else {
      return { ok: false, code: 4, message: `Argumento desconocido: ${String(a)}` }
    }
  }
  return { ok: true, args }
}

/** Listado legible del corpus para --list (no ejecuta nada). */
export function formatList(list: readonly Journey[]): string {
  return list
    .map((j) => `${j.id}  [${j.axis}]  ${j.title} — ${j.why} (${j.steps.length} step(s))`)
    .join('\n')
}

function writeReceipt(results: JourneyResult[], completed: number, failed: number): void {
  mkdirSync(EVIDENCE_DIR, { recursive: true })
  const receipt = {
    kind: 'dream-bench',
    drivenMode: true,
    runId: RUN_ID,
    corpusSize: results.length,
    totals: { completed, failed },
    journeys: results,
  }
  // Escritura atómica (tmp + rename): dos benches concurrentes nunca dejan un
  // bench-latest.json a medias; el último rename gana, sin corrupción.
  const tmp = `${EVIDENCE_DIR}/bench-latest.json.tmp-${RUN_ID}`
  writeFileSync(tmp, JSON.stringify(receipt, null, 2))
  renameSync(tmp, join(EVIDENCE_DIR, 'bench-latest.json'))
  const stamp = `${EVIDENCE_DIR}/bench-${Date.now()}.json`
  writeFileSync(stamp, JSON.stringify(receipt, null, 2))
}

// Exportado para tests (captura de stdout); la guarda invokedFile evita
// ejecución en import.
export function main(argv: readonly string[]): number {
  // --only <id,id,…>: subconjunto para entornos sin dependencias de host.
  // --list: muestra el corpus y sale (no ejecuta journeys).
  // --json: stdout es UN objeto JSON machine-readable (resultados por journey).
  const parsed = parseArgs(argv)
  if (!parsed.ok) {
    console.error(parsed.message)
    return parsed.code
  }
  const { only, list, json } = parsed.args

  const declarationErrors = validateCorpus(journeys)
  if (declarationErrors.length > 0) {
    console.error('✘ corpus inválido (declaraciones):')
    for (const e of declarationErrors) console.error(`  - ${e}`)
    return 2
  }

  if (list) {
    console.log(formatList(journeys))
    return 0
  }

  const selected = only === null ? journeys : journeys.filter((j) => only.has(j.id))
  if (selected.length === 0) {
    console.error(`✘ --only no coincide con ningún journey del corpus (${journeys.map((j) => j.id).join(', ')})`)
    return 4
  }

  const results: JourneyResult[] = []
  for (const j of selected) {
    const r = runJourney(j)
    results.push(r)
    if (!json) {
      const mark = r.status === 'completed' ? '✔' : '✘'
      console.log(`${mark} ${r.id} ${r.title}${r.status === 'failed' ? `\n    paso: ${r.failedStep}\n    ${r.detail}` : ''}`)
    }
  }

  const completed = results.filter((r) => r.status === 'completed').length
  const failed = results.length - completed
  const skipped = journeys.length - results.length
  if (json) {
    const payload = {
      kind: 'dream-bench',
      drivenMode: true,
      runId: RUN_ID,
      corpusSize: journeys.length,
      partial: skipped > 0,
      totals: { completed, failed, skipped },
      journeys: results,
    }
    console.log(JSON.stringify(payload))
  } else {
    console.log('')
    console.log(
      `bench driven: ${completed} completado(s) / ${failed} fallido(s) / ${skipped} omitido(s) — corpus ${journeys.length} journey(s)` +
        (skipped > 0 ? ` (corrida parcial: ${results.map((r) => r.id).join(',')})` : ''),
    )
  }
  writeReceipt(results, completed, failed)
  return failed === 0 ? 0 : 1
}

const thisFile = fileURLToPath(import.meta.url)
const invokedFile = (() => {
  try {
    return process.argv[1] !== undefined ? realpathSync(process.argv[1]) : ''
  } catch {
    return process.argv[1] ?? ''
  }
})()

if (invokedFile === thisFile) process.exit(main(process.argv.slice(2)))
