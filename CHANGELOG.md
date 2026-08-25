# Changelog

Todos los cambios notables de este proyecto se documentan aquí.

El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/)
y el versionado respeta [Semantic Versioning](https://semver.org/lang/es/).

## [Unreleased]

### Added

- Enforcement nativo de gobernanza de contexto (§7/§8): override de
  `compaction-basic` con `auto: true` y sumarización routeda al modelo
  económico del perfil; la compactación por presión ya es nativa de DSH.
- Telemetría de sesiones en `scripts/dream-metrics.ts`: agrega tokens de
  entrada/salida por sesión desde `session.jsonl.zstd` (flag
  `--sessions-dir`; degrada a ceros si zstd o el log no están disponibles).
- `schemas/cordis-patch.schema.json` + modeline `yaml-language-server` en
  `cordis.patch.yml`: evita que el LSP infiera el schema equivocado
  (JSONPatch) sobre los patches cordis.
- Tests unitarios de las herramientas (`bun test`, ahora 15 casos): ciclos
  RED→GREEN de `scripts/red-green.ts`, recibos PASS/FAIL/scope de
  `scripts/evidence-ledger.ts` y agregación de telemetría de
  `scripts/dream-metrics.ts`.
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
