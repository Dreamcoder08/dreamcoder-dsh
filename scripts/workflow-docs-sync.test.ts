import { describe, expect, test } from 'bun:test'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

// Los docs de workflow son autoritativos en `workflows/` raíz del repo y
// viajan como supporting files de la skill workflow-router. Si divergen,
// un agente ejecutaría contra un doc distinto según desde dónde resuelva
// la ruta. Este guard hace el drift imposible de ignorar.

const REPO_ROOT = join(import.meta.dir, '..')
const DOCS = ['direct.md', 'mini-sdd.md', 'full-sdd.md'] as const

describe('workflow docs sync', () => {
  for (const doc of DOCS) {
    test(`${doc}: existe en workflows/ raíz y embarcado en la skill`, () => {
      const source = join(REPO_ROOT, 'workflows', doc)
      const shipped = join(
        REPO_ROOT,
        'bundles/engineering/skills/workflow-router/workflows',
        doc,
      )
      expect(existsSync(source)).toBe(true)
      expect(existsSync(shipped)).toBe(true)
    })

    test(`${doc}: la copia embarcada es idéntica a la fuente`, () => {
      const source = readFileSync(join(REPO_ROOT, 'workflows', doc), 'utf8')
      const shipped = readFileSync(
        join(REPO_ROOT, 'bundles/engineering/skills/workflow-router/workflows', doc),
        'utf8',
      )
      expect(shipped).toBe(source)
    })
  }
})
