#!/usr/bin/env bash
# install.sh — instala el perfil `engineering` de Dreamcoder sobre DeepSeek Harness.
#
# Idempotente: puede ejecutarse repetidamente sin efectos residuales.
# No modifica el core de DSH ni ~/.dsh/cordis.patch.yml (la capa global del usuario).
#
# Uso:
#   bash scripts/install.sh                  # perfil + política + presets
#   bash scripts/install.sh --with-engram    # además habilita el overlay MCP Engram
#   bash scripts/install.sh --with-hooks     # además instala el hook pre-commit de seguridad
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
WITH_EXTERNAL_SUBAGENTS=false
WITH_HOOKS=false
for arg in "$@"; do
  case "$arg" in
    --with-engram) WITH_ENGRAM=true ;;
    --with-external-subagents) WITH_EXTERNAL_SUBAGENTS=true ;;
    --with-hooks) WITH_HOOKS=true ;;
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
#
# FUSIÓN IDEMPOTENTE: si el manifiesto instalado tiene dependencias propias
# (p. ej. los subagentes externos añadidos por --with-external-subagents en
# una corrida previa), se PRESERVAN; sobreescribir ciegamente las borraría y
# dejaría los overrides del patch apuntando a paquetes ausentes.
node --input-type=module -e '
import { readFileSync, writeFileSync } from "node:fs";
const [tmplPath, curPath, outPath, bundleDir] = process.argv.slice(1);
const tmpl = JSON.parse(readFileSync(tmplPath, "utf8"));
let preserved = {};
try {
  const cur = JSON.parse(readFileSync(curPath, "utf8"));
  const known = new Set(Object.keys(tmpl.dependencies ?? {}));
  for (const [name, spec] of Object.entries(cur.dependencies ?? {})) {
    if (!known.has(name)) preserved[name] = spec;
  }
} catch { /* manifiesto previo ausente o corrupto: nada que preservar */ }
const merged = {
  ...tmpl,
  dependencies: { ...(tmpl.dependencies ?? {}), ...preserved },
};
merged.dependencies = Object.fromEntries(
  Object.entries(merged.dependencies).map(([n, s]) =>
    [n, typeof s === "string" ? s.replace("link:@BUNDLE_DIR@", bundleDir) : s]),
);
writeFileSync(outPath, JSON.stringify(merged, null, 2) + "\n");
const kept = Object.keys(preserved);
if (kept.length > 0) console.log(`==> Dependencias opcionales preservadas: ${kept.join(", ")}`);
' "$REPO_ROOT/profiles/engineering/package.json" "$PROFILE_DIR/package.json" "$PROFILE_DIR/package.json" "$BUNDLE_DIR"

echo "==> Sincronizando instalación del perfil…"
dsh plugin --profile "$PROFILE_NAME" install
# ── 1b. Subagentes externos (opcional, --with-external-subagents) ───────────
# Camino de instalación documentado por los propios paquetes upstream:
# `dsh plugin --profile <name> add <pkg>`. Los providers no arrancan proceso
# alguno hasta que una tool los invoca; quitar el paquete retira el provider.
if $WITH_EXTERNAL_SUBAGENTS; then
  # Pin @next (0.1.1-rc.x): es la línea compatible con el core rc.x moderno;
  # `latest` resuelve 0.0.1-rc.1 cuyos pares exigen core 0.0.1 y romperían.
  for pkg in @deepseek-ai/dsh-subagent-codex@next @deepseek-ai/dsh-subagent-claude-code@next; do
    dsh plugin --profile "$PROFILE_NAME" add "$pkg" </dev/null
  done
  dsh plugin --profile "$PROFILE_NAME" install </dev/null
fi

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

# ── 4b. Overlay de subagentes externos (opcional, --with-external-subagents) ─
# Mismo patrón de fusión idempotente que el overlay Engram.
EXTERNAL_BODY="# ── Subagentes externos (codex / claude-code) — gestionado por install.sh ──
$(cat "$REPO_ROOT/memory/subagents-external.cordis.yml")
"
if $WITH_EXTERNAL_SUBAGENTS; then
  if [ ! -f "$PROFILE_PATCH" ]; then
    printf '%s\n' "$EXTERNAL_BODY" > "$PROFILE_PATCH"
    echo "==> $PROFILE_PATCH creado con el overlay de subagentes externos"
  elif grep -q "subagent-codex" "$PROFILE_PATCH"; then
    echo "==> Overlay de subagentes externos ya habilitado en $PROFILE_PATCH"
  elif grep -Eq '^[[:space:]]*\[[[:space:]]*\][[:space:]]*$' "$PROFILE_PATCH" \
       && [ "$(grep -cv '^[[:space:]]*\(#.*\)\?[[:space:]]*$' "$PROFILE_PATCH")" -le 1 ]; then
    printf '%s\n' "$EXTERNAL_BODY" > "$PROFILE_PATCH"
    echo "==> Capa vacía reemplazada: overlay de subagentes externos instalado"
  fi
  # El caso "patch con contenido propio" lo resuelve 4c (append-and-verify).
fi

# ── 4c. Fusión append-and-verify para overlays sobre patch con contenido ────
# Si el overlay externo sigue ausente pero el patch ya tiene filas propias
# (p. ej. Engram), se hace APPEND textual al final del documento-lista con
# backup y validación por composición; si la composición rompe, rollback.
if $WITH_EXTERNAL_SUBAGENTS && ! grep -q "subagent-codex" "$PROFILE_PATCH" 2>/dev/null && [ -f "$PROFILE_PATCH" ]; then
  BACKUP="$PROFILE_PATCH.backup.$(date +%Y%m%d-%H%M%S)"
  cp "$PROFILE_PATCH" "$BACKUP"
  printf '\n%s\n' "$EXTERNAL_BODY" >> "$PROFILE_PATCH"
  if dsh --profile "$PROFILE_NAME" --dump-config >/dev/null 2>&1; then
    echo "==> Overlay de subagentes externos añadido a $PROFILE_PATCH (composición validada)"
  else
    mv "$BACKUP" "$PROFILE_PATCH"
    echo "ERROR: el append rompió la composición; patch restaurado desde $BACKUP." >&2
    echo "  Fusiona manualmente memory/subagents-external.cordis.yml." >&2
    exit 1
  fi
fi

# ── 5. Hook pre-commit de seguridad (opcional, --with-hooks) ─────────────────
# Enforcement mecánico de policy/AGENTS.md §4: bloquea commits con rutas
# sensibles o claves privadas en el diff staged, vía scripts/security-gate.ts.
if $WITH_HOOKS; then
  HOOK="$REPO_ROOT/.git/hooks/pre-commit"
  HOOK_BODY="#!/usr/bin/env bash
# Generado por scripts/install.sh --with-hooks (policy/AGENTS.md §4).
exec node \"\$(git rev-parse --show-toplevel)/scripts/security-gate.ts\" stage-check
"
  # No pisa un pre-commit ajeno (husky/gitleaks…): hace backup con timestamp.
  if [ -f "$HOOK" ] && ! grep -q "security-gate" "$HOOK" 2>/dev/null; then
    cp "$HOOK" "$HOOK.backup.$(date +%Y%m%d-%H%M%S)"
    echo "==> pre-commit existente respaldado antes de instalar el gate"
  fi
  printf '%s' "$HOOK_BODY" > "$HOOK" && chmod +x "$HOOK"
  echo "==> hook pre-commit instalado ($HOOK)"

  # Pre-push: nada sale del repo sin la suite en verde (§5: sin evidencia no
  # está hecho). El push es P4 EXTERNAL-WRITE; este hook lo condiciona a la
  # verificación local completa.
  PUSH_HOOK="$REPO_ROOT/.git/hooks/pre-push"
  PUSH_BODY="#!/usr/bin/env bash
# Generado por scripts/install.sh --with-hooks (policy/AGENTS.md §5).
set -e
ROOT=\"\$(git rev-parse --show-toplevel)\"
echo \"==> pre-push: suite completa antes de publicar…\"
node \"\$ROOT/scripts/security-gate.ts\" stage-check
cd \"\$ROOT\" && pnpm test
"
  if [ -f "$PUSH_HOOK" ] && ! grep -q "install.sh --with-hooks" "$PUSH_HOOK" 2>/dev/null; then
    cp "$PUSH_HOOK" "$PUSH_HOOK.backup.$(date +%Y%m%d-%H%M%S)"
    echo "==> pre-push existente respaldado"
  fi
  printf '%s' "$PUSH_BODY" > "$PUSH_HOOK" && chmod +x "$PUSH_HOOK"
  echo "==> hook pre-push instalado ($PUSH_HOOK)"
fi

# ── 6. Manifiesto de procedencia (SHA-256) ───────────────────────────────────
# Registra el hash de los artefactos copiados/generados en $DSH_HOME para que
# dream-doctor.sh (sección 13) detecte drift posterior a la instalación.
MANIFEST_SCRIPT="$REPO_ROOT/scripts/dream-manifest.sh"
if [ -f "$MANIFEST_SCRIPT" ]; then
  # Degradar con AVISO, nunca abortar la instalación completa por el manifiesto
  # (generate sale 1 si algún artefacto falta; el trabajo real ya está hecho).
  if ! bash "$MANIFEST_SCRIPT" generate "$DSH_HOME" "$REPO_ROOT" "$PROFILE_NAME"; then
    echo "AVISO: manifiesto de procedencia parcial — revisa los avisos previos" >&2
  fi
else
  echo "AVISO: falta scripts/dream-manifest.sh; sin manifiesto de procedencia" >&2
fi

echo "==> Instalación completa. Verifica con: pnpm verify (desde $REPO_ROOT)"
