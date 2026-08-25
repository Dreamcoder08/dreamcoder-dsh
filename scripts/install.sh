#!/usr/bin/env bash
# install.sh — instala el perfil `engineering` de Dreamcoder sobre DeepSeek Harness.
#
# Idempotente: puede ejecutarse repetidamente sin efectos residuales.
# No modifica el core de DSH ni ~/.dsh/cordis.patch.yml (la capa global del usuario).
#
# Uso:
#   bash scripts/install.sh                  # perfil + política + presets
#   bash scripts/install.sh --with-engram    # además habilita el overlay MCP Engram
#
# Orden deliberado: `dsh plugin` debe ver el perfil SIN package.json en el
# primer arranque para ejecutar initProfile, que escribe las piezas que un
# perfil necesita y que no creamos a mano (capa de patch de usuario vacía y
# pnpm-workspace.yaml con nodeLinker hoisted que aisla el perfil del
# workspace padre — sin él, pnpm resuelve hacia $HOME e instala dependencias
# ajenas). Después sobreescribimos el manifiesto con la lista completa de
# bundles (user-owned: base + web-app + engineering) y sincronizamos.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUNDLE_DIR="$REPO_ROOT/bundles/engineering"
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
PROFILE_NAME="engineering"
PROFILE_DIR="$DSH_HOME/profiles/$PROFILE_NAME"
PRESETS_DIR="$DSH_HOME/.agent-presets"

WITH_ENGRAM=false
for arg in "$@"; do
  case "$arg" in
    --with-engram) WITH_ENGRAM=true ;;
    *) echo "Argumento desconocido: $arg" >&2; exit 2 ;;
  esac
done

echo "==> Dreamcoder DSH — instalando perfil '$PROFILE_NAME'"
echo "    repo:     $REPO_ROOT"
echo "    DSH home: $DSH_HOME"

command -v dsh >/dev/null 2>&1 || { echo "ERROR: 'dsh' no está en PATH" >&2; exit 1; }
command -v pnpm >/dev/null 2>&1 || { echo "ERROR: 'pnpm' no está en PATH" >&2; exit 1; }

# ── 1. Perfil ────────────────────────────────────────────────────────────────
if [ ! -f "$PROFILE_DIR/package.json" ]; then
  echo "==> Primer arranque: inicializando perfil vía 'dsh plugin … add'"
  # Ruta absoluta: pasa intacta al forwarder de pnpm (los specs relativos se
  # re-anclan al cwd invocador, y `add` desde el checkout del bundle con una
  # ruta relativa podría auto-enlazarse).
  dsh plugin --profile "$PROFILE_NAME" add "$BUNDLE_DIR"
else
  echo "==> Perfil existente; re-sincronizando dependencia local"
  dsh plugin --profile "$PROFILE_NAME" add "$BUNDLE_DIR"
fi

# El manifiesto del repo es la fuente de verdad de la lista de bundles
# (user-owned: la resolución de cada nombre es dos-anclada, instalación DSH
# primero, así que base y web-app no necesitan ser dependencias). El spec
# `link:` es una PLANTILLA con @BUNDLE_DIR@: se resuelve a la ruta real de
# esta máquina para que el repo no contenga rutas absolutas.
sed "s|link:@BUNDLE_DIR@|link:$BUNDLE_DIR|" \
  "$REPO_ROOT/profiles/engineering/package.json" > "$PROFILE_DIR/package.json"

echo "==> Sincronizando instalación del perfil…"
dsh plugin --profile "$PROFILE_NAME" install

# ── 2. Política global (~/.dsh/AGENTS.md) ───────────────────────────────────
AGENTS_TARGET="$DSH_HOME/AGENTS.md"
AGENTS_SOURCE="$REPO_ROOT/policy/AGENTS.md"
if [ -f "$AGENTS_SOURCE" ]; then
  if [ -f "$AGENTS_TARGET" ] && ! cmp -s "$AGENTS_TARGET" "$AGENTS_SOURCE"; then
    BACKUP="$DSH_HOME/AGENTS.md.backup.$(date +%Y%m%d-%H%M%S)"
    cp "$AGENTS_TARGET" "$BACKUP"
    echo "==> Backup de AGENTS.md existente → $BACKUP"
  fi
  if [ ! -f "$AGENTS_TARGET" ] || ! cmp -s "$AGENTS_TARGET" "$AGENTS_SOURCE"; then
    cp "$AGENTS_SOURCE" "$AGENTS_TARGET"
    echo "==> Política instalada en $AGENTS_TARGET"
  else
    echo "==> Política ya instalada (sin cambios)"
  fi
else
  echo "AVISO: $AGENTS_SOURCE aún no existe; se omite el paso de política" >&2
fi

# ── 3. Agent presets (root de usuario: $DSH_HOME/.agent-presets) ────────────
mkdir -p "$PRESETS_DIR"
for preset_dir in "$REPO_ROOT"/agents/*/; do
  role="$(basename "$preset_dir")"
  [ -f "$preset_dir/agent.cordis.yml" ] || continue
  ln -sfn "$preset_dir" "$PRESETS_DIR/$role"
  echo "==> Preset '$role' enlazado en $PRESETS_DIR/$role"
done

# ── 3b. Skills (raíz de usuario por defecto: $DSH_HOME/skills) ───────────────
# dsh-skill-filesystem escanea `<dshHome>/skills` sin configuración extra, así
# que enlazar ahí cada skill mantiene el bundle libre de rutas absolutas.
SKILLS_USER_DIR="$DSH_HOME/skills"
mkdir -p "$SKILLS_USER_DIR"
for skill_dir in "$REPO_ROOT"/bundles/engineering/skills/*/; do
  skill="$(basename "$skill_dir")"
  [ -f "$skill_dir/SKILL.md" ] || continue
  ln -sfn "$skill_dir" "$SKILLS_USER_DIR/$skill"
  echo "==> Skill '$skill' enlazada en $SKILLS_USER_DIR/$skill"
done

# ── 4. Overlay de memoria longitudinal (opcional, --with-engram) ─────────────
# La capa de patch del perfil es UN documento YAML (lista de filas). El overlay
# se fusiona así:
#   - archivo vacío o `[]` → se reemplaza por la plantilla completa;
#   - ya contiene memory-engram → no-op (idempotente);
#   - contiene otras filas → fusión textual solo si el documento termina de
#     forma que un append sea válido; si no, falla ruidoso pidiendo merge
#     manual (jamás dejar una capa de patch rota en silencio).
PROFILE_PATCH="$PROFILE_DIR/cordis.patch.yml"
OVERLAY_BODY="# ── Memoria longitudinal (Engram vía MCP) — gestionado por install.sh ──
$(cat "$REPO_ROOT/memory/engram.cordis.yml")
"
if $WITH_ENGRAM; then
  command -v engram >/dev/null 2>&1 \
    || { echo "ERROR: --with-engram requiere el binario 'engram' en PATH (pin v1.20.0)" >&2; exit 1; }
  if [ ! -f "$PROFILE_PATCH" ]; then
    printf '%s\n' "$OVERLAY_BODY" > "$PROFILE_PATCH"
    echo "==> $PROFILE_PATCH creado con el overlay Engram"
  elif grep -q "memory-engram" "$PROFILE_PATCH"; then
    echo "==> Overlay Engram ya habilitado en $PROFILE_PATCH"
  elif grep -Eq '^[[:space:]]*\[[[:space:]]*\][[:space:]]*$' "$PROFILE_PATCH" \
       && [ "$(grep -cv '^[[:space:]]*\(#.*\)\?[[:space:]]*$' "$PROFILE_PATCH")" -le 1 ]; then
    printf '%s\n' "$OVERLAY_BODY" > "$PROFILE_PATCH"
    echo "==> Capa vacía reemplazada: overlay Engram instalado en $PROFILE_PATCH"
  else
    echo "ERROR: $PROFILE_PATCH tiene contenido propio y no puedo fusionarlo sin riesgo." >&2
    echo "  Añade manualmente el bloque de $REPO_ROOT/memory/engram.cordis.yml" >&2
    echo "  dentro de la lista YAML (mismo documento, sin separador ---)." >&2
    exit 1
  fi
fi

echo "==> Instalación completa. Verifica con: bun run verify (desde $REPO_ROOT)"
