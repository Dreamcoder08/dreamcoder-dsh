# Procedencia y atribución

Este documento declara de dónde viene cada skill del bundle. Existe por dos
razones concretas:

1. **Licencia.** El repo es Apache-2.0, y esa licencia exige conservar los avisos
   de autoría del trabajo derivado. Un `metadata.author` es una afirmación, no
   un detalle decorativo.
2. **Un campo sin respaldo es basura silenciosa.** `metadata.author:
   gentleman-programming` dice "esto lo escribió él". Si no se puede mostrar de
   dónde salió, el campo miente — y este repositorio prefiere declarar la
   incertidumbre a heredarla (misma disciplina que la tabla "Qué se afirma y qué
   no" del README).

## La regla

`metadata.author` registra el **autor original** de la skill:

- `dreamcoder` — la skill es original de este repositorio;
- `gentleman-programming` — la skill se adaptó del ecosistema Gentle-AI y se
  conserva el autor upstream según Apache-2.0 §4;
- `por-confirmar` — no se pudo verificar el origen. **No se usa en el
  frontmatter**: marca la fila acá hasta que el mantenedor lo resuelva.

`scripts/provenance.test.ts` hace cumplir que toda skill del bundle tenga fila en
la tabla de abajo, que su `origen` pertenezca al vocabulario cerrado y que el
autor declarado acá coincida con el del frontmatter. Una skill nueva sin
clasificar rompe la suite: la clasificación es un acto deliberado, no un
accidente.

## Estado declarado

| Skill | `metadata.author` | Origen | Evidencia |
|---|---|---|---|
| `autonomous-mission` | `dreamcoder` | original | No aparece en gentle-pi ni en gentle-ai |
| `evidence-ledger` | `gentleman-programming` | **por-confirmar** | Ver "Punto abierto" |
| `memory-gate` | `dreamcoder` | original | No aparece en gentle-pi ni en gentle-ai |
| `model-router` | `dreamcoder` | original | No aparece en gentle-pi ni en gentle-ai |
| `review-4r` | `gentleman-programming` | **por-confirmar** | Ver "Punto abierto" |
| `tdd-evidence` | `gentleman-programming` | **por-confirmar** | Ver "Punto abierto" |
| `workflow-router` | `gentleman-programming` | **por-confirmar** | Ver "Punto abierto" |

## Punto abierto (requiere decisión del mantenedor)

Cuatro skills declaran `author: gentleman-programming`, pero **ninguno de los dos
repositorios upstream las contiene**, ni en su estado actual ni en el historial
completo:

```bash
# gentle-pi (clon completo, historial incluido)
git -C <clon> log --all --diff-filter=A --name-only --format="" \
  | grep -oE "workflow-router|tdd-evidence|review-4r|evidence-ledger"
# → sin coincidencias

# gentle-ai (clon completo)
grep -rlniE "workflow-router|tdd-evidence|review-4r|evidence-ledger" <clon>
# → sin coincidencias
```

gentle-pi 2.5.0 publica 13 skills (`branch-pr`, `chained-pr`,
`cognitive-doc-design`, `comment-writer`, `gentle-ai`, `issue-creation`,
`judgment-day`, `rdd-defect-workflow`, `release`, `skill-creator`,
`skill-improver`, `skill-registry`, `work-unit-commits`) y ninguna de las cuatro
está ahí.

**Dos lecturas posibles, y no se puede decidir desde este repo**:

- el frontmatter se copió de una plantilla y la atribución es un residuo: en ese
  caso corresponde `dreamcoder`;
- las skills se adaptaron de una fuente que no es ninguno de esos dos repos
  (otro repo del ecosistema, un tag que no llegó a publicarse, trabajo privado):
  en ese caso el autor es correcto y falta citar la fuente.

Mientras no se resuelva, la fila queda `por-confirmar` y el frontmatter **no se
toca**: cambiarlo afirmaría una autoría distinta que tampoco está probada.
Recomendación del análisis: corregir a `dreamcoder` salvo que aparezca la fuente,
porque hoy el campo afirma algo que ningún artefacto respalda.
