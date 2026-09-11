// Tests for scripts/dream-manifest.sh — provenance manifest (SHA-256) over the
// artifacts install.sh copies into $DSH_HOME. Runs the real bash script against
// a fake DSH_HOME; no dsh/pnpm needed.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { after, describe, test } from 'node:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SCRIPT = join(import.meta.dirname, 'dream-manifest.sh')

const tempDirs: string[] = []
// Higiene: ninguna fixture sobrevive a la suite (el TMPDIR queda limpio).
after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
})

interface Fixture {
  dshHome: string
  repoRoot: string
}

/** Fake installation: AGENTS.md copy + generated profile package.json. */
const makeFixture = (): Fixture => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-manifest-'))
  tempDirs.push(root)
  const dshHome = join(root, 'dsh-home')
  const repoRoot = join(root, 'repo')
  mkdirSync(join(dshHome, 'profiles', 'engineering'), { recursive: true })
  mkdirSync(join(repoRoot, 'agents', 'explorer'), { recursive: true })
  // Hermeticidad: `git -C <dir>` asciende por los directorios padre, así que sin
  // este repo propio la cabecera `repo-commit` dependía de si algún ancestro de
  // TMPDIR resultaba ser un repositorio en la máquina de quien corre la suite.
  // Anclamos la fixture a un repo sin commits: resultado determinista en
  // cualquier entorno (best-effort: sin git la cabecera cae a "unknown").
  spawnSync('git', ['init', '-q'], { cwd: repoRoot })
  writeFileSync(join(dshHome, 'AGENTS.md'), '# policy v1\n')
  writeFileSync(
    join(dshHome, 'profiles', 'engineering', 'package.json'),
    '{"name":"dsh-profile-engineering"}\n',
  )
  // El patch del perfil existe siempre tras el primer arranque del perfil
  // (initProfile de dsh escribe la capa vacía; install.sh añade overlays).
  writeFileSync(join(dshHome, 'profiles', 'engineering', 'cordis.patch.yml'), '[]\n')
  return { dshHome, repoRoot }
}

const runGenerate = (f: Fixture) =>
  spawnSync('bash', [SCRIPT, 'generate', f.dshHome, f.repoRoot, 'engineering'], { encoding: 'utf8' })

const runVerify = (f: Fixture) =>
  spawnSync('bash', [SCRIPT, 'verify', f.dshHome, f.repoRoot, 'engineering'], { encoding: 'utf8' })

describe('dream-manifest.sh', () => {
  test('generate writes a sha256sum-format manifest with provenance header', () => {
    const f = makeFixture()
    const r = runGenerate(f)
    assert.equal(r.status, 0, r.stderr)
    const body = readFileSync(join(f.dshHome, '.dreamcoder-manifest.sha256'), 'utf8')
    assert.match(body, /^# repo-commit: /m)
    assert.match(body, /^[0-9a-f]{64}  AGENTS\.md$/m)
    assert.match(body, /^([0-9a-f]{64})  profiles\/engineering\/package\.json$/m)
  })

  test('verify passes right after generate and detects post-install drift', () => {
    const f = makeFixture()
    assert.equal(runGenerate(f).status, 0)
    assert.equal(runVerify(f).status, 0)

    // Tampering after install must fail verification with a visible drift line.
    writeFileSync(join(f.dshHome, 'AGENTS.md'), '# policy edited by someone else\n')
    const r = runVerify(f)
    assert.equal(r.status, 1)
    assert.match(r.stdout, /drift detectado/)
    assert.match(r.stdout, /AGENTS\.md/)
  })

  test('verify exits 3 (not a failure of content) when no manifest exists', () => {
    const f = makeFixture()
    const r = runVerify(f)
    assert.equal(r.status, 3)
    assert.match(r.stdout, /sin manifiesto/)
  })

  test('generate warns and records a missing artifact without aborting', () => {
    const f = makeFixture()
    // A missing artifact is a degraded install: warn loudly, still record what
    // exists, and exit non-zero so install.sh output shows the degradation.
    unlinkSync(join(f.dshHome, 'profiles', 'engineering', 'package.json'))
    const r = runGenerate(f)
    assert.equal(r.status, 1)
    assert.match(r.stderr, /no existe/)
    const body = readFileSync(join(f.dshHome, '.dreamcoder-manifest.sha256'), 'utf8')
    assert.match(body, /AGENTS\.md/)
    assert.doesNotMatch(body, /package\.json$/m)
  })

  // Regresión: `git rev-parse HEAD` en un repo SIN commits imprime "HEAD" por
  // stdout y además falla, así que el `|| echo unknown` concatenaba una segunda
  // línea. La cabecera quedaba partida y la línea huérfana "unknown" hacía que
  // `sha256sum --check` la marcara como "improperly formatted": verify reportaba
  // drift falso sobre una instalación intacta. Verificado en el repo antes del
  // fix: 146 tests, 1 fail (scripts/dream-manifest.test.ts:63).
  test('la cabecera no se parte: sin líneas huérfanas y verify pasa sin drift', () => {
    const f = makeFixture() // repo sin commits → caso que rompía la cabecera
    const r = runGenerate(f)
    assert.equal(r.status, 0, r.stderr)
    const body = readFileSync(join(f.dshHome, '.dreamcoder-manifest.sha256'), 'utf8')
    // Invariante: cada línea es o comentario de cabecera o entrada sha256sum.
    const orphans = body
      .split('\n')
      .filter((l) => l !== '' && !l.startsWith('#') && !/^[0-9a-f]{64} {2}.+$/.test(l))
    assert.deepEqual(orphans, [], `líneas huérfanas en el manifiesto:\n${body}`)
    assert.equal(
      body.split('\n').filter((l) => l.startsWith('# repo-commit:')).length,
      1,
      body,
    )
    assert.equal(runVerify(f).status, 0)
  })

  test('la cabecera registra el commit real cuando el repo tiene uno', () => {
    const f = makeFixture()
    const git = (args: string[]) => spawnSync('git', args, { cwd: f.repoRoot, encoding: 'utf8' })
    git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'x'])
    const head = git(['rev-parse', 'HEAD']).stdout.trim()
    assert.match(head, /^[0-9a-f]{40}$/, 'la fixture debe tener un commit real')
    const r = runGenerate(f)
    assert.equal(r.status, 0, r.stderr)
    const body = readFileSync(join(f.dshHome, '.dreamcoder-manifest.sha256'), 'utf8')
    // La procedencia prometida en el README debe ser el commit real, no "unknown".
    assert.match(body, new RegExp(`^# repo-commit: ${head}$`, 'm'))
    assert.equal(runVerify(f).status, 0)
  })
})
