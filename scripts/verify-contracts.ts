#!/usr/bin/env node
// verify-contracts.ts — valida los contratos por etapa de contracts/ contra
// schemas/stage-contract.schema.json (subset validado a mano, sin dependencias)
// y cruza cada etapa contra el encabezado real que ocupa en su documento de
// workflow. El contrato que deriva del documento (o viceversa) falla ruidoso:
// un SDD sin contratos verificables es prosa, no ingeniería.
//
// Uso:
//   bun run scripts/verify-contracts.ts [--contracts-dir <dir>] [--schema <path>]
//
// Exit 0: todos los contratos válidos y consistentes con sus documentos.
// Exit 1: cualquier error de forma o de cruce.
//
// Se ejecuta con Bun o type-stripping nativo de Node (≥22.18): solo sintaxis
// erasable, cero dependencias de runtime.

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

interface ModelProfile {
  role: string
  compute: string
  fresh_context: boolean
}

interface TokenBudget {
  franja: string
  fraction: number
}

interface Stage {
  id: string
  heading: string
  executes: string
  inputs: unknown[]
  outputs: unknown[]
  exit_criteria: unknown[]
  model_profile: ModelProfile
  token_budget: TokenBudget
  allowed_tools: unknown[]
  memory_policy: string
}

interface Contract {
  workflow: string
  risk: string[]
  doc: string
  context_budget_ref: string
  stages: Stage[]
}

const COMPUTES = new Set(['capable', 'fast', 'fresh-reviewer', 'session'])
const FRANJAS = new Set([
  'identidad+reglas',
  'memoria',
  'codigo-y-contexto',
  'artefactos-de-tarea',
  'observaciones-de-tools',
  'reserva-de-seguridad',
])
const MEMORY_POLICIES = new Set(['orquestador-recupera', 'persistir-cierre', 'ninguna'])
const RISKS = new Set(['P0', 'P1', 'P2', 'P3'])

const isStringArray = (v: unknown, minLen: number): v is string[] =>
  Array.isArray(v) &&
  v.length > 0 &&
  v.every((s) => typeof s === 'string' && s.length >= minLen)

/** Extrae los encabezados de etapa del documento del workflow según su tipo. */
const headingRegexes: Record<string, RegExp> = {
  direct: /^### \d+\. (.+)$/m,
  // mini-sdd usa "## N. Título"; full-sdd "## título — rol".
  'mini-sdd': /^## \d+\. (.+)$/m,
  'full-sdd': /^## ([a-z]+ — .+)$/gm,
}
const docStageHeadings = (workflow: string, docBody: string): string[] => {
  // Flag 'g' siempre: sin él, re.exec devolvería el primer match indefinidamente.
  const src = headingRegexes[workflow]!
  const re = new RegExp(src.source, src.flags.includes('g') ? src.flags : src.flags + 'g')
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(docBody)) !== null) out.push(m[1]!.trim())
  return out
}

const errors: string[] = []
const fail = (msg: string): void => {
  errors.push(msg)
}

/** Valida un contrato contra el subset del schema que el verificador implementa. */
const validateContract = (raw: unknown, file: string): Contract | null => {
  // Marca base local: los guards de esta función comparan contra ella, nunca
  // contra el array global, para que errores de un archivo anterior no
  // contaminen la validación del siguiente.
  const base = errors.length
  if (typeof raw !== 'object' || raw === null) return fail(`${file}: no es un objeto JSON`), null
  const c = raw as Record<string, unknown>
  for (const k of ['$schema', 'workflow', 'risk', 'doc', 'context_budget_ref', 'stages']) {
    if (!(k in c)) fail(`${file}: falta campo obligatorio '${k}'`)
  }
  if (errors.length > base) return null

  const workflow = c['workflow'] as string
  if (!['direct', 'mini-sdd', 'full-sdd'].includes(workflow)) {
    fail(`${file}: workflow desconocido '${workflow}'`)
    return null
  }
  if (!isStringArray(c['risk'], 2) || !(c['risk'] as string[]).every((r) => RISKS.has(r))) {
    fail(`${file}: 'risk' debe ser lista no vacía de P0–P3`)
  }
  if (typeof c['doc'] !== 'string' || c['doc'].length < 3) fail(`${file}: 'doc' inválido`)
  if (c['context_budget_ref'] !== 'policy/AGENTS.md#7-gobernanza-de-contexto') {
    fail(`${file}: 'context_budget_ref' debe citar la sección §7 de policy/AGENTS.md`)
  }
  if (!Array.isArray(c['stages']) || c['stages'].length === 0) {
    fail(`${file}: 'stages' debe ser lista no vacía`)
    return null
  }

  const seen = new Set<string>()
  const stages: Stage[] = []
  for (const [i, s] of (c['stages'] as unknown[]).entries()) {
    const label = `${file}#stages[${i}]`
    if (typeof s !== 'object' || s === null) return fail(`${label}: no es objeto`), null
    const st = s as Record<string, unknown>
    for (const k of [
      'id',
      'heading',
      'executes',
      'inputs',
      'outputs',
      'exit_criteria',
      'model_profile',
      'token_budget',
      'allowed_tools',
      'memory_policy',
    ]) {
      if (!(k in st)) fail(`${label}: falta campo obligatorio '${k}'`)
    }
    if (typeof st['id'] !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(st['id'])) {
      fail(`${label}: 'id' debe ser kebab-case`)
    } else if (seen.has(st['id'])) {
      fail(`${label}: id duplicado '${st['id']}'`)
    } else seen.add(st['id'])
    for (const k of ['heading', 'executes'] as const) {
      if (typeof st[k] !== 'string' || (st[k] as string).length < 3) fail(`${label}: '${k}' inválido`)
    }
    for (const k of ['inputs', 'outputs', 'exit_criteria', 'allowed_tools'] as const) {
      const minLen = k === 'allowed_tools' ? 2 : 3
      if (!isStringArray(st[k], minLen)) fail(`${label}: '${k}' debe ser lista no vacía de strings`)
    }
    const mp = st['model_profile'] as Record<string, unknown> | undefined
    if (typeof mp !== 'object' || mp === null) {
      fail(`${label}: 'model_profile' debe ser objeto`)
    } else {
      if (typeof mp['role'] !== 'string' || mp['role'].length < 3) fail(`${label}: model_profile.role inválido`)
      if (typeof mp['compute'] !== 'string' || !COMPUTES.has(mp['compute'])) {
        fail(`${label}: model_profile.compute debe ser capable|fast|fresh-reviewer|session`)
      }
      if (typeof mp['fresh_context'] !== 'boolean') fail(`${label}: model_profile.fresh_context debe ser booleano`)
    }
    const tb = st['token_budget'] as Record<string, unknown> | undefined
    if (typeof tb !== 'object' || tb === null) {
      fail(`${label}: 'token_budget' debe ser objeto`)
    } else {
      if (typeof tb['franja'] !== 'string' || !FRANJAS.has(tb['franja'])) {
        fail(`${label}: token_budget.franja fuera de las franjas de §7`)
      }
      if (
        typeof tb['fraction'] !== 'number' ||
        !(tb['fraction'] > 0 && tb['fraction'] <= 1)
      ) {
        fail(`${label}: token_budget.fraction debe estar en (0,1]`)
      }
    }
    if (typeof st['memory_policy'] !== 'string' || !MEMORY_POLICIES.has(st['memory_policy'])) {
      fail(`${label}: memory_policy debe ser orquestador-recupera|persistir-cierre|ninguna`)
    }
    stages.push(st as unknown as Stage)
  }
  if (errors.length > 0) return null
  return c as unknown as Contract
}

// ── CLI ──────────────────────────────────────────────────────────────────────
const argv = process.argv
let contractsDirArg: string | undefined
let schemaArg: string | undefined
for (let i = 2; i < argv.length; i++) {
  if (argv[i] === '--contracts-dir') contractsDirArg = argv[++i]
  else if (argv[i] === '--schema') schemaArg = argv[++i]
  else {
    console.error(`Argumento desconocido: ${String(argv[i])}`)
    process.exit(2)
  }
}

const repoRoot = resolve(dirname(import.meta.url.replace('file://', '')), '..')
const contractsDir = contractsDirArg !== undefined ? resolve(contractsDirArg) : join(repoRoot, 'contracts')
const schemaPath = schemaArg !== undefined ? resolve(schemaArg) : join(repoRoot, 'schemas', 'stage-contract.schema.json')

// El schema existe y es JSON válido (fuente documental; la validación fina es
// el subset de arriba, mantenido a la par por tests).
try {
  JSON.parse(readFileSync(schemaPath, 'utf8'))
} catch (e) {
  console.error(`ERROR: schema ilegible en ${schemaPath}: ${String(e)}`)
  process.exit(1)
}

const files = readdirSync(contractsDir).filter((f) => f.endsWith('.json')).sort()
if (files.length === 0) {
  console.error(`ERROR: sin contratos *.json en ${contractsDir}`)
  process.exit(1)
}

console.log(`==> Verificando ${files.length} contrato(s) en ${contractsDir}`)

for (const f of files) {
  const path = join(contractsDir, f)
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'))
  } catch (e) {
    fail(`${f}: JSON ilegible — ${String(e)}`)
    continue
  }
  const before = errors.length
  const contract = validateContract(raw, f)
  if (contract === null) continue

  // ── Cruce contrato ↔ documento ──
  const docPath = resolve(contractsDir, contract.doc)
  let docBody: string
  try {
    docBody = readFileSync(docPath, 'utf8')
  } catch {
    fail(`${f}: documento '${contract.doc}' ilegible`)
    continue
  }
  const headings = docStageHeadings(contract.workflow, docBody)
  for (const st of contract.stages) {
    if (!headings.includes(st.heading.trim())) {
      fail(`${f}: la etapa '${st.id}' declara heading "${st.heading}" que no aparece como encabezado de etapa en ${contract.doc}`)
    }
  }
  if (headings.length !== contract.stages.length) {
    fail(
      `${f}: desalineación contrato↔documento — ${contract.stages.length} etapas declaradas vs ${headings.length} encabezados de etapa en ${contract.doc}`,
    )
  }
  const ok = errors.length === before
  console.log(`  ${ok ? '✔' : '✘'} ${f} — ${contract.workflow} (${contract.stages.length} etapas, riesgo ${contract.risk.join('/')})`)
}

if (errors.length > 0) {
  console.error('')
  for (const e of errors) console.error(`  ✘ ${e}`)
  console.error(`\n✘ Contratos inválidos: ${errors.length} problema(s).`)
  process.exit(1)
}
console.log('\n✔ Contratos verificados: forma válida y consistentes con sus workflows.')
