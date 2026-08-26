// Characterization tests for scripts/verify-contracts.ts — the stage-contract
// verifier. Each case runs the real CLI against a fixture contracts dir so the
// repo's own contracts are exercised exactly like third-party ones would be.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { after, describe, test } from 'node:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SCRIPT = join(import.meta.dirname, 'verify-contracts.ts')
const RUNNER = process.execPath
const REPO_ROOT = join(import.meta.dirname, '..')
const REPO_CONTRACTS = join(REPO_ROOT, 'contracts')
const REPO_SCHEMA = join(REPO_ROOT, 'schemas', 'stage-contract.schema.json')

const tempDirs: string[] = []
const newDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-contracts-'))
  tempDirs.push(dir)
  return dir
}
// Higiene: ninguna fixture sobrevive a la suite (el TMPDIR queda limpio).
after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
})

const run = (contractsDir: string) =>
  spawnSync(RUNNER, [SCRIPT, '--contracts-dir', contractsDir], { encoding: 'utf8' })

/** Copia el contrato real y le aplica una mutación JSON puntual. */
const mutatedContract = (dir: string, mutate: (c: Record<string, unknown>) => void): string => {
  const raw = JSON.parse(readFileSync(join(REPO_CONTRACTS, 'mini-sdd.json'), 'utf8')) as Record<string, unknown>
  mutate(raw)
  writeFileSync(join(dir, 'mini-sdd.json'), JSON.stringify(raw))
  return dir
}

describe('verify-contracts.ts', () => {
  test('the repo’s own contracts pass form and doc cross-checks', () => {
    const r = run(REPO_CONTRACTS)
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /3 contrato/)
    for (const wf of ['direct', 'full-sdd', 'mini-sdd']) {
      assert.match(r.stdout, new RegExp(`✔ ${wf}\\.json`))
    }
  })

  test('empty contracts dir fails loudly (exit 1)', () => {
    const dir = newDir()
    const r = run(dir)
    assert.equal(r.status, 1)
    assert.match(r.stderr, /sin contratos/)
  })

  test('invalid JSON in a contract is rejected', () => {
    const dir = newDir()
    writeFileSync(join(dir, 'broken.json'), '{ not json')
    const r = run(dir)
    assert.equal(r.status, 1)
    assert.match(r.stderr, /JSON ilegible/)
  })

  test('missing required field fails with a named error', () => {
    const dir = newDir()
    mutatedContract(dir, (c) => {
      const stages = c['stages'] as Array<Record<string, unknown>>
      const stage0 = stages[0]!
      delete stage0['exit_criteria']
    })
    const r = run(dir)
    assert.equal(r.status, 1)
    assert.match(r.stderr, /falta campo obligatorio 'exit_criteria'/)
  })

  /**
   * Fixture con el layout real contracts/ + workflows/: los tests que ejercitan
   * el cruce contrato↔documento necesitan el doc resoluble en ../workflows/.
   */
  const fixtureWithDocs = (): string => {
    const root = newDir()
    mkdirSync(join(root, 'contracts'), { recursive: true })
    mkdirSync(join(root, 'workflows'), { recursive: true })
    for (const wf of ['direct.md', 'mini-sdd.md', 'full-sdd.md']) {
      writeFileSync(join(root, 'workflows', wf), readFileSync(join(REPO_ROOT, 'workflows', wf)))
    }
    return root
  }

  test('stage heading absent from the workflow doc fails the cross-check', () => {
    const root = fixtureWithDocs()
    mutatedContract(join(root, 'contracts'), (c) => {
      const stages = c['stages'] as Array<Record<string, unknown>>
      const stage0 = stages[0]!
      stage0['heading'] = 'Etapa Inexistente'
    })
    const r = run(join(root, 'contracts'))
    assert.equal(r.status, 1)
    assert.match(r.stderr, /no aparece como encabezado de etapa/)
  })

  test('extra stage heading in the doc without a contract entry fails alignment', () => {
    const root = fixtureWithDocs()
    // Contrato válido pero con UNA etapa menos de las que el doc declara.
    const raw = JSON.parse(readFileSync(join(REPO_CONTRACTS, 'mini-sdd.json'), 'utf8')) as Record<string, unknown>
    const stages = raw['stages'] as unknown[]
    raw['stages'] = stages.slice(0, stages.length - 1)
    writeFileSync(join(root, 'contracts', 'mini-sdd.json'), JSON.stringify(raw))
    // El doc del contrato apunta al repo; copiamos la referencia tal cual.
    const r = spawnSync(RUNNER, [SCRIPT, '--contracts-dir', join(root, 'contracts')], {
      encoding: 'utf8',
    })
    assert.equal(r.status, 1)
    assert.match(r.stderr, /desalineación contrato↔documento/)
  })

  test('token_budget.fraction out of range is rejected', () => {
    const dir = newDir()
    mutatedContract(dir, (c) => {
      const stages = c['stages'] as Array<Record<string, unknown>>
      const stage0 = stages[0]!
      ;(stage0['token_budget'] as Record<string, unknown>)['fraction'] = 1.5
    })
    const r = run(dir)
    assert.equal(r.status, 1)
    assert.match(r.stderr, /fraction debe estar en \(0,1\]/)
  })

  test('unknown memory_policy is rejected', () => {
    const dir = newDir()
    mutatedContract(dir, (c) => {
      const stages = c['stages'] as Array<Record<string, unknown>>
      const stage0 = stages[0]!
      stage0['memory_policy'] = 'todos-escriben'
    })
    const r = run(dir)
    assert.equal(r.status, 1)
    assert.match(r.stderr, /memory_policy debe ser/)
  })

  test('schema file must exist and parse as JSON', () => {
    const dir = newDir()
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'direct.json'),
      readFileSync(join(REPO_CONTRACTS, 'direct.json'), 'utf8'),
    )
    const badSchema = join(newDir(), 'nope.json')
    const r = spawnSync(RUNNER, [SCRIPT, '--contracts-dir', dir, '--schema', badSchema], {
      encoding: 'utf8',
    })
    assert.equal(r.status, 1)
    assert.match(r.stderr, /schema ilegible/)
    assert.ok(!REPO_SCHEMA.includes('nope')) // sanity: schema real intacto
  })

  // ── Caracterización de los caminos corregidos tras la review 4R ──

  test('an unknown key is rejected (additionalProperties: false enforced)', () => {
    const dir = newDir()
    mutatedContract(dir, (c) => {
      ;(c as Record<string, unknown>)['stagges_typo'] = true
    })
    const r = run(dir)
    assert.equal(r.status, 1)
    assert.match(r.stderr, /clave desconocida 'stagges_typo'/)
  })

  test('a broken FIRST file does not hide the cross-check of later valid files', () => {
    const root = fixtureWithDocs()
    const contractsDir = join(root, 'contracts')
    // Primer archivo: JSON ilegible. Segundo: heading inexistente — su error
    // DEBE aparecer aunque el primero ya haya fallado.
    writeFileSync(join(contractsDir, 'aaa-broken.json'), '{ no json')
    mutatedContract(contractsDir, (c) => {
      const stages = c['stages'] as Array<Record<string, unknown>>
      stages[0]!['heading'] = 'Etapa Inexistente'
    })
    const r = run(contractsDir)
    assert.equal(r.status, 1)
    assert.match(r.stderr, /JSON ilegible/)
    assert.match(r.stderr, /no aparece como encabezado de etapa/)
  })

  test('duplicated stage headings in a doc are an ambiguous mapping (rejected)', () => {
    const root = fixtureWithDocs()
    const docPath = join(root, 'workflows', 'mini-sdd.md')
    const body = readFileSync(docPath, 'utf8').replace(
      /^## \d+\. (.+)$/gm,
      (m, t: string) => `## 1. ${t.trim()}`,
    )
    writeFileSync(docPath, body) // todos los headings idénticos
    const contractsDir = join(root, 'contracts')
    const raw = JSON.parse(readFileSync(join(REPO_CONTRACTS, 'mini-sdd.json'), 'utf8')) as Record<string, unknown>
    const stages = raw['stages'] as Array<Record<string, unknown>>
    for (const st of stages.slice(0, 2)) st['heading'] = 'Propuesta breve'
    raw['stages'] = stages.slice(0, 2)
    writeFileSync(join(contractsDir, 'mini-sdd.json'), JSON.stringify(raw))
    const r = run(contractsDir)
    assert.equal(r.status, 1)
    assert.match(r.stderr, /encabezados de etapa duplicados|heading duplicado/)
  })

  test('doc path escaping the allowed tree is rejected', () => {
    const dir = newDir()
    mutatedContract(dir, (c) => {
      c['doc'] = '../../../../../etc/hostname.md'
    })
    const r = run(dir)
    assert.equal(r.status, 1)
    assert.match(r.stderr, /escapa del árbol permitido/)
  })

  test('a dangling --contracts-dir value is usage error 2, never repo defaults', () => {
    const r = spawnSync(RUNNER, [SCRIPT, '--contracts-dir'], { encoding: 'utf8' })
    assert.equal(r.status, 2)
    assert.match(r.stderr, /requiere un valor/)
  })

  test('nonexistent --contracts-dir gets a named error, not a raw ENOENT stack', () => {
    const r = spawnSync(RUNNER, [SCRIPT, '--contracts-dir', join(newDir(), 'no-existe')], {
      encoding: 'utf8',
    })
    assert.equal(r.status, 1)
    assert.match(r.stderr, /directorio de contratos ilegible/)
  })

  test('the same workflow declared by two contracts is rejected', () => {
    const root = fixtureWithDocs()
    const contractsDir = join(root, 'contracts')
    const mini = readFileSync(join(REPO_CONTRACTS, 'mini-sdd.json'), 'utf8')
    writeFileSync(join(contractsDir, 'mini-sdd.json'), mini)
    writeFileSync(join(contractsDir, 'mini-sdd-copy.json'), mini)
    const r = run(contractsDir)
    assert.equal(r.status, 1)
    assert.match(r.stderr, /ya declara el workflow 'mini-sdd'/)
  })
})
