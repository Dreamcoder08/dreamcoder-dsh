# Changelog

Todos los cambios notables de este proyecto se documentan aquí.

El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/)
y el versionado respeta [Semantic Versioning](https://semver.org/lang/es/).

## [Unreleased]

### Changed (ronda de calidad 6 — documentación al nivel del referente)

Se tomaron los cuatro rasgos que definen la documentación de gentle-pi y se
aplicaron a la de este repo: navegación en cada doc, apertura por decisión y no
por contexto, **invariantes negativos** explícitos y **confianza autoevaluada**
con una columna que gradúa la propia afirmación.

- **README — "Estado verificado"**: tabla de métricas con el comando exacto que
  reproduce cada número. Las filas estructurales (presets, skills, contratos,
  jornadas) están atadas por gates; las de LOC se declaran **instantánea fechada**
  porque cualquier edición de un doc las mueve. Se corrigieron dos afirmaciones
  propias antes de publicarlas: la proporción documentación/scripts era falsa en
  el borrador (decía "más documentación que andamiaje") y la comparación con el
  referente se reemplazó por números medidos del mismo tipo.
- **`docs/security.md` — "Qué se sostiene y qué no"**: tabla superficie ↔
  evidencia en el código ↔ afirmación sostenida, con tres filas de evidencia
  vacía que declaran lo que el aparato NO hace (no hay guardia de sesión, no hay
  enforcement in-session, no hay resistencia a un operador hostil).
- **`docs/architecture.md` — "Quién es dueño de qué"**: tabla superficie ↔ dueño
  ↔ por qué, más el párrafo explícito de lo que este repositorio **no** posee (no
  toca el core de DSH, no publica en npm, no implementa sandbox ni aprobación, no
  tiene autoridad sobre la entrega).
- **`docs/troubleshooting.md` — "Lo que el doctor NO chequea"**: el catálogo
  efectivo de un rol, los hooks de otros repos, el enforcement in-session, la
  suite y las afirmaciones del README. Un `0` significa "instalación sana", no
  "el sistema hace todo lo que promete".
- **`docs/evidence.md` — "Lo que un receipt no prueba"**: cinco límites del
  recibo derivado de Git, incluido que acredita integridad del archivo y no
  procedencia.
- Navegación `← Volver al README` en los ocho documentos (en inglés donde el doc
  está en inglés).

Evidencia: integridad de enlaces y rutas OK; suite 216/216; métricas medidas con
los comandos publicados en el propio README.

### Fixed (ronda de calidad 5 — un falso positivo propio, cazado antes de creerlo)

- **`/dream-tools` ya no puede dar un verde falso.** Ante un agente que **no se
  unió a ningún preset**, reportaba `límite duro declarado: ninguno para este
  rol`, que se lee como "todo bien" y en realidad significa "su catálogo no es
  el de ningún rol". Ahora devuelve **error** y lo dice: el catálogo no
  corresponde a ningún rol, no hay límite que verificar, y si persiste el
  montaje está roto. Se descubrió intentando verificar la máscara con un agente
  `explorer` desechable creado desde una sonda: `agents.create` con
  `meta.agentPreset` **no** realiza el join, el agente quedó con 24 tools (MCP +
  la sonda) y `write`/`edit` ausentes — ausentes por falta de `tool-fs`, no por
  la máscara. El veredicto "MÁSCARA OK" era un falso positivo; se detectó porque
  la sonda imprimía `composedPreset`, que devolvió `(ninguno)`.
  Consecuencia documentada en el README y en `docs/architecture.md`: la máscara
  se aplica en `agent/created`, así que **depende de que el agente se una al
  preset en ese momento**; un agente que no hace ese join no la recibe. La
  verificación e2e en una sesión real de `explorer` sigue pendiente.

### Fixed (ronda de calidad 4 — una capacidad documentada que nunca existió)

- **Los comandos in-session nunca se registraron.** `/dream-doctor`,
  `/dream-status`, `/dream-presets` y `/dream-tools` estaban documentados en el
  README y "verificados" por un test con un registry simulado, pero **ninguno
  existía en una sesión real**. Causa: `host.mjs` leía el servicio con
  `ctx.get('commands')` en lugar de declararlo como dependencia. En el arranque
  del perfil el servicio todavía no está activo, y `ctx.get` **no devuelve
  servicios cuyo fiber no está activo**; el plugin se retiraba en silencio
  (`if (commands === undefined) return`, comentado como "degradación
  silenciosa"). Los paquetes que sí registran comandos lo declaran:
  `@deepseek-ai/dsh-command-goal` tiene `inject = ["commands", "goals"]`.
  Ahora `host.mjs` declara `inject: ['commands']` (en el export nombrado y en el
  default, que es el que toma el loader), lee `ctx.commands`, y si el servicio
  faltara lo reporta como **ERROR** en vez de callarse.
  Diagnóstico sobre el host vivo: la fila `dream-commands` está compuesta (dump
  línea 624), el registry acepta registros —un comando de control de una sonda
  **sí** apareció en la lista— y aun así los cuatro `dream-*` figuraban ausentes.
  El gate nuevo es `scripts/dream-commands.test.ts`: o declara `inject`, o la
  suite falla.
  **Verificado en el host vivo tras el reinicio**: `commands.list(agent)`
  devuelve `dream-doctor`, `dream-presets`, `dream-status` y `dream-tools`, y
  `standingKeyFor` monta los seis presets. Cadena completa: causa → fix →
  efecto observado en el runtime.

### Added (ronda de calidad 3 — lo que Gentleman haría)

- **`/dream-tools`: verificación del límite duro en el agente vivo.** La máscara
  de rol se aplica en `agent/created`, así que ningún gate estático —ni el
  montaje, que ocurre "sin el agente"— podía ver su efecto. El comando lee
  `tools.schemas(agent)` (el propio `Agent` es el `ScopeKey`, como en
  `dsh-tool-subagent`) y compara lo visible contra el límite declarado del rol:
  si `write`/`edit` aparecen en `explorer`, lo reporta como fuga. Cierra la única
  afirmación que quedaba sin forma de comprobarse.
  **Verificado por el operador tras el reinicio**: `/dream-presets` reporta los
  seis presets montando, y `/dream-tools` responde leyendo el scope del agente
  real (`preset: cordis`, 57 tools visibles, `límite duro declarado: ninguno
  para este rol` — correcto: el preset de autoría no declara límite). Falta
  únicamente correrlo dentro de una sesión de `explorer`/`architect`, que es
  donde el límite existe.
- **Tabla "Qué se afirma y qué no" en el README**: alcance verificado por
  capacidad y, explícitamente, lo que este repositorio NO afirma (enforcement por
  ruta, hooks sobre repos ajenos, las jornadas de bench que CI no corre, la
  ausencia de formatter). Un README que solo enumera capacidades enseña a no
  creerle a ninguna.
- **`docs/provenance.md` + gate de clasificación**: la autoría de cada skill
  queda declarada con su evidencia. El análisis comprobó que
  `evidence-ledger`, `review-4r`, `tdd-evidence` y `workflow-router` declaran
  `author: gentleman-programming` sin que **ninguno** de los dos upstreams
  (gentle-pi, historial incluido, y gentle-ai) las contenga: quedan marcadas
  `por-confirmar` en vez de esconderse, y el frontmatter no se toca porque
  cambiarlo afirmaría otra autoría igual de indemostrada.
  `scripts/provenance.test.ts` impide que una skill nueva entre sin clasificar.

### Removed

- **`biome.json`**: configuración muerta. No había script de lint ni de formato,
  no era dependencia y no aparecía en CI ni en docs — una promesa de estilo que
  nadie ejecutaba. El proyecto de referencia tampoco tiene lint ni typecheck, y
  lo declara: sus gates verifican deriva y bytes, no estilo.

### Added (ronda de calidad 2 — gates que no pueden quedar vacíos ni mentir)

- **`/dream-presets`: verificación de montaje bajo demanda.** Los tres defectos
  que impedían montar los seis presets convivieron con un "✔" en
  `verify-presets` y en el doctor, porque **ninguno de los dos monta**. El
  comando in-session `host.mjs` monta los seis roles con el mismo camino que el
  arranque de una sesión (`agentPresets.standingKeyFor`) y reporta cuál falla,
  con su motivo. Ya no hace falta una sonda dinámica artesanal para saber si un
  preset es usable. Requiere reiniciar `dsh` para registrarse.
- **Cobertura del bench declarada y verificada en las dos direcciones.**
  `bench/corpus.ts` ahora exige `requires: 'host' | 'none'` en cada jornada, sin
  default: omitirlo es un error de tipos, no una suposición. Y
  `scripts/bench-coverage.test.ts` compara la lista `--only` del workflow con el
  conjunto sin dependencia de host, de modo que una jornada nueva no pueda
  quedar fuera de CI en silencio ni una dependiente del host colarse hasta
  romper el runner. Antes, la exclusión de j4–j6 existía solo como lista
  hardcodeada más un comentario.
- **`j4` corregido y sumado a CI (5 → 6 de 8 jornadas).** Su expectativa de
  exit 3 exigía la frase `sin datos`, que emite **una sola** de las tres rutas de
  exit 3: en un clon nuevo la que se dispara es `sin sesiones`, así que
  `pnpm bench` —el gate local documentado— quedaba rojo por una razón ambiental.
  Ahora afirma el vocabulario del contrato (`limitación declarada`), y el mensaje
  de la ruta "la sesión no existe" se alineó con las otras dos, que ya lo usaban.

### Fixed (ronda de calidad — defectos que los gates no veían)

- **Los 6 agent presets no existían para el roster.** `install.sh` los
  instalaba como symlink de *directorio*, y `dsh-agent-presets` descubre con
  `readdir(…, { withFileTypes: true })` + `child.isDirectory()`
  (`lib/index.js:403`), que es `false` para un symlink: los 6 quedaban fuera del
  roster **en silencio**, con `install.sh`, `dream-doctor` y `verify-presets`
  reportándolos instalados. Ahora se crea un directorio real con archivos
  enlazados (`link_tree`), de modo que el roster los ve y el repo sigue siendo
  la fuente de verdad. Verificado en el host vivo: los 6 aparecen con
  `trust: user`.
- **Ningún preset podía montar.** Tres campos requeridos por los schemas de DSH
  faltaban o estaban mal nombrados: `persona` exige `prefix` y usaba `text`
  (campo inexistente), `tool-todo` exige `allowParallelInProgress` y
  `plan-mode` un `section` no vacío. Verificado con montaje real
  (`agentPresets.standingKeyFor`): 6/6 montan.
- **Falso drift en el manifiesto de procedencia**: en un repo sin commits,
  `git rev-parse HEAD` imprime `HEAD` y *además* falla, así que la captura
  quedaba multilínea (`"HEAD\nunknown"`); la línea huérfana hacía que
  `sha256sum --check` la marcara como mal formada y `verify` denunciaba drift
  sobre una instalación intacta. Esto tenía la suite en rojo (146 tests, 1
  fallo).
- **`dream-doctor` daba por bueno un preset instalado como symlink**, que es
  exactamente la instalación inservible; ahora exige directorio real.

### Added (ronda de calidad — verificación)

- `bundles/tool-restrict/`: paquete `@dreamcoder/dsh-tool-restrict` que aplica
  `ctx.tools.restrict({ deny })` en el scope del agente (`agent/created`,
  guardado por `composedPreset`). Cierra la afirmación falsa de `explorer` y
  `architect`: ambos montaban `dsh-tool-fs`, que registra `write`/`edit` sin
  opción de config para desactivarlos, mientras su persona decía "no tienes
  herramientas de escritura". **Estado declarado**: declarada y montada,
  verificación end-to-end del catálogo efectivo pendiente de una sesión real.
- `scripts/install-e2e.test.ts`: E2E de `install.sh` con `dsh` simulado (layout,
  idempotencia sin residuos, preservación de dependencias opcionales, fallo
  claro sin `dsh`, flag inválido). El camino primario del usuario no tenía
  ningún test.
- `scripts/preset-config.test.ts`: lint de los campos que los schemas exigen, la
  alarma temprana en CI de los tres defectos de montaje.
- `scripts/preset-restrictions.test.ts`: cruza la tabla del README contra las
  composiciones; un rol con límite de no-mutación sin máscara rompe la suite.
- `scripts/skill-contract.test.ts` + contrato declarado en
  `docs/skills-reference.md`: identidad, trigger en una línea, atribución,
  `Activation Contract`/`Output Contract`, sin H1 en el cuerpo, presupuesto de
  150–1000 palabras y skill documentada. El proyecto de referencia declara su
  guía de estilo pero no la hace cumplir; acá es mecánico.
- `scripts/claims-vs-artifacts.test.ts`: ata el pipeline de diez etapas al
  artefacto que lo declara y la versión del repo a su entrada de changelog.
- CI endurecido: acciones fijadas por SHA (con `.github/dependabot.yml` para
  mantenerlas frescas), guard anti "verde porque nada corrió" (`node --test`
  sale 0 e imprime `# fail 0` si el glob no casa nada — comprobado) con piso de
  150 tests, y `verify-contracts` como gate host-free explícito.
- `docs/reference/gentle-pi-quality-bar.md`: análisis del referente
  (gentle-pi 2.5.0) del que salió este backlog, con los mecanismos
  transferibles y su coste de portabilidad.

### Added (documentación)

- **Suite documental deep-dive**: `docs/architecture.md` ampliado (145→400
  líneas: composición del perfil, bundle Cordis entrada por entrada, presets
  con sus campos de permisos reales, contratos SDD y decisiones D1–D5
  ADR-style); `docs/skills-reference.md` reescrita como contrato por skill
  (99→450 líneas: trigger/garantía/activación/E-S/modo de fallo + tablas de
  flags y exit codes de los scripts compañeros leídos del código);
  `docs/security.md` nueva (jerarquía P0–P5, rutas sensibles, bypass
  auditable fail-closed, hooks, puente Claude Code y modelo de amenazas) y
  `docs/evidence.md` nueva (ciclo TDD observado, receipt derivado de Git,
  sdd-gate, mini-bench driven y presupuesto de contexto);
  `docs/troubleshooting.md` ampliada con tabla de los 13 chequeos reales del
  doctor y tres casos nuevos con salida verificada (EROFS del pre-push bajo
  sandbox, symlink ssh de systemd-ssh-proxy, fallo ruidoso del hook bridge);
  `CONTRIBUTING.md` con verificación local obligatoria y convenciones.
  Correcciones de consistencia: `host.mjs` anunciaba "12 chequeos" (13
  reales), roadmap M10 anotado.

### Added (fase 2 — cableado automático)

- **Comandos in-session `/dream-doctor` y `/dream-status`**: el bundle exporta
  su primer plugin host (`bundles/engineering/host.mjs`, patrón upstream
  publish.md: exports nombrados + `ctx.effect` + Service `commands`). Los
  comandos corren el tooling del repo y devuelven `CommandResult` sin salir
  de la sesión ni gastar tokens de modelo; degradan en silencio si el
  registry no está compuesto. Mecanismo verificado contra dsh 0.1.1-rc.2
  (cadena de carga: entry.ts import → unwrapExports → registry.apply).
  Requiere reinicio del proceso dsh para cargar código nuevo de bundle.
- **CI con gates mecánicos**: el job `tooling` auto-verifica la deny-list P5
  del security-gate con las mismas sondas de un operador (`git reset --hard`
  y `rm -rf` deben salir bloqueados, `pnpm test` debe clasificar P2) y corre
  `update-guard --offline`. Fallar en CI = política §3–§4 rota en el repo que
  la declara.
- **Hook pre-push** (`install.sh --with-hooks`): ningún push (P4
  EXTERNAL-WRITE) sale sin stage-check + suite completa en verde, con backup
  de hooks ajenos. Tests v2 de métricas en `dream-metrics-v2.test.ts`
  (tokens/task, rework% exacto sobre repo Git temporal, ciclos COMPLETE).

### Added

- **Enforcement mecánico de la política (misión "10/10")**:
  - `scripts/security-gate.ts` — la jerarquía P0–P5 (§3–§4) deja de ser prosa:
    clasifica comandos, bloquea P5 (`rm -rf`, `git reset --hard`, `git push
    --force`/refspec `+ref`, DROP/TRUNCATE/destroy/kubectl delete…) y rutas
    sensibles (`.env*` con sufijos múltiples, `*.pem`/`*.key`, `~/.ssh`,
    credenciales), con escape auditable y FAIL-CLOSED
    (`DC_SECURITY_BYPASS="quién aprobó"` → `.evidence/security-gate-audit.jsonl`;
    sin traza no hay bypass) y modo `stage-check` para pre-commit. Matching
    consciente de flags globales (`git -C dir`, `terraform -chdir=dir`,
    `kubectl -n ns`) y de forma de ruta para evitar falsos positivos. Hook
    instalable vía `install.sh --with-hooks` (respalda pre-commit ajeno).
    16 tests.
  - `scripts/sdd-gate.ts` — orden de etapas exigido en runtime contra los
    contratos: saltarse una etapa falla (`advance` valida el siguiente id
    esperado); re-iniciar una misión exige `--force` explícito; estado
    auditable por misión en `.evidence/sdd-*.json`.
    `evidence-ledger --sdd <misión>` niega el receipt si el SDD está
    incompleto. 5 tests (+2 de integración en evidence-ledger).
  - `scripts/skill-router.ts` — presupuesto de skills ejecutable (§10): puntúa
    relevancia tarea↔skill (nombre ×3, descripción/whenToUse ×2, bonus por
    nombre completo) y emite top-N (default 3) + diferidas. Implementado con
    ciclo TDD COMPLETE real registrado en `.evidence/`. 4 tests.
  - `red-green.ts` v2 — fases TRIANGULATE y REFACTOR del ciclo completo, con
    puntero `.evidence/red-green.latest.json` y marca `complete`.
  - `scripts/update-guard.ts` — verificación de vanguardia: pin local vs último
    tag upstream de GitHub; cache offline en `.evidence/upstream-cache.json`
    para CI; `--strict` para gates.
  - `dream-metrics.ts` v2 — tokens/task aproximado, rework % derivado de Git
    (commits fix/revert sobre últimos 100) y conteo de ciclos COMPLETE.
  - `dream-doctor.sh` v2 — 12 secciones: postura de seguridad mecánica (gate,
    hook, permission mode), gates SDD/skill-router, vanguardia offline, y
    detección de patches huérfaos ("entry not found") tras cambios upstream.
- **Installer idempotente en dependencias**: `install.sh` ya no sobreescribe
  ciegamente el manifiesto del perfil — preserva dependencias opcionales de
  corridas previas (subagentes externos) que los overrides del patch esperan.

### Fixed

- Detección de providers externos en el doctor: la composición renderiza las
  filas como `id: subagent-<provider>`, no `providerName:`.

### Added (previo)

- **Providers externos de subagente operativos** (codex / claude-code): core
  actualizado a la línea 0.1.1-rc.x, `scripts/install.sh --with-external-subagents`
  instala los paquetes pineados a `@next` y fusiona el overlay
  `memory/subagents-external.cordis.yml` con append-and-verify (backup +
  validación por composición). Política de permisos deliberada: codex
  `approve-for-me`, claude `acceptEdits` — el bypass existe upstream y esta
  capa NO lo monta. Delegación cross-engine verificada end-to-end en modo
  headless (`dsh --profile eng-headless`).
- Contratos por etapa machine-readable (`contracts/direct|mini-sdd|full-sdd.json`,
  schema `schemas/stage-contract.schema.json`): cada etapa de cada workflow declara
  inputs, outputs, criterios de salida, perfil de modelo, presupuesto de contexto
  (franjas §7), tools permitidas y política de memoria. `scripts/verify-contracts.ts`
  valida forma y cruce contrato↔documento; parte del gate `pnpm verify` (16 tests).
- `scripts/context-governor.ts`: gate operativo de presión de contexto — mide el uso
  LLM real de la sesión DSH (lectura streaming: logs de cualquier tamaño) y emite
  `context:ok | context:warning | context:critical` a `.evidence/context-events.jsonl`,
  con umbrales alineados a la compactación nativa (warning 0.80 / critical 0.92) y
  exit codes exclusivos componibles: `0` ok · `1` warning · `2` critical ·
  `3` sin datos · `4` uso inválido · `5` error de infra (14 tests).
- Doctor (secciones 8–9): proveedores de subagente validados contra la
  COMPOSICIÓN (`dsh --dump-config`, robusto ante cambios de layout pnpm/npm) —
  core spawn/fork, externos codex/claude-code y CLIs; gate de Node ≥26;
  contratos validados en cada pasada.
- Skill `model-router`: tabla de routing por TRANSPORTE (spawn one-shot / fork
  continuable / provider externo condicional) junto a la tabla de modelos.
- Política §7: la presión de contexto se mide con `scripts/context-governor.ts`
  (warning obliga a cerrar la unidad; critical obliga a compactar).
- Enforcement nativo de gobernanza de contexto (§7/§8): override de
  `compaction-basic` con `auto: true` y sumarización routeda al modelo
  económico del perfil; la compactación por presión ya es nativa de DSH.
- Telemetría de sesiones en `scripts/dream-metrics.ts`: agrega tokens de
  entrada/salida por sesión desde `session.jsonl.zstd` (flag
  `--sessions-dir`; degrada a ceros si zstd o el log no están disponibles).
- `schemas/cordis-patch.schema.json` + modeline `yaml-language-server` en
  `cordis.patch.yml`: evita que el LSP infiera el schema equivocado
  (JSONPatch) sobre los patches cordis.
- Tests unitarios de las herramientas (32 casos, runner `node --test`): ciclos
  RED→GREEN de `scripts/red-green.ts`, recibos PASS/FAIL/scope de
  `scripts/evidence-ledger.ts`, agregación de telemetría de
  `scripts/dream-metrics.ts`, contratos por etapa y governor de contexto.
- `scripts/dream-metrics.ts`: métricas de proceso de ingeniería derivadas de
  `.evidence/` (misiones por veredicto, tasa de éxito, ciclos TDD válidos/
  inválidos, pendientes) con salida humana o `--json`; aritmética entera
  exacta (BigInt).
- Política §10: carga de skills con ranking (máximo 3 por fase, difiere
  posteriores, declara "sin skill aplicable").
- CI: paso `bun test` en el job `tooling`.

### Fixed

- Tipado de tests: `@types/bun` añadido y habilitado en `tsconfig.json`
  (`types: ["node", "bun"]`) para que el typecheck cubra los archivos de test.
- Gate roto en main: `dream-metrics.test.ts` usaba `expect()` de Bun (el
  typecheck de CI fallaba) y el script `test` con argumento directorio no
  resolvía en Node 26 — ahora `node --test 'scripts/*.test.ts'` con asserts
  estándar, runtime-neutral.

## [0.2.0] - 2026-08-24

### Added

- CI (GitHub Actions): job de gate `tooling` (typecheck + integridad de
  enlaces/rutas de docs) y job best-effort `composition` que requiere una
  instalación local de `dsh`.
- `CONTRIBUTING.md`: guía issue-first con clasificación de riesgo del propio
  bundle y reglas del repo.
- Documentación reestructurada inspirada en gentle-pi: README con badges,
  problema/solución, tablas de referencia; `docs/architecture.md`,
  `docs/skills-reference.md`, `docs/troubleshooting.md`.

### Changed

- Tooling migrado íntegramente a TypeScript sobre Bun, tipado con tsgo 7.x
  (`@typescript/native-preview`).
- Skills expuestas vía la raíz de usuario por defecto de dsh-skill-filesystem
  (`$DSH_HOME/skills`): el patch ya no registra `customSkillDirs` ni rutas
  absolutas — bundle portable.
- Doctor corregido para chequear skills vía el root de usuario por defecto.

## [0.1.0] - 2026-08-24

### Added

- Bundle Cordis out-of-tree `@dreamcoder/dsh-engineering-bundle` con override
  de la fila `system-prompt` (persona operativa Gentle-AI, pipeline de diez
  etapas, reglas de evidencia y delegación).
- Siete skills curadas: `workflow-router`, `tdd-evidence`, `review-4r`,
  `evidence-ledger`, `memory-gate`, `model-router`, `autonomous-mission`.
- Seis agent presets: `explorer`, `architect`, `implementer`, `tester`,
  `reviewer`, `security`.
- Workflows `direct`, `mini-sdd`, `full-sdd` y política global
  (`policy/AGENTS.md` → `~/.dsh/AGENTS.md` con backup).
- Scripts: `install.sh` (idempotente), `dream-doctor.sh`, `red-green.ts`
  (captura RED→GREEN), `evidence-ledger.ts` (receipt Git + SHA256),
  `verify-compat.ts` y `verify-presets.ts`.
- Perfil `engineering` (bundles `base` + `web-app` + este bundle) y overlay
  opcional de memoria Engram (`install.sh --with-engram`).

[Unreleased]: https://github.com/Dreamcoder08/dreamcoder-dsh/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/Dreamcoder08/dreamcoder-dsh/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Dreamcoder08/dreamcoder-dsh/releases/tag/v0.1.0
