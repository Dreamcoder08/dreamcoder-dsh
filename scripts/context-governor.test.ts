// Characterization tests for scripts/context-governor.ts — the context
// pressure gate. Each case runs the real CLI against fixture session logs
// (plain session.jsonl — no zstd needed) in an isolated temp dir.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { after, describe, test } from 'node:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
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

const tempDirs: string[] = []
const newRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-governor-'))
  tempDirs.push(root)
  return root
}
// Higiene: ninguna fixture sobrevive a la suite (el TMPDIR queda limpio).
// Los .out que el propio CLI del governor graba en TMPDIR al registrar eventos
// también se retiran — SOLO los creados por esta corrida (snapshot previo),
// jamás los de una sesión DSH viva que comparta el TMPDIR.
const GOV_OUT = /^dsh-governor-\d+-\d+\.out$/
const preExistingOuts = new Set(readdirSync(tmpdir()).filter((f) => GOV_OUT.test(f)))
after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
  for (const f of readdirSync(tmpdir())) {
    if (GOV_OUT.test(f) && !preExistingOuts.has(f)) rmSync(join(tmpdir(), f), { force: true })
  }
})

/** El camino feliz zstd requiere el binario; si falta, el test se salta. */
const HAS_ZSTD = spawnSync('zstd', ['--version'], { encoding: 'utf8' }).status === 0

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
    const evt = JSON.parse(events[0]!) as { event: string; tokens: number; sessionId: string }
    assert.equal(evt.event, 'context:ok')
    assert.equal(evt.tokens, 2000) // max over steps, not the last nor the sum
    // El evento persiste un id hasheado (12 hex), nunca el nombre local crudo.
    assert.equal(evt.sessionId.length, 12)
    assert.doesNotMatch(evt.sessionId, /session|aaa/)
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
    // Uso inválido de CLI: exit 4 exclusivo, jamás un veredicto (0/1/2).
    assert.equal(badOrder.status, 4)
    assert.match(badOrder.stderr, /mayor que el umbral de warning/)
  })

  test('--critical alone below the default warning is a hard error too (no silent clamp)', () => {
    const root = newRoot()
    newSession(root, 'session-clamp', [500])
    const r = run(['--sessions-dir', root, '--window', '1000', '--critical', '0.4'])
    assert.equal(r.status, 4)
    assert.match(r.stderr, /warning efectivo/)
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

  // ── Caracterización de los caminos de fallo corregidos tras la review 4R ──

  test('a dangling --sessions-dir value is usage error 4, never a green verdict', () => {
    const root = newRoot()
    newSession(root, 'session-real', [120000]) // would be critical if measured
    // El flag sin valor NO debe caer al default ni medir nada: exit 4.
    const r = run(['--sessions-dir'])
    assert.equal(r.status, 4)
    assert.match(r.stderr, /requiere un valor/)
  })

  test('--session rejects path traversal characters (exit 4)', () => {
    const root = newRoot()
    newSession(root, 'session-target', [1000])
    const r = run([
      '--sessions-dir', root, '--evidence-dir', root,
      '--session', '../other/session-x',
    ])
    assert.equal(r.status, 4)
    assert.match(r.stderr, /A-Za-z0-9/)
  })

  test('--window rejects non-integer values (exit 4)', () => {
    const root = newRoot()
    newSession(root, 'session-win', [500])
    const r = run(['--sessions-dir', root, '--evidence-dir', root, '--window', '1.5'])
    assert.equal(r.status, 4)
    assert.match(r.stderr, /entero positivo/)
  })

  test('corrupt .zstd log is infra error 5 with a named cause — never exit 3 "sin datos"', () => {
    const root = newRoot()
    const dir = join(root, 'session-corrupt')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'session.jsonl.zstd'), Buffer.from('esto no es zstd'))
    const r = run(['--sessions-dir', root, '--evidence-dir', root])
    assert.equal(r.status, 5)
    assert.match(r.stderr, /ilegible/)
  })

  test('a directory without any session log is not a session candidate', () => {
    const root = newRoot()
    // Dir con log real + dir más reciente SIN log: el gate debe medir el que tiene.
    newSession(root, 'session-with-log', [110000])
    mkdirSync(join(root, 'not-a-session'), { recursive: true })
    writeFileSync(join(root, 'not-a-session', 'random.txt'), 'x')
    const r = run(['--sessions-dir', root, '--evidence-dir', root])
    assert.equal(r.status, 1) // midió session-with-log (warning), no cayó en exit 3
    assert.match(r.stdout, /session-with-log/)
  })

  test('happy path: a compressed .zstd log is measured through the streaming path', { skip: !HAS_ZSTD }, () => {
    const root = newRoot()
    const name = newSession(root, 'session-zstd', [64000]) // ratio 0.5 → ok
    // Comprimir el log plano como hace DSH (.zstd, extensión no estándar de
    // zstd — hay que pasarla explícita) y retirar el plano: solo queda .zstd.
    const plain = join(root, name, 'session.jsonl')
    const c = spawnSync('zstd', ['-f', '-o', join(root, name, 'session.jsonl.zstd'), plain], {
      encoding: 'utf8',
    })
    assert.equal(c.status, 0, c.stderr)
    unlinkSync(plain)
    assert.ok(existsSync(join(root, name, 'session.jsonl.zstd')))
    const r = run(['--sessions-dir', root, '--evidence-dir', root, '--json'])
    assert.equal(r.status, 0, r.stderr)
    const evt = JSON.parse(r.stdout) as { event: string; tokens: number }
    assert.equal(evt.event, 'context:ok')
    assert.equal(evt.tokens, 64000)
  })
})
