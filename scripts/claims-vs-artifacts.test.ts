// Afirmaciones del README atadas a sus artefactos.
//
// Dos afirmaciones que hasta ahora eran solo prosa y que un cambio silencioso
// podía volver falsas:
//
//   1. "Toda tarea recorre el pipeline de diez etapas" — las etapas viven en la
//      persona del bundle (`bundles/engineering/cordis.patch.yml`). Si alguien
//      reordena, renombra o borra una etapa, el README seguiría afirmándolo.
//      Este test compara la lista del artefacto contra la canónica.
//   2. La versión del repo y su CHANGELOG: subir `version` sin entrada de
//      changelog es una promesa de release sin registro.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, test } from 'node:test'

const ROOT = join(import.meta.dirname, '..')
const PATCH = join(ROOT, 'bundles', 'engineering', 'cordis.patch.yml')
const README = join(ROOT, 'README.md')
const CHANGELOG = join(ROOT, 'CHANGELOG.md')
const PKG = join(ROOT, 'package.json')

/** Las diez etapas, en orden, tal como las declara `policy/AGENTS.md` §1. */
const CANONICAL = [
  'Architect',
  'Clarify',
  'Classify risk',
  'Select workflow',
  'Retrieve context',
  'Delegate',
  'Implement',
  'Verify independently',
  'Review',
  'Publish evidence',
]

/**
 * Bloque `persona: >-` del patch: desde esa línea hasta la primera línea con
 * indentación menor o igual a la de `persona:` que no esté vacía.
 */
function personaBlock(text: string): string {
  const lines = text.split('\n')
  const start = lines.findIndex((l) => /^\s*persona:\s*>-\s*$/.test(l))
  assert.notEqual(start, -1, 'no encontré el bloque `persona: >-` en el patch del bundle')
  const indent = (lines[start] ?? '').length - (lines[start] ?? '').trimStart().length
  const out: string[] = []
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i] ?? ''
    if (line.trim() === '') {
      out.push(line)
      continue
    }
    const lineIndent = line.length - line.trimStart().length
    if (lineIndent <= indent) break
    out.push(line)
  }
  return out.join('\n')
}

describe('pipeline de diez etapas (afirmación ↔ artefacto)', () => {
  const block = personaBlock(readFileSync(PATCH, 'utf8'))

  test('la persona enumera las diez etapas canónicas en orden', () => {
    const found: Array<{ n: number; name: string }> = []
    for (const line of block.split('\n')) {
      const m = /^\s*(\d{1,2})\.\s+([^—]+?)\s+—/.exec(line)
      if (m?.[1] !== undefined && m[2] !== undefined) found.push({ n: Number(m[1]), name: m[2].trim() })
    }
    assert.equal(found.length, CANONICAL.length, `la persona declara ${found.length} etapas, no ${CANONICAL.length}`)
    assert.deepEqual(
      found.map((f) => f.name),
      CANONICAL,
      'las etapas del artefacto no coinciden con la lista canónica',
    )
    assert.deepEqual(
      found.map((f) => f.n),
      CANONICAL.map((_, i) => i + 1),
      'la numeración de las etapas no es 1..10',
    )
  })

  test('el README nombra cada etapa y las cuenta como diez', () => {
    const readme = readFileSync(README, 'utf8')
    assert.match(readme, /diez etapas/, 'el README ya no afirma el pipeline de diez etapas')
    const missing = CANONICAL.filter((stage) => !readme.includes(stage))
    assert.deepEqual(missing, [], `etapas del artefacto ausentes del README: ${missing.join(', ')}`)
  })
})

describe('disciplina de versión (package.json ↔ CHANGELOG)', () => {
  test('la versión publicada tiene entrada de changelog', () => {
    const version = (JSON.parse(readFileSync(PKG, 'utf8')) as { version?: string }).version
    assert.ok(typeof version === 'string' && version.length > 0, 'package.json sin version')
    const changelog = readFileSync(CHANGELOG, 'utf8')
    assert.match(
      changelog,
      new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\]`, 'm'),
      `CHANGELOG.md no tiene una sección '## [${version}]' — subir la versión exige registrarla`,
    )
  })
})
