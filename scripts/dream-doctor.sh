#!/usr/bin/env bash
# dream-doctor.sh — salud de la instalación Dreamcoder sobre DeepSeek Harness.
#
# Verifica, con evidencia observable y exit code agregado:
#   1. binarios requeridos (dsh, pnpm, node)
#   2. perfil `engineering` instalado y compuesto (dsh --dump-config)
#   3. política global instalada en $DSH_HOME/AGENTS.md
#   4. presets de agentes enlazados y componibles
#   5. skills del bundle presentes
#   6. memoria longitudinal opcional (engram) disponible
#   7. evidencia reciente (.evidence/)
#   8. proveedores de subagente (core instalados; externos opcionales detectados)
#   9. contratos por etapa (contracts/ vs workflows/)
#  10. postura de seguridad mecánica (security-gate, hook, permission mode)
#  11. gates SDD y presupuesto de skills
#  12. vanguardia (pin local vs upstream, cache offline)
#  13. procedencia de la instalación (manifiesto SHA-256 vs ~/.dsh)
#
# Uso: bash scripts/dream-doctor.sh [--profile engineering]
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
PROFILE="${2:-engineering}"
FAIL=0

ok()   { printf '  ✔ %s\n' "$1"; }
bad()  { printf '  ✘ %s\n' "$1"; FAIL=$((FAIL+1)); }
info() { printf '  · %s\n' "$1"; }

echo "==> Dreamcoder DSH doctor — perfil '$PROFILE' (DSH_HOME=$DSH_HOME)"

echo "── 1. Binarios"
for bin in dsh pnpm node; do
  if command -v "$bin" >/dev/null 2>&1; then ok "$bin: $(command -v "$bin") ($("$bin" --version 2>/dev/null | head -n1))"; else bad "falta $bin"; fi
done

echo "── 2. Perfil instalado"
if [ -f "$DSH_HOME/profiles/$PROFILE/package.json" ]; then
  ok "manifiesto del perfil: $DSH_HOME/profiles/$PROFILE/package.json"
else
  bad "perfil '$PROFILE' no instalado — ejecuta bash scripts/install.sh"
fi
DUMP="$(dsh --profile "$PROFILE" --dump-config 2>/dev/null)" && ok "composición del perfil genera (dsh --dump-config)" || { bad "la composición del perfil falla — corre pnpm verify para el detalle"; }

echo "── 3. Política global"
TARGET="$DSH_HOME/AGENTS.md"
if [ -f "$TARGET" ] && cmp -s "$TARGET" "$REPO_ROOT/policy/AGENTS.md"; then
  ok "AGENTS.md instalado e idéntico a policy/AGENTS.md"
elif [ -f "$TARGET" ]; then
  bad "$TARGET difiere de policy/AGENTS.md — reinstala o revisa el backup"
else
  bad "no existe $TARGET"
fi

echo "── 4. Presets de agentes"
for preset_dir in "$REPO_ROOT"/agents/*/; do
  role="$(basename "$preset_dir")"
  link="$DSH_HOME/.agent-presets/$role"
  if [ ! -f "$preset_dir/agent.cordis.yml" ]; then bad "preset '$role': falta agent.cordis.yml en el repo"
  elif [ -e "$link" ] || [ -L "$link" ]; then ok "preset '$role' enlazado"
  else bad "preset '$role' NO enlazado en $link"; fi
done

echo "── 5. Skills del bundle"
SKILLS_USER_DIR="${DSH_HOME:-$HOME/.dsh}/skills"
for skill in workflow-router tdd-evidence review-4r evidence-ledger memory-gate model-router autonomous-mission; do
  f="$REPO_ROOT/bundles/engineering/skills/$skill/SKILL.md"
  [ -f "$f" ] && ok "skill $skill en el repo" || bad "skill $skill ausente"
  [ -e "$SKILLS_USER_DIR/$skill/SKILL.md" ] && ok "skill $skill visible en $SKILLS_USER_DIR" || bad "skill $skill NO enlazada en $SKILLS_USER_DIR (reinstala)"
done

echo "── 6. Memoria longitudinal (opcional)"
if command -v engram >/dev/null 2>&1; then
  ok "engram: $(command -v engram)"
else
  info "engram no instalado — memoria longitudinal deshabilitada (opcional)"
fi
if grep -q "memory-engram" "$DSH_HOME/profiles/$PROFILE/cordis.patch.yml" 2>/dev/null; then
  ok "overlay Engram habilitado en el perfil"
else
  info "overlay Engram no habilitado (bash scripts/install.sh --with-engram)"
fi

echo "── 7. Evidencia reciente (.evidence/ del repo actual)"
if [ -d .evidence ] && ls .evidence/* >/dev/null 2>&1; then
  ok "$(ls .evidence | wc -l) registro(s) de evidencia en $(pwd)/.evidence"
else
  info "sin registros de evidencia en $(pwd)/.evidence todavía"
fi

echo "── 8. Proveedores de subagente (routing multi-provider)"
# Señal correcta: la COMPOSICIÓN (dsh --dump-config), no el layout de
# node_modules — que varía entre layouts pnpm/npm y es un detalle interno.
DUMP_ERR_FILE="$(mktemp)"
DUMP="$(dsh --profile "$PROFILE" --dump-config 2>"$DUMP_ERR_FILE")"
DUMP_ERR="$(cat "$DUMP_ERR_FILE" 2>/dev/null || true)"
rm -f "$DUMP_ERR_FILE"
if echo "$DUMP_ERR" | grep -q 'not found'; then
  bad "patch huérfano detectado: $(echo "$DUMP_ERR" | grep 'not found' | head -2 | tr '\n' ' ')— reinstala los paquetes (install.sh --with-external-subagents) o limpia el patch"
fi
if [ -n "$DUMP" ]; then
  for prov in spawn fork; do
    if echo "$DUMP" | grep -q "providerName: $prov"; then ok "provider '$prov' compuesto"; else bad "falta el provider '$prov' (debería venir con dsh-base)"; fi
  done
  # Externos: OPCIONALES. Instalados vía `bash scripts/install.sh --with-external-subagents`
  # (pin @next = 0.1.1-rc.x, compatible con el core moderno). El dump los
  # renderiza como filas `id: subagent-<provider>` (NO como providerName).
  # El doctor solo DETECTA — jamás se simula un routing que no existe.
  for ext in codex claude-code; do
    if echo "$DUMP" | grep -q "id: subagent-$ext\$"; then
      ok "provider externo '$ext' compuesto (routing disponible)"
    else
      info "provider externo '$ext' ausente — opcional: bash scripts/install.sh --with-external-subagents"
    fi
  done
else
  bad "no pude componer el perfil (dsh --dump-config falló) — ver sección 2"
fi
for cli in codex claude; do
  if command -v "$cli" >/dev/null 2>&1; then ok "CLI externa '$cli': $(command -v "$cli")"; else info "CLI '$cli' no instalada"; fi
done

echo "── 9. Contratos por etapa (SDD machine-readable)"
if [ -f "$REPO_ROOT/contracts/full-sdd.json" ] && [ -f "$REPO_ROOT/schemas/stage-contract.schema.json" ]; then
  ok "contracts/ + schema presentes ($(ls "$REPO_ROOT"/contracts/*.json 2>/dev/null | wc -l) contrato(s))"
else
  bad "falta contracts/ o schemas/stage-contract.schema.json en el repo"
fi
if [ -f "$REPO_ROOT/scripts/context-governor.ts" ]; then
  ok "context-governor disponible (gate de presión de contexto §7)"
else
  bad "falta scripts/context-governor.ts"
fi
# Los scripts del repo usan type-stripping nativo (≥22.18) y los tests usan
# node:test moderno; el gate exige ≥26 como el engines de package.json.
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "${NODE_MAJOR:-0}" -ge 26 ]; then
  ok "node ≥ 26 (type-stripping y node:test disponibles)"
else
  bad "node ${NODE_MAJOR:-?} < 26 — los scripts TS nativos pueden fallar; actualiza Node"
fi
if command -v node >/dev/null 2>&1 && node "$REPO_ROOT/scripts/verify-contracts.ts" >/dev/null 2>&1; then
  ok "contratos válidos y consistentes con workflows/ (verify-contracts)"
else
  bad "verify-contracts falla — corre node scripts/verify-contracts.ts para el detalle"
fi

echo "── 10. Postura de seguridad mecánica (P0–P5)"
if [ -f "$REPO_ROOT/scripts/security-gate.ts" ]; then
  ok "security-gate disponible (deny-list P5 + rutas sensibles §3–§4)"
else
  bad "falta scripts/security-gate.ts"
fi
HOOK="$REPO_ROOT/.git/hooks/pre-commit"
if [ -x "$HOOK" ] && grep -q "security-gate" "$HOOK" 2>/dev/null; then
  ok "hook pre-commit instalado (stage-check anti-secretos)"
else
  info "hook pre-commit ausente — opcional: bash scripts/install.sh --with-hooks"
fi
MODE="${DSH_PERMISSION_MODE:-workspace-write}"
if [ "$MODE" = "danger-full-access" ]; then
  bad "DSH_PERMISSION_MODE=danger-full-access — el sandbox y las aprobaciones quedan sin dientes (§3)"
else
  ok "DSH_PERMISSION_MODE=$MODE (sandbox y approval activos por defecto)"
fi

echo "── 11. Gates SDD y presupuesto de skills"
[ -f "$REPO_ROOT/scripts/sdd-gate.ts" ] && ok "sdd-gate disponible (orden de etapas exigido en runtime)" || bad "falta scripts/sdd-gate.ts"
[ -f "$REPO_ROOT/scripts/skill-router.ts" ] && ok "skill-router disponible (presupuesto máx 3, §10)" || bad "falta scripts/skill-router.ts"

echo "── 12. Vanguardia (pin vs upstream)"
GUARD="$(node "$REPO_ROOT/scripts/update-guard.ts" --offline 2>/dev/null)" && {
  echo "$GUARD" | grep -q '✔' && ok "$(echo "$GUARD" | tail -n1)" || info "update-guard: $(echo "$GUARD" | head -n1) — corre 'node scripts/update-guard.ts' con red para refrescar el cache"
} || info "update-guard no ejecutable en este entorno"

echo "── 13. Procedencia de la instalación (SHA-256)"
if [ -f "$REPO_ROOT/scripts/dream-manifest.sh" ]; then
  MANIFEST_OUT="$(bash "$REPO_ROOT/scripts/dream-manifest.sh" verify "$DSH_HOME" "$PROFILE")"
  MANIFEST_RC=$?
  case "$MANIFEST_RC" in
    0) ok "$MANIFEST_OUT" ;;
    3) info "$MANIFEST_OUT — opcional: bash scripts/install.sh lo genera" ;;
    *) bad "$MANIFEST_OUT" ;;
  esac
else
  bad "falta scripts/dream-manifest.sh (gate de procedencia §5)"
fi

echo
if [ "$FAIL" -eq 0 ]; then
  echo "✔ Doctor: instalación saludable."
  exit 0
else
  echo "✘ Doctor: $FAIL problema(s). Revisa las líneas ✘."
  exit 1
fi
