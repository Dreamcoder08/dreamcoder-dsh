# Dreamcoder DSH

Capa operativa de ingeniería (filosofía Gentle-AI) como **bundle out-of-tree** de
DeepSeek Harness, sin modificar el core de DSH.

## Arquitectura

```text
        Gentle-AI philosophy + engineering policy
                        │
          @dreamcoder/dsh-engineering-bundle   ← este repo
                        │
                DeepSeek Harness (dsh)
                        │
        ┌───────────────┼────────────────┐
     dsh base       web-app         presets/skills propios
```

- `bundles/engineering/` — bundle instalable (`dsh.bundle.patch`): persona
  operativa global (fila `system-prompt`) y registro de las skills del bundle
  (fila `skill-filesystem` → `customSkillDirs`).
- `bundles/engineering/skills/` — skills curadas: `workflow-router`,
  `tdd-evidence`, `review-4r`, `evidence-ledger`, `memory-gate`,
  `model-router`, `autonomous-mission`.
- `agents/` — seis agent presets (`explorer`, `architect`, `implementer`,
  `tester`, `reviewer`, `security`) instalados en `$DSH_HOME/.agent-presets`.
- `workflows/` — documentos de workflow: `direct`, `mini-sdd`, `full-sdd`.
- `policy/AGENTS.md` — contrato operativo global (se instala en
  `~/.dsh/AGENTS.md`, con backup). Incluye gobernanza de contexto (§7),
  routing de modelos (§8) y autonomía acotada (§9).
- `memory/engram.cordis.yml` — overlay opcional de memoria longitudinal
  (Engram vía MCP); se habilita con `install.sh --with-engram`.
- `scripts/red-green.mjs` — captura observable del ciclo RED→GREEN en
  `<repo>/.evidence/`; exit code 0 = ciclo válido.
- `scripts/evidence-ledger.mjs` — receipt de misión derivado de Git (SHAs,
  scope, checks) con SHA256 de cierre.
- `scripts/dream-doctor.sh` — salud de la instalación: binarios, perfil,
  política, presets, skills, memoria opcional.
- `profiles/engineering/` — manifiesto del perfil: bundles `base` + `web-app`
  + este bundle.
- `scripts/install.sh` — instalación idempotente del perfil.
- `scripts/verify-compat.mjs` — suite de compatibilidad contra la versión
  pineada de DSH (compone el perfil con el mismo algoritmo que el arranque).
- `scripts/verify-presets.mjs` — valida cada agent preset: sintaxis YAML,
  forma de filas y resolución de paquetes desde el perfil instalado.

## Uso

```bash
bash scripts/install.sh              # instala perfil, política y presets
bash scripts/install.sh --with-engram  # además habilita memoria Engram (requiere binario)
pnpm run verify                       # verifica la composición (dsh --dump-config)
bash scripts/dream-doctor.sh         # salud de la instalación
dsh --profile engineering            # arranca la sesión
```

Dentro de la sesión, los presets están disponibles en el selector de agentes;
la skill `workflow-router` clasifica cada tarea (P0–P3) y elige el workflow
mínimo seguro.

## Roadmap

Fases implementadas:

- **M0** baseline · **M1** identidad/política · **M2** skills/presets ·
  **M3** routing de workflows.
- **M4** memoria: gate de memoria (skill `memory-gate`) + overlay Engram
  opcional (`--with-engram`).
- **M5** TDD con evidencia: captura RED→GREEN por el script `red-green.mjs`
  (el harness observa el ciclo; el relato no basta).
- **M6** revisión: lentes 4R con contexto fresco (presets reviewer/security).
- **M7** evidence ledger: receipts derivados de Git con SHA256
  (`evidence-ledger.mjs`).
- **M8** context governor: presupuestos y reglas de compactación (política §7).
- **M9** model routing: decisión explícita rol→riesgo→modelo (política §8 +
  skill `model-router`).
- **M10** observabilidad de proceso: `dream-doctor.sh` + registros en
  `.evidence/`; métricas de sesión vía telemetry/session-query de DSH.
- **M11** autonomía acotada: goals persistidos + jobs con límites duros
  (política §9 + skill `autonomous-mission`).

Pendiente conocido: los receipts viven como scripts+skills out-of-tree; un
plugin TS propio del bundle (fila cordis que emita el recibo como evento de
sesión) queda como evolución cuando DSH estabilice su API de plugins de
terceros. El routing por fase es hoy decisión declarada del orquestador; el
pinning per-preset de modelo requiere cambios host-plane upstream.
