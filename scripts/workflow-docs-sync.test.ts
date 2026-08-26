import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// Los docs de workflow son autoritativos en `workflows/` raíz del repo y
// viajan como supporting files de la skill workflow-router. Si divergen,
// un agente ejecutaría contra un doc distinto según desde dónde resuelva
// la ruta. Este guard hace el drift imposible de ignorar.
//
// Enumera `workflows/*.md` en vez de hardcodear nombres: un doc nuevo en
// raíz queda cubierto sin tocar este archivo.

const REPO_ROOT = join(import.meta.dirname, '..')
const SOURCE_DIR = join(REPO_ROOT, 'workflows')
const SHIPPED_DIR = join(
  REPO_ROOT,
  'bundles/engineering/skills/workflow-router/workflows',
)
const DOCS = readdirSync(SOURCE_DIR).filter((f) => f.endsWith('.md'))

describe('workflow docs sync', () => {
  // Sanity del propio guard: si raíz no tiene docs, el guard no protege nada.
  it('el directorio workflows/ raíz tiene al menos un doc', () => {
    assert.ok(DOCS.length > 0, 'workflows/ raíz vacío: guard sin cobertura')
  })

  for (const doc of DOCS) {
    it(`${doc}: existe en workflows/ raíz y embarcado en la skill`, () => {
      assert.equal(existsSync(join(SOURCE_DIR, doc)), true)
      assert.equal(existsSync(join(SHIPPED_DIR, doc)), true)
    })

    it(`${doc}: la copia embarcada es idéntica a la fuente`, () => {
      const source = readFileSync(join(SOURCE_DIR, doc), 'utf8')
      const shipped = readFileSync(join(SHIPPED_DIR, doc), 'utf8')
      assert.equal(shipped, source)
    })
  }
})
