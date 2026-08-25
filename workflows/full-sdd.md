# Workflow Full-SDD (riesgo P3)

Para cambios arquitectónicos: diseño, contratos públicos, migraciones. Nueve etapas con gate
explícito: no se entra a la siguiente sin cumplir el criterio de salida de la anterior.

**Roles** (presets de `agents/`): `explorer` explora, `architect` diseña, `implementer` aplica,
`tester` verifica, `reviewer` y `security` revisan con contexto fresco; el orquestador coordina,
aprueba gates, archiva y es el único rol que recupera memoria (`policy/AGENTS.md`, sección 6).

| Etapa | Ejecuta | Producto central |
|-------|---------|------------------|
| explore | explorer | Mapa del terreno con evidencia |
| proposal | architect | Dirección aprobada por humano |
| spec | architect | Requisitos verificables numerados |
| design | architect (+reviewer) | Diseño técnico revisado |
| tasks | architect (+orquestador) | Unidades commiteables trazables |
| apply | implementer | Commits por unidad |
| verify | tester | Suite verde + checklist de spec |
| review | reviewer + security | Veredicto sin bloqueantes |
| archive | orquestador | Artefactos y memoria persistidos |

## explore — explorer
- **Inputs**: objetivo, estado actual del repo, memoria recuperada por el orquestador.
- **Outputs**: resumen del terreno: módulos afectados, restricciones, alternativas descartadas con motivo.
- **Exit criteria**: todo módulo afectado fue leído; cero suposiciones sin marcar como tales.

## proposal — architect
- **Inputs**: hallazgos de `explore`.
- **Outputs**: propuesta de ~1 página: problema, ≥2 opciones con tradeoffs, recomendación, impacto y riesgos.
- **Exit criteria**: aprobación humana explícita de la dirección; sin ella no hay spec.

## spec — architect
- **Inputs**: propuesta aprobada.
- **Outputs**: requisitos numerados; contratos públicos propuestos (firmas, schemas, códigos de error); política de compatibilidad y migración.
- **Exit criteria**: cada requisito tiene criterio de aceptación observable; sin ambigüedad ni "etc.".

## design — architect diseña; reviewer revisa
- **Inputs**: `spec`.
- **Outputs**: componentes y responsabilidades, flujo de datos, plan de migración, plan de rollback, riesgos con mitigación.
- **Exit criteria**: revisión de diseño por `reviewer` con contexto fresco; objeciones resueltas o registradas como decisiones aceptadas.

## tasks — architect; orquestador valida
- **Inputs**: `design` aprobado.
- **Outputs**: lista ordenada de unidades commiteables; cada una con archivos, tests y dependencias.
- **Exit criteria**: trazabilidad completa requisito ↔ unidad: la suma cubre la spec y nada extra.

## apply — implementer
- **Inputs**: lista de tareas.
- **Outputs**: un commit por unidad (compila + tests de la unidad en verde); notas de desviación por unidad.
- **Exit criteria**: todas las unidades aplicadas, o bloqueo documentado con evidencia.
- **Límite**: prohibido introducir contratos ausentes de `spec`/`design`; cualquier necesidad nueva escala al architect.

## verify — tester (contexto fresco; no fue el implementador)
- **Inputs**: diff completo, suite de tests, `spec`.
- **Outputs**: suite completa con exit codes; tests nuevos vistos fallar y luego pasar; checklist requisito → evidencia.
- **Exit criteria**: 100% de requisitos con evidencia, o excepción aprobada explícitamente por el humano.

## review — reviewer + security (contexto fresco, independientes entre sí)
- **Inputs**: diff, evidencia de `verify`, `spec`, `design`.
- **Outputs**: veredicto separado de cada revisor: aprobar o cambios requeridos (lista concreta). Security cubre superficie de ataque, secretos, permisos y reversibilidad de la migración.
- **Exit criteria**: cero comentarios bloqueantes pendientes; operaciones P5 restantes (deploy, migración a producción) con aprobación humana propia.

## archive — orquestador
- **Inputs**: todos los artefactos de las etapas anteriores.
- **Outputs**: spec/design/tasks archivados junto al proyecto; entradas de memoria dignas de persistencia; registro de lecciones.
- **Exit criteria**: un lector nuevo puede reconstruir qué se decidió, por qué y cómo se verificó, sin acceso a esta conversación.

## Contrato machine-readable

Las etapas de este workflow tienen contrato verificable en `contracts/full-sdd.json` (schema: `schemas/stage-contract.schema.json`). El cruce contrato↔documento lo valida `node scripts/verify-contracts.ts` — parte del gate `pnpm verify`. Si este documento y el contrato divergen, la verificación falla: arregla la fuente de deriva, no el verificador.
