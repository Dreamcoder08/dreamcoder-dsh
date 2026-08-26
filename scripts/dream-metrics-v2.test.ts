// dream-metrics-v2.test.ts — cobertura de las métricas añadidas en la fase
// "10/10": tokens/task aproximado, rework% derivado de Git y conteo de ciclos
// TDD COMPLETE. Archivo independiente para no colisionar con trabajo en curso
// de otra sesión sobre dream-metrics.test.ts.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { after, before, describe, test } from 'node:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SCRIPT = join(import.meta.dirname, 'dream-metrics.ts')
const RUNNER = process.execPath
const SHA = 'b'.repeat(64)

const missionYaml = (mission: string): string =>
  [
    '# Evidence receipt — generado por scripts/evidence-ledger.ts',
    `mission: ${mission}`,
    'recordedAt: 2026-08-26T00:00:00.000Z',
    'repository: /tmp/x',
    'git: {baseSha: bb, candidateSha: cc, changedFiles: 2}',
    'verification: []',
    'verdict: PASS',
    `sha256: ${SHA}`,
    '',
  ].join('\n')

/** Escribe un log de sesión DSH comprimido con los pasos de uso dados. */
const writeSession = (root: string, id: string, steps: { i: number; o: number }[]): void => {
  const sdir = join(root, `session-${id}`)
  mkdirSync(sdir, { recursive: true })
  const header = JSON.stringify({ type: 'session', version: 0, id, createdAt: Date.now() })
  const events = steps.map((u, idx) =>
    JSON.stringify({
      type: 'assistant/chunk',
      seq: idx,
      data: { chunk: { type: 'usage', usage: { inputTokens: u.i, outputTokens: u.o } } },
    }),
  )
  const plain = join(sdir, 'session.jsonl')
  writeFileSync(plain, [header, ...events].join('\n') + '\n')
  const r = spawnSync('zstd', ['-z', '-f', plain, '-o', `${plain}.zstd`])
  if (r.status !== 0) throw new Error('zstd no disponible')
}

const runMetrics = (cwd: string, args: string[] = []) =>
  spawnSync(RUNNER, [SCRIPT, '--json', ...args], { cwd, encoding: 'utf8' })

describe('dream-metrics v2', () => {
  let ws = ''
  before(() => {
    ws = mkdtempSync(join(tmpdir(), 'dsh-metrics-v2-'))
    const ev = join(ws, '.evidence')
    mkdirSync(ev)
    writeFileSync(join(ev, 'mission-a.yaml'), missionYaml('a'))
    writeFileSync(join(ev, 'mission-b.yaml'), missionYaml('b'))
    // Dos ciclos válidos, uno COMPLETE:
    const cycle = (name: string, complete: boolean): void => {
      writeFileSync(
        join(ev, name),
        JSON.stringify({
          cycle: 'VALID',
          expectation: 'RED falla y GREEN pasa',
          red: { command: 'x', exitCode: 1 },
          green: { command: 'x', exitCode: 0 },
          complete,
          capturedAt: new Date().toISOString(),
        }) + '\n',
      )
    }
    cycle('red-green-1.json', false)
    cycle('red-green-2.json', true)
  })
  after(() => {
    rmSync(ws, { recursive: true, force: true })
  })

  test('tokensPerMission ≈ tokens de sesión / misiones cerradas', () => {
    const sess = join(ws, 'sessions')
    mkdirSync(sess)
    writeSession(sess, 's1', [{ i: 1000, o: 100 }])
    writeSession(sess, 's2', [{ i: 500, o: 50 }])
    const r = runMetrics(ws, ['--sessions-dir', sess])
    assert.equal(r.status, 0, r.stderr)
    const out = JSON.parse(r.stdout) as { tokensPerMission: string; missions: { total: number }; sessions: { inputTokens: number } }
    assert.equal(out.missions.total, 2)
    assert.equal(out.sessions.inputTokens, 1500)
    assert.match(out.tokensPerMission, /~750 tokens entrada\/misión/)
  })

  test('cuenta ciclos TDD COMPLETE por separado de los meramente válidos', () => {
    const r = runMetrics(ws)
    const out = JSON.parse(r.stdout) as { tdd: { valid: number; complete: number } }
    assert.equal(out.tdd.valid, 2)
    assert.equal(out.tdd.complete, 1)
  })
})

describe('rework% derivado de Git', () => {
  let repo = ''
  before(() => {
    repo = mkdtempSync(join(tmpdir(), 'dsh-rework-'))
    const g = (args: string[]): void => {
      const r = spawnSync('git', args, { cwd: repo, encoding: 'utf8' })
      if (r.status !== 0) throw new Error(`git ${args.join(' ')} falló`)
    }
    g(['init', '-q'])
    g(['config', 'user.email', 't@local'])
    g(['config', 'user.name', 't'])
    writeFileSync(join(repo, 'f.txt'), 'one\n')
    g(['add', '.'])
    g(['commit', '-qm', 'init'])
    writeFileSync(join(repo, 'f.txt'), 'two\n')
    g(['add', '.'])
    g(['commit', '-qm', 'fix bug uno'])
    writeFileSync(join(repo, 'f.txt'), 'three\n')
    g(['add', '.'])
    g(['commit', '-qm', 'hotfix critico'])
    writeFileSync(join(repo, 'f.txt'), 'four\n')
    g(['add', '.'])
    g(['commit', '-qm', 'feat normal'])
    // .evidence vacío para que missions=0 y tokensPerMission sea null:
    mkdirSync(join(repo, '.evidence'))
  })
  after(() => {
    rmSync(repo, { recursive: true, force: true })
  })

  test('porcentaje exacto de commits fix/hotfix/revert sobre la muestra', () => {
    const r = runMetrics(repo)
    assert.equal(r.status, 0, r.stderr)
    const out = JSON.parse(r.stdout) as { rework: { fixCommits: number; sampleSize: number; percent: string } | null }
    assert.ok(out.rework !== null)
    assert.equal(out.rework.fixCommits, 2)
    assert.equal(out.rework.sampleSize, 4)
    assert.equal(out.rework.percent, '50,00%')
  })
})
