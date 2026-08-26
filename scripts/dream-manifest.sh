#!/usr/bin/env bash
# dream-manifest.sh — manifiesto de procedencia SHA-256 de la instalación.
#
# Registra el estado exacto de los artefactos QUE INSTALL.SH COPIA o GENERA en
# $DSH_HOME (los enlazados por symlink —presets y skills— apuntan al propio
# repo, así que su contenido siempre coincide con la fuente por definición y
# no aportan señal de drift). El doctor verifica el manifiesto para detectar
# alteraciones posteriores a la instalación (edición manual accidental,
# restauraciones parciales de backup, escrituras de terceros).
#
# Uso:
#   dream-manifest.sh generate <DSH_HOME> <REPO_ROOT> [PROFILE]
#       Genera $DSH_HOME/.dreamcoder-manifest.sha256 con formato `sha256sum`
#       (rutas relativas a $DSH_HOME) más cabecera de procedencia
#       (commit del repo si está disponible).
#       Exit 0 con manifiesto completo; exit 1 si algún artefacto faltó
#       (se registra lo que existe y avisa por stderr).
#   dream-manifest.sh verify <DSH_HOME> [PROFILE]
#       Exit 0 si todos los archivos registrados coinciden; exit 1 e imprime
#       los archivos con drift si no; exit 3 si no hay manifiesto.
set -uo pipefail

usage() { echo "uso: dream-manifest.sh {generate|verify} ..." >&2; exit 2; }

CMD="${1:-}"; [ -n "$CMD" ] || usage; shift
case "$CMD" in
  generate|verify) ;;
  *) usage ;;
esac

DSH_HOME="${1:?falta DSH_HOME}"
REPO_ROOT="${2:-}"
PROFILE="${3:-engineering}"
MANIFEST="$DSH_HOME/.dreamcoder-manifest.sha256"

case "$CMD" in
  generate)
    [ -n "$REPO_ROOT" ] || { echo "generate requiere REPO_ROOT" >&2; exit 2; }
    # Copias y artefactos generados que install.sh deposita en $DSH_HOME.
    # Incluye el patch del perfil: es el artefacto escribible de mayor valor
    # (filas MCP con command arbitrario); su drift post-instalación DEBE verse.
    FILES=( "AGENTS.md" "profiles/$PROFILE/package.json" "profiles/$PROFILE/cordis.patch.yml" )
    LINES=()
    LINES+=("# Dreamcoder DSH — manifiesto de procedencia (generado por scripts/install.sh)")
    COMMIT="$(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || echo unknown)"
    LINES+=("# repo-commit: $COMMIT")
    LINES+=("# generated-at: $(date -u +%Y-%m-%dT%H:%M:%SZ)")
    MISSING=0
    for f in "${FILES[@]}"; do
      if [ -f "$DSH_HOME/$f" ]; then
        H="$(sha256sum "$DSH_HOME/$f" | cut -d' ' -f1)"
        LINES+=("$H  $f")
      else
        echo "AVISO: $DSH_HOME/$f no existe; queda fuera del manifiesto" >&2
        MISSING=1
      fi
    done
    TMP="$(mktemp "$MANIFEST.tmp.XXXXXX")"
    trap 'rm -f "$TMP"' EXIT
    printf '%s\n' "${LINES[@]}" > "$TMP"
    mv "$TMP" "$MANIFEST"
    trap - EXIT
    echo "manifiesto: $MANIFEST ($(grep -c '^[0-9a-f]\{64\}' "$MANIFEST") entrada(s))"
    exit "$MISSING"
    ;;
  verify)
    if [ ! -f "$MANIFEST" ]; then
      echo "sin manifiesto en $MANIFEST — ejecuta bash scripts/install.sh"
      exit 3
    fi
    DRIFT="$(cd "$DSH_HOME" && sha256sum --check "$MANIFEST" 2>&1 | grep -v ': OK$' || true)"
    if [ -z "$DRIFT" ]; then
      echo "✔ procedencia verificada: $(grep -c '^[0-9a-f]\{64\}' "$MANIFEST") archivo(s) sin drift"
      exit 0
    fi
    echo "✘ drift detectado entre $DSH_HOME y el manifiesto:"
    printf '%s\n' "$DRIFT"
    echo "  reinstala con: bash scripts/install.sh"
    exit 1
    ;;
esac
