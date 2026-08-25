---
name: workflow-router
description: "Trigger: clasificar, riesgo, workflow, P0, P1, P2, P3, router. Clasifica cualquier tarea entrante por riesgo antes de actuar y elige el workflow mínimo seguro."
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0"
---

## Activation Contract

Load cuando llega una tarea nueva sin clasificar y hay que decidir cómo ejecutarla. Clasifica SIEMPRE antes de tocar código: la clase de riesgo determina el workflow, nunca al revés.

## Niveles de Riesgo

| Nivel | Criterio | Ejemplos concretos |
|---|---|---|
| P0 trivial | Cambio cosmético o mecánico; sin lógica nueva ni superficie de fallo | Corregir un typo en README; renombrar una variable local; bump de versión patch |
| P1 scoped | Lógica acotada a un módulo; contrato estable; reversión trivial | Añadir validación a un input; arreglar un bug con test que lo reproduce; endpoint CRUD ya especificado |
| P2 substantial | Cruza varios módulos; cambia contratos internos o requiere migración | Extraer un servicio compartido; cambiar el schema de una tabla usada por 3 features; reescribir la capa de auth manteniendo el contrato externo |
| P3 architectural | Cambia fronteras del sistema, protocolos externos o es irreversible a mediano plazo | Partir un monolito en servicios; cambiar el modelo de persistencia completo; introducir un protocolo público nuevo |

## Mapeo a Workflow

| Clase | Workflow | Alcance mínimo |
|---|---|---|
| P0 | direct | Editar y entregar; sin ceremonia adicional (`workflows/direct.md`) |
| P1 | direct+test | Variante con test del workflow `direct`: cambio local acotado y su test se entregan juntos, evidencia RED/GREEN mínima (ver skill tdd-evidence) |
| P2 | mini-sdd | Especificación breve + diseño + lista de tareas antes de implementar (`workflows/mini-sdd.md`) |
| P3 | full-sdd | Ciclo SDD completo: spec, diseño, plan por fases, verificación formal y revisión con review-4r (`workflows/full-sdd.md`) |

Los docs autoritativos viven en el directorio `workflows/` de este bundle-repo; si un doc contradice esta tabla o aún no existe, manda el doc y decláralo explícitamente en tu resultado.

## Regla de Oro

Elige siempre el workflow MÍNIMO seguro. Subir de nivel cuesta tiempo; bajar de nivel cuesta defectos. Ante empate entre dos clases contiguas, gana la más alta (la más segura).

## Decision Gates

| Condición | Acción |
|---|---|
| Duda entre dos clases contiguas | Escalar UN nivel, nunca dos |
| Parece P0 pero toca código que corre en producción | Tratarla como P1 como mínimo |
| Toca dinero, seguridad, datos de usuarios o es irreversible | Mínimo P2 |
| El alcance crece durante la ejecución | Re-clasificar y anunciar el cambio de workflow antes de continuar |
| Cambio aislado, reversible y con tests existentes que lo vigilarían | No subir de nivel sin evidencia nueva |

## Execution Steps

1. Lee la tarea completa e identifica la superficie afectada: archivos, módulos, contratos, usuarios.
2. Contrasta con la tabla de niveles y asigna P0–P3 citando el criterio que decide.
3. Fija el workflow con la tabla de mapeo.
4. Aplica las Decision Gates de duda antes de comprometerte.
5. Emite la línea de clasificación (Output Contract) y solo entonces empieza a trabajar.

## Output Contract

Antes de cualquier acción sobre el repo, imprime exactamente una línea:

`Clasificación: P<n> → <workflow>`

Si escalaste por duda, añade una línea `Escalar: <motivo>` citando la puerta aplicada. Si re-clasificas a mitad de camino, repite la línea con el nuevo valor y el motivo del cambio.

## References

No supporting files. Docs de workflow del bundle-repo: `workflows/direct.md` (P0–P1), `mini-sdd.md` (P2) y `full-sdd.md` (P3); también `policy/AGENTS.md` si existe.
