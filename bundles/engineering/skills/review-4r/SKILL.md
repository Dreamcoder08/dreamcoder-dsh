---
name: review-4r
description: "Trigger: revisión de código, code review, dual review, cuatro lentes. Revisa cambios con las lentes Readability/Reliability/Resilience/Risk y protocolo de tres revisores para cambios grandes."
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0"
---

## Activation Contract

Load cuando se pide revisar código, code review, dual review o aplicar las cuatro lentes 4R. La revisión produce hallazgos con evidencia; nunca aprueba por cortesía ni por jerarquía.

## Las Cuatro Lentes

**Readability** — ¿se entiende?
- ¿Un lector nuevo sigue el diff sin contexto oculto?
- ¿Los nombres dicen lo que hacen? ¿Hay magia: números sueltos, efectos ocultos, flujo no obvio?
- ¿Respeta las convenciones y estructura del repo?

**Reliability** — ¿funciona siempre?
- ¿Qué entrada lo rompe: vacía, nula, límite superior, mal tipada, maliciosa?
- ¿Los errores se manejan o se tragan silenciosamente? ¿Los caminos de fallo tienen test?
- ¿Tipos y contratos reflejan la realidad del dato en runtime?

**Resilience** — ¿sobrevive a producción?
- ¿Qué pasa bajo carga, latencia alta, reintentos, concurrencia o dependencia caída?
- ¿Falla con gracia (timeout, retry acotado, degradación) o provoca cascada?
- ¿El fallo sería observable y reversible en producción?

**Risk** — ¿cuánto cuesta si sale mal?
- ¿Superficie de seguridad: autorización, inyección, secretos expuestos, dependencias dudosas?
- ¿Impacto en datos, dinero o usuarios ante fallo? ¿Cómo se revierte?
- ¿El blast radius coincide con la intención declarada del cambio?

## Protocolo para Cambios Grandes

Para diffs >~300 líneas o que cruzan módulos:

1. Congela el diff objetivo (commit/SHA) que todos revisarán.
2. Lanza tres revisores paralelos con contexto fresco, uno por lente profunda: **reliability**, **security** (variante estricta de Risk) y **resilience**. Read-only, sin compartir hallazgos entre sí durante la pasada.
3. Un **verificador final independiente** consolida: deduplica, valida la evidencia de cada hallazgo contra el diff y emite el informe único.

## Hard Rules

- Prohibida la autoaprobación: quien escribió el cambio no puede aprobarlo ni ser el único revisor ni el verificador final.
- Todo hallazgo cita evidencia concreta (código/línea); un hallazgo sin evidencia citable se degrada a INFO o se descarta.
- Los desacuerdos entre revisores los resuelve el humano, nunca la autoridad del autor.
- Cuando se pide explícitamente revisión adversarial dual, usa `judgment-day`; no dupliques métodos sobre el mismo objetivo.

## Decision Gates

| Condición | Acción |
|---|---|
| Diff pequeño (<~50 líneas, un módulo) | Una pasada secuencial por las cuatro lentes basta |
| Diff grande o sensible | Protocolo de tres revisores + verificador final |
| Hallazgo severo confirmado | BLOCKER detiene el merge hasta corrección |
| Revisor sin acceso de lectura al repo | Detener y reportar; no revisar «de oído» |

## Formato de Hallazgos

Un hallazgo por línea:

`[SEVERITY] file:line — evidencia — sugerencia`

Severidades: `BLOCKER` (rompe corrección, seguridad o datos), `WARNING` (riesgo probable), `SUGGESTION` (mejora opcional), `INFO` (nota sin acción). La evidencia es el fragmento real del diff; la sugerencia es accionable y específica.

## Output Contract

Devuelve: veredicto único `APPROVED | CHANGES_REQUESTED | ESCALATED`, conteo por severidad, lista completa de hallazgos en el formato anterior, revisores que participaron y qué NO se revisó (fuera de alcance). Sin veredicto ni hallazgos con evidencia, la revisión no cuenta como hecha.

## References

No supporting files. Para revisión adversarial blind con rondas acotadas, ver skill `judgment-day`.
