---
name: memory-gate
description: "Trigger: memoria, engram, recordar, persistir decisión, lección, gate. Decide qué merece memoria longitudinal al cierre de cada tarea y recupera memoria solo desde el orquestador."
license: Apache-2.0
metadata:
  author: dreamcoder
  version: "1.0"
---

## Activation Contract

Load al CERRAR una tarea con descubrimientos potenciales y al INICIAR una tarea que pueda beneficiarse de conocimiento previo. El gate decide qué entra en memoria; no es un volcado automático.

## Regla de Oro

Solo el ORQUESTADOR recupera y escribe memoria. Los subagentes no leen ni escriben memoria por su cuenta: el orquestador inyecta lo pertinente en sus prompts autocontenidos.

## Persistir (decisión explícita, no rutina)

Persiste SOLO cuando el descubrimiento altere trabajo futuro:

| Tipo | Ejemplo |
|---|---|
| Decisión arquitectónica + por qué | "Elegimos polling sobre webhooks porque el proveedor no reintenta" |
| Invariantes y comandos canónicos | "Los tests corren con `pnpm test:unit`, nunca `npm test`" |
| Descubrimiento costoso y reutilizable | "La API X limita a 60 req/min por IP; pin en v2.3" |
| Lección de fallo verificado | "El bug #412 ocurrió porque…; se detectó con…" |

## Descartar

- Salida cruda de comandos, diffs intermedios, estados de depuración transitorios.
- Detalles de tareas cerradas que no alteren invariantes ni decisiones.
- Nada que ya esté en AGENTS.md, docs del repo o el propio código.

## Prohibido SIEMPRE

Secretos o contenido de rutas sensibles (`~/.ssh`, `.env*`, credenciales): jamás a memoria, logs ni commits.

## Protocolo

1. Al iniciar: una consulta de recuperación acotada al dominio de la tarea (no browsing general).
2. Inyecta en cada prompt de subagente solo los hechos pertinentes, citando su origen.
3. Al cerrar: aplica este gate; si algo pasa, escríbelo con estructura `contexto → decisión/descubrimiento → evidencia → implicación`.
4. Declara en tu reporte final una línea: `Memoria: N entradas persistidas, M recuperadas` (o `0, 0`).

Si las tools `mcp__engram__*` no están disponibles, decláralo una vez y opera sin memoria longitudinal; no simules escrituras.
