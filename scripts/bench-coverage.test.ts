// Cobertura del bench en CI: la lista `--only` del workflow debe ser
// EXACTAMENTE el conjunto de jornadas sin dependencia de host.
//
// Problema que cierra: la exclusión de j4–j6 vivía solo en una lista
// hardcodeada dentro de `.github/workflows/ci.yml` y en un comentario. Nada
// relacionaba esa lista con la realidad del corpus, así que:
//
//   · una jornada nueva sin dependencia de host quedaba fuera de CI en
//     silencio (verde por omisión, no por verificación);
//   · una jornada que pasara a necesitar `dsh` seguía en CI hasta romper el
//     runner;
//   · una jornada declarada `host` por error nunca se revisaba.
//
// El corpus declara `requires` sin default (`bench/corpus.ts`), y este test
// compara ambos lados en las dos direcciones. Es el mismo patrón de deriva
// bidireccional que el proyecto de referencia usa para sus contratos pinneados.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import { journeys } from '../bench/corpus.ts'

const ROOT = join(import.meta.dirname, '..')
const CI = join(ROOT, '.github', 'workflows', 'ci.yml')

/** Ids que el workflow pasa a `dream-bench --only`. */
function ciBenchSelection(): Set<string> {
  const text = readFileSync(CI, 'utf8')
  const m = /--only[ \t]+([a-z0-9,]+)/.exec(text)
  assert.notEqual(m, null, 'el workflow de CI no invoca `dream-bench --only …`')
  return new Set((m?.[1] ?? '').split(',').filter((s) => s !== ''))
}

describe('cobertura del bench en CI', () => {
  test('toda jornada declara su dependencia de entorno', () => {
    const undeclared = journeys
      .filter((j) => {
        const value: unknown = j.requires
        return value !== 'host' && value !== 'none'
      })
      .map((j) => j.id)
    assert.deepEqual(
      undeclared,
      [],
      `jornadas sin \`requires\` declarado ('host' | 'none'): ${undeclared.join(', ')}`,
    )
  })

  test('la selección de CI es exactamente el conjunto sin dependencia de host', () => {
    const hostFree = journeys.filter((j) => j.requires === 'none').map((j) => j.id)
    const hostOnly = journeys.filter((j) => j.requires === 'host').map((j) => j.id)
    const selected = ciBenchSelection()

    const missing = hostFree.filter((id) => !selected.has(id))
    const extra = [...selected].filter((id) => !hostFree.includes(id))
    const problems: string[] = []
    if (missing.length > 0) {
      problems.push(`sin dependencia de host pero CI NO las corre: ${missing.join(', ')}`)
    }
    if (extra.length > 0) {
      problems.push(`CI las corre pero dependen del host: ${extra.join(', ')}`)
    }
    assert.deepEqual(problems, [], `deriva entre CI y el corpus:\n - ${problems.join('\n - ')}`)

    // El complemento debe estar declarado, no simplemente ausente: si alguien
    // borra la marca de una jornada dependiente, el test de arriba la deja
    // colar en CI y este mensaje explica qué quedó fuera.
    assert.ok(
      hostOnly.length > 0,
      'ninguna jornada declara `requires: host` — revisá si la marca se perdió',
    )
  })
})
