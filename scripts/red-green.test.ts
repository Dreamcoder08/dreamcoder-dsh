// Characterization tests for scripts/red-green.ts — the RED→GREEN TDD evidence
// recorder. Each test runs the real CLI in an isolated temp workspace so the
// `.evidence/` state never leaks between cases.
import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SCRIPT = join(import.meta.dir, 'red-green.ts')
/** `process.execPath` under bun test is the bun binary; it runs TS natively. */
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
    expect(r.status).toBe(2)
  })

  test('record-red rejects a passing command — a test that passes proves nothing new', () => {
    const ws = newWorkspace()
    const r = runTool(ws, 'record-red', PASSING)
    expect(r.status).toBe(1)
    expect(existsSync(join(ws, '.evidence', 'red-green.pending.json'))).toBe(false)
  })

  test('record-red accepts a failing command and writes the pending cycle', () => {
    const ws = newWorkspace()
    const r = runTool(ws, 'record-red', FAILING)
    expect(r.status).toBe(0)
    const pending = JSON.parse(readFileSync(join(ws, '.evidence', 'red-green.pending.json'), 'utf8'))
    expect(pending.red.exitCode).toBe(3)
    expect(pending.red.command).toContain('-e')
    expect(typeof pending.recordedAt).toBe('string')
  })

  test('a second record-red while a cycle is open is rejected', () => {
    const ws = newWorkspace()
    runTool(ws, 'record-red', FAILING)
    const r = runTool(ws, 'record-red', FAILING)
    expect(r.status).toBe(1)
  })

  test('record-green without a pending RED is rejected', () => {
    const ws = newWorkspace()
    const r = runTool(ws, 'record-green', PASSING)
    expect(r.status).toBe(1)
  })

  test('GREEN failure keeps the cycle open and pending intact', () => {
    const ws = newWorkspace()
    runTool(ws, 'record-red', FAILING)
    const r = runTool(ws, 'record-green', FAILING)
    expect(r.status).toBe(1)
    expect(existsSync(join(ws, '.evidence', 'red-green.pending.json'))).toBe(true)
  })

  test('a full failing-RED then passing-GREEN cycle records VALID evidence', () => {
    const ws = newWorkspace()
    expect(runTool(ws, 'record-red', FAILING).status).toBe(0)
    const r = runTool(ws, 'record-green', PASSING)
    expect(r.status).toBe(0)
    // Pending is consumed and exactly one definitive record remains.
    expect(existsSync(join(ws, '.evidence', 'red-green.pending.json'))).toBe(false)
    const records = readdirSync(join(ws, '.evidence')).filter((f) => f.startsWith('red-green-'))
    expect(records.length).toBe(1)
    const record = JSON.parse(readFileSync(join(ws, '.evidence', records[0] as string), 'utf8'))
    expect(record.cycle).toBe('VALID')
    expect(record.red.exitCode).not.toBe(0)
    expect(record.green.exitCode).toBe(0)
  })
})
