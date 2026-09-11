---
mission: feat-install-e2e
workflow: mini-sdd
status: active
created: 2026-09-11T06:31:27.106Z
---

# Spec — feat-install-e2e

## Propuesta breve

<!-- etapa: propuesta · outputs/criteria según contracts/mini-sdd.json -->

- **Objetivo**: que el camino de instalación (`scripts/install.sh`) tenga
  verificación automática de punta a punta y que los 6 agent presets que el
  README promete sean realmente montables por el roster de DSH.
- **Alcance**: entra `scripts/install.sh`, `scripts/dream-doctor.sh`, la
  composición de los 6 presets, el bundle (`host.mjs`, nuevo paquete
  `bundles/tool-restrict`) y los tests nuevos. Queda **fuera**: publicar en npm,
  el puente de hooks Claude Code (bloqueado upstream) y cualquier cambio al core
  de DSH.
- **Archivos esperados**: `scripts/install-e2e.test.ts`,
  `scripts/preset-restrictions.test.ts`, `scripts/preset-config.test.ts`,
  `bundles/tool-restrict/{package.json,index.mjs}`,
  `agents/*/agent.cordis.yml`, `profiles/engineering/package.json`,
  `scripts/dream-doctor.sh`, `scripts/install.sh`, `README.md`.
- **Plan de tests**: E2E de install.sh con `dsh` simulado (layout, idempotencia,
  preservación de dependencias, fallo sin dsh, flag inválido); lint de campos
  requeridos por schema; test de claim↔composición del límite de no-mutación;
  verificación autoritativa por montaje real (`standingKeyFor`).

## Confirmación

<!-- etapa: confirmacion · outputs/criteria según contracts/mini-sdd.json -->

- Confirmado por el humano: eligió "Todo, en orden de riesgo" y ese ítem
  declaraba explícitamente "Install E2E con dsh simulado + idempotencia" como
  primera prioridad.
- Autorizó además la operación P4 de reinstalar sobre `~/.dsh` ("Ejecútalo tú
  ahora") para que el fix fuera verificable en el runtime vivo.

## Implementación por unidades de trabajo

<!-- etapa: implementacion · outputs/criteria según contracts/mini-sdd.json -->

1. `fix(manifest)`: cabecera de procedencia partida por salida multilínea de
   `git rev-parse` en repo sin commits → drift falso. Evidencia TDD:
   `.evidence/red-green-1789108161894.json`.
2. `feat(install)`: los presets se enlazaban como symlink de directorio y
   `dsh-agent-presets` los descarta (`Dirent.isDirectory()` es false para un
   symlink) → los 6 eran invisibles. Ahora directorio real con archivos
   enlazados. Evidencia TDD: `.evidence/red-green-1789108756491.json`.
3. `feat(presets)`: campos de config que el schema exige y faltaban en los 6
   presets (`persona.prefix` en vez de `text`; `tool-todo.allowParallelInProgress`;
   `plan-mode.section`) — sin ellos NINGÚN preset montaba.
4. `feat(restrict)`: paquete `@dreamcoder/dsh-tool-restrict` que enmascara
   `write`/`edit` en el scope del agente, para que "sin escritura" deje de ser
   una promesa del prompt en `explorer` y `architect`.
5. `fix(doctor)`: el chequeo de presets aceptaba symlinks y reportaba salud con
   la instalación inservible.

## Verificación independiente

<!-- etapa: verificacion-independiente · outputs/criteria según contracts/mini-sdd.json -->

- **Verificación propia**: `node --test 'scripts/*.test.ts'` → 167/167, exit 0;
  `pnpm typecheck` → exit 0; `verify-compat`, `verify-presets`,
  `verify-contracts` → exit 0; `dream-doctor.sh` → exit 0; chequeo de integridad
  de docs de CI → ALL OK.
- **Verificación independiente** (subagente con contexto fresco, adversarial).
  Veredictos sobre la revisión final: suite y gates VERIFICADOS; premisa del
  symlink VERIFICADA en el código de `dsh-agent-presets` (:396, :403) y con
  prueba propia de `Dirent`; fix de `install.sh` VERIFICADO en un `DSH_HOME`
  desechable (árbol idéntico entre corridas, sin backups); ausencia de servicio
  publicado y de riesgo de máscara cruzada VERIFICADA por lectura de
  `bindScopeParent`; montaje real de los 6 presets VERIFICADO.
  **Falsificó** dos cosas de la revisión intermedia, ya corregidas: (a) la
  variante previa del plugin como subpath del bundle dejaba `explorer` y
  `architect` sin poder montar — se sustituyó por el paquete
  `@dreamcoder/dsh-tool-restrict`; (b) el README afirmaba "garantizado
  mecánicamente" y una separación implementa/verifica que `reviewer` no cumple
  (monta bash y `tool-fs`), corregido para declarar solo lo verificado.
- **Límite residual declarado**: el efecto final de la máscara —`write`/`edit`
  ausentes del catálogo efectivo en una sesión real— queda **sin verificar**,
  porque el montaje validado no crea agente y `agent/created` no se dispara. Se
  documenta así en `README.md` y `docs/architecture.md` en vez de presentarlo
  como observado. Confirmación pendiente: abrir una sesión en `explorer` y
  comprobar que `write`/`edit` no aparecen.

## Resumen de evidencia

<!-- etapa: resumen-evidencia · outputs/criteria según contracts/mini-sdd.json -->

| Unidad | Verificación | Resultado |
|---|---|---|
| fix(manifest) | `node --test scripts/dream-manifest.test.ts` | 6/6, exit 0 |
| feat(install) | `node --test scripts/install-e2e.test.ts` | 7/7, exit 0 |
| feat(presets) | `node --test scripts/preset-config.test.ts` | 7/7, exit 0 (probado en rojo) |
| feat(restrict) | `node --test scripts/preset-restrictions.test.ts` | 5/5, exit 0 |
| los 6 presets | `standingKeyFor(id)` en el host vivo | 6/6 OK |

- Suite completa antes: 146 tests / 1 fallo. Después: **167 tests / 0 fallos**.
- Todos los scripts de gate devuelven exit 0 y el árbol no tiene referencias
  obsoletas al plugin movido.
- Desvío declarado: el montaje de `explorer`/`architect` se validó con el
  paquete `@dreamcoder/dsh-tool-restrict` recién instalado; la variante anterior
  (subpath del bundle) no era montable en el proceso vivo por la caché de
  `package.json` del host, y se descartó en vez de documentarla.
