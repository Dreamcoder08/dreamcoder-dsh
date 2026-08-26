// Characterization tests for scripts/red-green.ts — the RED→GREEN TDD evidence
// recorder. Each test runs the real CLI in an isolated temp workspace so the
// `.evidence/` state never leaks between cases.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { after, describe, test } from 'node:test'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SCRIPT = join(import.meta.dirname, 'red-green.ts')
const RUNNER = process.execPath

const PASSING = [RUNNER, '-e', 'process.exit(0)']
const FAILING = [RUNNER, '-e', 'process.exit(3)']

const tempDirs: string[] = []
const newWorkspace = (): string => {
  const ws = mkdtempSync(join(tmpdir(), 'dsh-redgreen-'))
  tempDirs.push(ws)
  return ws
}
// Higiene: ninguna fixture sobrevive a la suite (el TMPDIR queda limpio).
after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
})

const runTool = (cwd: string, phase: string, cmd: readonly string[]) =>
  spawnSync(RUNNER, [SCRIPT, phase, '--', ...cmd], { cwd, encoding: 'utf8' })

describe('red-green.ts', () => {
  test('usage error (exit 2) when the -- separator is missing', () => {
    const ws = newWorkspace()
    const r = spawnSync(RUNNER, [SCRIPT, 'record-red'], { cwd: ws, encoding: 'utf8' })
    assert.equal(r.status, 2)
  })

  test('record-red rejects a passing command — a test that passes proves nothing new', () => {
    const ws = newWorkspace()
    const r = runTool(ws, 'record-red', PASSING)
    assert.equal(r.status, 1)
    assert.equal(existsSync(join(ws, '.evidence', 'red-green.pending.json')), false)
  })

  test('record-red accepts a failing command and writes the pending cycle', () => {
    const ws = newWorkspace()
    const r = runTool(ws, 'record-red', FAILING)
    assert.equal(r.status, 0)
    const pending = JSON.parse(readFileSync(join(ws, '.evidence', 'red-green.pending.json'), 'utf8'))
    assert.equal(pending.red.exitCode, 3)
    assert.match(pending.red.command, /-e/)
    assert.equal(typeof pending.recordedAt, 'string')
  })

  test('a second record-red while a cycle is open is rejected', () => {
    const ws = newWorkspace()
    runTool(ws, 'record-red', FAILING)
    const r = runTool(ws, 'record-red', FAILING)
    assert.equal(r.status, 1)
  })

  test('record-green without a pending RED is rejected', () => {
    const ws = newWorkspace()
    const r = runTool(ws, 'record-green', PASSING)
    assert.equal(r.status, 1)
  })

  test('GREEN failure keeps the cycle open and pending intact', () => {
    const ws = newWorkspace()
    runTool(ws, 'record-red', FAILING)
    const r = runTool(ws, 'record-green', FAILING)
    assert.equal(r.status, 1)
    assert.equal(existsSync(join(ws, '.evidence', 'red-green.pending.json')), true)
  })

  test('a full failing-RED then passing-GREEN cycle records VALID evidence', () => {
    const ws = newWorkspace()
    assert.equal(runTool(ws, 'record-red', FAILING).status, 0)
    const r = runTool(ws, 'record-green', PASSING)
    assert.equal(r.status, 0)
    // Pending is consumed and exactly one definitive record remains.
    assert.equal(existsSync(join(ws, '.evidence', 'red-green.pending.json')), false)
    const records = readdirSync(join(ws, '.evidence')).filter((f) => f.startsWith('red-green-'))
    assert.equal(records.length, 1)
    const record = JSON.parse(readFileSync(join(ws, '.evidence', records[0] as string), 'utf8'))
    assert.equal(record.cycle, 'VALID')
    assert.notEqual(record.red.exitCode, 0)
    assert.equal(record.green.exitCode, 0)
    assert.equal(record.complete, false)
  })

  describe('post-pair phases (TRIANGULATE / REFACTOR)', () => {
    const closePair = (ws: string): void => {
      assert.equal(runTool(ws, 'record-red', FAILING).status, 0)
      assert.equal(runTool(ws, 'record-green', PASSING).status, 0)
    }
    const latestRecord = (ws: string): Record<string, unknown> => {
      const latest = JSON.parse(readFileSync(join(ws, '.evidence', 'red-green.latest.json'), 'utf8')) as {
        file: string
      }
      return JSON.parse(readFileSync(latest.file, 'utf8')) as Record<string, unknown>
    }

    test('triangulate without any closed cycle is rejected', () => {
      const ws = newWorkspace()
      const r = runTool(ws, 'record-triangulate', PASSING)
      assert.equal(r.status, 1)
    })

    test('refactor without prior triangulate is rejected (tdd-evidence order)', () => {
      const ws = newWorkspace()
      closePair(ws)
      const r = runTool(ws, 'record-refactor', PASSING)
      assert.equal(r.status, 1)
      assert.match(r.stderr, /TRIANGULATE/)
    })

    test('a failing triangulate does not mutate the cycle and can be retried', () => {
      const ws = newWorkspace()
      closePair(ws)
      const r = runTool(ws, 'record-triangulate', FAILING)
      assert.equal(r.status, 1)
      assert.equal(latestRecord(ws).triangulate, undefined)
      assert.equal(runTool(ws, 'record-triangulate', PASSING).status, 0)
      assert.ok(latestRecord(ws).triangulate !== undefined)
    })

    test('the full RED→GREEN→TRIANGULATE→REFACTOR sequence marks the cycle COMPLETE', () => {
      const ws = newWorkspace()
      closePair(ws)
      assert.equal(runTool(ws, 'record-triangulate', PASSING).status, 0)
      const r = runTool(ws, 'record-refactor', PASSING)
      assert.equal(r.status, 0)
      assert.match(r.stdout, /COMPLETE/)
      const rec = latestRecord(ws)
      assert.equal(rec.complete, true)
      assert.equal((rec.triangulate as { exitCode: number }).exitCode, 0)
      assert.equal((rec.refactor as { exitCode: number }).exitCode, 0)
    })
  })
})
