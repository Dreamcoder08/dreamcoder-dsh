// Tests for bench/corpus.ts + scripts/dream-bench.ts.
//
// ⚠️ REGLA gentle-ai-bench: estos tests validan DECLARACIONES y la lógica de
// evaluación del runner. Un verde aquí NO prueba ejecución driven — esa es
// siempre `node scripts/dream-bench.ts` (ver .evidence/bench-latest.json).
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { journeys, type Journey } from '../bench/corpus.ts'
import { evaluateStep, formatList, parseArgs, runJourney, validateCorpus } from './dream-bench.ts'

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
