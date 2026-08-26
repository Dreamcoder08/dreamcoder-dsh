# Workflow Mini-SDD (riesgo P2)

Feature o refactor multi-archivo con estructura ligera: una propuesta corta autoriza la
implementación; el resto es disciplina de unidades commiteables y verificación independiente.

## 1. Propuesta breve

Documento de máximo una pantalla con campos obligatorios:

- **Objetivo**: resultado observable en una o dos frases.
- **Alcance**: qué entra y qué queda explícitamente fuera.
- **Archivos esperados**: lista de archivos a crear/modificar; lo incierto se declara como tal.
- **Plan de tests**: qué pruebas demuestran el objetivo (unitarias/integración, casos límite).

Se presenta al humano u orquestador; no hay implementación sin propuesta.

## 2. Confirmación

- Solo avanza con un sí explícito ("OK", "adelante"); las preguntas cuentan como no-confirmadas.
- Si durante la ejecución el alcance cambia, se detiene y se re-propone únicamente el delta.

## 3. Implementación por unidades de trabajo

- Divide el cambio en unidades commiteables: cada unidad compila, pasa sus tests y deja el sistema
  usable.
- Orden típico: contratos/tipos → implementación → integración/wiring.
- Un commit por unidad, con mensaje que diga qué y por qué; los tests y docs viajan con su código.
- Un bug ajeno descubierto en camino se corrige en su propio commit, nunca mezclado con la unidad.

## 4. Verificación independiente

La ejecuta un agente o proceso distinto del implementador, con contexto fresco:

1. Suite completa (tests, lint, build): registrar comandos, salidas y exit codes.
2. Comparar el diff real contra la propuesta: archivos esperados vs. archivos tocados.
3. Checklist del plan de tests: cada prueba prevista, ejecutada y vista pasar.

Las desviaciones respecto a la propuesta se listan explícitamente; ninguna se disimula.

## 5. Resumen de evidencia

Tabla final en el reporte:

| Unidad | Commit | Verificación | Resultado |
|--------|--------|--------------|-----------|

Más: exit codes, resumen de salidas de test, diff stat, lista de desvíos y riesgo residual.

Criterio de cierre: todas las unidades commiteadas, verificación independiente en verde con
evidencia publicada y desvíos declarados. Con eso, el workflow termina.

## Contrato machine-readable

Las etapas de este workflow tienen contrato verificable en `contracts/mini-sdd.json` (schema: `schemas/stage-contract.schema.json`). El cruce contrato↔documento lo valida `node scripts/verify-contracts.ts` — parte del gate `pnpm verify`. Si este documento y el contrato divergen, la verificación falla: arregla la fuente de deriva, no el verificador.
