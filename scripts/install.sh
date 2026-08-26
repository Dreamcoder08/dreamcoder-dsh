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
#   bash scripts/install.sh --with-hook-bridge[=<checkout DSH>]  # puente de hooks Claude Code (file: link local)
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
WITH_HOOK_BRIDGE=""
for arg in "$@"; do
  case "$arg" in
    --with-engram) WITH_ENGRAM=true ;;
    --with-external-subagents) WITH_EXTERNAL_SUBAGENTS=true ;;
    --with-hooks) WITH_HOOKS=true ;;
    --with-hook-bridge)
      WITH_HOOK_BRIDGE="${DSH_CHECKOUT:-$HOME/deepseek-harness}" ;;
    --with-hook-bridge=*)
      WITH_HOOK_BRIDGE="${arg#*=}" ;;
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
# La fila `memory-engram` vive en la CAPA GLOBAL del usuario
# ($DSH_HOME/cordis.patch.yml), no en el patch del perfil: una sola fuente
# para TODOS los perfiles (web, engineering, headless, dsh-tui…). DSH no
# tolera dos inserts con el mismo id en capas distintas — "duplicate loader
# entry id: memory-engram" rompe el arranque del perfil — así que esta sección
# además AUTO-REPARA instalaciones viejas que todavía la tengan en el patch
# del perfil: la retira de ahí (con backup) una vez garantizado que la capa
# global la tiene. Toda mutación se valida componiendo el perfil; si rompe,
# rollback desde backup.
GLOBAL_PATCH="$DSH_HOME/cordis.patch.yml"
PROFILE_PATCH="$PROFILE_DIR/cordis.patch.yml"
ENGRAM_BLOCK="# ── Memoria longitudinal (Engram vía MCP) — capa global, gestionado por install.sh ──
$(cat "$REPO_ROOT/memory/engram.cordis.yml")
"
if $WITH_ENGRAM; then
  command -v engram >/dev/null 2>&1 \
    || { echo "ERROR: --with-engram requiere el binario 'engram' en PATH (pin v1.20.0)" >&2; exit 1; }

  # 4.a Garantizar la fila en la capa global (idempotente). Detección ESTRICTA:
  # solo cuenta la fila real (`- id: memory-engram`), no menciones en comentarios.
  if [ -f "$GLOBAL_PATCH" ] && grep -Eq '^[[:space:]]*-[[:space:]]+id:[[:space:]]*memory-engram([[:space:]]|$)' "$GLOBAL_PATCH"; then
    echo "==> Overlay Engram ya presente en la capa global ($GLOBAL_PATCH)"
  elif [ ! -f "$GLOBAL_PATCH" ]; then
    printf '%s\n' "$ENGRAM_BLOCK" > "$GLOBAL_PATCH"
    echo "==> $GLOBAL_PATCH creado con el overlay Engram (aplica a todos los perfiles)"
  elif grep -Eq '^[[:space:]]*\[[[:space:]]*\][[:space:]]*$' "$GLOBAL_PATCH" \
       && [ "$(grep -cv '^[[:space:]]*\(#.*\)\?[[:space:]]*$' "$GLOBAL_PATCH")" -le 1 ]; then
    printf '%s\n' "$ENGRAM_BLOCK" > "$GLOBAL_PATCH"
    echo "==> Capa global vacía reemplazada: overlay Engram instalado"
  else
    # La capa global tiene filas propias: APPEND con backup y validación.
    BACKUP="$GLOBAL_PATCH.backup.$(date +%Y%m%d-%H%M%S)"
    cp "$GLOBAL_PATCH" "$BACKUP"
    printf '\n%s\n' "$ENGRAM_BLOCK" >> "$GLOBAL_PATCH"
    if dsh --profile "$PROFILE_NAME" --dump-config >/dev/null 2>&1; then
      echo "==> Overlay Engram añadido a la capa global $GLOBAL_PATCH (composición validada)"
    else
      mv "$BACKUP" "$GLOBAL_PATCH"
      echo "ERROR: el append rompió la composición; capa global restaurada desde $BACKUP." >&2
      exit 1
    fi
  fi

  # 4.b Auto-reparación: retirar la fila del patch del perfil si aún vive ahí
  # (duplicaría el id contra la capa global y rompería el arranque). Detección
  # estricta de la fila real; menciones en comentarios no cuentan.
  if grep -Eq '^[[:space:]]*-[[:space:]]+id:[[:space:]]*memory-engram([[:space:]]|$)' "$PROFILE_PATCH" 2>/dev/null; then
    BACKUP="$PROFILE_PATCH.backup.$(date +%Y%m%d-%H%M%S)"
    cp "$PROFILE_PATCH" "$BACKUP"
    if node --input-type=module -e '
import { readFileSync, writeFileSync } from "node:fs";
const [path] = process.argv.slice(1);
const lines = readFileSync(path, "utf8").split("\n");
const idIdx = lines.findIndex((l) => /^\s*- id: memory-engram\s*$/.test(l));
if (idIdx === -1) process.exit(0);
// Subir desde la fila hasta "- insert:" pasando por líneas indentadas
// (config del insert) y comentarios contiguos que encabezan el bloque.
let start = idIdx;
while (start > 0 && (/^\s/.test(lines[start - 1]) || /^#/.test(lines[start - 1]))) start--;
if (start > 0 && /^- insert:\s*$/.test(lines[start - 1])) {
  start--;
  while (start > 0 && /^#/.test(lines[start - 1])) start--;
}
// Bajar hasta la primera línea que ya no sea parte del bloque insert.
let end = idIdx + 1;
while (end < lines.length && (/^\s/.test(lines[end]) || lines[end] === "")) end++;
lines.splice(start, end - start);
writeFileSync(path, lines.join("\n"));
' "$PROFILE_PATCH"; then
      if dsh --profile "$PROFILE_NAME" --dump-config >/dev/null 2>&1 \
         && ! grep -q "memory-engram" "$PROFILE_PATCH"; then
        rm -f "$BACKUP"
        echo "==> Migración completa: fila retirada de $PROFILE_PATCH (vivía duplicada)"
      else
        mv "$BACKUP" "$PROFILE_PATCH"
        echo "AVISO: no pude retirar la fila del patch del perfil sin romperlo; restaurado." >&2
        echo "  Retírala a mano de $PROFILE_PATCH: duplica el id contra la capa global." >&2
      fi
    else
      mv "$BACKUP" "$PROFILE_PATCH"
      echo "AVISO: edición del patch del perfil falló; restaurado desde $BACKUP." >&2
    fi
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

# ── 4d. Puente de hooks dialecto Claude Code (opcional, --with-hook-bridge) ──
# Enforcement mecánico DENTRO de cada sesión: un hook PreToolUse(Bash) que
# decide con scripts/cc-hook-guard.ts (deny-list P5 §3 + rutas sensibles §4).
# El paquete del puente NO está publicado en npm: se linkea file: desde un
# checkout local de DeepSeek Harness — compromiso de portabilidad DECLARADO.
if [ -n "$WITH_HOOK_BRIDGE" ]; then
  BRIDGE_PKG="$WITH_HOOK_BRIDGE/packages/hooks/hooks-claude-code"
  if [ ! -f "$BRIDGE_PKG/package.json" ]; then
    echo "ERROR: no existe $BRIDGE_PKG — pasa el checkout con --with-hook-bridge=<ruta>" >&2
    exit 1
  fi
  echo "==> Añadiendo puente de hooks desde $BRIDGE_PKG"
  dsh plugin --profile "$PROFILE_NAME" add "file:$BRIDGE_PKG" </dev/null
  dsh plugin --profile "$PROFILE_NAME" install </dev/null

  HOOKS_DIR="$DSH_HOME/hooks"
  mkdir -p "$HOOKS_DIR"
  sed "s|@REPO_ROOT@|$REPO_ROOT|g" \
    "$REPO_ROOT/hooks/claude-hooks.template.json" > "$HOOKS_DIR/dreamcoder-hooks.json"

  BRIDGE_ROW="
# ── Puente de hooks (dialecto Claude Code) — gestionado por install.sh ──
- insert:
    - id: hooks-claude-code
      name: '@deepseek-ai/dsh-hooks-claude-code'
      config:
        configPath: $HOOKS_DIR/dreamcoder-hooks.json
"
  if grep -q 'hooks-claude-code' "$PROFILE_PATCH" 2>/dev/null; then
    echo "==> puente de hooks ya habilitado en el perfil"
  elif [ ! -f "$PROFILE_PATCH" ]; then
    printf '%s\n' "$BRIDGE_ROW" > "$PROFILE_PATCH"
    echo "==> $PROFILE_PATCH creado con el puente de hooks"
  elif grep -Eq '^[[:space:]]*\[[[:space:]]*\][[:space:]]*$' "$PROFILE_PATCH" \
       && [ "$(grep -cv '^[[:space:]]*\(#.*\)\?[[:space:]]*$' "$PROFILE_PATCH")" -le 1 ]; then
    printf '%s\n' "$BRIDGE_ROW" > "$PROFILE_PATCH"
    echo "==> Capa vacía reemplazada: puente de hooks instalado"
  else
    BACKUP="$PROFILE_PATCH.backup.$(date +%Y%m%d-%H%M%S)"
    cp "$PROFILE_PATCH" "$BACKUP"
    printf '\n%s\n' "$BRIDGE_ROW" >> "$PROFILE_PATCH"
    if dsh --profile "$PROFILE_NAME" --dump-config >/dev/null 2>&1; then
      echo "==> puente de hooks añadido a $PROFILE_PATCH (composición validada)"
    else
      mv "$BACKUP" "$PROFILE_PATCH"
      echo "ERROR: el append del puente rompió la composición; patch restaurado." >&2
      exit 1
    fi
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
