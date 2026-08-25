---
name: autonomous-mission
description: "Trigger: misión autónoma, goal, continuation, larga duración, overnight, bounded. Ejecuta objetivos largos sobre goals persistidos + jobs, con límites duros y puntos de control verificables."
license: Apache-2.0
metadata:
  author: dreamcoder
  version: "1.0"
---

## Activation Contract

Load cuando una tarea excede un turno (migraciones grandes, suites de reparación, benchmarks iterativos) y el humano pide ejecución autónoma o continuada. Autonomía NO significa ausencia de control: significa control verificado en lugar de supervisión constante.

## Arquitectura de la Misión

```text
objetivo → create_goal (persistido en sesión)
         → plan en tareas verificables (todo_write)
         → ejecutar unidad → verificar con contexto fresco → registrar evidencia
         → siguiente unidad … (continuation rounds)
         → complete | blocked (con razón concreta)
```

## Límites Duros (no negociables)

1. **Radio acotado**: fija `max_goal_rounds` antes de empezar; sin límite no hay autonomía, hay deriva.
2. **Unidad mínima verificable**: cada round termina con evidencia publicada (test, diff, exit code). Un round sin evidencia cuenta como fallo, no como progreso.
3. **Escalado a humano**: operaciones P4/P5 (push, borrados, deploy) y decisiones arquitectónicas no contempladas en el objetivo → pausa y reporta; nunca las resuelve la autonomía.
4. **Re-clasificación**: si la misión real resulta ser P3 y nació como P2, detén y replanifica; la autonomía no amplía alcance en silencio.
5. **Blocked honesto**: tras repetirse el mismo bloqueo en rounds consecutivos, marca blocked con la condición exacta; insistir distinto no es progreso.

## Trabajo en Segundo Plano

- Builds, suites largas y servidores → jobs en background (`run_in_background`); nunca bloques un turno esperando.
- Colecciona cada job antes de declarar su unidad terminada (`job_output`) y mata los que dejaron de importar (`job_kill`).
- Subagentes para exploración/review paralela; el orquestador conserva la decisión final y la memoria (skill memory-gate).

## Protocolo de Continuation Round

Al retomar (round automático o rearme tras resume):

1. Lee el estado del goal y la última evidencia publicada; no repitas trabajo hecho.
2. Ejecuta UNA unidad del plan hasta evidencia verificable.
3. Publica: unidad completada + comando + salida + exit code + siguiente paso.
4. Actualiza todos y memoria (gate) solo con hechos nuevos y duraderos.

## Output Contract

Cada round cierra con:

```yaml
goal: <id>
unidad: "<qué se completó>"
evidencia: "<comando → salida clave → exit code>"
siguiente: "<siguiente unidad>"
estado: avanzando | awaiting_human | blocked(<condición>)
```

## References

Requiere los presets con tool-goal/jobs disponibles en la composición (implementer u orquestador). Evidencia se registra según `tdd-evidence` y cierra con `evidence-ledger`.
