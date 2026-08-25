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
DUMP="$(dsh --profile "$PROFILE" --dump-config 2>/dev/null)" && ok "composición del perfil genera (dsh --dump-config)" || { bad "la composición del perfil falla — corre npm run verify para el detalle"; }

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

echo
if [ "$FAIL" -eq 0 ]; then
  echo "✔ Doctor: instalación saludable."
  exit 0
else
  echo "✘ Doctor: $FAIL problema(s). Revisa las líneas ✘."
  exit 1
fi
