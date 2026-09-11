// Tests de la máscara de tools por rol (dream-tool-restrict).
//
// Defecto que estos tests cierran: el README afirma que "la separación
// implementa/verifica es estructural, no disciplinaria" e impone a `explorer`
// y `architect` límites duros de NO MUTACIÓN ("Sin shell ni escritura", "Sin
// mutación del repo"). Pero ambos montaban `@deepseek-ai/dsh-tool-fs`, que
// registra la suite completa `read`/`read_image`/`write`/`edit` en un solo
// paquete sin opción de config para desactivar la parte mutadora: el límite
// era una promesa del prompt, no una propiedad de la composición.
//
// Dos invariantes:
//  A) deriva: cada rol cuyo límite duro (tabla del README) niega la mutación
//     debe declarar una máscara `deny` que cubra write y edit, atada a su
//     propio presetId;
//  B) unidad: el plugin aplica la máscara al ctx del agente correcto, no a
//     otros presets, y no registra nada si no hay nada que negar.
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, test } from 'node:test'

const ROOT = join(import.meta.dirname, '..')
const README = join(ROOT, 'README.md')
const AGENTS = join(ROOT, 'agents')

/** Tools mutadoras que `dsh-tool-fs` registra y que un rol de solo lectura no debe alcanzar. */
const MUTATING = ['write', 'edit']

interface RoleRow {
  role: string
  limit: string
}

/**
 * Filas de la tabla de presets del README: | `rol` | responsabilidad | límite duro | [naturaleza] |.
 * El parseo se acota a la sección "## Agent presets": otras tablas del mismo
 * README también empiezan con una celda en backticks (p. ej. `workflow-router`)
 * y tomarlas por roles produciría fallos espurios. La tercera celda es el
 * límite duro; se toleran columnas extra para no acoplar el test al ancho de la
 * tabla.
 */
function readmeRoles(): RoleRow[] {
  const text = readFileSync(README, 'utf8')
  const section = /^## Agent presets\s*$([\s\S]*?)(?=^## )/m.exec(text)?.[1]
  assert.ok(section !== undefined, 'el README no tiene la sección "## Agent presets"')
  const rows: RoleRow[] = []
  for (const line of section.split('\n')) {
    if (!line.startsWith('|')) continue
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim())
    const role = /^`([a-z][a-z0-9-]*)`$/.exec(cells[0] ?? '')?.[1]
    if (role === undefined || cells.length < 3 || cells[2] === undefined) continue
    rows.push({ role, limit: cells[2] })
  }
  return rows
}

/** Un límite duro que niega mutar el repositorio exige máscara mecánica, no promesa. */
const claimsNonMutation = (limit: string): boolean =>
  /sin\s+shell\s+ni\s+escritura|sin\s+mutaci[oó]n|solo\s+lectura/i.test(limit)

function composition(role: string): string {
  const file = join(AGENTS, role, 'agent.cordis.yml')
  assert.ok(existsSync(file), `falta la composición de ${role}: ${file}`)
  return readFileSync(file, 'utf8')
}

/** Extrae la config de la fila de máscara declarada en una composición. */
function declaredMask(text: string): { presetId: string | undefined; deny: string[] } | undefined {
  const row = /- id:\s*tool-restrict[^\n]*\n(?:.*\n)*?\s*name:\s*'@dreamcoder\/dsh-tool-restrict'\n([\s\S]*?)(?=\n-\s|\n*$)/.exec(
    text,
  )
  if (row === null) return undefined
  const body = row[1] ?? ''
  const presetId = /presetId:\s*([a-z][a-z0-9-]*)/.exec(body)?.[1]
  const flow = /denyTools:\s*\[([^\]]*)\]/.exec(body)?.[1]
  const deny = (flow ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  return { presetId, deny }
}

describe('preset-restrictions (claim ↔ composición)', () => {
  test('todo rol de la tabla del README existe como preset', () => {
    const roles = readmeRoles().map((r) => r.role)
    assert.ok(roles.length >= 6, `esperaba los 6 roles del README, leí: ${roles.join(', ')}`)
    for (const role of roles) {
      assert.ok(existsSync(join(AGENTS, role, 'agent.cordis.yml')), `sin composición para '${role}'`)
    }
  })

  test('los roles con límite de no-mutación declaran máscara mecánica de write/edit', () => {
    const claimed = readmeRoles().filter((r) => claimsNonMutation(r.limit))
    // Si el README deja de prometer no-mutación, este test lo hace visible en
    // vez de quedar vacío en silencio.
    assert.ok(claimed.length > 0, 'el README no declara ningún límite de no-mutación')

    const missing: string[] = []
    for (const { role } of claimed) {
      const mask = declaredMask(composition(role))
      if (mask === undefined) {
        missing.push(`${role}: sin fila tool-restrict (monta tool-fs, que expone write/edit)`)
        continue
      }
      if (mask.presetId !== role) missing.push(`${role}: presetId '${mask.presetId}' no coincide con el rol`)
      for (const tool of MUTATING) {
        if (!mask.deny.includes(tool)) missing.push(`${role}: la máscara no niega '${tool}'`)
      }
    }
    assert.deepEqual(missing, [], `límites duros sin enforcement mecánico:\n - ${missing.join('\n - ')}`)
  })
})

describe('dream-tool-restrict (unidad)', () => {
  async function loadPlugin() {
    // Especificador no literal: tsgo no intenta resolver el .mjs del paquete.
    const href = new URL('../bundles/tool-restrict/index.mjs', import.meta.url).href
    return (await import(href)) as {
      name: string
      apply: (ctx: unknown, config: unknown) => void
    }
  }

  interface AgentCtx {
    tools: { restrict: (filter: unknown) => () => void }
  }

  /** ctx de agente mínimo: registra cada máscara aplicada en `applied`. */
  const agentCtx = (applied: unknown[]): AgentCtx => ({
    tools: {
      restrict: (filter: unknown) => {
        applied.push(filter)
        return () => {}
      },
    },
  })

  /** Monta el ctx del plugin y devuelve el emisor de `agent/created`. */
  function mount(plugin: { apply: (ctx: unknown, config: unknown) => void }, config: unknown) {
    const applied: unknown[] = []
    const listeners: Array<(payload: { agent: { ctx: unknown } }) => void> = []
    const presetOf = new Map<unknown, string | undefined>()
    const ctx = {
      agentPresets: { composedPreset: (c: unknown) => presetOf.get(c) },
      tools: { restrict: () => () => {} },
      on: (event: string, listener: (payload: { agent: { ctx: unknown } }) => void) => {
        assert.equal(event, 'agent/created')
        listeners.push(listener)
        return () => {}
      },
      logger: { error: () => {} },
    }
    plugin.apply(ctx, config)
    return {
      applied,
      bind: (preset: string | undefined) => {
        const c = agentCtx(applied)
        presetOf.set(c, preset)
        return c
      },
      emit: (c: unknown) => {
        for (const l of listeners) l({ agent: { ctx: c } })
      },
      listenerCount: () => listeners.length,
    }
  }

  test('aplica la máscara solo al preset declarado', async () => {
    const h = mount(await loadPlugin(), { presetId: 'explorer', denyTools: ['write', 'edit'] })
    const implementerCtx = h.bind('implementer')
    const explorerCtx = h.bind('explorer')

    h.emit(implementerCtx)
    assert.equal(h.applied.length, 0, 'la máscara no debe tocar otros presets')

    h.emit(explorerCtx)
    assert.deepEqual(h.applied, [{ deny: ['write', 'edit'] }])
  })

  test('un agente sin preset compuesto no recibe máscara', async () => {
    const h = mount(await loadPlugin(), { presetId: 'explorer', denyTools: ['write'] })
    h.emit(h.bind(undefined))
    assert.equal(h.applied.length, 0)
  })

  test('sin denyTools no registra listener alguno', async () => {
    const h = mount(await loadPlugin(), { presetId: 'explorer', denyTools: [] })
    assert.equal(h.listenerCount(), 0)
  })
})
