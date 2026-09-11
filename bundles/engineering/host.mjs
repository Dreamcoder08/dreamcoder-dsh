// host.mjs — plugin host del bundle @dreamcoder/dsh-engineering-bundle.
//
// Registra comandos humanos in-session (`/dream-doctor`, `/dream-status`,
// `/dream-presets`, `/dream-tools`) que ejecutan el tooling out-of-tree del repo
// y devuelven su salida como CommandResult. Así la observabilidad deja de
// requerir salir de la sesión.
//
// Contrato consumido (verificado contra dsh 0.1.1-rc.2 y docs/user/develop/
// basic/publish.md): la fila `- name: '@dreamcoder/dsh-engineering-bundle'`
// hace import() del paquete y unwrapExports toma exports.default ?? exports;
// el plugin válido es un objeto con .apply(ctx). Los comandos se registran
// contra el Service `commands` (@deepseek-ai/dsh-commands, compuesto por
// dsh-base) dentro de ctx.effect para que el ciclo de vida pertenezca al
// Fiber de Cordis.
//
// `inject: ['commands']` NO es decorativo: sin declararlo, `apply` corría antes
// de que el servicio estuviera provisto, la lectura devolvía `undefined` y el
// plugin se retiraba en silencio. Los cuatro comandos estuvieron muertos con la
// fila compuesta y documentada. La lección quedó como gate en
// `scripts/dream-commands.test.ts`.
//
// Un fallo al registrar se reporta como ERROR y jamás tumba la composición del
// perfil: el bundle no puede romper la sesión, pero tampoco puede fingir que
// una capacidad documentada existe.
import { spawnSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** Corre un script del repo y devuelve {ok, text} con salida recortada. */
function runScript(args, timeoutMs = 120000) {
  const r = spawnSync(args[0], args.slice(1), {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, NO_COLOR: '1' },
  })
  const tail = ((r.stdout ?? '') + '\n' + (r.stderr ?? '')).trim().slice(-6000)
  return { ok: r.status === 0, text: tail }
}

const DOCTOR = {
  name: 'dream-doctor',
  description: 'Salud de la instalación Dreamcoder (13 chequeos con exit code agregado).',
  async handler() {
    const r = runScript(['bash', join(REPO_ROOT, 'scripts', 'dream-doctor.sh')])
    return r.ok
      ? { kind: 'success', text: r.text }
      : { kind: 'error', text: r.text || 'dream-doctor falló sin salida' }
  },
}

const STATUS = {
  name: 'dream-status',
  description: 'Métricas del proceso de ingeniería del workspace actual.',
  async handler() {
    const r = runScript([process.execPath, join(REPO_ROOT, 'scripts', 'dream-metrics.ts')], 60000)
    return r.ok
      ? { kind: 'success', text: r.text }
      : { kind: 'error', text: r.text || 'dream-metrics falló sin salida' }
  },
}

/** Los seis roles que este repo publica como agent presets. */
export const PRESET_ROLES = ['explorer', 'architect', 'implementer', 'tester', 'reviewer', 'security']

/**
 * Monta cada preset con el MISMO camino que usa el arranque de una sesión
 * (`agentPresets.standingKeyFor`) y devuelve el veredicto por rol.
 *
 * Por qué existe: `verify-presets.ts` valida sintaxis, forma y resolución de
 * filas, y el doctor comprueba que el preset esté instalado — ninguno MONTA.
 * Así convivieron con un "✔" tres defectos que impedían montar los seis
 * presets (persona sin `prefix`, `tool-todo` sin `allowParallelInProgress`,
 * `plan-mode` sin `section`). La única forma de detectarlos es montar de
 * verdad, y eso solo puede hacerse dentro del host vivo: de ahí un comando
 * in-session en vez de un script.
 *
 * Es lógica pura sobre el servicio, para poder probarla sin host.
 *
 * @param presets - el servicio `agentPresets` del host.
 * @param ids - roles a validar; por defecto, los seis del repo.
 * @returns `{ ok, lines }`: veredicto global y una línea por rol.
 */
export async function validatePresetMounts(presets, ids = PRESET_ROLES) {
  const lines = []
  let ok = true
  for (const id of ids) {
    try {
      await presets.standingKeyFor(id)
      lines.push(`  ✔ ${id} monta`)
    } catch (error) {
      ok = false
      const detail = String(error?.message ?? error).split('\n').slice(0, 3).join(' ')
      lines.push(`  ✘ ${id}: ${detail}`)
    }
  }
  return { ok, lines }
}

/**
 * Límite duro declarado por rol: las tools que su composición debe enmascarar.
 * Es la expectativa contra la que se juzga el catálogo EFECTIVO del agente.
 * `scripts/preset-mount-command.test.ts` lo cruza contra los `denyTools` de
 * `agents/<rol>/agent.cordis.yml`, así que esta tabla no puede derivar sola.
 */
export const ROLE_DENY = {
  explorer: ['write', 'edit'],
  architect: ['write', 'edit'],
}

/**
 * Juzga el catálogo efectivo de un agente contra el límite duro de su rol.
 *
 * Por qué existe: la máscara de `tool-restrict` se aplica en `agent/created`,
 * así que ninguna comprobación estática —ni el montaje, que ocurre "sin el
 * agente"— puede ver su efecto. La única forma de saber si el límite se cumple
 * de verdad es leer las tools VISIBLES para un agente vivo, que es lo que
 * devuelve `tools.schemas(agent)` (el propio `Agent` es el `ScopeKey`; ver
 * `dsh-tool-subagent/lib/invariant.js`).
 *
 * Es lógica pura: recibe los schemas y decide.
 *
 * @param schemas - tools visibles para el agente (`ctx.tools.schemas(agent)`).
 * @param role - preset compuesto del agente, o `undefined` si no tiene.
 * @returns veredicto con lo visible, lo filtrado y lo que se esperaba filtrar.
 */
export function verifyRoleLimit(schemas, role) {
  const visible = schemas.map((s) => s.name).slice().sort()
  const deny = ROLE_DENY[role] ?? []
  const leaked = deny.filter((name) => visible.includes(name))
  return { ok: leaked.length === 0, role, deny, visible, leaked }
}

export const name = 'dream-commands'

/**
 * Dependencia dura: sin el registry de comandos esta fila no aporta nada, así
 * que Cordis debe esperarlo en vez de dejar que `apply` corra antes de tiempo.
 * Un servicio leído con `ctx.get` en el arranque devuelve `undefined` y el
 * plugin se retira sin ruido — que es exactamente cómo estos cuatro comandos
 * estuvieron muertos con la fila compuesta y documentada.
 */
export const inject = ['commands']

export function apply(ctx) {
  try {
    // `ctx.commands`, no `ctx.get('commands')`: con `inject` declarado, Cordis
    // no llama a `apply` hasta que el servicio existe.
    const commands = ctx.commands
    if (commands === undefined) {
      // Con `inject` esto es inalcanzable; si pasara, tiene que doler.
      ctx.logger?.error?.(
        'dream-commands: el servicio `commands` no está disponible; los comandos in-session NO se registraron',
      )
      return
    }

    // `/dream-presets`: la verificación que ningún gate estático puede hacer.
    // Se define acá dentro porque necesita resolver `agentPresets` en el ctx
    // del montaje en el momento de la invocación, no al cargar el módulo.
    const PRESETS = {
      name: 'dream-presets',
      description:
        'Monta los seis agent presets con el mismo camino que el arranque de sesión y reporta cuál no monta.',
      async handler() {
        const presets = ctx.get('agentPresets')
        if (presets === undefined) {
          return { kind: 'error', text: 'agent-presets no está compuesto en este perfil' }
        }
        try {
          const { ok, lines } = await validatePresetMounts(presets)
          const head = ok
            ? `✔ los ${PRESET_ROLES.length} presets montan (verificación de montaje real)`
            : '✘ hay presets que NO montan — revisá la composición antes de usarlos'
          return { kind: ok ? 'success' : 'error', text: `${head}\n${lines.join('\n')}` }
        } catch (error) {
          return { kind: 'error', text: `dream-presets falló: ${String(error?.message ?? error)}` }
        }
      },
    }

    // `/dream-tools`: cierra la única afirmación que ningún gate podía cerrar.
    // La máscara de rol se aplica en `agent/created`, o sea DESPUÉS del único
    // montaje que se puede validar desde fuera; su efecto solo se observa
    // leyendo el catálogo de un agente vivo desde dentro de su sesión.
    const TOOLS = {
      name: 'dream-tools',
      description:
        'Lista el catálogo efectivo de tools de ESTE agente y verifica el límite duro de su rol (p. ej. explorer sin write/edit).',
      async handler(invocation) {
        const agent = invocation?.agent
        const tools = ctx.get('tools')
        if (agent === undefined || tools === undefined) {
          return {
            kind: 'error',
            text: 'no pude resolver el agente o el registry de tools en esta invocación',
          }
        }
        try {
          const presets = ctx.get('agentPresets')
          const role = presets?.composedPreset?.(agent.ctx)
          // El propio `Agent` es el ScopeKey: `schemas(agent)` es la vista que
          // el modelo recibe, no la global.
          const schemas = tools.schemas(agent)
          const { ok, deny, visible, leaked } = verifyRoleLimit(schemas, role)
          // Un agente que NO se unió a un preset no tiene catálogo de rol: su
          // lista no dice nada sobre ningún rol. Reportarlo como "ninguno para
          // este rol" se lee como verde y esconde un montaje roto — el falso
          // positivo que esta comprobación existe para evitar (observado en un
          // agente creado fuera del camino que hace el join al preset).
          if (role === undefined) {
            return {
              kind: 'error',
              text: [
                'preset: (ninguno — este agente no se unió a un preset)',
                `tools visibles: ${visible.length}`,
                'El catálogo NO corresponde a ningún rol: no hay límite duro que verificar.',
                'Un agente de rol se une al preset al crearse; si esto persiste, el montaje está roto.',
                visible.join(', '),
              ].join('\n'),
            }
          }
          const head = [`preset: ${role}`, `tools visibles: ${visible.length}`]
          if (deny.length === 0) {
            head.push('límite duro declarado: ninguno para este rol')
            return { kind: 'success', text: `${head.join('\n')}\n${visible.join(', ')}` }
          }
          head.push(
            ok
              ? `✔ límite duro cumplido: ${deny.join(', ')} NO están visibles`
              : `✘ FUGA: ${leaked.join(', ')} siguen visibles pese al límite del rol`,
          )
          return { kind: ok ? 'success' : 'error', text: `${head.join('\n')}\n${visible.join(', ')}` }
        } catch (error) {
          return { kind: 'error', text: `dream-tools falló: ${String(error?.message ?? error)}` }
        }
      },
    }

    const install = () => {
      const disposers = [
        commands.register(DOCTOR),
        commands.register(STATUS),
        commands.register(PRESETS),
        commands.register(TOOLS),
      ]
      return () => disposers.forEach((d) => d())
    }
    // El ciclo de vida pertenece al Fiber: si ctx.effect existe, Cordis
    // desregistra los comandos al detener/descargar el plugin.
    if (typeof ctx.effect === 'function') ctx.effect(install, 'dream-commands')
    else install()
  } catch (error) {
    // El bundle no tumba la sesión, pero un fallo al registrar comandos es una
    // capacidad documentada que no existe: se reporta como error, no como aviso.
    try {
      ctx.logger?.error?.(`dream-commands: registro de comandos falló: ${String(error)}`)
    } catch {
      /* sin logger disponible: nada más que hacer */
    }
  }
}

export default { name, inject, apply }
