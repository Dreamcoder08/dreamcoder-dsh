// index.mjs — máscara de tools por rol, aplicada en el scope del AGENTE.
//
// Por qué existe: `@deepseek-ai/dsh-tool-fs` registra la suite completa
// `read`/`read_image`/`write`/`edit` en un solo paquete y su Config NO ofrece
// forma de desactivar la mitad mutadora (verificado en dsh 0.1.5-rc.2:
// `apply()` llama a applyReadTool/applyWriteTool/applyEditTool sin condición).
// Un rol que promete "solo lectura" pero monta ese paquete recibe write y edit
// en su catálogo: el límite queda como promesa del prompt, no como propiedad
// de la composición.
//
// Cómo lo cierra: `ctx.tools.restrict({ deny })` es la API sancionada de
// dsh-tools ("Restrict global tools for the calling agent scope ... the
// restriction lifts when disposed"). Se aplica sobre `agent.ctx`, no sobre el
// scope del preset: las tools que el preset registra son scope-LOCALES para su
// propio scope (y `restrict` las rechaza), pero son HEREDADAS —y por tanto
// enmascarables— desde el scope del agente que se une al preset por
// parentesco. Es el mismo orden que usa dsh-subagent para restringir a sus
// hijos (join primero, restricción del hijo después).
//
// Efecto lateral deseable: las tools ocultas dejan de pagar su schema en el
// prompt de ese agente (dsh-tools README: "Restrictions that hide tools remove
// their entire schema cost for that agent").
//
// Fail-loud por diseño: acá NO hay degradación silenciosa. Un fallo al aplicar
// la máscara se registra como error; el silencio convertiría el límite duro en
// una afirmación falsa, que es exactamente el defecto que este plugin cierra.
export const name = 'dream-tool-restrict'

// Dependencias duras: sin `tools` no hay máscara y sin `agentPresets` no puedo
// distinguir a qué preset pertenece el agente. La fila espera a que existan en
// vez de activarse a medias (un row que nunca activa lo reporta la validación
// de montaje del roster).
export const inject = ['tools', 'agentPresets']

export function apply(ctx, config) {
  const presetId = typeof config?.presetId === 'string' ? config.presetId : ''
  const deny = Array.isArray(config?.denyTools)
    ? config.denyTools.filter((t) => typeof t === 'string' && t.length > 0)
    : []
  // Sin preset declarado o sin nada que negar la fila no hace nada: el test
  // unitario fija ese contrato.
  if (presetId === '' || deny.length === 0) return

  // `ctx.on` pertenece al Fiber: Cordis retira el listener al descargar el
  // plugin, así que no queda efecto colgando entre recargas.
  ctx.on('agent/created', ({ agent }) => {
    try {
      // La guarda por preset es deliberada: si el filtrado por scope del evento
      // no bastara, sin ella la máscara de `explorer` caería sobre el
      // implementer y le quitaría la escritura. Preferimos una comprobación
      // redundante a un radio de impacto catastrófico.
      if (ctx.agentPresets.composedPreset(agent.ctx) !== presetId) return
      const tools = agent.ctx?.tools
      if (tools === undefined || typeof tools.restrict !== 'function') {
        ctx.logger?.error?.(
          `dream-tool-restrict: el agente del preset '${presetId}' no expone ctx.tools; ` +
            `la máscara ${JSON.stringify(deny)} NO se aplicó (límite duro sin enforcement)`,
        )
        return
      }
      tools.restrict({ deny })
    } catch (error) {
      ctx.logger?.error?.(
        `dream-tool-restrict: fallo al enmascarar ${JSON.stringify(deny)} en '${presetId}': ${String(error)}`,
      )
    }
  })
}

export default { name, inject, apply }
