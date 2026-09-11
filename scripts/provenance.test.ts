// Gate de procedencia: toda skill del bundle está clasificada en
// `docs/provenance.md`, con un origen del vocabulario cerrado, y el autor que
// declara este documento coincide con el del frontmatter.
//
// Por qué existe: `metadata.author` es una afirmación de autoría, y Apache-2.0
// exige conservar los avisos del trabajo derivado. Sin este gate, una skill
// nueva entra sin clasificar y la tabla de procedencia envejece en silencio
// hasta que alguien la lee y no puede confiar en ella. El autor real del
// análisis es que cuatro skills declaran `gentleman-programming` sin que
// ninguno de los dos repositorios upstream las contenga — eso quedó visible acá
// como `por-confirmar` en vez de esconderse.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, test } from 'node:test'

const ROOT = join(import.meta.dirname, '..')
const SKILLS_DIR = join(ROOT, 'bundles', 'engineering', 'skills')
const PROVENANCE = join(ROOT, 'docs', 'provenance.md')

/** Orígenes admitidos. `por-confirmar` es deliberado: declara lo no verificado. */
const ORIGINS = ['original', 'adaptada', 'por-confirmar']

interface Row {
  skill: string
  author: string
  origin: string
}

/** Filas de la tabla de estado declarado: | `skill` | `author` | origen | … |. */
function declaredRows(): Row[] {
  const section = /^## Estado declarado\s*$([\s\S]*?)(?=^## )/m.exec(readFileSync(PROVENANCE, 'utf8'))?.[1]
  assert.ok(section !== undefined, 'docs/provenance.md no tiene la sección "## Estado declarado"')
  const rows: Row[] = []
  for (const line of section.split('\n')) {
    if (!line.startsWith('|')) continue
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim())
    const skill = /^`([a-z0-9-]+)`$/.exec(cells[0] ?? '')?.[1]
    if (skill === undefined || cells.length < 3) continue
    rows.push({ skill, author: (cells[1] ?? '').replace(/`/g, ''), origin: (cells[2] ?? '').replace(/\*/g, '') })
  }
  return rows
}

/** Autor declarado en el frontmatter de una skill. */
function frontmatterAuthor(skill: string): string {
  const text = readFileSync(join(SKILLS_DIR, skill, 'SKILL.md'), 'utf8')
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? ''
  return /^\s+author:[ \t]*(.+)$/m.exec(fm)?.[1]?.trim() ?? ''
}

const skills = readdirSync(SKILLS_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory() && existsSync(join(SKILLS_DIR, e.name, 'SKILL.md')))
  .map((e) => e.name)
  .sort()

describe('procedencia de skills', () => {
  const rows = declaredRows()

  test('toda skill del bundle está clasificada', () => {
    const classified = rows.map((r) => r.skill).sort()
    assert.deepEqual(
      classified,
      skills,
      'docs/provenance.md y bundles/engineering/skills/ divergen: una skill sin fila queda sin procedencia declarada',
    )
  })

  test('el origen pertenece al vocabulario cerrado', () => {
    const bad = rows.filter((r) => !ORIGINS.includes(r.origin)).map((r) => `${r.skill}: '${r.origin}'`)
    assert.deepEqual(bad, [], `orígenes fuera de ${ORIGINS.join(' | ')}:\n - ${bad.join('\n - ')}`)
  })

  test('el autor declarado coincide con el frontmatter', () => {
    const mismatched = rows
      .filter((r) => frontmatterAuthor(r.skill) !== r.author)
      .map((r) => `${r.skill}: doc='${r.author}' frontmatter='${frontmatterAuthor(r.skill)}'`)
    assert.deepEqual(
      mismatched,
      [],
      `procedencia y frontmatter divergen:\n - ${mismatched.join('\n - ')}`,
    )
  })

  test('lo no verificado queda declarado, no escondido', () => {
    // Si no hay ninguna fila `por-confirmar`, el punto abierto se cerró: hay que
    // actualizar el documento en el mismo cambio. Este assert obliga a que la
    // decisión sea visible en vez de que la tabla se degrade sin ruido.
    const pending = rows.filter((r) => r.origin === 'por-confirmar').map((r) => r.skill)
    const doc = readFileSync(PROVENANCE, 'utf8')
    if (pending.length > 0) {
      assert.match(doc, /## Punto abierto/, 'hay filas por-confirmar y falta la sección que las explica')
      for (const skill of pending) {
        assert.ok(doc.includes(skill), `${skill} está por-confirmar y no se menciona en el punto abierto`)
      }
    }
  })
})
