// Tests for scripts/dream-metrics.ts — engineering-process observability
// derived from .evidence/ receipts (missions, TDD cycles, pending work).
import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SCRIPT = join(import.meta.dir, 'dream-metrics.ts')
const RUNNER = process.execPath

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
    expect(r.status).toBe(0)
    const out = JSON.parse(r.stdout) as Record<string, any>
    expect(out.missions.total).toBe(0)
    expect(out.missions.pass).toBe(0)
    expect(out.tdd.valid).toBe(0)
    expect(out.tdd.pending).toBe(0)
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
    expect(r.status).toBe(0)
    const out = JSON.parse(r.stdout) as Record<string, any>
    expect(out.missions.total).toBe(2)
    expect(out.missions.pass).toBe(1)
    expect(out.missions.fail).toBe(1)
    expect(out.missions.passRate).toBe('50.0%')
    expect(out.tdd.cycles).toBe(2)
    expect(out.tdd.valid).toBe(1)
    expect(out.tdd.invalid).toBe(1)
    expect(out.tdd.pending).toBe(1)
    expect(out.latest.mission).toBe('beta') // most recent recordedAt wins
  })

  test('honors an explicit --evidence-dir instead of <cwd>/.evidence', () => {
    const ws = mkdtempSync(join(tmpdir(), 'dsh-metrics-'))
    mkdirSync(join(ws, '.evidence')) // stays empty on purpose
    const elsewhere = mkdtempSync(join(tmpdir(), 'dsh-metrics-ev-'))
    writeFileSync(join(elsewhere, 'mission-gamma-3.yaml'), missionYaml('gamma', 'PASS'))
    const r = runMetrics(ws, ['--evidence-dir', elsewhere])
    expect(r.status).toBe(0)
    const out = JSON.parse(r.stdout) as Record<string, any>
    expect(out.missions.total).toBe(1)
    expect(out.missions.pass).toBe(1)
    expect(out.latest.mission).toBe('gamma')
  })
})
