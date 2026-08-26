// Tests for bench/corpus.ts + scripts/dream-bench.ts.
//
// ⚠️ REGLA gentle-ai-bench: estos tests validan DECLARACIONES y la lógica de
// evaluación del runner. Un verde aquí NO prueba ejecución driven — esa es
// siempre `node scripts/dream-bench.ts` (ver .evidence/bench-latest.json).
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { journeys, type Journey } from '../bench/corpus.ts'
import { evaluateStep, formatList, main, parseArgs, runJourney, validateCorpus } from './dream-bench.ts'

describe('corpus declarations', () => {
  test('the real corpus is valid: unique j<N> ids, closed axes, runnable steps, declared why', () => {
    assert.deepEqual(validateCorpus(journeys), [])
  })

  test('validateCorpus catches duplicated ids, dead steps and unknown axes', () => {
    const bad: Journey[] = [
      {
        id: 'j1',
        title: 'a',
        why: 'w',
        axis: 'gates' as const,
        steps: [{ name: 's1', shell: 'true' }],
      },
      {
        id: 'j1', // duplicado
        title: 'b',
        why: 'w',
        axis: 'no-existe' as never, // eje fuera del vocabulario
        steps: [], // journey muerto
      },
      {
        id: 'malo', // formato
        title: 'c',
        why: '',
        axis: 'gates' as const,
        steps: [{ name: 's2', shell: '   ' }], // step sin comando
      },
    ]
    const errors = validateCorpus(bad)
    assert.ok(errors.some((e) => e.includes('duplicado')))
    assert.ok(errors.some((e) => e.includes('vocabulario cerrado')))
    assert.ok(errors.some((e) => e.includes('journey muerto')))
    assert.ok(errors.some((e) => e.includes('formato')))
    assert.ok(errors.some((e) => e.includes('comando ejecutable')))
    assert.ok(errors.some((e) => e.includes('why') || e.includes('POR QUÉ')))
  })
})

describe('cli surface (parseArgs / formatList)', () => {
  test('sin argumentos: corpus completo, sin list ni json', () => {
    const r = parseArgs([])
    assert.equal(r.ok, true)
    if (r.ok) {
      assert.equal(r.args.only, null)
      assert.equal(r.args.list, false)
      assert.equal(r.args.json, false)
    }
  })

  test('--only parsea ids y rechaza lista vacía con exit 4', () => {
    const ok = parseArgs(['--only', 'j1, j2 ,'])
    assert.equal(ok.ok, true)
    if (ok.ok) assert.deepEqual([...(ok.args.only ?? [])], ['j1', 'j2'])
    const bad = parseArgs(['--only', '  '])
    assert.equal(bad.ok, false)
    if (!bad.ok) assert.equal(bad.code, 4)
  })

  test('argumento desconocido → exit 4; flags nuevos se aceptan', () => {
    const unk = parseArgs(['--help'])
    assert.equal(unk.ok, false)
    if (!unk.ok) assert.equal(unk.code, 4)
    const flags = parseArgs(['--list', '--json'])
    assert.equal(flags.ok, true)
    if (flags.ok) {
      assert.equal(flags.args.list, true)
      assert.equal(flags.args.json, true)
    }
  })

  test('formatList cubre el corpus real: id, eje, título y conteo de steps', () => {
    const out = formatList(journeys)
    const lines = out.split('\n')
    assert.equal(lines.length, journeys.length)
    for (const j of journeys) {
      const line = lines.find((l) => l.startsWith(`${j.id}  `))
      assert.ok(line, `falta ${j.id} en el listado`)
      assert.match(line, new RegExp(`\\[${j.axis}\\]`))
      assert.match(line, /\(\d+ step\(s\)\)$/)
    }
  })
})

describe('--json payload (D1/D2 del review: contrato JSON bajo test)', () => {
  // Captura el stdout de main() sin tocar consola global más allá del test.
  const captureStdout = (fn: () => number): { out: string; code: number } => {
    const chunks: string[] = []
    const orig = console.log
    console.log = (...a: unknown[]) => chunks.push(a.map(String).join(' '))
    try {
      const code = fn()
      return { out: chunks.join('\n'), code }
    } finally {
      console.log = orig
    }
  }

  test('--only j1 --json emite UN objeto JSON válido y coherente', () => {
    const { out, code } = captureStdout(() => main(['--only', 'j1', '--json']))
    assert.equal(code, 0)
    const lines = out.trim().split('\n')
    assert.equal(lines.length, 1, 'stdout debe ser exactamente una línea JSON')
    const payload = JSON.parse(lines[0]!) as {
      kind: string
      drivenMode: boolean
      corpusSize: number
      totals: { completed: number; failed: number; skipped: number }
      journeys: Array<{ id: string; status: string }>
      runId: string
    }
    assert.equal(payload.kind, 'dream-bench')
    assert.equal(payload.drivenMode, true)
    assert.equal(payload.corpusSize, journeys.length)
    assert.equal(payload.journeys.length, 1)
    const first = payload.journeys[0]!
    assert.equal(first.id, 'j1')
    assert.equal(first.status, 'completed')
    assert.equal(
      payload.totals.completed + payload.totals.failed + payload.totals.skipped,
      payload.corpusSize,
    )
    assert.ok(payload.runId.length > 0)
  })

  test('fallo bajo --json: failed>0 en payload y exit 1 (sin provocar fallo real: journey sintético vía corpus no posible, se valida la aritmética con --only inexistente → exit 4)', () => {
    // La rama de fallo por journey roto ya está cubierta por runJourney
    // (test 'runJourney isolates failures'); aquí se fija el contrato CLI:
    // --only que no matchea NO emite JSON, devuelve exit 4.
    const { out, code } = captureStdout(() => main(['--only', 'no-existe', '--json']))
    assert.equal(code, 4)
    assert.equal(out.trim(), '')
  })
})

describe('runner evaluation logic', () => {
  const step = (over: Partial<Parameters<typeof evaluateStep>[0]>): Parameters<typeof evaluateStep>[0] => ({
    name: 's',
    shell: 'true',
    ...over,
  })

  test('default expectation is exit 0 with no output constraints', () => {
    assert.equal(evaluateStep(step({}), { status: 0, stdout: '', stderr: '' }).ok, true)
    assert.equal(evaluateStep(step({}), { status: 1, stdout: '', stderr: '' }).ok, false)
  })

  test('accepts any exit from the declared set and checks stdout/stderr regexes', () => {
    const s = step({ expectExit: [0, 1, 2, 3], expectStdout: /context:(ok|warning)/ })
    assert.equal(evaluateStep(s, { status: 3, stdout: 'context:ok', stderr: '' }).ok, true)
    const noMatch = evaluateStep(s, { status: 0, stdout: 'nada', stderr: '' })
    assert.equal(noMatch.ok, false)
    assert.match(noMatch.detail, /stdout/)
    const errStep = evaluateStep(step({ expectExit: 0, expectStderr: /GATE/ }), {
      status: 0,
      stdout: '',
      stderr: '✘ GATE VIOLADO',
    })
    assert.equal(errStep.ok, true)
  })

  test('timeout/signaled process (null status) fails without fabricating an exit code', () => {
    const r = evaluateStep(step({}), { status: null, stdout: '', stderr: '' })
    assert.equal(r.ok, false)
    assert.equal(r.exit, null)
  })

  test('runJourney isolates failures to the failing step and reports it', () => {
    const j: Journey = {
      id: 'j999',
      title: 'fake',
      why: 'unit fixture',
      axis: 'gates',
      steps: [
        { name: 'pasa', shell: 'true' },
        { name: 'falla', shell: 'exit 7', expectExit: 0 },
        { name: 'nunca corre', shell: 'true' },
      ],
    }
    const r = runJourney(j)
    assert.equal(r.status, 'failed')
    assert.equal(r.failedStep, 'falla')
    assert.match(r.detail ?? '', /exit 7/)
  })
})
