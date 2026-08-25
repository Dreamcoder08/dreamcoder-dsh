---
name: model-router
description: "Trigger: modelo, routing, provider, effort, coste, capacidad, qué modelo. Elige proveedor/modelo/esfuerzo por rol y fase del pipeline según riesgo y coste; registra la elección."
license: Apache-2.0
metadata:
  author: dreamcoder
  version: "1.0"
---

## Activation Contract

Load al delegar (spawn/fork de subagentes) o al iniciar una fase cuyo perfil de cómputo difiera de la sesión actual. El routing es una decisión explícita del orquestador, no un default silencioso.

## Principio

**rol → riesgo → modelo → esfuerzo → permisos → contexto.** El modelo más capaz no es el mejor default: se reserva para donde la calidad de razonamiento decide el resultado.

## Tabla de Routing por Rol/Fase

| Rol / Fase | Perfil | Criterio de elección |
|---|---|---|
| explorer / retrieve context | rápido y barato | volumen de lectura, poco razonamiento; errores se corrigen barato |
| researcher / docs web | rápido y barato | síntesis con citas; verificación humana posterior |
| architect / spec & design | más capaz disponible + effort alto | las decisiones aquí se pagan en todo lo downstream |
| implementer P1 | estándar | cambio acotado con test que vigila |
| implementer P2–P3 | capaz + effort alto | cruza módulos o cambia contratos |
| tester / verify | estándar | ejecución y reporte literal; el juicio ya ocurrió |
| reviewer / security | contexto fresco, modelo DISTINTO al del implementer cuando exista alternativa | independencia de criterio: mismo modelo = mismos sesgos |
| orchestrator | capaz + effort medio-alto | decide, sintetiza y responde por el resultado |

## Reglas Duras

1. La independencia del revisor prima sobre el coste: si solo hay un modelo disponible, decláralo como limitación en el reporte.
2. El routing NO cambia permisos ni superficie: un subagente barato no recibe más tools para compensar.
3. Declara la elección en cada delegación: `routing: <rol> → <provider/model> (effort <n>)` — sin esa línea, el default de sesión es la decisión y debe decirse.
4. Cambiar de modelo a mitad de una misión exige re-verificación de lo ya producido bajo el modelo anterior.

## Mecánica en DSH

- El modelo de sesión lo fija `agent-default-model` en `~/.dsh/settings.yaml` (plane).
- Cada preset de rol (`agents/<rol>/`) puede operar sobre cualquier ruta de modelo; la elección se hace al crear la sesión o al delegar, nunca dentro del turno.
- Providers alternativos de subagente (codex, claude-code) requieren sus bundles instalados; si no están, usa spawn/fork y decláralo.

## Tabla de Routing por Transporte

El transporte es parte del routing: se elige junto al modelo, con la misma regla de decisión explícita. `bash scripts/dream-doctor.sh` (sección 8) lista qué proveedores están realmente instalados — esa lista, no el deseo, decide.

| Transporte | Cuándo | Ejemplos |
|---|---|---|
| `subagent` one-shot (spawn in-process) | tareas cortas y paralelas cuyo resultado cabe en un turno | exploraciones simultáneas de 2–3 módulos, checks puntuales |
| `subagent_fork` continuable (fork in-process) | hijos que heredan contexto completado y siguen vivos entre turnos | tester/reviewer de una misión larga, iteración sobre el mismo diff |
| provider externo (`codex`, `claude-code`) | SOLO si doctor los lista instalados y su versión es compatible con el core pineado | implementación delegada en otro motor, segunda opinión cross-engine |

Reglas de transporte:

1. Contexto fresco para review NO significa otro harness: significa un hijo sin las conclusiones del implementador. Un fork recién creado cumple; un spawn también.
2. El proveedor externo es una dependencia versionada: instalarlo contra un core incompatible rompe la composición del perfil completa. Si el doctor reporta el paquete ausente o el par desalineado, la decisión correcta es spawn/fork + limitación declarada.
3. Cada preset de rol (`agents/`) ya acota su superficie (sin escritura para explorer/reviewer/security, etc.). El transporte elegido no amplía esa superficie: un hijo externo recibe prompt autocontenido y devuelve texto, igual que uno interno.

## Output Contract

En cada delegación o inicio de fase, una línea: `Routing: <fase/rol> → <modelo> (effort <nivel>, motivo breve)`.
