// Contrato de estructura de las skills del bundle.
//
// Por qué existe: el proyecto de referencia declara un "skill-style-guide" con
// orden de secciones y presupuesto de tokens, pero no lo hace cumplir — su
// propia skill `issue-creation` supera su máximo duro. Declarar un estándar sin
// verificarlo es exactamente el tipo de afirmación que este repositorio no
// quiere hacer. Acá el contrato es mecánico:
//
//   1. frontmatter: `name` (kebab-case, igual al directorio), `description` en
//      UNA línea física que empieza por `Trigger:`, `license`,
//      `metadata.author` y `metadata.version`;
//   2. cuerpo con exactamente un `## Activation Contract` y un
//      `## Output Contract` (cuándo se carga y qué devuelve: sin esos dos, una
//      skill es prosa suelta);
//   3. sin H1 en el cuerpo fuera de bloques de código: la identidad vive en el
//      frontmatter, no en un título;
//   4. presupuesto de palabras entre 150 y 1000 (guía: 180–450 objetivo, 700
//      recomendado). El límite es contexto: una skill se carga en cada sesión
//      donde aplica;
//   5. toda skill del bundle está nombrada en `docs/skills-reference.md`, para
//      que una skill nueva no quede indocumentada.
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, test } from 'node:test'

const ROOT = join(import.meta.dirname, '..')
const SKILLS_DIR = join(ROOT, 'bundles', 'engineering', 'skills')
const REFERENCE = join(ROOT, 'docs', 'skills-reference.md')

/** Autores admitidos: cambiar esta lista es una decisión de atribución deliberada. */
const AUTHORS = ['dreamcoder', 'gentleman-programming']

const WORD_MIN = 150
const WORD_MAX = 1000

interface Skill {
  dir: string
  path: string
  raw: string
  frontmatter: string
  body: string
}

/** Quita bloques de código cercados: sus `#` son comentarios, no secciones. */
const stripFences = (text: string): string => text.replace(/^```[\s\S]*?^```$/gm, '')

const parseFrontmatter = (raw: string): { frontmatter: string; body: string } => {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw)
  assert.ok(m !== null, 'sin bloque de frontmatter delimitado por ---')
  return { frontmatter: m[1] ?? '', body: m[2] ?? '' }
}

const readSkills = (): Skill[] =>
  readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => {
      const path = join(SKILLS_DIR, e.name, 'SKILL.md')
      assert.ok(existsSync(path), `${e.name}: falta SKILL.md`)
      const raw = readFileSync(path, 'utf8')
      const { frontmatter, body } = parseFrontmatter(raw)
      return { dir: e.name, path, raw, frontmatter, body }
    })
    .sort((a, b) => a.dir.localeCompare(b.dir))

/** Lee un campo simple del frontmatter (`clave: valor`). */
const field = (fm: string, key: string): string | undefined =>
  new RegExp(`^${key}:[ \\t]*(.+)$`, 'm').exec(fm)?.[1]?.trim()

const skills = readSkills()

describe('contrato de estructura de skills', () => {
  test('el bundle expone las skills esperadas', () => {
    assert.ok(skills.length >= 7, `esperaba >=7 skills, encontré ${skills.length}: ${skills.map((s) => s.dir).join(', ')}`)
  })

  for (const skill of skills) {
    const { dir, frontmatter: fm, body } = skill

    test(`${dir}: frontmatter completo y consistente`, () => {
      const problems: string[] = []

      if (field(fm, 'name') !== dir) {
        problems.push(`name '${field(fm, 'name')}' no coincide con el directorio '${dir}'`)
      }
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(dir)) problems.push(`directorio no es kebab-case: '${dir}'`)

      // `description` debe ser UNA línea física: un bloque plegado rompe el
      // índice de skills, que indexa la descripción como línea única.
      const descLine = /^description:[ \t]*(.+)$/m.exec(fm)?.[1]
      if (descLine === undefined) problems.push('falta description')
      else {
        if (!/^".*"$/.test(descLine)) problems.push('description debe ir entre comillas en una sola línea')
        if (!/^"?Trigger:/.test(descLine.replace(/^"/, ''))) problems.push("description debe empezar por 'Trigger:'")
      }

      if ((field(fm, 'license') ?? '') === '') problems.push('falta license')
      const author = /^\s+author:[ \t]*(.+)$/m.exec(fm)?.[1]?.trim()
      if (author === undefined || author === '') problems.push('falta metadata.author')
      else if (!AUTHORS.includes(author)) problems.push(`author '${author}' fuera de la lista admitida (${AUTHORS.join(', ')})`)
      const version = /^\s+version:[ \t]*(.+)$/m.exec(fm)?.[1]?.trim()
      if (version === undefined || version === '') problems.push('falta metadata.version')

      assert.deepEqual(problems, [], `${dir}: frontmatter:\n - ${problems.join('\n - ')}`)
    })

    test(`${dir}: secciones obligatorias y presupuesto`, () => {
      const problems: string[] = []
      const clean = stripFences(body)

      for (const required of ['## Activation Contract', '## Output Contract']) {
        const count = clean.split('\n').filter((l) => l.trim() === required).length
        if (count !== 1) problems.push(`${required}: esperaba exactamente 1, encontré ${count}`)
      }

      const h1 = clean.split('\n').filter((l) => /^# [^#]/.test(l))
      if (h1.length > 0) problems.push(`H1 en el cuerpo (la identidad va en el frontmatter): ${h1.join(' | ')}`)

      const words = body.split(/\s+/).filter((w) => w !== '').length
      if (words < WORD_MIN) problems.push(`presupuesto: ${words} palabras (< ${WORD_MIN})`)
      if (words > WORD_MAX) problems.push(`presupuesto: ${words} palabras (> ${WORD_MAX})`)

      assert.deepEqual(problems, [], `${dir}: estructura:\n - ${problems.join('\n - ')}`)
    })

    test(`${dir}: documentada en docs/skills-reference.md`, () => {
      const reference = readFileSync(REFERENCE, 'utf8')
      assert.ok(reference.includes(dir), `${dir} no aparece en docs/skills-reference.md`)
    })
  }
})
