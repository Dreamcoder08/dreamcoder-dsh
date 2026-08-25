# Borrador de issue — Gentleman-Programming/gentle-ai

> Estado: borrador para revisión de Dreamcoder08. No publicado.
> Plantilla: Feature Request · Área: Catalog/Steps

---

**Título:** Nuevo harness objetivo: DeepSeek Harness (DSH), con implementación de referencia ya funcionando

## 💡 Problem Statement

Gentle AI instala entornos de agente por harness; hoy Pi tiene soporte
first-class vía `gentle-pi`, pero DeepSeek Harness (DSH) no tiene camino de
instalación aunque es un substrate ideal para la filosofía Gentle-AI: DSH está
construido como "everything is a plugin" (bundles apilables por perfil, capa de
patch `cordis.patch.yml`, agent presets por rol, skills con frontmatter,
memoria vía MCP). Es decir, buena parte de lo que `gentle-pi` tuvo que construir
alrededor de Pi ya existe nativamente en DSH.

## 🚀 Proposed Solution

Añadir DSH como harness objetivo del catálogo de gga. Yo ya implementé una capa
operativa completa sobre DSH (**dreamcoder-dsh**) que demuestra la integración
punto por punto y puede servir como implementación de referencia o base del
paso de catálogo:

- **Persona operativa** (contrato Gentle-AI de 10 fases: Architect → Clarify →
  Classify risk → Select workflow → Retrieve context → Delegate → Implement →
  Verify independently → Review → Publish evidence) instalada como persona
  global vía bundle.
- **Clasificación de riesgo P0–P3** con workflows mínimos seguros:
  `direct` / `mini-sdd` / `full-sdd`.
- **6 agent presets por rol** (`explorer`, `architect`, `implementer`,
  `tester`, `reviewer`, `security`) con superficie de tools acotada por rol;
  quien implementa jamás se autoaprueba.
- **7 skills curadas**: workflow-router, tdd-evidence (captura observable
  RED→GREEN), review-4r, evidence-ledger (recibos derivados de Git con SHA256),
  memory-gate, model-router, autonomous-mission.
- **Memoria longitudinal con Engram** (MCP stdio, pin v1.20.0) con regla
  Gentle: solo el orquestador lee/escribe memoria.
- **Suites de verificación** (`verify-compat`, `verify-presets`, `doctor`) que
  componen el perfil con el mismo algoritmo de arranque de DSH y fallan ruidoso
  ante drift upstream — importante porque DSH está en developer preview.

La instalación es out-of-tree (`dsh plugin --profile add <bundle>` + presets +
AGENTS.md + overlay MCP): cero forks del core, actualizable con cada versión de
DSH.

## 🔄 Alternatives Considered

- Mantener la capa solo para Pi: pierde a los usuarios de DSH y duplica esfuerzo
  futuro cuando DSH gane adopción.
- Extraer las piezas genéricas (skills, clasificación, recibos) a un paquete
  compartido por ambos harnesses: es la evolución natural a mediano plazo; este
  issue también puede leerse como el primer paso hacia ahí.

## ✅ Additional Context

- Repo de referencia: (publicar `dreamcoder-dsh`; enlace a confirmar)
- DSH: https://github.com/deepseek-ai/DeepSeek-Harness
- El bundle ya está en uso diario en mi máquina con suites de compatibilidad
  verdes contra la versión pineada de DSH.
- Si les interesa, puedo abrir el PR correspondiente al paso de catálogo
  respetando el workflow issue-first (esperando `status:approved`).

---

### Comando previsto (requiere tu aprobación explícita)

```bash
gh issue create --repo Gentleman-Programming/gentle-ai \
  --title "Nuevo harness objetivo: DeepSeek Harness (DSH), con implementación de referencia ya funcionando" \
  --body-file <draft>
```
