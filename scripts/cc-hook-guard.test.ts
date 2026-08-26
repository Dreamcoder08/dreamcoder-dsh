// Tests for scripts/cc-hook-guard.ts — CC-dialect PreToolUse decision shim.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { describe, test } from 'node:test'
import { join } from 'node:path'

const SCRIPT = join(import.meta.dirname, 'cc-hook-guard.ts')

const runGuard = (stdin: string) =>
  spawnSync(process.execPath, [SCRIPT], { input: stdin, encoding: 'utf8' })

describe('cc-hook-guard.ts', () => {
  test('blocks a P5 Bash command with exit 2 and actionable stderr', () => {
    const r = runGuard(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'rm -rf /tmp/x' } }))
    assert.equal(r.status, 2)
    assert.match(r.stderr, /COMANDO BLOQUEADO/)
    assert.match(r.stderr, /security-gate/)
  })

  test('allows an innocuous Bash command with exit 0', () => {
    const r = runGuard(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls -la' } }))
    assert.equal(r.status, 0)
    assert.equal(r.stderr, '')
  })

  test('passes through non-Bash tools without consulting the gate', () => {
    const r = runGuard(JSON.stringify({ tool_name: 'Write', tool_input: {} }))
    assert.equal(r.status, 0)
  })

  test('fails OPEN on malformed payloads — never blocks on noise', () => {
    assert.equal(runGuard('not json at all').status, 0)
    assert.equal(runGuard(JSON.stringify({ tool_name: 'Bash' })).status, 0) // sin command
  })

  test('blocks sensitive-path access routed through shell (§4, verificado contra el gate)', () => {
    const r = runGuard(
      JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'cat ~/.ssh/id_rsa' } }),
    )
    assert.equal(r.status, 2)
    assert.match(r.stderr, /BLOQUEADO/)
  })
})
