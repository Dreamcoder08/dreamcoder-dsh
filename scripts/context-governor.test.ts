// Characterization tests for scripts/context-governor.ts — the context
// pressure gate. Each case runs the real CLI against fixture session logs
// (plain session.jsonl — no zstd needed) in an isolated temp dir.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { describe, test } from 'node:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SCRIPT = join(import.meta.dirname, 'context-governor.ts')
const RUNNER = process.execPath

const usageLine = (inputTokens: number): string =>
  JSON.stringify({
    data: { chunk: { type: 'usage', usage: { inputTokens, outputTokens: 10 } } },
  })

/** Crea una sesión fixture con los turnos de uso dados; devuelve su nombre. */
const newSession = (root: string, name: string, inputs: number[]): string => {
  const dir = join(root, name)
  mkdirSync(dir, { recursive: true })
  const body =
    inputs.length === 0
      ? ''
      : inputs.map((t) => usageLine(t)).join('\n') + '\n'
  writeFileSync(join(dir, 'session.jsonl'), body)
  return name
}

const newRoot = (): string => mkdtempSync(join(tmpdir(), 'dsh-governor-'))

const run = (args: readonly string[]) =>
  spawnSync(RUNNER, [SCRIPT, ...args], { encoding: 'utf8' })

describe('context-governor.ts', () => {
  test('ok under the warning threshold (exit 0) and event recorded', () => {
    const root = newRoot()
    const name = newSession(root, 'session-aaa', [1000, 2000])
    const r = run([
      '--sessions-dir', root,
      '--evidence-dir', root,
      '--window', '128000',
    ])
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /context:ok/)
    const events = readFileSync(join(root, 'context-events.jsonl'), 'utf8').trim().split('\n')
    assert.equal(events.length, 1)
    const evt = JSON.parse(events[0]!) as { event: string; tokens: number; session: string }
    assert.equal(evt.event, 'context:ok')
    assert.equal(evt.tokens, 2000) // max over steps, not the last nor the sum
    assert.equal(evt.session, name)
  })

  test('warning at the native compaction threshold (exit 1)', () => {
    const root = newRoot()
    newSession(root, 'session-bbb', [110000]) // ratio 0.859 ≥ 0.80 < 0.92
    const r = run(['--sessions-dir', root, '--evidence-dir', root])
    assert.equal(r.status, 1)
    assert.match(r.stdout, /context:warning/)
    assert.match(r.stdout, /compactación/)
  })

  test('critical above the critical threshold (exit 2) with compact-now advice', () => {
    const root = newRoot()
    newSession(root, 'session-ccc', [125000]) // ratio 0.976 ≥ 0.92
    const r = run(['--sessions-dir', root, '--evidence-dir', root])
    assert.equal(r.status, 2)
    assert.match(r.stdout, /context:critical/)
    assert.match(r.stdout, /COMPACTA YA/)
  })

  test('custom thresholds are honored and validated for ordering', () => {
    const root = newRoot()
    newSession(root, 'session-ddd', [500]) // ratio 0.5
    const ok = run([
      '--sessions-dir', root, '--evidence-dir', root,
      '--window', '1000', '--warning', '0.6', '--critical', '0.8',
    ])
    assert.equal(ok.status, 0)

    const root2 = newRoot()
    newSession(root2, 'session-eee', [500])
    const badOrder = run([
      '--sessions-dir', root2,
      '--window', '1000', '--warning', '0.6', '--critical', '0.5',
    ])
    assert.equal(badOrder.status, 2)
    assert.match(badOrder.stderr, /mayor que --warning/)
  })

  test('picks the most recently modified session when none is named', () => {
    const root = newRoot()
    newSession(root, 'session-old', [90000])
    // Crear la segunda DESPUÉS garantiza mtime mayor.
    const latest = newSession(root, 'session-new', [1000])
    const r = run(['--sessions-dir', root, '--evidence-dir', root])
    assert.equal(r.status, 0)
    assert.match(r.stdout, new RegExp(latest))
  })

  test('explicit --session names a non-latest session', () => {
    const root = newRoot()
    newSession(root, 'session-target', [120000]) // would be critical
    newSession(root, 'session-other', [10])
    const r = run([
      '--sessions-dir', root, '--evidence-dir', root,
      '--session', 'session-target',
    ])
    assert.equal(r.status, 2)
    assert.match(r.stdout, /session-target/)
  })

  test('no usage data exits 3 and declares the limitation instead of inventing one', () => {
    const root = newRoot()
    newSession(root, 'session-empty', [])
    const r = run(['--sessions-dir', root, '--evidence-dir', root])
    assert.equal(r.status, 3)
    assert.match(r.stderr, /sin datos de uso/)
  })

  test('--json emits the full machine-readable event', () => {
    const root = newRoot()
    newSession(root, 'session-json', [64000]) // exactly 0.5 of 128k
    const r = run(['--sessions-dir', root, '--evidence-dir', root, '--json'])
    assert.equal(r.status, 0)
    const evt = JSON.parse(r.stdout) as { event: string; ratio: number }
    assert.equal(evt.event, 'context:ok')
    assert.ok(Math.abs(evt.ratio - 0.5) < 1e-9)
    assert.ok(existsSync(join(root, 'context-events.jsonl')))
  })
})
