# Referencia de skills

Las siete skills del bundle viven en `bundles/engineering/skills/<nombre>/SKILL.md`
y se instalan por enlace en `$DSH_HOME/skills`. Todas son contratos LLM-first:
definen cuándo cargarse (trigger), qué reglas aplicar y qué salida producir —
no son tutoriales.

| Skill | Autor declarado | Versión |
|---|---|---|
| `workflow-router` | gentleman-programming | 1.0 |
| `tdd-evidence` | gentleman-programming | 1.0 |
| `review-4r` | gentleman-programming | 1.0 |
| `evidence-ledger` | gentleman-programming | 1.0 |
| `memory-gate` | dreamcoder | 1.0 |
| `model-router` | dreamcoder | 1.0 |
| `autonomous-mission` | dreamcoder | 1.0 |

---

## workflow-router

**Trigger:** clasificar, riesgo, workflow, P0, P1, P2, P3, router.

Clasifica cualquier tarea entrante por riesgo **antes** de actuar: la clase de
riesgo determina el workflow, nunca al revés.

- P0 trivial (typo, comentario, docs) → `direct`
- P1 scoped (cambio local con test) → `direct` + test obligatorio
- P2 substantial (feature/refactor multi-archivo) → `mini-sdd`
- P3 architectural (contratos, esquemas, migraciones) → `full-sdd`

Garantías: ante duda entre dos niveles gana el más alto; si la tarea real
excede su nivel, se reclasifica y se anuncia antes de continuar.

## tdd-evidence

**Trigger:** TDD estricto, RED/GREEN, test primero, triangulación.

Ejecuta el ciclo TDD exigiendo **evidencia observada de cada fase**: la salida
real del runner es la prueba; el relato no cuenta. Aplicable a cualquier stack
con runner ejecutable desde CLI. Se complementa con `scripts/red-green.ts`,
que captura el ciclo en `<repo>/.evidence/` (exit code 0 = ciclo válido).

## review-4r

**Trigger:** revisión de código, code review, dual review, cuatro lentes.

Revisa con las lentes **Readability / Reliability / Resilience / Risk**, y para
cambios grandes aplica protocolo de tres revisores con contexto fresco.
Garantía central: produce hallazgos con evidencia; jamás aprueba por cortesía
ni por jerarquía.

## evidence-ledger

**Trigger:** receipt, evidencia, ledger, cierre de misión, aceptación de cambio.

Produce el recibo YAML verificable al cerrar cualquier misión P≥1; sin recibo
no hay misión completa. El recibo se deriva del estado real de Git mediante
`scripts/evidence-ledger.ts` (SHAs, scope, checks) y cierra con SHA256 — el
relato del agente no participa en su construcción.

## memory-gate

**Trigger:** memoria, engram, recordar, persistir decisión, lección, gate.

Decide qué merece memoria longitudinal al cierre de cada tarea y recupera
memoria solo al iniciar tareas que pueden beneficiarse de conocimiento previo.
Reglas:

- persisten decisiones arquitectónicas + porqué, invariantes, comandos
  canónicos, descubrimientos costosos y lecciones de fallos verificados;
- no persiste salida cruda, estados de depuración transitorios ni secretos;
- solo el orquestador lee y escribe memoria; los subagentes no acceden por su
  cuenta;
- si el overlay Engram no está compuesto, se declara una vez y se opera sin
  memoria longitudinal — nunca se simula.

## model-router

**Trigger:** modelo, routing, provider, effort, coste, capacidad, qué modelo.

Elige proveedor/modelo/esfuerzo por rol y fase del pipeline según riesgo y
coste, y registra la elección. La cadena de decisión es explícita:
`rol → riesgo → modelo → esfuerzo → permisos → contexto`. Perfiles típicos:
el modelo más capaz para arquitectura/implementación P2–P3; exploración con el
modelo rápido y barato; revisión con contexto fresco y, cuando exista,
un modelo distinto al del implementador. Sin alternativa de modelo disponible,
la limitación se declara en el reporte.

## autonomous-mission

**Trigger:** misión autónoma, goal, continuation, larga duración, overnight, bounded.

Ejecuta objetivos largos sobre goals persistidos + jobs en segundo plano, con
radio acotado: límite de rounds fijado **antes** de empezar, una unidad
verificable con evidencia por round, escalado a humano para toda operación
externa/irreversible o decisión no contemplada, y estado `blocked` honesto
ante bloqueos repetidos. Autonomía es control verificado, no ausencia de
supervisión.
