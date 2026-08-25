---
name: evidence-ledger
description: "Trigger: receipt, evidencia, ledger, cierre de misión, aceptación de cambio. Produce el recibo YAML verificable al cerrar cualquier misión P≥1; sin recibo no hay misión completa."
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0"
---

## Activation Contract

Load al cerrar una misión, al pedir un receipt/evidencia o al aceptar formalmente un cambio. Convierte los hechos observados de la misión en un recibo verificable bajo control de versiones.

## Hard Rules

- Ninguna misión P≥1 (clasificada con `workflow-router`) se declara completa sin su recibo cerrado.
- Todo campo del recibo proviene de hechos observados: comandos ejecutados y sus salidas reales, SHAs de git reales. Inventar o deducir campos está prohibido.
- `human_approval.required` = sí para toda misión P≥2, todo push/merge/release y todo cambio irreversible; está prohibido marcarlo «no» para evadir la aprobación.
- El recibo cerrado es inmutable: una corrección emite un recibo nuevo que referencia al anterior, nunca edita el existente.

## Plantilla de Recibo

```yaml
mission: <id corto kebab-case>
date: <ISO-8601 UTC>
classification: P<0-3>              # salida de workflow-router
base_sha: <git rev-parse HEAD inicial>
candidate_sha: <git rev-parse HEAD final>
tests:
  command: "<comando exacto de la suite>"
  result: pass                      # solo con salida observada
  summary: "<n passed, n failed>"
review:
  method: single | review-4r-trio   # según review-4r
  verdict: APPROVED | CHANGES_REQUESTED | ESCALATED
  blockers_open: <n>
scope:
  expected_files:
    - <ruta que la misión debía tocar>
  changed_files_stat: |             # salida literal de git diff --stat base..candidate
    ...
  unexpected_changes: none          # rutas fuera de scope, o listarlas
human_approval:
  required: true                    # según reglas de arriba
  granted_by: pending               # quién otorga, o pending
receipt_sha256: <rellenar al final>
```

## Decision Gates

| Condición | Acción |
|---|---|
| Falta un hecho (p. ej. sin salida de test observada) | No cerrar el recibo; completar la evidencia primero |
| Cambios fuera del scope esperado en el diff | Investigar antes de cerrar; revertir o justificar en `unexpected_changes` |
| `human_approval.required: true` y sin otorgar | Estado `awaiting_approval`; prohibido declarar complete |
| Error material en un recibo cerrado | Recibo correctivo nuevo referenciando al anterior |

## Execution Steps

1. Confirma la clasificación: P≥1 requiere recibo obligatorio; P0 queda exento salvo petición humana explícita.
2. Reúne la evidencia: SHAs reales (`git rev-parse HEAD` antes y después), comandos y salidas de tests, veredicto de revisión.
3. Genera el scope: lista `expected_files` vs `git diff --stat <base_sha>..<candidate_sha>`; marca cualquier cambio inesperado.
4. Determina `human_approval.required` con las reglas de Hard Rules.
5. **Vía preferida — script del bundle** (deriva SHAs, diff y checks directamente de Git; el exit code 0 equivale a receipt `PASS`):

   ```bash
   node <ruta-de-este-repo>/scripts/evidence-ledger.mjs \
     --mission <id> --base <sha_base> [--expected <n>] \
     --check "unit tests" -- "<comando de test>" \
     --check "lint" -- "<comando de lint>"
   ```

   Escribe `<repo>/.evidence/mission-<id>-<ts>.yaml` con su `sha256`.
6. Vía manual (solo si el script no aplica): escribe el YAML completo excepto `receipt_sha256` en `<repo>/.evidence/<mission>.yaml`, calcula el SHA256 del texto sin esa línea (`sha256sum`) y añádela al final: cualquiera puede verificarlo recalculando el hash sin el último campo.
7. Declara la misión completa solo con el recibo cerrado; si falta aprobación requerida, el estado es `awaiting_approval`.

## Output Contract

Devuelve: ruta del recibo (`<repo>/.evidence/<mission>.yaml`), su SHA256, estado final (`complete | awaiting_approval | blocked`) y un resumen de una línea con tests y veredicto. Si la misión termina sin recibo siendo P≥1, el resultado correcto es reportarlo como incumplimiento, no como éxito.

## References

Entrada esperada de `workflow-router` (clasificación) y `tdd-evidence` / `review-4r` (evidencia y veredicto). Script generador: `scripts/evidence-ledger.mjs` en la raíz de este bundle-repo (registros en `<repo>/.evidence/`).
