// host.mjs — plugin host del bundle @dreamcoder/dsh-engineering-bundle.
//
// Registra comandos humanos in-session (`/dream-doctor`, `/dream-status`)
// que ejecutan el tooling out-of-tree del repo y devuelven su salida como
// CommandResult. Así la observabilidad deja de requerir salir de la sesión.
//
// Contrato consumido (verificado contra dsh 0.1.1-rc.2 y docs/user/develop/
// basic/publish.md): la fila `- name: '@dreamcoder/dsh-engineering-bundle'`
// hace import() del paquete y unwrapExports toma exports.default ?? exports;
// el plugin válido es un objeto con .apply(ctx). Los comandos se registran
// contra el Service `commands` (@deepseek-ai/dsh-commands, compuesto por
// dsh-base) dentro de ctx.effect para que el ciclo de vida pertenezca al
// Fiber de Cordis.
//
// Defensivo por diseño: cualquier fallo propio se degrada (sin registry no
// hay registro; sin logger, silencio); jamás rompe la composición del perfil.
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
  description: 'Salud de la instalación Dreamcoder (12 chequeos con exit code agregado).',
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

export const name = 'dream-commands'

export function apply(ctx) {
  try {
    const commands = ctx.get('commands')
    // Sin el registry no hay nada que hacer: degradación silenciosa.
    if (commands === undefined) return
    const install = () => {
      const disposers = [commands.register(DOCTOR), commands.register(STATUS)]
      return () => disposers.forEach((d) => d())
    }
    // El ciclo de vida pertenece al Fiber: si ctx.effect existe, Cordis
    // desregistra los comandos al detener/descargar el plugin.
    if (typeof ctx.effect === 'function') ctx.effect(install, 'dream-commands')
    else install()
  } catch (error) {
    // Última línea de defensa: el bundle nunca tumba la sesión por sí mismo.
    try {
      ctx.logger?.warn?.(`dream-commands: registro de comandos falló: ${String(error)}`)
    } catch {
      /* sin logger disponible: silencio defensivo */
    }
  }
}

export default { name, apply }
