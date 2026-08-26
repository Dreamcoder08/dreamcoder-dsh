// Tests for scripts/dream-metrics.ts — engineering-process observability
// derived from .evidence/ receipts (missions, TDD cycles, pending work) and
// DSH session telemetry (token usage per step).
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { describe, test } from 'node:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SCRIPT = join(import.meta.dirname, 'dream-metrics.ts')
const RUNNER = process.execPath
const HAS_ZSTD = spawnSync('zstd', ['--version']).status === 0

interface UsageStep {
  inputTokens: number
  outputTokens: number
}

/** Writes a fake DSH session log (JSONL events), zstd-compressed like real ones. */
const writeSession = (dir: string, id: string, usageSteps: UsageStep[]): boolean => {
  const header = JSON.stringify({ type: 'session', version: 0, id, createdAt: Date.now() })
  const events = usageSteps.map((usage, idx) =>
    JSON.stringify({
      type: 'assistant/chunk',
      seq: idx,
      time: Date.now() + idx,
      data: { turn: 1, step: idx + 1, chunk: { type: 'usage', usage } },
    }),
  )
  const payload = [header, ...events].join('\n') + '\n'
  const sdir = join(dir, `session-${id}`)
  mkdirSync(sdir, { recursive: true })
  const target = join(sdir, 'session.jsonl.zstd')
  const plain = join(sdir, 'session.jsonl')
  writeFileSync(plain, payload)
  const r = spawnSync('zstd', ['-z', '-f', plain, '-o', target])
  return r.status === 0
}

const runMetrics = (cwd: string, args: string[] = []) =>
  spawnSync(RUNNER, [SCRIPT, '--json', ...args], { cwd, encoding: 'utf8' })

const SHA = 'a'.repeat(64)

const missionYaml = (mission: string, verdict: 'PASS' | 'FAIL', recordedAt = '2026-08-25T00:00:00.000Z') =>
  [
    '# Evidence receipt — generado por scripts/evidence-ledger.ts',
    `mission: ${mission}`,
    `recordedAt: ${recordedAt}`,
    'repository: /tmp/x',
    'git: {baseSha: bb, candidateSha: cc, changedFiles: 2}',
    'verification: []',
    `verdict: ${verdict}`,
    `sha256: ${SHA}`,
    '',
  ].join('\n')

describe('dream-metrics.ts', () => {
  test('reports zeros on an empty evidence directory', () => {
    const ws = mkdtempSync(join(tmpdir(), 'dsh-metrics-'))
    mkdirSync(join(ws, '.evidence'))
    const r = runMetrics(ws)
    assert.equal(r.status, 0)
    const out = JSON.parse(r.stdout) as Record<string, any>
    assert.equal(out.missions.total, 0)
    assert.equal(out.missions.pass, 0)
    assert.equal(out.tdd.valid, 0)
    assert.equal(out.tdd.pending, 0)
  })

  test('counts missions by verdict and TDD cycles from real receipt shapes', () => {
    const ws = mkdtempSync(join(tmpdir(), 'dsh-metrics-'))
    const ev = join(ws, '.evidence')
    mkdirSync(ev)
    writeFileSync(join(ev, 'mission-alpha-1.yaml'), missionYaml('alpha', 'PASS'))
    writeFileSync(join(ev, 'mission-beta-2.yaml'), missionYaml('beta', 'FAIL', '2026-08-25T12:00:00.000Z'))
    writeFileSync(
      join(ev, 'red-green-111.json'),
      JSON.stringify({ cycle: 'VALID', red: {}, green: {} }),
    )
    writeFileSync(
      join(ev, 'red-green-222.json'),
      JSON.stringify({ cycle: 'INVALID', red: {}, green: {} }),
    )
    writeFileSync(join(ev, 'red-green.pending.json'), JSON.stringify({ red: {} }))
    const r = runMetrics(ws)
    assert.equal(r.status, 0)
    const out = JSON.parse(r.stdout) as Record<string, any>
    assert.equal(out.missions.total, 2)
    assert.equal(out.missions.pass, 1)
    assert.equal(out.missions.fail, 1)
    if (out.missions.passRate !== '50.0%') {
      throw new Error('unexpected mission pass rate')
    }
    assert.equal(out.tdd.cycles, 2)
    assert.equal(out.tdd.valid, 1)
    assert.equal(out.tdd.invalid, 1)
    assert.equal(out.tdd.pending, 1)
    assert.equal(out.latest.mission, 'beta') // most recent recordedAt wins
  })

  test('honors an explicit --evidence-dir instead of <cwd>/.evidence', () => {
    const ws = mkdtempSync(join(tmpdir(), 'dsh-metrics-'))
    mkdirSync(join(ws, '.evidence')) // stays empty on purpose
    const elsewhere = mkdtempSync(join(tmpdir(), 'dsh-metrics-ev-'))
    writeFileSync(join(elsewhere, 'mission-gamma-3.yaml'), missionYaml('gamma', 'PASS'))
    const r = runMetrics(ws, ['--evidence-dir', elsewhere])
    assert.equal(r.status, 0)
    const out = JSON.parse(r.stdout) as Record<string, any>
    assert.equal(out.missions.total, 1)
    assert.equal(out.missions.pass, 1)
    assert.equal(out.latest.mission, 'gamma')
  })

  test('aggregates token usage from DSH session telemetry', { skip: !HAS_ZSTD }, () => {
    const ws = mkdtempSync(join(tmpdir(), 'dsh-metrics-'))
    mkdirSync(join(ws, '.evidence'))
    const firstOk = writeSession(ws, 'aaaa', [
      { inputTokens: 100, outputTokens: 10 },
      { inputTokens: 200, outputTokens: 20 },
    ])
    const secondOk = writeSession(ws, 'bbbb', []) // session without LLM traffic
    assert.equal(firstOk && secondOk, true)
    const r = runMetrics(ws, ['--sessions-dir', ws])
    assert.equal(r.status, 0)
    const out = JSON.parse(r.stdout) as Record<string, any>
    assert.equal(out.sessions.count, 2)
    assert.equal(out.sessions.withUsage, 1)
    assert.equal(out.sessions.inputTokens, 300)
    assert.equal(out.sessions.outputTokens, 30)
  })

  test('aggregates native token-meter projections from the projcache', () => {
    const ws = mkdtempSync(join(tmpdir(), 'dsh-metrics-'))
    mkdirSync(join(ws, '.evidence'))
    const projcache = join(ws, 'session_projcache.json')
    const totals = (uncached: number, out: number, cr: number, cw: number) => ({
      uncachedInputTokens: uncached,
      outputTokens: out,
      cacheReadTokens: cr,
      cacheWriteTokens: cw,
    })
    writeFileSync(
      projcache,
      JSON.stringify({
        tables: {
          sessions: {
            'session-one': {
              rows: {
                tokenUsage: { val: { totals: totals(1000, 200, 50_000, 0) } },
                contextPressure: { val: { pressureTokens: 40_000, contextWindow: 1_000_000 } },
              },
            },
            'session-two': {
              rows: {
                tokenUsage: { val: { totals: totals(500, 100, 0, 3000) } },
                contextPressure: { val: { pressureTokens: 90_000, contextWindow: 200_000 } },
              },
            },
            // proyección ilegible (buckets no enteros): se excluye entera
            'session-broken': {
              rows: { tokenUsage: { val: { totals: { uncachedInputTokens: 'x' } } } },
            },
          },
        },
      }),
    )
    const r = runMetrics(ws, ['--projcache', projcache])
    assert.equal(r.status, 0)
    const out = JSON.parse(r.stdout) as Record<string, any>
    assert.equal(out.tokenMeter.sessions, 2)
    assert.equal(out.tokenMeter.uncachedInputTokens, 1500)
    assert.equal(out.tokenMeter.outputTokens, 300)
    assert.equal(out.tokenMeter.cacheReadTokens, 50_000)
    assert.equal(out.tokenMeter.cacheWriteTokens, 3000)
    assert.equal(out.tokenMeter.peakPressureTokens, 90_000) // el pico gana, no el último
    assert.equal(out.tokenMeter.peakContextWindow, 200_000)
  })

  test('degrades to null peaks when the projcache is missing or corrupt', () => {
    const ws = mkdtempSync(join(tmpdir(), 'dsh-metrics-'))
    mkdirSync(join(ws, '.evidence'))
    const r = runMetrics(ws) // sin --projcache y sin ~/.dsh real que matchee: nulls o ceros
    assert.equal(r.status, 0)
    const out = JSON.parse(r.stdout) as Record<string, any>
    assert.equal(typeof out.tokenMeter.sessions, 'number')

    const corrupt = join(ws, 'corrupt.json')
    writeFileSync(corrupt, '{ not json')
    const r2 = runMetrics(ws, ['--projcache', corrupt])
    assert.equal(r2.status, 0)
    const out2 = JSON.parse(r2.stdout) as Record<string, any>
    assert.equal(out2.tokenMeter.sessions, 0)
    assert.equal(out2.tokenMeter.peakPressureTokens, null)
  })
})
