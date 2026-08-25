---
name: tdd-evidence
description: "Trigger: TDD estricto, RED/GREEN, test primero, triangulación. Ejecuta el ciclo TDD exigiendo evidencia observada de cada fase; sin salida real no hay TDD."
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0"
---

## Activation Contract

Load cuando se pide TDD estricto, desarrollo test-first, ciclos RED/GREEN o triangulación. Aplica a cualquier stack con runner de tests ejecutable desde CLI.

## Hard Rules

- Nunca escribas código de producción sin que exista antes un test que falle.
- Cada fase exige EVIDENCIA OBSERVADA: el comando exacto ejecutado y su salida real. Resumir de memoria, parafrasear o inventar salidas está prohibido.
- Decir «seguí TDD» sin evidencia pegada es una violación de este contrato: se trata como trabajo no verificado y debe repetirse la fase.
- En RED el test debe fallar POR LA RAZÓN CORRECTA (aserción o error esperado), no por un typo, import roto o fallo de compilación ajeno al comportamiento.
- GREEN = código mínimo para pasar; adelantar generalizaciones está prohibido.
- REFACTOR solo con la suite verde; si rompe, revierte y reintenta en pasos más pequeños.
- La verificación final cubre la suite completa más lint/format del proyecto, no solo el test nuevo.

## Decision Gates

| Condición | Acción |
|---|---|
| El test pasa a la primera (RED imposible) | El comportamiento ya existe o el test no prueba nada: reescribe o elimina |
| Fallo por import/compilación no intencional | Arréglalo como andamiaje y vuelve a RED; no cuenta como evidencia del comportamiento |
| Segundo caso pasa sin tocar producción | Aún no hay nada que generalizar; busca un tercer caso que exponga el hardcode |
| Refactor rompe tests | Revierte; divide el refactor en pasos menores |
| Sin acceso al entorno de tests | Detente y repórtalo; jamás simules salidas |

## Mecanismo preferido de captura RED→GREEN

El harness debe OBSERVAR el ciclo, no confiar en el relato del agente. El script del bundle registra el ciclo en dos fases con ventana de edición real entre ellas y deja el par en `<repo>/.evidence/` (exit code 0 = fase/ciclo válido):

```bash
# 1. Test que falla por la razón correcta:
node <ruta-de-este-repo>/scripts/red-green.mjs record-red -- <comando de test>
# 2. Edita el código (implementación mínima)...
# 3. El mismo comando, ahora en verde:
node <ruta-de-este-repo>/scripts/red-green.mjs record-green -- <comando de test>
```

`record-red` rechaza un pase inicial (no hay comportamiento que probar) y `record-green` rechaza ejecutarse sin RED pendiente: no se puede cerrar un ciclo que nunca estuvo rojo. El JSON resultante es la evidencia citable en las fases RED/GREEN y la que `evidence-ledger` acepta en el cierre. Fases posteriores (TRIANGULATE, REFACTOR, VERIFY) se capturan manualmente según Execution Steps.

## Execution Steps

### 1. RED
Escribe el test más pequeño que exprese el comportamiento ausente. Ejecuta el runner y captura: comando exacto + líneas clave del fallo.

```text
$ npm test -- --run tests/parse-duration.test.ts
FAIL tests/parse-duration.test.ts
  ● parsea "90s" a segundos
    expect(received).toBe(expected) // 90 !== undefined
Tests: 1 failed, 1 total
```

### 2. GREEN
Implementa el código mínimo para que pase. Vuelve a ejecutar y captura el pase:
`Tests: 1 passed, 1 total`. Prohibido tocar nada que no exija este test.

### 3. TRIANGULATE
Añade un segundo caso que fuerce la generalización (otro input, un borde, un objeto equivalente). Si pasa sin cambios en producción, no había nada que abstraer: documenta el caso. Solo introduce la abstracción cuando ≥2 casos reales la exigen, con su evidencia de pase.

### 4. REFACTOR
Con tests verdes, mejora nombres, duplicación y estructura en pasos pequeños, re-ejecutando tras cada paso. La evidencia es la salida verde del último paso.

### 5. VERIFY
Ejecuta la suite completa y los checks del proyecto (`lint`, `typecheck`). Captura el resumen real. Sin esta fase no se declara la tarea terminada.

## Output Contract

Reporta cada fase con este bloque mínimo:

```yaml
fase: RED | GREEN | TRIANGULATE | REFACTOR | VERIFY
comando: "<comando exacto>"
salida: |
  <líneas reales del fallo o pase>
veredicto: ok | repetir-fase | bloqueado
```

Cierra con un resumen: fases completadas, nº de tests añadidos y ruta de los archivos de test. Un reporte sin bloques de evidencia viola este skill.

## References

Complementa a `workflow-router` (P1+ exige evidencia RED/GREEN) y alimenta a `evidence-ledger` en el cierre. Script de captura: `scripts/red-green.mjs` en la raíz de este bundle-repo.
