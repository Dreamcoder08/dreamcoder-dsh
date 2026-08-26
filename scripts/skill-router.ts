#!/usr/bin/env node
// skill-router.ts — presupuesto de skills ejecutable (policy/AGENTS.md §10).
//
// El contexto es un presupuesto finito: cargar todas las skills por
// completitud es desperdicio, no rigor. Este router puntúa la relevancia de
// cada skill disponible contra la tarea actual y emite las top-N (default 3)
// a CARGAR AHORA más la lista a DIFERIR hasta su fase.
//
// Uso:
//   node scripts/skill-router.ts --task "texto de la tarea" \
//     [--skills-dir <dir>]… [--max 3] [--json]
//
// --skills-dir es acumulable; por defecto escanea bundles/engineering/skills
// del repo y $DSH_HOME/skills si existe. Exit 0 siempre que los args sean
// válidos; 2 en uso inválido.
//
// Se ejecuta con el type-stripping nativo de Node (≥26), sin build.

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'when', 'use', 'using', 'uses',
  'que', 'del', 'los', 'las', 'una', 'uno', 'por', 'para', 'con', 'como', 'mas', 'más', 'sin',
  'sobre', 'entre', 'cuando', 'cual', 'cuál', 'todo', 'toda', 'todos', 'todas', 'hay', 'sus',
])

interface SkillDoc {
  name: string
  description: string
  whenToUse: string
  dir: string
}

interface Scored {
  name: string
  score: number
  matched: string[]
}

function parseArgs(argv: readonly string[]): {
  task: string
  max: number
  json: boolean
  dirs: string[]
} {
  let task = ''
  let max = 3
  let json = false
  const dirs: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--task') task = argv[++i] ?? ''
    else if (a === '--max') max = Number(argv[++i] ?? 3)
    else if (a === '--json') json = true
    else if (a === '--skills-dir') dirs.push(argv[++i] ?? '')
    else throw new Error(`Argumento desconocido: ${String(a)}`)
  }
  if (task.trim() === '') throw new Error('--task es obligatorio')
  if (!Number.isInteger(max) || max < 1) throw new Error('--max debe ser entero ≥ 1')
  return { task, max, json, dirs: dirs.filter((d) => d !== '') }
}

/** Extrae name/description/whenToUse del frontmatter YAML simple de SKILL.md. */
export function parseFrontmatter(raw: string): {
  name: string | undefined
  description: string | undefined
  whenToUse: string | undefined
} {
  const parts = raw.split('---')
  const fm = parts.length >= 3 ? (parts[1] ?? '') : ''
  // Parser de bloque YAML simple: `clave: [marcador]` seguido de líneas
  // indentadas (block scalars |, >, >- y variantes) o valor en la misma
  // línea; termina en la siguiente clave top-level o fin del frontmatter.
  // Tolerante a CRLF: el \r final no debe romper el ancla de clave.
  const fields = new Map<string, string>()
  let current: { key: string; value: string } | null = null
  for (const rawLine of fm.split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    const keyMatch = line.match(/^([A-Za-z_-]+):[ \t]*(.*)$/)
    if (keyMatch !== null) {
      if (current !== null) fields.set(current.key, current.value.trim())
      const marker = keyMatch[2] ?? ''
      current = { key: keyMatch[1] ?? '', value: /^[|>][+-]?[0-9]*$/.test(marker.trim()) ? '' : marker }
      continue
    }
    if (current !== null && /^[ \t]+\S/.test(line)) current.value += ' ' + line.trim()
    else if (current !== null && line.trim() === '') current.value += ' '
  }
  if (current !== null) fields.set(current.key, current.value.trim())
  return {
    name: fields.get('name'),
    description: fields.get('description'),
    whenToUse: fields.get('whenToUse'),
  }
}

export function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9áéíóúñü]+/i)
      .filter((t) => t.length > 2 && !STOPWORDS.has(t)),
  )
}

// Pesos de scoring: el nombre de la skill pesa más que su prosa; la
// coincidencia literal del nombre completo en la tarea da bonus.
const WEIGHT_NAME = 3
const WEIGHT_BODY = 2
const BONUS_FULL_NAME = 2

export function scoreSkill(skill: SkillDoc, queryTokens: Set<string>): Scored {
  const nameTokens = tokenize(skill.name)
  const bodyTokens = new Set([...tokenize(skill.description), ...tokenize(skill.whenToUse)])
  const matched: string[] = []
  let score = 0
  for (const t of queryTokens) {
    if (nameTokens.has(t)) {
      score += WEIGHT_NAME
      matched.push(t)
    } else if (bodyTokens.has(t)) {
      score += WEIGHT_BODY
      matched.push(t)
    }
  }
  // Bonus por coincidencia literal del nombre en el texto de la tarea.
  if (queryTokens.size > 0 && skill.name.split('-').every((p) => queryTokens.has(p.toLowerCase()))) {
    score += BONUS_FULL_NAME
  }
  return { name: skill.name, score, matched }
}

function collectSkills(explicitDirs: readonly string[]): SkillDoc[] {
  const roots =
    explicitDirs.length > 0
      ? explicitDirs
      : [join(import.meta.dirname, '..', 'bundles', 'engineering', 'skills'), join(process.env.DSH_HOME ?? join(process.env.HOME ?? '', '.dsh'), 'skills')]
  const out: SkillDoc[] = []
  for (const root of roots) {
    if (!existsSync(root)) continue
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const p = join(root, entry.name, 'SKILL.md')
      if (!existsSync(p)) continue
      const parsed = parseFrontmatter(readFileSync(p, 'utf8'))
      if (parsed.name === undefined && parsed.description === undefined) continue
      out.push({
        name: parsed.name ?? entry.name,
        description: parsed.description ?? '',
        whenToUse: parsed.whenToUse ?? '',
        dir: entry.name,
      })
    }
  }
  return out
}

try {
  const opts = parseArgs(process.argv.slice(2))
  const skills = collectSkills(opts.dirs)
  const queryTokens = tokenize(opts.task)
  const scored = skills
    .map((s) => scoreSkill(s, queryTokens))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
  const relevant = scored.filter((s) => s.score > 0)
  const loaded = relevant.slice(0, opts.max)
  const deferred = relevant.slice(opts.max)

  if (opts.json) {
    console.log(JSON.stringify({ budget: opts.max, loaded, deferred }, null, 2))
  } else {
    if (loaded.length === 0) {
      console.log('Sin skill aplicable — decláralo en una línea y procede sin ellas (§10).')
    } else {
      console.log(`Skills a CARGAR (${loaded.length}/${opts.max}):`)
      loaded.forEach((s, i) => console.log(`→ ${i + 1}. ${s.name} (score ${s.score})`))
    }
    console.log(`deferridas: ${deferred.length}${deferred.length > 0 ? ` — ${deferred.map((d) => d.name).join(', ')}` : ''}`)
  }
  process.exit(0)
} catch (err) {
  console.error(`✘ ${err instanceof Error ? err.message : String(err)}`)
  process.exit(2)
}
