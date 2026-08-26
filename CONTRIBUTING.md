# Contribuir

Este repo es la capa operativa de ingeniería Gentle-AI sobre DeepSeek Harness
(DSH): un bundle out-of-tree (`bundles/engineering`) con su perfil, presets,
skills y el tooling de gates que hace cumplir la política. No modifica jamás el
core de DSH; si tu cambio parece requerirlo, el camino es upstream: abrí primero
el issue correspondiente en el proyecto gentle-ai siguiendo el workflow
issue-first (hay un borrador listo en
[docs/contribution-gentle-ai.md](docs/contribution-gentle-ai.md)).

**Issue-first también acá.** Antes de un PR grande, abrí un issue con:

1. el problema operativo observado (no la solución deseada);
2. evidencia: qué pasó, con salida literal o repro;
3. el nivel de riesgo que le asignás (P0–P3, tabla más abajo).

Los fixes triviales (typo, enlace roto) no requieren issue.

## Setup de desarrollo

Requisitos: Node ≥26 (lo exige `engines`; los scripts TS corren con
type-stripping nativo) y pnpm 11.22.0 (pin de `packageManager`).

```bash
git clone https://github.com/Dreamcoder08/dreamcoder-dsh.git
cd dreamcoder-dsh
pnpm install
bash scripts/install.sh   # instala el perfil 'engineering' en ~/.dsh
```

Sin instalación local de `dsh` podés aportar typecheck, tests y docs; la
verificación de composición y el doctor completo sí la necesitan.

## Verificación local obligatoria antes de proponer cambios

| Comando | Qué valida | Evidencia que produce |
|---|---|---|
| `pnpm typecheck` | Tipado de todo el tooling TS (`tsgo --noEmit`) | Salida sin errores |
| `pnpm test` | Las suites `node --test` de gates y scripts | Conteo pass/fail por suite |
| `pnpm verify` | Que la composición real del perfil sea válida: verify-compat (mismo algoritmo que el arranque), verify-presets y verify-contracts | Salida por paso; falla ruidoso ante drift upstream |
| `pnpm bench` | Ejecución REAL del corpus de journeys en modo driven | Veredicto por journey + recibo `.evidence/bench-latest.json` |
| `bash scripts/dream-doctor.sh` | Salud de la instalación completa (13 chequeos) | Líneas ✔/✘ y exit code agregado |
| `node scripts/update-guard.ts` | Pin local de DSH vs último tag upstream | Aviso o exit 1 con `--strict`; cache offline con `--offline` |

Sobre el modo **driven** del bench: un test verde sobre el corpus solo valida
declaraciones (análogo a `go test ./bench`); nunca prueba ejecución. El runner
ejecuta cada step real con `bash -c`, observa exit codes y salidas, y emite un
veredicto honesto — jamás fabrica resultados. Flags útiles:
`--only <ids>` para subconjuntos, `--list` para ver el corpus sin ejecutar,
`--json` para salida machine-readable. Algunos journeys requieren un
`dsh`/`DSH_HOME` real: en CI se corre `--only j1,j2,j3,j7,j8` (los que no
dependen del host); el bench completo es parte del gate autoritativo local.

Incluí en la descripción del PR la salida relevante y los exit codes de estos
comandos — no un resumen verbal ("debería funcionar" es hipótesis, no
resultado). Si tu cambio toca instalación o salud, sumá la salida del doctor.

## Convenciones

- **Commits por unidad de trabajo revisable**: código + su test + su doc juntos,
  en un commit. Convención `type(scope): summary`, p. ej.
  `fix(doctor): check skills via default user-dsh root after portable refactor`.
- **Español operativo**: la documentación operativa va en español; los
  identificadores de código, en inglés cuando sea idiomático.
- **Riesgo antes de tocar código** (la misma clasificación P0–P3 del bundle):

  | Nivel | Cambio típico | Expectativa |
  |---|---|---|
  | P0 trivial | typo, docs, comentario | 1 commit, sin test |
  | P1 scoped | fix puntual + unit test | test obligatorio |
  | P2 substantial | feature/refactor multi-archivo | decisión + tests |
  | P3 architectural | contratos, esquemas, build/CI | issue previo + diseño |

  Si el PR crece más allá de su nivel declarado, reclasificalo y decilo —
  reclasificar no es fracasar; ocultarlo sí.
- **Quien implementa no se autoaprueba.** Todo PR recibe revisión bajo las
  cuatro lentes 4R. En cambios grandes (> ~400 líneas o multi-módulo), la
  revisión se hace con contexto fresco: subagente nuevo u otro modelo distinto
  del implementador.
- **Reglas del repo**: out-of-tree siempre; overrides deterministas (reemplazo
  completo de config, con comentario que explique por qué existen); sin rutas
  absolutas ni `customSkillDirs` (las skills se enlazan vía `$DSH_HOME/skills`).

## CI

El workflow (`.github/workflows/ci.yml`) corre dos jobs:

- **tooling** — gate duro en cada push a main y PR: `pnpm install
  --frozen-lockfile`, `pnpm typecheck`, `pnpm test`, auto-verificación de los
  gates mecánicos (`scripts/security-gate.ts` debe bloquear `git reset --hard`
  y `rm -rf`, clasificar `pnpm test` como P2 y pasar el stage-check),
  mini-bench driven con `--only j1,j2,j3,j7,j8`, `update-guard --offline` e
  integridad de documentación (todo enlace relativo de `README.md` y `docs/*.md`
  debe existir, y toda ruta en backticks bajo `bundles/`, `agents/`,
  `workflows/`, `policy/`, `memory/`, `profiles/`, `scripts/` y `docs/` debe
  existir en el repo).
- **composition** — best-effort pero determinista: si el runner no tiene `dsh`,
  se omite con un notice (exit 0, sin ❌ permanente); si lo tiene, corre
  `pnpm verify` en modo estricto.

Por qué el gate autoritativo sigue siendo tu máquina: componer el perfil exige
una instalación real de DSH con su `$DSH_HOME`, y eso no es reproducible en un
runner estándar. CI detecta rupturas mecánicas y de declaraciones; la prueba de
que la capa funciona es local:

```bash
pnpm verify && bash scripts/dream-doctor.sh
```

Para diagnóstico de instalación, empezá por
[docs/troubleshooting.md](docs/troubleshooting.md).
