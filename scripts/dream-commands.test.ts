// dream-commands.test.ts — verifica el plugin host del bundle
// (bundles/engineering/host.mjs) contra un registry simulado: los comandos
// se registran, sus handlers devuelven el shape CommandResult correcto y un
// ctx sin registry degrada en silencio.
import assert from 'node:assert/strict'
import { before, describe, test } from 'node:test'
import { join } from 'node:path'

const PLUGIN = join(import.meta.dirname, '..', 'bundles', 'engineering', 'host.mjs')

/** Carga el plugin con un ctx simulado y captura los registros. */
async function loadWith(ctxOverrides = {}): Promise<{
  registered: { name: string; description: string; handler: () => unknown }[]
  effects: string[]
  ctx: Record<string, unknown>
}> {
  const registered: { name: string; description: string; handler: () => unknown }[] = []
  const effects: string[] = []
  const ctx: Record<string, unknown> = {
    get: (key: string) => {
      if (key === 'commands') {
        return {
          register: (def: { name: string; description: string; handler: () => unknown }) => {
            registered.push(def)
            return () => {}
          },
        }
      }
      return undefined
    },
    effect: (fn: () => () => void, label: string) => {
      effects.push(label)
      const dispose = fn()
      return typeof dispose === 'function' ? dispose : () => {}
    },
    logger: { warn: () => {} },
    ...ctxOverrides,
  }
  const mod = await import(PLUGIN)
  mod.default.apply(ctx)
  return { registered, effects, ctx }
}

describe('bundle host.mjs (dream-commands)', () => {
  let plugin: { name: string; apply: (ctx: unknown) => void; default: { apply: (ctx: unknown) => void } }
  before(async () => {
    plugin = (await import(PLUGIN)) as {
      name: string
      apply: (ctx: unknown) => void
      default: { apply: (ctx: unknown) => void }
    }
  })

  test('expone plugin Cordis válido: exports nombrados y default con apply', () => {
    assert.equal(typeof plugin.apply, 'function')
    assert.match(String(plugin.name), /dream/)
    assert.equal(typeof plugin.default?.apply, 'function')
  })

  test('registra /dream-doctor y /dream-status dentro de ctx.effect', async () => {
    const { registered, effects } = await loadWith()
    const names = registered.map((d) => d.name).sort()
    assert.deepEqual(names, ['dream-doctor', 'dream-status'])
    for (const def of registered) {
      assert.equal(typeof def.description, 'string')
      assert.ok(def.description.length > 0)
      assert.ok(/^[a-z][a-z0-9_-]*$/.test(def.name), 'nombre cumple regex del registry')
      assert.equal(typeof def.handler, 'function')
    }
    // El ciclo de vida quedó ligado al Fiber.
    assert.deepEqual(effects, ['dream-commands'])
  })

  test('ctx sin registry no lanza (degradación silenciosa)', async () => {
    const warned: string[] = []
    const mod = await import(PLUGIN)
    mod.default.apply({
      get: () => undefined,
      logger: { warn: (m: string) => warned.push(m) },
    })
    assert.deepEqual(warned, [])
  })

  test('/dream-status handler devuelve kind success con texto de métricas', { timeout: 120000 }, async () => {
    const { registered } = await loadWith()
    const status = registered.find((d) => d.name === 'dream-status')
    assert.ok(status !== undefined)
    const result = (await status.handler()) as { kind: string; text?: string }
    assert.equal(result.kind, 'success')
    assert.match(result.text ?? '', /Dreamcoder Engineering Metrics/)
  })
})
