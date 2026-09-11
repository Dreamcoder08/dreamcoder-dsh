// `/dream-presets`: el comando in-session que MONTA los seis presets.
//
// Motivo: `verify-presets.ts` valida sintaxis, forma y resolución; el doctor
// comprueba que estén instalados. Ninguno monta, y por eso tres defectos que
// impedían montar los seis presets (persona sin `prefix`, `tool-todo` sin
// `allowParallelInProgress`, `plan-mode` sin `section`) convivieron con un "✔"
// en ambos gates. La verificación autoritativa es `standingKeyFor`, que solo
// existe dentro del host vivo.
//
// Acá se prueba la LÓGICA sobre el servicio (sin host). El cableado del comando
// —registro en el registry `commands`, resolución de `agentPresets` por
// `ctx.get`— usa el mismo patrón que `/dream-doctor` y `/dream-status`, que ya
// corren en el perfil instalado.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, test } from 'node:test'

const ROOT = join(import.meta.dirname, '..')

interface HostModule {
  PRESET_ROLES: string[]
  ROLE_DENY: Record<string, string[]>
  validatePresetMounts: (
    presets: { standingKeyFor: (id: string) => Promise<unknown> },
    ids?: string[],
  ) => Promise<{ ok: boolean; lines: string[] }>
  verifyRoleLimit: (
    schemas: { name: string }[],
    role: string | undefined,
  ) => { ok: boolean; role: string | undefined; deny: string[]; visible: string[]; leaked: string[] }
}

// Especificador no literal: tsgo no intenta tipar un .mjs del bundle.
const href = new URL('../bundles/engineering/host.mjs', import.meta.url).href
const host = (await import(href)) as unknown as HostModule

describe('/dream-presets (lógica de montaje)', () => {
  test('todos montan → ok y una línea ✔ por rol', async () => {
    const seen: string[] = []
    const presets = {
      standingKeyFor: async (id: string) => {
        seen.push(id)
        return { key: id }
      },
    }
    const { ok, lines } = await host.validatePresetMounts(presets)
    assert.equal(ok, true)
    assert.equal(lines.length, host.PRESET_ROLES.length)
    assert.deepEqual(seen, host.PRESET_ROLES, 'debe montar los seis roles, no un subconjunto')
    assert.ok(
      lines.every((l) => l.includes('✔')),
      `todas las líneas deben ser ✔: ${lines.join(' | ')}`,
    )
  })

  test('un preset que no monta → ok false con su motivo', async () => {
    const presets = {
      standingKeyFor: async (id: string) => {
        if (id === 'architect') {
          throw new Error('invalid config:\n  - $.prefix missing required value (at prefix)')
        }
        return { key: id }
      },
    }
    const { ok, lines } = await host.validatePresetMounts(presets)
    assert.equal(ok, false)
    const failing = lines.filter((l) => l.includes('✘'))
    assert.equal(failing.length, 1, `esperaba un solo fallo: ${lines.join(' | ')}`)
    // El motivo debe sobrevivir al recorte (primera línea del mensaje).
    assert.match(failing[0] ?? '', /prefix missing required value/)
  })

  test('conserva el orden y evalúa todos, sin cortar en el primero que falla', async () => {
    let calls = 0
    const presets = {
      standingKeyFor: async () => {
        calls += 1
        throw new Error('boom')
      },
    }
    const { ok, lines } = await host.validatePresetMounts(presets)
    assert.equal(ok, false)
    assert.equal(calls, host.PRESET_ROLES.length, 'un fallo no debe abortar la verificación del resto')
    assert.equal(lines.length, host.PRESET_ROLES.length)
  })

  test('PRESET_ROLES coincide con los roles de agents/ (guard de deriva)', () => {
    const onDisk = readdirSync(join(ROOT, 'agents'), { withFileTypes: true })
      .filter((e) => e.isDirectory() && existsSync(join(ROOT, 'agents', e.name, 'agent.cordis.yml')))
      .map((e) => e.name)
      .sort()
    assert.deepEqual(
      [...host.PRESET_ROLES].sort(),
      onDisk,
      'un rol nuevo en agents/ no quedaría cubierto por /dream-presets',
    )
  })
})

describe('/dream-presets (cableado del comando)', () => {
  interface Registration {
    name: string
    description: string
    handler: () => Promise<{ kind: string; text: string }>
  }

  /** Aplica el plugin contra un ctx simulado y devuelve el comando registrado. */
  async function commandWith(
    presets: { standingKeyFor: (id: string) => Promise<unknown> } | undefined,
  ): Promise<Registration> {
    const registered: Registration[] = []
    // `commands` va como PROPIEDAD: el plugin lo declara con `inject` y lee
    // `ctx.commands`. Simularlo solo vía `get` era justamente lo que ocultaba
    // que la fila real nunca registraba nada.
    const commands = {
      register: (def: Registration) => {
        registered.push(def)
        return () => {}
      },
    }
    const ctx = {
      commands,
      get: (key: string) => {
        if (key === 'commands') return commands
        if (key === 'agentPresets') return presets
        return undefined
      },
      effect: (fn: () => () => void) => {
        const dispose = fn()
        return typeof dispose === 'function' ? dispose : () => {}
      },
      logger: { warn: () => {}, error: () => {} },
    }
    const mod = (await import(href)) as unknown as { default: { apply: (c: unknown) => void } }
    mod.default.apply(ctx)
    const found = registered.find((r) => r.name === 'dream-presets')
    assert.ok(found !== undefined, `no se registró /dream-presets: ${registered.map((r) => r.name).join(', ')}`)
    return found
  }

  const allMount = { standingKeyFor: async () => ({ key: 'ok' }) }

  test('reporta éxito con una línea por rol cuando todos montan', async () => {
    const cmd = await commandWith(allMount)
    const result = await cmd.handler()
    assert.equal(result.kind, 'success')
    assert.match(result.text, /montan/)
    assert.equal(result.text.split('\n').length, host.PRESET_ROLES.length + 1, result.text)
  })

  test('reporta error con el motivo cuando uno no monta', async () => {
    const cmd = await commandWith({
      standingKeyFor: async (id: string) => {
        if (id === 'explorer') throw new Error('$.prefix missing required value')
        return { key: id }
      },
    })
    const result = await cmd.handler()
    assert.equal(result.kind, 'error')
    assert.match(result.text, /NO montan/)
    assert.match(result.text, /explorer:.*prefix/, result.text)
  })

  test('sin servicio agentPresets reporta error en vez de lanzar', async () => {
    const cmd = await commandWith(undefined)
    const result = await cmd.handler()
    assert.equal(result.kind, 'error')
    assert.match(result.text, /agent-presets no está compuesto/)
  })
})

describe('límite duro por rol (verifyRoleLimit)', () => {
  const names = (...n: string[]) => n.map((name) => ({ name }))

  test('sin las tools del límite → cumplido', () => {
    const v = host.verifyRoleLimit(names('read', 'read_image', 'glob', 'grep'), 'explorer')
    assert.equal(v.ok, true)
    assert.deepEqual(v.leaked, [])
    assert.deepEqual(v.deny, ['write', 'edit'])
  })

  test('con una tool del límite visible → fuga y la nombra', () => {
    const v = host.verifyRoleLimit(names('read', 'write', 'edit'), 'explorer')
    assert.equal(v.ok, false)
    assert.deepEqual(v.leaked, ['write', 'edit'])
  })

  test('un rol sin límite declarado nunca reporta fuga', () => {
    const v = host.verifyRoleLimit(names('read', 'write', 'edit'), 'implementer')
    assert.equal(v.ok, true)
    assert.deepEqual(v.deny, [])
  })

  test('un agente sin preset tampoco reporta fuga (no hay expectativa)', () => {
    const v = host.verifyRoleLimit(names('read', 'write'), undefined)
    assert.equal(v.ok, true)
    assert.equal(v.role, undefined)
  })

  test('ROLE_DENY coincide con los denyTools de las composiciones (guard de deriva)', () => {
    const declared: Record<string, string[]> = {}
    for (const role of host.PRESET_ROLES) {
      const text = readFileSync(join(ROOT, 'agents', role, 'agent.cordis.yml'), 'utf8')
      const row = /- id:\s*tool-restrict[^\n]*\n(?:.*\n)*?\s*denyTools:\s*\[([^\]]*)\]/.exec(text)
      if (row === null) continue
      declared[role] = (row[1] ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s !== '')
    }
    // Si una composición gana o pierde su máscara, esta tabla debe seguirla: sin
    // este cruce, `/dream-tools` juzgaría con una expectativa vieja.
    assert.deepEqual(
      Object.fromEntries(Object.entries(host.ROLE_DENY).map(([r, d]) => [r, [...d].sort()])),
      Object.fromEntries(Object.entries(declared).map(([r, d]) => [r, [...d].sort()])),
      'ROLE_DENY y las composiciones divergen',
    )
  })
})

describe('/dream-tools (catálogo efectivo del agente)', () => {
  interface ToolCmd {
    name: string
    handler: (inv: unknown) => Promise<{ kind: string; text: string }>
  }

  /** Aplica el plugin contra un ctx simulado y devuelve /dream-tools. */
  async function toolsCommand(opts: {
    role: string | undefined
    visible: string[]
  }): Promise<ToolCmd> {
    const registered: ToolCmd[] = []
    const commands = {
      register: (def: ToolCmd) => {
        registered.push(def)
        return () => {}
      },
    }
    const ctx = {
      commands,
      get: (key: string) => {
        if (key === 'commands') return commands
        if (key === 'tools') return { schemas: () => opts.visible.map((name) => ({ name })) }
        if (key === 'agentPresets') return { composedPreset: () => opts.role }
        return undefined
      },
      effect: (fn: () => () => void) => {
        const dispose = fn()
        return typeof dispose === 'function' ? dispose : () => {}
      },
      logger: { warn: () => {}, error: () => {} },
    }
    const mod = (await import(href)) as unknown as { default: { apply: (c: unknown) => void } }
    mod.default.apply(ctx)
    const found = registered.find((r) => r.name === 'dream-tools')
    assert.ok(found !== undefined, `no se registró /dream-tools: ${registered.map((r) => r.name).join(', ')}`)
    return found
  }

  const invocation = { agent: { ctx: {} } }

  test('rol con límite y sin fuga → éxito y lo declara', async () => {
    const cmd = await toolsCommand({ role: 'explorer', visible: ['read', 'read_image', 'grep'] })
    const r = await cmd.handler(invocation)
    assert.equal(r.kind, 'success')
    assert.match(r.text, /preset: explorer/)
    assert.match(r.text, /límite duro cumplido: write, edit NO están visibles/)
  })

  test('fuga real → error y nombra las tools visibles que no deberían estarlo', async () => {
    const cmd = await toolsCommand({ role: 'explorer', visible: ['read', 'write', 'edit'] })
    const r = await cmd.handler(invocation)
    assert.equal(r.kind, 'error')
    assert.match(r.text, /FUGA: write, edit siguen visibles/)
  })

  test('rol sin límite declarado → informa el catálogo sin juzgar', async () => {
    const cmd = await toolsCommand({ role: 'implementer', visible: ['read', 'write', 'bash'] })
    const r = await cmd.handler(invocation)
    assert.equal(r.kind, 'success')
    assert.match(r.text, /límite duro declarado: ninguno/)
  })

  test('un agente sin preset reporta error: su catálogo no es el de ningún rol', async () => {
    // Caso observado en runtime: un agente creado fuera del camino que hace el
    // join al preset queda con un catálogo que no es el de ningún rol. Decir
    // "límite duro declarado: ninguno" ahí se lee como verde y esconde el
    // montaje roto — es el falso positivo que esta comprobación evita.
    const cmd = await toolsCommand({ role: undefined, visible: ['read', 'write', 'edit'] })
    const r = await cmd.handler(invocation)
    assert.equal(r.kind, 'error')
    assert.match(r.text, /no se unió a un preset/)
    assert.match(r.text, /NO corresponde a ningún rol/)
    assert.doesNotMatch(r.text, /límite duro declarado: ninguno/)
  })

  test('una invocación sin agente no rompe: reporta error', async () => {
    const cmd = await toolsCommand({ role: 'explorer', visible: [] })
    const r = await cmd.handler({})
    assert.equal(r.kind, 'error')
    assert.match(r.text, /no pude resolver el agente/)
  })
})
