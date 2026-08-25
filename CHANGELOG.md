# Changelog

Todos los cambios notables de este proyecto se documentan aquí.

El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/)
y el versionado respeta [Semantic Versioning](https://semver.org/lang/es/).

## [Unreleased]

### Added

- Contratos por etapa machine-readable (`contracts/direct|mini-sdd|full-sdd.json`,
  schema `schemas/stage-contract.schema.json`): cada etapa de cada workflow declara
  inputs, outputs, criterios de salida, perfil de modelo, presupuesto de contexto
  (franjas §7), tools permitidas y política de memoria. `scripts/verify-contracts.ts`
  valida forma y cruce contrato↔documento; parte del gate `pnpm verify` (9 tests).
- `scripts/context-governor.ts`: gate operativo de presión de contexto — mide el uso
  LLM real de la sesión DSH y emite `context:ok | context:warning | context:critical`
  a `.evidence/context-events.jsonl`, con umbrales alineados a la compactación nativa
  (warning 0.80 / critical 0.92) y exit codes 0/1/2/3 componibles (8 tests).
- Doctor (secciones 8–9): detección de proveedores de subagente — core spawn/fork
  verificado, externos (codex, claude-code) detectados como condicionales a la versión
  del core pineado, CLIs externas listadas; contratos validados en cada pasada.
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
- Tests unitarios de las herramientas (`bun test`, ahora 32 casos): ciclos
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
