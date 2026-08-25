# Workflow Direct (riesgo P0–P1)

Ruta corta del pipeline: sin documento de diseño ni confirmación formal. La aplica la skill
`workflow-router` cuando la clasificación resulta P0 o P1 (`policy/AGENTS.md`, sección 2).

## Cuándo aplica

- **P0**: typo, comentario, docs, one-liner sin dependencias.
- **P1**: cambio local acotado con test asociado (fix puntual, ajuste pequeño).

No aplica si la tarea toca contratos públicos, migraciones, ≥3 archivos o dependencias nuevas, o
requiere decisiones de diseño: reclasificar y escalar a `mini-sdd` o `full-sdd`.

## Pasos

### 1. Understand
- Leer los archivos afectados y sus llamadores directos.
- Enunciar el comportamiento esperado en una frase antes de editar.

### 2. Change
- Editar solo lo necesario; prohibido el refactor de paso.
- En P1, el cambio y su test se entregan juntos.

### 3. Verify
Ejecutar la verificación mínima pertinente y registrar comando, salida y exit code:

- **P0**: lint/compilación del archivo tocado, o equivalente (p. ej., render del documento).
- **P1**: el test nuevo pasa en esta ejecución; si es barato, mostrar primero que falla sin el fix.

### 4. Summarize
Reportar qué cambió, qué NO cambió, cómo se verificó y qué riesgo residual queda.

## Criterios de salida

- [ ] El diff contiene solo lo pedido: sin archivos incidentales ni reformateo masivo.
- [ ] Verificación ejecutada con exit code visible, no presumido.
- [ ] P1: existe un test que ejerce el cambio y pasó en esta ejecución.
- [ ] Resumen emitido con evidencia adjunta.
- [ ] Ninguna operación por encima del permiso requerido (máx. P2 EXECUTE-SAFE).

## Evidencia a producir

1. Comandos de verificación con salida relevante y exit codes.
2. `git diff --stat` (diff completo disponible bajo demanda).
3. Resumen de 3–5 líneas: alcance, verificación, riesgo residual.

Si algún criterio falla, el workflow no terminó: volver al paso correspondiente.

## Contrato machine-readable

Las etapas de este workflow tienen contrato verificable en `contracts/direct.json` (schema: `schemas/stage-contract.schema.json`). El cruce contrato↔documento lo valida `bun run scripts/verify-contracts.ts` — parte del gate `bun run verify`. Si este documento y el contrato divergen, la verificación falla: arregla la fuente de deriva, no el verificador.
