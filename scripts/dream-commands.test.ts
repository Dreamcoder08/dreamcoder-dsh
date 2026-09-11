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
  // El plugin lee `ctx.commands` (dependencia declarada con `inject`), no
  // `ctx.get('commands')`: el registry va como propiedad.
  const registry = {
    register: (def: { name: string; description: string; handler: () => unknown }) => {
      registered.push(def)
      return () => {}
    },
  }
  const ctx: Record<string, unknown> = {
    commands: registry,
    get: (key: string) => (key === 'commands' ? registry : undefined),
    effect: (fn: () => () => void, label: string) => {
      effects.push(label)
      const dispose = fn()
      return typeof dispose === 'function' ? dispose : () => {}
    },
    logger: { warn: () => {}, error: () => {} },
    ...ctxOverrides,
  }
  const mod = await import(PLUGIN)
  mod.default.apply(ctx)
  return { registered, effects, ctx }
}

describe('bundle host.mjs (dream-commands)', () => {
  let plugin: {
    name: string
    apply: (ctx: unknown) => void
    inject?: string[]
    default: { apply: (ctx: unknown) => void; inject?: string[] }
  }
  before(async () => {
    plugin = (await import(PLUGIN)) as {
      name: string
      apply: (ctx: unknown) => void
      inject?: string[]
      default: { apply: (ctx: unknown) => void; inject?: string[] }
    }
  })

  test('expone plugin Cordis válido: exports nombrados y default con apply', () => {
    assert.equal(typeof plugin.apply, 'function')
    assert.match(String(plugin.name), /dream/)
    assert.equal(typeof plugin.default?.apply, 'function')
  })

  test('registra la superficie de comandos in-session dentro de ctx.effect', async () => {
    const { registered, effects } = await loadWith()
    const names = registered.map((d) => d.name).sort()
    // Contrato de la superficie del bundle: exactamente estos cuatro comandos.
    // `/dream-presets` monta los seis agent presets y `/dream-tools` verifica el
    // catálogo efectivo del agente actual — las dos comprobaciones que ningún
    // gate estático puede hacer. Sumar o quitar uno es un cambio deliberado.
    assert.deepEqual(names, ['dream-doctor', 'dream-presets', 'dream-status', 'dream-tools'])
    for (const def of registered) {
      assert.equal(typeof def.description, 'string')
      assert.ok(def.description.length > 0)
      assert.ok(/^[a-z][a-z0-9_-]*$/.test(def.name), 'nombre cumple regex del registry')
      assert.equal(typeof def.handler, 'function')
    }
    // El ciclo de vida quedó ligado al Fiber.
    assert.deepEqual(effects, ['dream-commands'])
  })

  test('declara `inject: [commands]` — el gate del defecto que dejó los comandos muertos', () => {
    // Este es el assert que faltaba. `apply` leía `ctx.get('commands')` y salía
    // en silencio cuando el servicio todavía no estaba provisto: los cuatro
    // comandos nunca existieron, con la fila compuesta y el registry simulado de
    // este mismo archivo diciendo que todo estaba bien. Los paquetes que sí
    // registran (`@deepseek-ai/dsh-command-goal`) declaran `inject`.
    assert.ok(Array.isArray(plugin.inject), 'el plugin debe declarar `inject`')
    assert.ok(
      plugin.inject.includes('commands'),
      `inject debe incluir 'commands' (leído: ${JSON.stringify(plugin.inject)})`,
    )
    // El loader toma `exports.default ?? exports`, así que la dependencia tiene
    // que estar también en el default o no llega al registro.
    assert.deepEqual(plugin.default.inject, plugin.inject)
  })

  test('sin el servicio registra un ERROR explícito, no un silencio', async () => {
    const errors: string[] = []
    const mod = await import(PLUGIN)
    // Escenario inalcanzable bajo `inject`; si ocurriera, no puede pasar como
    // "no hay nada que hacer": una capacidad documentada sin registrar es un
    // error, no una degradación.
    mod.default.apply({
      commands: undefined,
      get: () => undefined,
      logger: { error: (m: string) => errors.push(m), warn: () => {} },
    })
    assert.equal(errors.length, 1, `esperaba un error reportado, recibí: ${JSON.stringify(errors)}`)
    assert.match(errors[0] ?? '', /NO se registraron/)
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
