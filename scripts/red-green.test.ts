// Characterization tests for scripts/red-green.ts — the RED→GREEN TDD evidence
// recorder. Each test runs the real CLI in an isolated temp workspace so the
// `.evidence/` state never leaks between cases.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { describe, test } from 'node:test'
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SCRIPT = join(import.meta.dirname, 'red-green.ts')
const RUNNER = process.execPath

const PASSING = [RUNNER, '-e', 'process.exit(0)']
const FAILING = [RUNNER, '-e', 'process.exit(3)']

const newWorkspace = (): string => mkdtempSync(join(tmpdir(), 'dsh-redgreen-'))

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
  })
})
