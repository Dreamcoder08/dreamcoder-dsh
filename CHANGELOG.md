# Changelog

Todos los cambios notables de este proyecto se documentan aquí.

El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/)
y el versionado respeta [Semantic Versioning](https://semver.org/lang/es/).

## [Unreleased]

### Added (fase 2 — cableado automático)

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
    26 tests.
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
