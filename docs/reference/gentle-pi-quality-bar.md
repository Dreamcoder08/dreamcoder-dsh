# gentle-pi 2.5.0 — Evidence-Based Quality Bar

Read-only analysis of `/tmp/gentle-pi-probe` (commit `c5c9a9d`, 625 tracked files). Every claim cites a path actually read.

## 1. README & documentation

`README.md`: 981 lines / 11,379 words. Structure: problem (`:54`) → 20-row capability table (`:68`) → install/quickstart (`:115-161`) → core workflow and delegation/review decision logic (`:183-376`) → SDD/OpenSpec (`:376`) → skill registry (`:493`) → persona/model (`:562-636`) → Shell/Agents/Todo (`:636-768`) → 27-row command table (`:768`) → skills/memory/telemetry (`:827-875`) → 28-row package table (`:875`) → development (`:906`) → 7 principles (`:973`).

**Marketing vs engineering:** the 11 shields.io badges (`:3-13`) and the embedded Star History chart (`:29-37`) are marketing; so is the banner/rose surface. Everything from `:54` on is operational spec. Two deliberate stances: the README disclaims its own authority ("never derive or run those choices from this README", `:255`; "it is not an operator instruction", `:259`), and it has **no Troubleshooting section and no compatibility matrix** — compatibility is one sentence, "requires Pi 0.85.1 or newer" (`:716`), matching `peerDependencies: ">=0.85.1"`.

`docs/` = 6 files / 419 lines, all narrow and normative. `native-authority-architecture.md` (121) carries a surface→owner table, a module→production-consumer table, a quantified slimming table (baseline `origin/main`: 222 package files / 4,051,652 bytes), 9 retired modules, an explicit disambiguation of "compact-v2" vs contract `/v2` (`:27-31`), and a Windows table whose third column is literally "Supported claim" — ending "no end-to-end Windows support claim". `telemetry.md` (94) encodes **negative invariants**: "no metrics disk storage, outbox, retry, backoff, cooldown, daemon, or session reconstruction", plus a wire-field allowlist and a 1–32 row / 16 KiB bound. `skill-style-guide.md` (116) is the normative skill contract. `review-integration.md` (45) is ownership boundaries + `Buffer → Buffer/error` + a review checklist. `delegated-verification.md` (25) is a risk-tier × RDD-mode table with fail-closed branches and `outcome_source: explicit|derived|unknown`. `windows-startup-console-visibility.md` (18).

## 2. Skill system

`skills/` = 16 files / 1,428 lines: 13 `SKILL.md`, `_shared/review-ledger-contract.md`, two `references/` files. Frontmatter is fixed (`skill-creator/SKILL.md:1-8`): kebab-case `name`, one physical `description` line starting with trigger words, `license: Apache-2.0`, `metadata.author/version`. Names are prefixed `gentle-ai-*` to avoid user-skill collisions; former names are documented as retired aliases (`README.md:553`).

Section order is enforced by two artifacts — the guide and the skill: `Activation Contract`, `Hard Rules`, `Decision Gates`, `Execution Steps`, `Output Contract`, `References` (`docs/skill-style-guide.md:63`), complied with exactly in `skills/rdd-defect-workflow/SKILL.md` and `skill-creator`. LLM-first is explicit: "a runtime instruction contract for an LLM… not a tutorial, article, README, or generic checklist" (`:11`), with creation anti-patterns enumerated (`:27-31`: one-off tasks, generic documentation, rules belonging in tests/linters/code). Token discipline is numeric — "target 180–450, recommended max 700, hard max 1000" (`:79`); files run 51–202 lines. **Deviation:** `skills/issue-creation/SKILL.md` is 1,048 words (estimated ~1.4k tokens, above the guide's hard max) — stated standard, not mechanically enforced.

Progressive disclosure is real: long material moves to `judgment-day/references/prompts-and-formats.md` and `chained-pr/references/chaining-details.md`; `_shared` is excluded from the registry (`extensions/skill-registry.ts:20`). The 621-line registry writes `.atl/skill-registry.md`, scans 30+ roots, debounces a watcher at 500 ms, and "indexes skill names, full descriptions, scope, and exact `SKILL.md` paths without copying skill body rules" (`README.md:545-546`). Guarded by `tests/skill-registry.test.ts` and `tests/skill-collision-prefixes.test.ts`.

## 3. Test & verification depth

204 files / 53,896 LOC; 1,850 `test()` calls; 8,375 `assert.*`.

| Category | Path | Size | Invariant protected |
|---|---|---|---|
| Unit/contract | `tests/*.test.ts` (141) | bulk of 54k | `lib/` semantics vs vendored fixtures |
| Runtime harness | `tests/runtime-harness.mjs` | 2,396 lines / 391 asserts | real extension load; registered command/hook/flag sets |
| Dev-binary | `tests/devbinary/*.devtest.ts` (2) | 1,240 | live native-binary journeys, gated by `tests/support/native-binary-gate.ts` |
| Cross-lane | `tests/crosslane/cross-lane.mjs` | 16 | one live envelope through the pinned decoder |
| Maintainer | `tests/maintainer/*.maintest.ts` (1) | 601 | relay matrix, strict validation + env-supplied real binaries |
| Packed | `scripts/test-packed-runner.mjs` | 7 KB | `npm pack` → install → installer runs in a disposable env |
| Fixtures | `tests/fixtures/` | 53 / 280 KB | version pins `v0.10.7`, `v0.13`, `v0.14` |

**Philosophy — what it deliberately does *not* do.** No lint or typecheck script exists in `package.json`. `pnpm test` runs `node --test tests/*.test.ts && check:provider-contract && test:harness` — no network, no model, no binary required. The gates check **drift and bytes** instead: `--test-name-pattern` runs are guarded against matching zero tests (`ci.yml:73-81`); CI sets `GENTLE_PI_REQUIRE_NATIVE_BINARY=1` (`ci.yml:35`) so an absent binary fails instead of skipping; blocked maintainer checks are prefixed `known-red` rather than hidden (`README.md:944`); live lanes are "excluded from `pnpm test` and CI by construction" (`README.md:935`). It asserts **absence** (18 forbidden legacy commands, `runtime-harness.mjs:47-69`), **bidirectional drift** (`check-provider-contract.mjs:34-36`), and **hash identity** — not mocked behavior.

## 4. Contracts & provider abstraction

`contracts/` = 80 files, 78 JSON: `review-integration/{v1,v2}` and `review-provider-contract-mirror/{provider-contract.lock.json, v1.2.0/bundle/{manifest.json,schemas/*,vectors/*,orchestration/pi.md}, generated/*.baseline.json}`. The lock records per-entry SHA-256, `tree_sha256`, baseline digests, runtimes, `pi_registered: true`, and `acquisition: "field-test-local"` — explicitly *not* a release pin.

Three mechanical gates: `scripts/mirror-provider-contract.mjs:3-6` "NEVER fetches anything from the network and NEVER touches the Gentle AI release pin" and only writes the mirror after verification; `scripts/check-provider-contract.mjs:5-6` runs "completely offline" and fails when mirror, lock, schemas, vectors or baselines "disagree in any direction"; `scripts/verify-package-files.mjs` pins a `contractHashes` map, reconciles the on-disk tree both ways, refuses unpinned release digests, and cross-checks `INSTALLER_VERSION` / `RELEASE_BASE_URL` / Windows tag / `lib/gentle-ai-binary.ts:GENTLE_AI_VERSION`.

**Native authority** (`docs/native-authority-architecture.md`) assigns worktree, lineage, candidate freeze, lens selection, correction and approval to Go; the package "is a transport consumer, not a review authority" with "no durable receipt or policy authority" (`review-integration.md:5,20`); delivery stays ordinary repository policy. Nine modules were retired, and retired surfaces are tested for absence (`tests/review-controller-retired-ops.test.ts`).

## 5. Runtime, telemetry, extensions

`extensions/` = 12 files / 13,685 LOC (`gentle-ai.ts` alone 7,972). The seam is a default-export factory with injected dependencies: `runtimeMetrics(pi, env = process.env, { lookup, native, send, now } = {})` (`extensions/runtime-metrics.ts:14-16`) — injection is what enables fake-subprocess tests without a host. Reversibility is explicit: every `pi.on`/`pi.events.on` returns an unsubscribe, all released on `session_shutdown` (`runtime-metrics.ts:100`); watchers are held in a module-level `activeWatchers` Set (`extensions/skill-registry.ts:32`); telemetry spawns detached with `stdio: "ignore"`, a 3 s **unref'd** kill timer, never awaits exit, and fires "at most once per process" (`docs/telemetry.md:47`). Unknown input fails closed silently — `decodeTelemetryTriggerDecision` returns `undefined`, `spawnTelemetryTrigger` returns `{spawned:false, reason}`. Kill switches: `DO_NOT_TRACK=1`, `GENTLE_AI_TELEMETRY=0`, `CI=true`. `runtime/*.mjs` (6 / 6,053) is generated from `lib/*.ts` via `stripTypeScriptTypes`; `--check` fails on drift, so no hand-maintained duplicate exists.

## 6. Release / CI / contributor discipline

`ci.yml` (85): verify job (`pnpm test`, `check:runtime-modules`, `verify-package-files.mjs`, `test:packed-package`) plus a `windows-latest` job with three probes; all actions SHA-pinned. `publish.yml` (234): OIDC trusted publishing, npm ≥ 11.5.1, exact repository match, dispatch only from protected `main`, exact `vSemVer` tag whose peeled commit equals remote `main`, dispatch commit, checkout and `package.json.version`, rechecked immediately before publish. `prepack` = test + runtime check + package verification; `prepublishOnly` adds the packed-install test. `TRADEMARKS.md` separates MIT copyright from trademark, names the owner, requires forks to rename, disclaims Pi's marks. `dependabot.yml` + 2 issue templates.

## 7. Quantified inventory

| Area | Files | Lines | Note |
|---|---:|---:|---|
| `extensions/` | 12 | 13,685 | `gentle-ai.ts` = 7,972 |
| `lib/` | 77 | 26,117 | 6 generate `runtime/` |
| `runtime/` | 6 | 6,053 | generated, drift-checked |
| `scripts/` | 10 | ~2,200 + 31 KB | 5 are gates |
| Source subtotal | 105 | 48,056 | `.ts` + `.mjs` |
| `tests/` | 204 | 53,896 | 141 `.test.ts`, 2 `.devtest.ts`, 1 `.maintest.ts` |
| `contracts/` | 80 | — | 78 JSON + 2 MD |
| `skills/` | 16 | 1,428 | 13 `SKILL.md` |
| `docs/` | 6 | 419 | |
| `README.md` | 1 | 981 | 11,379 words |
| `openspec/` | 157 | 18,246 | 14 active changes |
| **Total** | **625** | **146,017** | all tracked text lines incl. 11,041 JSON; test:source ≈ 1.12:1 |

## 8. Ten most transferable quality mechanisms

1. **Byte-pinned provider contract mirror with bidirectional drift check.** Prevents silent host/provider divergence. `contracts/review-provider-contract-mirror/provider-contract.lock.json`, `scripts/check-provider-contract.mjs`, `scripts/mirror-provider-contract.mjs`, `scripts/verify-package-files.mjs`. Port: **moderate concept, high effort** — needs an upstream emitting a versioned bundle. Caveat: DSH/Cordis has no Go authority; nearest analogue is pinning the composition/preset schema and Inspect manifests, and the check must fail both ways or it is decoration.
2. **Generated-runtime drift gate.** Prevents a hand-edited shipped duplicate. `scripts/build-runtime-modules.mjs --check`. Port: **trivial** if plain-JS artifacts are needed; caveat: relies on Node's `stripTypeScriptTypes` (Node 24), else substitute a real bundler with pinned output.
3. **Packed-install E2E in the publish gate.** Prevents "works in the repo, broken installed". `scripts/test-packed-runner.mjs` + `prepublishOnly`. Port: **easy**; caveat: replace the Pi-specific env isolation (`GENTLE_PI_AGENT_HOME`, `PI_CODING_AGENT_DIR`), and it only matters if the harness ships as a package.
4. **Runtime harness asserting the real registration surface, including forbidden names.** Prevents dead/duplicate registrations and resurrected legacy commands. `tests/runtime-harness.mjs:47-69,355-361`. Port: **moderate** — Cordis registration is dynamic (`inject`, tools, slots), so assert against the live service/tool/slot registry rather than a discovered command map.
5. **Fixed skill section contract + numeric token budget + body-free registry.** Prevents skills decaying into prose and duplicating context. `docs/skill-style-guide.md`, `extensions/skill-registry.ts:20,272-310`. Port: **easy to adopt, hard to enforce** — DSH skills use different frontmatter, and gentle-pi itself exceeds its own hard max in `skills/issue-creation/SKILL.md`; only a lint test makes the budget real.
6. **Absence and retired-surface tests.** Prevents authority creeping back after a refactor. `tests/review-controller-retired-ops.test.ts`, `tests/native-review-authority-quarantine.test.ts`, `runtime-harness.mjs:47`. Port: **cheap**; caveat: needs a maintained list updated at each retirement or it rots.
7. **Fail-closed unknown with a provenance field.** Prevents a stale derivation being indistinguishable from a real negative. `docs/delegated-verification.md` (`outcome_source: explicit|derived|unknown`), `runtime/telemetry-trigger.mjs`. Port: **easy as a pattern**; caveat: needs a native authority able to produce the binding, else the field is unpopulated ceremony.
8. **Live lanes excluded by construction, with a CI switch that makes skips fail.** Prevents "green because nothing ran" while keeping the fast suite dependency-free. `.devtest.ts`/`.maintest.ts` naming, `tests/support/native-binary-gate.ts`, `GENTLE_PI_REQUIRE_NATIVE_BINARY=1` (`ci.yml:35`), zero-tests guard (`ci.yml:73-81`). Port: **very easy**; caveat: the default suite must stay zero-dependency or contributors stop running it.
9. **Reversible side effects behind an injected-dependency factory.** Prevents orphaned listeners, timers and watchers across sessions. `extensions/runtime-metrics.ts:14-16,100`, `extensions/skill-registry.ts:32`, `runtime/telemetry-trigger.mjs`. Port: **native fit for Cordis** — this is what `ctx.effect()`/`ctx.on()` already require, so it is conformance, not translation, and earns no differentiation.
10. **Docs stating negative invariants and grading their own confidence.** Prevents docs becoming aspirational. `docs/telemetry.md:1-6`, the "Supported claim" column in `docs/native-authority-architecture.md` ending "no end-to-end Windows support claim", `docs/review-integration.md` checklist, `README.md:255,259`. Port: **free, purely disciplinary**; caveat: unenforceable by tooling — survives only if review rejects unsupported claims.

**Marketing, explicitly:** the shields.io badges (`README.md:3-13`), the Star History chart (`:29-37`), and the banner/rose/Todo cosmetic surfaces are positioning, not quality engineering. `openspec/` (157 files) and the 28-row package-contents table are supporting infrastructure, not independent evidence.
