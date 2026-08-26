#!/usr/bin/env node
// sdd-specs.ts — specs canónicas SDD: persistencia y archivo de artefactos.
//
// Cada misión SDD (mini/full) deja su especificación canónica en
// <repo>/specs/<misión>/spec.md — autodescripta (front matter) y alineada con
// el contrato del workflow (contracts/<workflow>.json): una sección por etapa.
// El gate `sync` hace visible la deriva spec↔contrato; `archive` congela la
// spec verificada en specs/_archive/ con SHA-256 e índice.
//
// Uso:
//   node scripts/sdd-specs.ts new     --workflow <W> --mission <X> [--specs-dir <dir>] [--force]
//   node scripts/sdd-specs.ts sync    --mission <X> [--specs-dir <dir>]
//   node scripts/sdd-specs.ts archive --mission <X> [--specs-dir <dir>]
//   node scripts/sdd-specs.ts status  [--specs-dir <dir>]
//
// Exit codes: 0 OK · 1 spec inválida o deriva de contrato · 2 uso inválido.
//
// Se ejecuta con type-stripping nativo de Node (≥26), sin build ni deps.

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const USAGE =
  'Uso:\n' +
  '  node scripts/sdd-specs.ts new     --workflow <direct|mini-sdd|full-sdd> --mission <nombre> [--specs-dir <dir>] [--force]\n' +
  '  node scripts/sdd-specs.ts sync    --mission <nombre> [--specs-dir <dir>]\n' +
  '  node scripts/sdd-specs.ts archive --mission <nombre> [--specs-dir <dir>]\n' +
  '  node scripts/sdd-specs.ts status  [--specs-dir <dir>]\n'

const repoRoot = join(import.meta.dirname, '..')
const die = (msg: string): never => {
  console.error(`ERROR: ${msg}`)
  process.exit(2)
}

function parseNamedArgs(argv: readonly string[]): Record<string, string | true> {
  const KNOWN = new Set(['workflow', 'mission', 'specs-dir', 'force'])
  const out: Record<string, string | true> = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === undefined) break
    if (!a.startsWith('--')) die(`argumento inesperado: ${a}`)
    const key = a.slice(2)
    if (!KNOWN.has(key)) die(`flag desconocida: --${key}`)
    const next = argv[i + 1]
    if (next !== undefined && !next.startsWith('--')) {
      out[key] = next
      i++
    } else {
      out[key] = true
    }
  }
  return out
}

interface Stage {
  id: string
  heading: string
}
interface Contract {
  workflow: string
  stages: Stage[]
}

function loadContract(workflow: string): Contract {
  const p = join(repoRoot, 'contracts', `${workflow}.json`)
  if (!existsSync(p)) die(`no existe contracts/${workflow}.json`)
  return JSON.parse(readFileSync(p, 'utf8')) as Contract
}

interface FrontMatter {
  mission: string
  workflow: string
  status: 'draft' | 'active' | 'archived'
  created: string
}

/** Front matter plano `clave: valor` entre líneas `---`. Devuelve null si falta o está roto. */
export function parseFrontMatter(body: string): FrontMatter | null {
  const m = /^---\n((?:[a-z-]+: .*\n)+)---\n/.exec(body)
  if (m === null || m[1] === undefined) return null
  const kv: Record<string, string> = {}
  for (const line of m[1].split('\n')) {
    const mm = /^([a-z-]+): (.*)$/.exec(line)
    const key = mm?.[1]
    const value = mm?.[2]
    if (key !== undefined && value !== undefined) kv[key] = value
  }
  if (!kv.mission || !kv.workflow || !kv.status || !kv.created) return null
  if (kv.status !== 'draft' && kv.status !== 'active' && kv.status !== 'archived') return null
  return { mission: kv.mission, workflow: kv.workflow, status: kv.status, created: kv.created }
}

export function renderSpec(contract: Contract, mission: string, created: string): string {
  const head =
    `---\nmission: ${mission}\nworkflow: ${contract.workflow}\nstatus: active\ncreated: ${created}\n---\n\n` +
    `# Spec — ${mission}\n\n`
  const sections = contract.stages
    .map(
      (s) =>
        `## ${s.heading}\n\n<!-- etapa: ${s.id} · outputs/criteria según contracts/${contract.workflow}.json -->\n\n- TODO\n`,
    )
    .join('\n')
  return `${head}${sections}`
}

export interface SyncReport {
  ok: boolean
  errors: string[]
}

/** Valida la spec contra el contrato declarado en su propio front matter. */
export function syncSpec(specPath: string, repoContractsDir: string): SyncReport {
  const errors: string[] = []
  if (!existsSync(specPath)) return { ok: false, errors: [`no existe ${specPath}`] }
  const body = readFileSync(specPath, 'utf8')
  const fm = parseFrontMatter(body)
  if (fm === null) return { ok: false, errors: ['front matter ausente o inválido (mission/workflow/status/created)'] }

  const contractPath = join(repoContractsDir, `${fm.workflow}.json`)
  if (!existsSync(contractPath)) {
    errors.push(`el front matter declara workflow '${fm.workflow}' sin contrato en contracts/`)
    return { ok: false, errors }
  }
  const contract = JSON.parse(readFileSync(contractPath, 'utf8')) as Contract

  // Coherencia interna: nombre de directorio ≡ front matter.
  const dirName = specPath.split('/').at(-2)
  if (dirName !== undefined && dirName !== fm.mission && dirName !== '_archive') {
    errors.push(`front matter mission '${fm.mission}' ≠ directorio '${dirName}'`)
  }
  // Alineación spec↔contrato: una sección ## EXACTA por cada etapa ratificada
  // (comparación literal por líneas: los headings contractuales llevan
  // paréntesis y guiones largos que romperían un RegExp).
  const headings = new Set(body.split('\n').map((l) => l.trim()))
  for (const stage of contract.stages) {
    if (!headings.has(`## ${stage.heading}`)) {
      errors.push(`falta la sección de la etapa '${stage.id}' (## ${stage.heading})`)
    }
  }
  return { ok: errors.length === 0, errors }
}

const sha256File = (p: string): string => createHash('sha256').update(readFileSync(p)).digest('hex')

function main(argv: readonly string[]): number {
  // argv[0] es el subcomando; las flags empiezan en argv[1].
  const args = parseNamedArgs(argv.slice(1))
  const cmd = argv[0]
  const specsDir = typeof args['specs-dir'] === 'string' ? args['specs-dir'] : join(process.cwd(), 'specs')
  const mission = typeof args.mission === 'string' ? args.mission : undefined

  switch (cmd) {
    case 'new': {
      const rawWorkflow = args.workflow
      if (typeof rawWorkflow !== 'string') {
        console.error('ERROR: new exige --workflow <direct|mini-sdd|full-sdd>')
        process.exit(2)
      }
      if (mission === undefined) {
        console.error('ERROR: new exige --mission <nombre>')
        process.exit(2)
      }
      if (!/^[A-Za-z0-9._-]+$/.test(mission)) die('--mission solo acepta [A-Za-z0-9._-] (sin rutas)')
      const contract = loadContract(rawWorkflow)
      const dir = join(specsDir, mission)
      if (existsSync(dir) && args.force !== true) {
        console.error(`ERROR: ${dir} ya existe — usa --force para reemplazarlo`)
        process.exit(2)
      }
      if (existsSync(dir)) rmSync(dir, { recursive: true })
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'spec.md'), renderSpec(contract, mission, new Date().toISOString()))
      console.log(`✔ spec creada: ${join(dir, 'spec.md')} (${contract.stages.length} etapas de ${contract.workflow})`)
      return 0
    }
    case 'sync': {
      if (mission === undefined) {
        console.error('ERROR: sync exige --mission <nombre>')
        process.exit(2)
      }
      const target = join(specsDir, mission, 'spec.md')
      const report = syncSpec(target, join(repoRoot, 'contracts'))
      if (report.ok) {
        console.log(`✔ spec sincronizada con su contrato: ${mission}`)
        return 0
      }
      console.error(`✘ deriva spec↔contrato en '${mission}':`)
      for (const e of report.errors) console.error(`  - ${e}`)
      return 1
    }
    case 'archive': {
      if (mission === undefined) {
        console.error('ERROR: archive exige --mission <nombre>')
        process.exit(2)
      }
      const srcDir = join(specsDir, mission)
      const specPath = join(srcDir, 'spec.md')
      if (!existsSync(specPath)) {
        console.error(`✘ '${mission}' no tiene spec.md bajo ${srcDir} — nada que archivar`)
        return 1
      }
      const report = syncSpec(specPath, join(repoRoot, 'contracts'))
      if (!report.ok) {
        console.error(`✘ no se archiva una spec inválida ('${mission}'): corre sync primero`)
        for (const e of report.errors) console.error(`  - ${e}`)
        return 1
      }
      const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '')
      const dest = join(specsDir, '_archive', `${stamp}-${mission}`)
      mkdirSync(join(specsDir, '_archive'), { recursive: true })
      // El índice se valida ANTES del rename: si estuviera corrupto, la misión
      // NO se mueve y el ledger queda consistente (fail-closed pre-mutación).
      const indexPath = join(specsDir, '_archive', 'index.json')
      let index: unknown[] = []
      if (existsSync(indexPath)) {
        try {
          const parsed: unknown = JSON.parse(readFileSync(indexPath, 'utf8'))
          if (!Array.isArray(parsed)) throw new Error('index.json no es un array')
          index = parsed
        } catch (err) {
          console.error(`✘ index.json corrupto o inválido (${String(err)}) — repáralo antes de archivar`)
          return 1
        }
      }
      const specSha = sha256File(specPath)
      renameSync(srcDir, dest)
      index.push({ mission, archivedAt: new Date().toISOString(), path: dest.replace(`${process.cwd()}/`, ''), specSha256: specSha })
      writeFileSync(indexPath, JSON.stringify(index, null, 2))
      console.log(`✔ spec archivada: ${dest} (sha256 ${specSha.slice(0, 12)}…, índice actualizado)`)
      return 0
    }
    case 'status': {
      if (!existsSync(specsDir)) {
        console.log(`sin specs bajo ${specsDir}`)
        return 0
      }
      let count = 0
      for (const d of readdirSync(specsDir, { withFileTypes: true })) {
        if (!d.isDirectory() || d.name === '_archive') continue
        count++
        const specFile = join(specsDir, d.name, 'spec.md')
        if (!existsSync(specFile)) {
          console.log(`· ${d.name}: directorio SIN spec.md — estado desconocido`)
          continue
        }
        const body = readFileSync(specFile, 'utf8')
        const fm = parseFrontMatter(body)
        console.log(`· ${d.name}: ${fm === null ? 'spec SIN front matter válido' : `${fm.workflow} (${fm.status}, creada ${fm.created})`}`)
      }
      if (count === 0) console.log(`sin specs bajo ${specsDir}`)
      return 0
    }
    default:
      console.error(USAGE)
      return 2
  }
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
