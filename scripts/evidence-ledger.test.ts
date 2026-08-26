// Characterization tests for scripts/evidence-ledger.ts — the Git-derived
// mission receipt generator. Each test builds a throwaway Git repository so
// receipts are computed against real diffs and real check commands.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { describe, test } from 'node:test'
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SCRIPT = join(import.meta.dirname, 'evidence-ledger.ts')
const RUNNER = process.execPath

interface Repo {
  dir: string
  baseSha: string
}

const git = (cwd: string, args: string[]) =>
  spawnSync('git', args, { cwd, encoding: 'utf8' })

/** Creates a temp repo with one committed file; returns it plus the base SHA. */
const initRepo = (): Repo => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-ledger-'))
  git(dir, ['init', '-q'])
  git(dir, ['config', 'user.email', 'test@local'])
  git(dir, ['config', 'user.name', 'test'])
  writeFileSync(join(dir, 'a.txt'), 'one\n')
  git(dir, ['add', '.'])
  git(dir, ['commit', '-qm', 'base'])
  const baseSha = git(dir, ['rev-parse', 'HEAD']).stdout.trim()
  return { dir, baseSha }
}

/** Commits an edit plus a new file → committed diff of exactly 2 files.
 *  The ledger derives receipts from committed ranges (base..HEAD), so the
 *  changes must land in Git history, not stay in the working tree. */
const changeTwoFiles = (dir: string) => {
  writeFileSync(join(dir, 'a.txt'), 'one changed\n')
  writeFileSync(join(dir, 'b.txt'), 'two\n')
  git(dir, ['add', '-A'])
  git(dir, ['commit', '-qm', 'candidate change'])
}

const runLedger = (cwd: string, args: string[]) =>
  spawnSync(RUNNER, [SCRIPT, ...args], { cwd, encoding: 'utf8' })

const evidenceFiles = (dir: string): string[] =>
  readdirSync(join(dir, '.evidence')).filter((f) => f.startsWith('mission-'))

describe('evidence-ledger.ts', () => {
  test('PASS receipt when checks pass and scope matches expectation', () => {
    const { dir, baseSha } = initRepo()
    changeTwoFiles(dir)
    const r = runLedger(dir, [
      '--mission', 'feat-test',
      '--base', baseSha,
      '--expected', '2',
      '--check', 'always ok', '--', RUNNER, '-e', 'process.exit(0)',
    ])
    assert.equal(r.status, 0)
    assert.match(r.stdout, /PASS/)
    const files = evidenceFiles(dir)
    assert.equal(files.length, 1)
    const body = readFileSync(join(dir, '.evidence', files[0] as string), 'utf8')
    assert.match(body, /mission: feat-test/)
    assert.match(body, /verdict: PASS/)
    assert.match(body, /sha256: [0-9a-f]{64}/)
    assert.match(body, /scopeMatchesExpectation: true/)
    assert.match(body, /baseIsAncestorOfCandidate: true/)
  })

  test('FAIL receipt when a verification command fails', () => {
    const { dir, baseSha } = initRepo()
    changeTwoFiles(dir)
    const r = runLedger(dir, [
      '--mission', 'broken-check',
      '--base', baseSha,
      '--check', 'doomed', '--', RUNNER, '-e', 'process.exit(1)',
    ])
    assert.equal(r.status, 1)
    const body = readFileSync(join(dir, '.evidence', evidenceFiles(dir)[0] as string), 'utf8')
    assert.match(body, /verdict: FAIL/)
  })

  test('FAIL receipt when changed files exceed the expected scope', () => {
    const { dir, baseSha } = initRepo()
    changeTwoFiles(dir)
    const r = runLedger(dir, [
      '--mission', 'scope-creep',
      '--base', baseSha,
      '--expected', '5',
      '--check', 'ok', '--', RUNNER, '-e', 'process.exit(0)',
    ])
    assert.equal(r.status, 1)
    const body = readFileSync(join(dir, '.evidence', evidenceFiles(dir)[0] as string), 'utf8')
    assert.match(body, /scopeMatchesExpectation: false/)
    assert.match(body, /verdict: FAIL/)
  })

  test('missing --mission is rejected with a clear error', () => {
    const { dir, baseSha } = initRepo()
    const r = runLedger(dir, ['--base', baseSha])
    assert.notEqual(r.status, 0)
    assert.match(r.stderr, /--mission es obligatorio/)
  })

  describe('--sdd gate integration', () => {
    const runGate = (cwd: string, args: string[]) =>
      spawnSync(RUNNER, [join(import.meta.dirname, 'sdd-gate.ts'), ...args], { cwd, encoding: 'utf8' })

    test('an incomplete SDD denies the receipt even with green checks', () => {
      const { dir, baseSha } = initRepo()
      assert.equal(runGate(dir, ['start', '--workflow', 'direct', '--mission', 'm1']).status, 0)
      const r = runLedger(dir, [
        '--mission', 'sdd-incomplete',
        '--base', baseSha,
        '--expected', '0',
        '--sdd', 'm1',
        '--check', 'ok', '--', RUNNER, '-e', 'process.exit(0)',
      ])
      assert.equal(r.status, 1)
      const body = readFileSync(join(dir, '.evidence', evidenceFiles(dir)[0] as string), 'utf8')
      assert.match(body, /verdict: FAIL/)
    })

    test('a completed SDD yields PASS and records the workflow in the receipt', () => {
      const { dir, baseSha } = initRepo()
      runGate(dir, ['start', '--workflow', 'direct', '--mission', 'm2'])
      for (const stage of ['understand', 'change', 'verify', 'summarize']) {
        assert.equal(
          runGate(dir, ['advance', '--mission', 'm2', '--stage', stage, '--note', `ok ${stage}`]).status,
          0,
          stage,
        )
      }
      const r = runLedger(dir, [
        '--mission', 'sdd-complete',
        '--base', baseSha,
        '--expected', '0',
        '--sdd', 'm2',
        '--check', 'ok', '--', RUNNER, '-e', 'process.exit(0)',
      ])
      assert.equal(r.status, 0, r.stderr)
      const body = readFileSync(join(dir, '.evidence', evidenceFiles(dir)[0] as string), 'utf8')
      assert.match(body, /workflow: direct/)
      assert.match(body, /complete: true/)
    })
  })
})
