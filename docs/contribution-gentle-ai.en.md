# New harness target: DeepSeek Harness (DSH), with a working reference implementation

<!-- Borrador publicado como issue en Gentleman-Programming/gentle-ai (Feature Request). -->

## 💡 Problem Statement

Gentle AI installs agent environments per harness. Pi already has first-class support via `gentle-pi`, but DeepSeek Harness (DSH, https://github.com/deepseek-ai/DeepSeek-Harness) has no installation path — even though it is an ideal substrate for the Gentle-AI philosophy: DSH is built as "everything is a plugin" (stackable bundles per profile, a `cordis.patch.yml` patch layer, per-role agent presets, frontmatter skills, MCP-based memory). Much of what `gentle-pi` had to build around Pi already exists natively in DSH.

## 🚀 Proposed Solution

Add DSH as a harness target in the gga catalog. I have already implemented a complete operating layer on top of DSH (**dreamcoder-dsh**, https://github.com/Dreamcoder08/dreamcoder-dsh) that demonstrates the integration end to end and can serve as the reference implementation or as the basis for the catalog step:

- **Operating persona** (the 10-phase Gentle-AI contract: Architect → Clarify → Classify risk → Select workflow → Retrieve context → Delegate → Implement → Verify independently → Review → Publish evidence), installed globally via bundle patch.
- **Risk classification P0–P3** with minimal-safe workflows: `direct` / `mini-sdd` / `full-sdd`.
- **6 role agent presets** (`explorer`, `architect`, `implementer`, `tester`, `reviewer`, `security`) with role-scoped tool surfaces; the implementer can never approve its own work.
- **7 curated skills**: workflow-router, tdd-evidence (observable RED→GREEN capture), review-4r, evidence-ledger (Git-derived mission receipts closed with SHA256), memory-gate, model-router, autonomous-mission.
- **Long-term memory via Engram** (MCP stdio, pinned v1.20.0) with the Gentle rule: only the orchestrator reads/writes memory.
- **Verification suites** (`verify-compat`, `verify-presets`, `doctor`) that compose the profile with the same algorithm DSH uses at boot and fail loudly on upstream drift — important because DSH is in developer preview.

Installation is fully out-of-tree (`dsh plugin --profile add <bundle>` + presets + AGENTS.md + MCP overlay): zero core forks, upgradable with every DSH release.

## 🔄 Alternatives Considered

- Keep the layer Pi-only: loses DSH users and duplicates future effort as DSH adoption grows.
- Extract the generic pieces (skills, risk classification, receipts) into a package shared by both harnesses: the natural mid-term evolution; this issue can also be read as a first step in that direction.

## ✅ Additional Context

- Reference implementation: https://github.com/Dreamcoder08/dreamcoder-dsh
- DSH: https://github.com/deepseek-ai/DeepSeek-Harness
- The bundle is in daily use on my machine with green compatibility suites against a pinned DSH version.
- If this is approved, I'm happy to open the corresponding PR for the catalog step, following the issue-first workflow.
