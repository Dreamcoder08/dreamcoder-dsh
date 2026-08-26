# Referencia de skills

Las siete skills del bundle engineering son **contratos LLM-first**: cada una
declara un trigger de activación y desarrolla reglas duras, puertas de decisión
y un contrato de salida verificable. No son tutoriales: son instrucciones que
un agente carga solo cuando la fase actual las necesita (`policy/AGENTS.md` §10).

Viven en `bundles/engineering/skills/<nombre>/SKILL.md`; el frontmatter declara
`name`, `description` (donde vive el trigger), licencia Apache-2.0 y
`metadata.author` / `metadata.version`. Se instalan con `bash scripts/install.sh`,
que enlaza cada carpeta por symlink en `$DSH_HOME/skills` —la raíz que escanea
el filesystem de skills de DSH—, sin rutas absolutas en el patch; las flags
`--with-engram` y `--with-hooks` agregan el overlay Engram y el hook pre-commit.

## Índice

| Skill | Trigger (frontmatter) | Garantía central | Script compañero |
|---|---|---|---|
| `workflow-router` | clasificar, riesgo, workflow, P0, P1, P2, P3, router | Riesgo clasificado antes de actuar; workflow mínimo seguro | — |
| `tdd-evidence` | TDD estricto, RED/GREEN, test primero, triangulación | Cada fase con evidencia observada, no relatada | `scripts/red-green.ts` |
| `review-4r` | revisión de código, code review, dual review, cuatro lentes | Hallazgos con evidencia; jamás aprobar por cortesía | — |
| `evidence-ledger` | receipt, evidencia, ledger, cierre de misión, aceptación de cambio | Recibo YAML derivado de Git; sin recibo no hay misión P≥1 | `scripts/evidence-ledger.ts` |
| `memory-gate` | memoria, engram, recordar, persistir decisión, lección, gate | Memoria como decisión explícita del orquestador | — |
| `model-router` | modelo, routing, provider, effort, coste, capacidad, qué modelo | Routing explícito por rol y riesgo, registrado | — |
| `autonomous-mission` | misión autónoma, goal, continuation, larga duración, overnight, bounded | Autonomía con radio acotado y evidencia por round | — |

---

## workflow-router

**Trigger:** clasificar, riesgo, workflow, P0, P1, P2, P3, router.

**Qué garantiza:** toda tarea se clasifica por riesgo P0–P3 *antes* de tocar
código, y la clase determina el workflow —nunca al revés—. Elige siempre el
workflow MÍNIMO seguro: subir de nivel cuesta tiempo, bajar cuesta defectos.

**Contrato de activación:** cargar cuando llega una tarea nueva sin clasificar
y hay que decidir cómo ejecutarla. Los docs de soporte viajan con la skill
(`workflows/direct.md`, `workflows/mini-sdd.md`, `workflows/full-sdd.md`
resueltos contra su directorio base, sincronizados con la fuente canónica en
`workflows/` del repo); si un doc contradice la tabla o no existe, se manda el
doc y se declara explícitamente en el resultado.

El mapeo clase → workflow:

| Clase | Workflow | Alcance mínimo |
|---|---|---|
| P0 trivial | `direct` | Editar y entregar, sin ceremonia |
| P1 scoped | `direct` + test obligatorio | Cambio local y su test juntos, RED/GREEN mínima |
| P2 substantial | `mini-sdd` | Spec breve + diseño + lista de tareas |
| P3 architectural | `full-sdd` | Ciclo SDD completo + revisión `review-4r` |

Puertas de decisión: ante duda entre dos clases contiguas se escala UN nivel,
nunca dos; lo que parece P0 pero toca código de producción trata como P1 como
mínimo; dinero, seguridad, datos de usuarios o irreversibilidad exigen P2
como piso; si el alcance crece a mitad de camino, se re-clasifica y se anuncia
antes de continuar; un cambio aislado que los tests existentes ya vigilarían
no sube de nivel sin evidencia nueva.

**Entradas / salidas:** entra la tarea completa (superficie afectada:
archivos, módulos, contratos, usuarios). Sale una línea exacta impresa antes
de cualquier acción sobre el repo: `Clasificación: P<n> → <workflow>`. Si
escaló por duda, agrega `Escalar: <motivo>` citando la puerta aplicada; si
re-clasifica, repite la línea con el nuevo valor y el motivo.

**Modo de fallo:** ante input ambiguo no elige en silencio: escala un nivel y
declara qué puerta disparó la decisión. Su salida es además la entrada
obligatoria de `evidence-ledger` (campo `classification`): una misión sin
clasificación previa no puede cerrar recibo. Sin script propio.

---

## tdd-evidence

**Trigger:** TDD estricto, RED/GREEN, test primero, triangulación.

**Qué garantiza:** ningún código de producción sin un test que falle antes, y
cada fase del ciclo respaldada por **evidencia observada**: el comando exacto
ejecutado y su salida real. Resumir de memoria, parafrasear o inventar salidas
está prohibido; decir «seguí TDD» sin evidencia pegada se trata como trabajo
no verificado y la fase debe repetirse.

**Contrato de activación:** cargar cuando se pide TDD estricto, desarrollo
test-first, ciclos RED/GREEN o triangulación. Aplica a cualquier stack con
runner de tests ejecutable desde CLI. Si no hay acceso al entorno de tests, la
skill ordena detenerse y reportarlo: jamás simula salidas.

Cinco fases, cada una con su puerta de decisión:

| Fase | Regla | Si algo sale mal |
|---|---|---|
| RED | Falla POR LA RAZÓN CORRECTA (aserción esperada) | Pasa a la primera → reescribir o eliminar; fallo de import/build es andamiaje, vuelve a RED |
| GREEN | Código mínimo para pasar; nada extra | Sigue fallando → seguir implementando |
| TRIANGULATE | Segundo caso que fuerza generalización; abstraer con ≥2 casos reales | Pasa sin tocar producción → no había nada que abstraer |
| REFACTOR | Solo con suite verde, en pasos pequeños | Rompe tests → revertir y dividir el paso |
| VERIFY | Suite completa + lint/format del proyecto | Sin esta fase no se declara la tarea terminada |

**Entradas / salidas:** espera un comportamiento ausente expresable como test
y un runner accesible. Produce un bloque YAML por fase —`fase`, `comando`,
`salida` (líneas reales), `veredicto: ok | repetir-fase | bloqueado`— y cierra
con un resumen: fases completadas, cantidad de tests añadidos y ruta de los
archivos de test. Un reporte sin bloques de evidencia viola la skill.

**Modo de fallo:** fail-closed por diseño: una fase sin salida real observada
se repite, y el harness debe OBSERVAR el ciclo en vez de confiar en el relato
del agente. La evidencia que este script produce es la que `evidence-ledger`
acepta en el cierre de la misión.

**Compañero mecánico:** `scripts/red-green.ts` captura el ciclo en dos fases
con ventana de edición real entre ellas y deja el par en `.evidence/`.

| Subcomando | Qué exige | Qué registra |
|---|---|---|
| `record-red -- <cmd>` | Sin ciclo pendiente; el test DEBE fallar (exit ≠ 0) | `.evidence/red-green.pending.json` |
| `record-green -- <cmd>` | RED pendiente; el test DEBE pasar (exit 0) | `.evidence/red-green-<ts>.json` + puntero `.evidence/red-green.latest.json`; consume el pendiente |
| `record-triangulate -- <cmd>` | Ciclo RED→GREEN cerrado vía puntero; sin TRIANGULATE previo; pase | Campo `triangulate` dentro del JSON del ciclo |
| `record-refactor -- <cmd>` | TRIANGULATE registrado; pase | Campo `refactor`; al completarse marca el ciclo COMPLETE |

Exit codes del script: `0` solo en una fase válida del ciclo; `1` cuando se
viola un requisito de la tabla, GREEN falla o el comando ni siquiera llegó a
ejecutarse (ENOENT, EACCES — registrarlo sería fabricar evidencia); `2` en uso
inválido (falta subcomando o separador `--`). Cada corrida guarda comando
completo, exit code, signal y las últimas 20000 caracteres de stdout/stderr.
Las fases posteriores al par operan sobre el último ciclo cerrado vía el
puntero `red-green.latest.json`.

---

## review-4r

**Trigger:** revisión de código, code review, dual review, cuatro lentes.

**Qué garantiza:** hallazgos con evidencia concreta (código/línea) bajo cuatro
lentes —Readability (¿se entiende?), Reliability (¿funciona siempre?),
Resilience (¿sobrevive a producción?), Risk (¿cuánto cuesta si sale mal?)—.
Jamás aprueba por cortesía ni por jerarquía.

**Contrato de activación:** cargar cuando se pide revisar código, code review,
dual review o aplicar las lentes 4R. Cuando se pide explícitamente revisión
adversarial dual con rondas acotadas, la skill manda usar `judgment-day` y NO
duplicar métodos sobre el mismo objetivo.

Para diffs >~300 líneas o que cruzan módulos, protocolo de tres revisores:
congelar el diff objetivo (commit/SHA); lanzar tres revisores paralelos con
contexto fresco —**reliability**, **security** (variante estricta de Risk) y
**resilience**— read-only y sin compartir hallazgos durante la pasada; y un
**verificador final independiente** que deduplica, valida la evidencia contra
el diff y emite el informe único. Reglas duras: prohibida la autoaprobación
(quien escribió el cambio no puede aprobarlo, ser el único revisor ni el
verificador final); un hallazgo sin evidencia citable se degrada a INFO o se
descarta; los desacuerdos entre revisores los resuelve el humano, nunca la
autoridad del autor.

**Entradas / salidas:** entra el diff a revisar (congelado si es grande).
Sale un hallazgo por línea con formato
`[SEVERITY] file:line — evidencia — sugerencia`, severidades `BLOCKER`
(detiene el merge), `WARNING`, `SUGGESTION`, `INFO`, más veredicto único
`APPROVED | CHANGES_REQUESTED | ESCALATED`, conteo por severidad, revisores
participantes y qué NO se revisó. Sin veredicto ni hallazgos con evidencia, la
revisión no cuenta como hecha. El veredicto alimenta el recibo de
`evidence-ledger` (campo `review.method: single | review-4r-trio`).

**Modo de fallo:** revisor sin acceso de lectura al repo → detener y reportar;
no se revisa «de oído». Diff pequeño (<~50 líneas, un módulo) → basta una
pasada secuencial por las cuatro lentes. Sin script propio.

---

## evidence-ledger

**Trigger:** receipt, evidencia, ledger, cierre de misión, aceptación de
cambio.

**Qué garantiza:** toda misión P≥1 (clasificada por `workflow-router`) se
cierra con un recibo YAML verificable bajo control de versiones. Todo campo
proviene de hechos observados —comandos ejecutados, salidas reales, SHAs de
Git—; inventar o deducir campos está prohibido. El recibo cerrado es
inmutable: una corrección emite un recibo nuevo que referencia al anterior.

**Contrato de activación:** cargar al cerrar una misión, al pedir un
receipt/evidencia o al aceptar formalmente un cambio. P0 queda exento salvo
petición humana explícita. `human_approval.required` es sí para toda misión
P≥2, todo push/merge/release y todo cambio irreversible; marcarlo «no» para
evadir la aprobación está prohibido, y con aprobación requerida y no otorgada
el estado es `awaiting_approval` —declarar complete está vedado—.

La plantilla del recibo define: `mission`, `date` (ISO-8601 UTC),
`classification`, `base_sha`, `candidate_sha`, `tests` (comando, resultado con
salida observada, resumen), `review` (método, veredicto, blockers abiertos),
`scope` (`expected_files` vs `git diff --stat base..candidate`,
`unexpected_changes`), `human_approval` y `receipt_sha256`.

**Compañero mecánico:** `scripts/evidence-ledger.ts` deriva SHAs, diff y
checks directamente de Git; el exit code 0 equivale a receipt `PASS`.

| Flag | Obligatorio | Función |
|---|---|---|
| `--mission <id>` | sí | Identificador corto kebab-case de la misión |
| `--base <sha>` | sí | SHA base del diff |
| `--candidate <sha>` | no | SHA final; default `git rev-parse HEAD` |
| `--expected <n>` | no | Gate de scope: archivos cambiados deben ser exactamente n |
| `--sdd <misión>` | no | Gate SDD contra el estado de `scripts/sdd-gate.ts` |
| `--check "<label>" -- "<comando>"` | repetible | Ejecuta y registra label, comando, exit code, passed |

El veredicto `PASS` exige las cuatro condiciones juntas: la base es ancestro
del candidato, TODOS los checks pasan (y hay al menos uno), el gate SDD está
completo cuando se pidió, y el conteo de archivos coincide con `--expected`
cuando se dio. Cualquier condición fallida produce `FAIL` y exit 1.

Campos del recibo YAML en `.evidence/mission-<misión>-<ts>.yaml`: `mission`,
`recordedAt`, `repository`, `git` (baseSha, candidateSha,
baseIsAncestorOfCandidate, changedFiles, expectedFiles,
scopeMatchesExpectation, filesChanged, insertions, deletions), `verification`
(label, command, exitCode, passed), `sdd` (mission, workflow, complete,
missingStages) cuando aplica, `verdict: PASS | FAIL` y `sha256`. El hash se
calcula sobre el cuerpo SIN la última línea y se agrega al final: cualquiera
puede verificarlo recalculándolo sin ese campo.

**Modo de fallo:** falta un hecho (p. ej. sin salida de test observada) → no
cierra el recibo hasta completar la evidencia; cambios fuera del scope →
investigar antes de cerrar, revertir o justificar en `unexpected_changes`. Con
`--sdd`, si el estado de `scripts/sdd-gate.ts` no existe aborta con exit 1
(«¿corriste sdd-gate start?») y las etapas faltantes fuerzan FAIL vía
`missingStages`. Vía manual (solo si el script no aplica): YAML sin
`receipt_sha256`, hash con `sha256sum`, línea añadida al final. Una misión P≥1
que termina sin recibo se reporta como incumplimiento, no como éxito.

---

## memory-gate

**Trigger:** memoria, engram, recordar, persistir decisión, lección, gate.

**Qué garantiza:** la memoria longitudinal es una decisión explícita del
orquestador, no un volcado automático. Regla de oro: SOLO el orquestador
recupera y escribe memoria; los subagentes no acceden por su cuenta — el
orquestador inyecta lo pertinente en sus prompts autocontenidos.

**Contrato de activación:** cargar al CERRAR una tarea con descubrimientos
potenciales y al INICIAR una tarea que pueda beneficiarse de conocimiento
previo. La recuperación inicial es una consulta acotada al dominio de la
tarea, no browsing general.

Persiste solo lo que altere trabajo futuro: decisiones arquitectónicas con su
porqué, invariantes y comandos canónicos de build/test, descubrimientos
costosos y reutilizables (límites de APIs, versiones pineadas) y lecciones de
fallos verificados. Descarta salida cruda, diffs intermedios, estados de
depuración transitorios y lo que ya esté en AGENTS.md, docs del repo o el
código. Prohibido SIEMPRE: secretos o contenido de rutas sensibles (`~/.ssh`,
`.env*`, credenciales) — jamás a memoria, logs ni commits.

**Entradas / salidas:** espera descubrimientos del cierre de tarea; produce
escrituras estructuradas `contexto → decisión/descubrimiento → evidencia →
implicación` y una línea obligatoria en el reporte final:
`Memoria: N entradas persistidas, M recuperadas` (o `0, 0`).

**Modo de fallo:** si las tools `mcp__engram__*` no están disponibles, lo
declara una vez y opera sin memoria longitudinal; nunca simula escrituras. El
overlay opcional vive en `memory/engram.cordis.yml`, lo habilita
`install.sh --with-engram` y es su único compañero mecánico (no tiene script
propio).

---

## model-router

**Trigger:** modelo, routing, provider, effort, coste, capacidad, qué modelo.

**Qué garantiza:** la elección de modelo y esfuerzo es una decisión explícita
por rol y riesgo —`rol → riesgo → modelo → esfuerzo → permisos → contexto`—,
no un default silencioso. El modelo más capaz se reserva para donde la
calidad de razonamiento decide el resultado.

**Contrato de activación:** cargar al delegar (spawn/fork de subagentes) o al
iniciar una fase cuyo perfil de cómputo difiere de la sesión actual. Tabla
central: explorer/researcher usan el perfil rápido y barato; architect/spec &
design, el más capaz disponible con effort alto; implementer P1 estándar y
P2–P3 capaz con effort alto; tester estándar; reviewer con contexto fresco y
modelo DISTINTO al del implementador cuando exista alternativa; orchestrator
capaz con effort medio-alto.

Reglas duras: la independencia del revisor prima sobre el coste; el routing
NO cambia permisos ni superficie (un subagente barato no recibe más tools para
compensar); cambiar de modelo a mitad de misión exige re-verificar lo ya
producido bajo el modelo anterior.

**Entradas / salidas:** entra la delegación o fase a perfilar; sale una línea
por delegación: `routing: <rol> → <provider/model> (effort <n>)` — sin esa
línea, el default de sesión ES la decisión y debe decirse. Contrato de output
de la skill: `Routing: <fase/rol> → <modelo> (effort <nivel>, motivo breve)`.

Mecánica en DSH: el modelo de sesión lo fija `agent-default-model` en
`~/.dsh/settings.yaml`; cada preset de rol (`agents/implementer`,
`agents/reviewer`, etc.) opera sobre cualquier ruta de modelo, y la elección se
hace al crear la sesión o al delegar, nunca dentro del turno. El transporte
también se routea: `subagent` one-shot para tareas cortas y paralelas,
`subagent_fork` continuable para hijos que heredan contexto; providers externos
(`codex`, `claude-code`) exigen sus bundles instalados y auth nativa vigente.
Contexto fresco NO es otro harness: es un hijo sin las conclusiones del
implementador. `bash scripts/dream-doctor.sh` lista los proveedores realmente
instalados — esa lista, no el deseo, decide.

**Modo de fallo:** sin alternativa de modelo disponible, la limitación se
declara en el reporte. El bypass upstream de los providers externos existe y
aquí NO se monta: sería P5 encubierto. Sin script propio.

---

## autonomous-mission

**Trigger:** misión autónoma, goal, continuation, larga duración, overnight,
bounded.

**Qué garantiza:** objetivos largos corren sobre goals persistidos + jobs en
segundo plano con radio acotado. Autonomía NO es ausencia de control: es
control verificado en lugar de supervisión constante.

**Contrato de activación:** cargar cuando la tarea excede un turno
(migraciones grandes, suites de reparación, benchmarks iterativos) y el humano
pide ejecución autónoma o continuada. Requiere presets con tool-goal/jobs
disponibles en la composición (implementer u orquestador).

Límites duros, no negociables:

1. Radio acotado: `max_goal_rounds` se fija ANTES de empezar; sin límite no
   hay autonomía, hay deriva.
2. Unidad mínima verificable: cada round termina con evidencia publicada
   (test, diff, exit code). Un round sin evidencia cuenta como fallo, no como
   progreso.
3. Escalado a humano: operaciones P4/P5 (push, borrados, deploy) y decisiones
   arquitectónicas no contempladas pausan y reportan; nunca las resuelve la
   autonomía.
4. Re-clasificación: si la misión real resulta P3 y nació como P2, se detiene
   y replanifica; la autonomía no amplía alcance en silencio.
5. Blocked honesto: tras repetirse el mismo bloqueo en rounds consecutivos,
   estado `blocked` con la condición exacta; insistir distinto no es
   progreso.

**Entradas / salidas:** entra un objetivo persistido con `create_goal` y un
plan en tareas verificables (`todo_write`). El protocolo por round: leer el
estado del goal y la última evidencia (no repetir trabajo hecho), ejecutar UNA
unidad hasta evidencia verificable, publicarla y actualizar todos y memoria
(gate) solo con hechos nuevos y duraderos. Builds, suites largas y servidores
van a jobs en background (`run_in_background`); cada job se colecciona con
`job_output` antes de declarar su unidad terminada y se mata con `job_kill`
cuando dejó de importar.

Cada round cierra con un bloque YAML: `goal`, `unidad`, `evidencia` (comando →
salida clave → exit code), `siguiente` y `estado: avanzando |
awaiting_human | blocked(<condición>)`.

**Modo de fallo:** bloqueos repetidos → `blocked` con razón concreta, no
deriva. Operaciones fuera del radio → pausa y escalado. La evidencia se
registra según `tdd-evidence` y la misión cierra con `evidence-ledger`; la
memoria queda en el orquestador según `memory-gate`. Sin script propio: opera
sobre las primitivas de goal/jobs del harness.

---

## Gates mecánicos que sostienen los contratos

Tres scripts del repo convierten en gates ejecutables las secciones de la
política que las skills citan. Ninguno sustituye el criterio humano: cubren la
superficie determinable.

`scripts/security-gate.ts` — enforcement de la jerarquía P0–P5 (§3–§4):

| Modo | Función |
|---|---|
| `classify -- <comando>` | Clasifica el comando (informativo; siempre exit 0) |
| `command -- <comando>` | Bloquea patrones P5 y rutas sensibles (ver abajo) |
| `stage-check` | Pre-commit: rutas sensibles staged o claves privadas en el diff bloquean el commit |

Patrones P5 que bloquea: `rm` recursivo/forzado, `git reset --hard`,
`git clean -fdx`, push forzado (flag o refspec `+ref`), `DROP DATABASE/TABLE`,
`TRUNCATE TABLE`, `terraform destroy`, `kubectl delete`, `mkfs` y `dd
of=/dev/…`. Rutas sensibles: `.ssh/`, `.aws/`, `.gnupg/`, `.env*`, `*.pem`,
`*.key`, `*.p12`, `id_rsa*` y argumentos con forma de ruta que contengan
credential, secret o token.

Exit codes: `0` permitido · `1` bloqueado · `2` uso inválido. Escape único:
`DC_SECURITY_BYPASS="quién aprobó y cuándo"` — se audita en
`.evidence/security-gate-audit.jsonl`, y si la traza no puede escribirse, el
bypass se deniega (fail-closed). Es el contrapeso mecánico de las escalaciones
P4/P5 que `autonomous-mission` debe pausar.

`scripts/context-governor.ts` — gobernanza de contexto operativa (§7): lee el
uso real de la sesión (chunks `usage` del session log) y emite `context:ok`,
`context:warning` o `context:critical` contra la ventana (default 128000
tokens, umbrales 0.80 / 0.92). Exit codes exclusivos: `0` ok, `1` warning
(cerrar la unidad en curso), `2` critical (compactar YA, persistiendo antes lo
imprescindible por `memory-gate`), `3` sin datos de uso (limitación declarada,
nada simulado), `4` uso inválido de CLI, `5` error de infraestructura (log
ilegible). Flags: `--sessions-dir`, `--session`, `--window`, `--warning`,
`--critical`, `--evidence-dir`, `--json`. Cada evento queda en
`.evidence/context-events.jsonl` con rotación a `context-events.1.jsonl`.

`scripts/sdd-gate.ts` — gate runtime del pipeline SDD (`start`, `advance`,
`status`, `verify`): registra cada transición en `.evidence/sdd-<misión>.json`
validando que la etapa sea exactamente la siguiente del contrato; saltarse una
etapa falla mecánicamente. Exit codes: `0` OK · `1` gate violado o misión
incompleta · `2` uso inválido. Es el estado que consulta el flag `--sdd` de
`evidence-ledger.ts`.

## Presupuesto de skills

Las skills son contexto y el contexto es presupuesto (§7 de
`policy/AGENTS.md`): nunca se cargan todas. Antes de cargar, la tarea se
contrasta contra `description` y `whenToUse` de cada skill y se puntúa su
relevancia para ESTA fase; se cargan como máximo las tres más relevantes; una
skill pertinente solo para una fase posterior se difiere hasta entrar en esa
fase, sin precargar «por si acaso»; y si nada supera el umbral de relevancia
clara, se declara «sin skill aplicable» en una línea y se procede sin ellas.

El enforcement mecánico es `scripts/skill-router.ts`:

```bash
node scripts/skill-router.ts --task "texto de la tarea" \
  [--skills-dir <dir>]… [--max 3] [--json]
```

Mecánica observable del código:

- Escanea por defecto `bundles/engineering/skills` del repo y `$DSH_HOME/skills`
  si existe; `--skills-dir` es acumulable para ampliar el censo.
- Tokeniza la tarea (tokens > 2 caracteres, sin stopwords castellano/inglés) y
  puntúa cada skill: coincidencia con el `name` vale 3, con `description` o
  `whenToUse` vale 2, más un bonus de 2 cuando todas las partes del nombre
  aparecen literalmente en la tarea.
- Solo puntúan las skills con score > 0; ordena por score descendente y, a
  igualdad, alfabéticamente por nombre. Las primeras `--max` (default 3) son
  «a CARGAR ahora»; el resto de las relevantes queda deferrido hasta su fase.
- En modo texto imprime `Skills a CARGAR (n/max)` con score por skill y la
  línea de diferimiento; sin candidatas imprime exactamente
  `Sin skill aplicable — decláralo en una línea y procede sin ellas (§10)`.
  Con `--json`, `{budget, loaded, deferred}` para consumo por otros flujos.
- Exit codes: `0` siempre que los argumentos sean válidos (aunque no haya
  skills aplicables); `2` en uso inválido (`--task` vacío, `--max` menor que 1
  o argumento desconocido).

La regla de política de desempate —a igualdad de relevancia gana la más
específica— es criterio de carga del agente; el desempate mecánico del script
es alfabético. La decisión final de carga sigue siendo del orquestador, con el
ranking del router como insumo.

---

Ver también: [architecture.md](architecture.md) para cómo se compone la capa
engineering, y [troubleshooting.md](troubleshooting.md) para diagnosticar la
instalación de skills en `$DSH_HOME/skills`.
