# Seguridad

La seguridad de este bundle es **mecánica, no disciplinaria**: no consiste en
pedirle al modelo que sea cuidadoso, sino en clasificar comandos contra listas
cerradas y bloquear lo irreversible sin intervención humana. La base normativa
son las secciones 3 y 4 de [`policy/AGENTS.md`](../policy/AGENTS.md); el
enforcement vive en [`scripts/security-gate.ts`](../scripts/security-gate.ts),
en los hooks de Git que instala [`scripts/install.sh`](../scripts/install.sh)
y, en estado parcial, en el puente de hooks por sesión (M14).

Límite declarado desde el inicio: esto cubre la superficie **determinable** —
patrones destructivos canónicos, rutas sensibles, secretos en diffs staged—.
No sustituye el criterio humano ni resiste a un operador malicioso con acceso
de escritura al mismo repositorio (ver [Modelo de amenazas](#modelo-de-
amenazas)).

## Jerarquía de permisos P0–P5

Toda operación se clasifica antes de ejecutarse. Ante duda entre dos niveles,
gana el más alto.

| Nivel | Permiso | Ejemplos |
|-------|---------|----------|
| P0 | READ | leer archivos, grep/glob, `git status/diff/log` |
| P1 | WRITE | crear o editar archivos dentro del workspace |
| P2 | EXECUTE-SAFE | tests, lint, build, formatters: efectos localmente reversibles |
| P3 | NETWORK | red explícita y declarada: consultar docs, instalar dependencias ya pactadas |
| P4 | EXTERNAL-WRITE | escribir fuera del workspace, `git push` normal, publicar paquetes |
| P5 | DESTRUCTIVE | irreversible o de alto radio de impacto |

## Operaciones P5

La política define la lista canónica que **requiere aprobación humana
explícita, citando el comando exacto**:

- `rm -rf` y borrados recursivos equivalentes;
- `git reset --hard`;
- `git clean -fdx`;
- `git push --force` (y variantes) sobre ramas compartidas;
- `DROP DATABASE`, `DROP TABLE`, truncados masivos;
- `terraform destroy`;
- `kubectl delete` sobre recursos con estado (PVC, namespaces, CRDs).

Reglas para P5:

1. pedir aprobación y **esperar** la respuesta humana;
2. nunca envolver una operación P5 dentro de un script mayor para ocultarla;
3. registrar quién aprobó y cuándo — mecánica en
   [Bypass auditable](#bypass-auditable).

La deny-list del gate añade dos formas destructivas de sistema que la prosa
no enumera: `mkfs` y `dd` hacia un dispositivo de bloques (`of=/dev/…`). El
criterio es el mismo nivel P5: alto radio, sin reversibilidad local.

## Rutas sensibles denegadas por defecto

Denegadas para lectura, escritura y listado sin aprobación humana explícita.
El gate evalúa estos patrones **solo sobre argumentos con forma de ruta**
(contienen separador o empiezan con punto), para no criminalizar palabras
sueltas dentro de flags:

| Patrón | Ejemplos | Motivo |
|--------|----------|--------|
| `~/.ssh/`, `~/.aws/`, `~/.gnupg/` | `cat ~/.ssh/id_rsa` | credenciales y material criptográfico personal |
| `.env`, `.env.*` | `.env`, `.env.production` | secretos de entorno |
| `*.pem`, `*.key`, `*.p12` | `server.key` | claves y certificados privados |
| `id_rsa*`, `id_ed25519*`, `id_ecdsa*` | `~/.ssh/id_ed25519` | llaves SSH |
| nombre contiene `credential` o `credentials` | `aws/credentials` | archivos de credenciales |
| nombre contiene `secret` | `secrets.yaml` | material sensible por convención |
| nombre contiene `token` | `token.json` | tokens de acceso |

Todos los patrones son case-insensitive. Si la tarea legítimamente necesita
una de estas rutas: escalar al humano nombrando ruta exacta y motivo, operar
solo tras aprobación, y nunca volcar su contenido al contexto, a logs ni a un
commit.

## security-gate en acción

[`scripts/security-gate.ts`](../scripts/security-gate.ts) tiene tres modos y
tres exit codes:

| Modo | Uso | Comportamiento |
|------|-----|----------------|
| `classify` | `classify -- <comando [args…]>` | clasifica e informa; **informativo**, siempre exit 0 con uso válido |
| `command` | `command -- <comando [args…]>` | bloquea con exit 1 si el comando es P5 o toca rutas sensibles |
| `stage-check` | `stage-check` | revisa el diff staged (lo consumen los hooks de Git) |

| Exit code | Significado |
|-----------|-------------|
| 0 | permitido |
| 1 | bloqueado |
| 2 | uso inválido |

Cómo clasifica:

- Los patrones destructivos se evalúan sobre una línea **normalizada**: los
  flags globales que consumen valor (`git -C dir`, `terraform -chdir=d`,
  `kubectl -n ns`, `psql -h …`) se separan antes, de modo que la adyacencia
  del patrón no dependa de ellos.
- Los patrones de rutas sensibles se evalúan sobre cada argumento con forma
  de ruta (ver tabla anterior).
- Si nada alcanza P5, el nivel es el máximo de una escalera informativa:
  P4 publicación externa (`git push`, `npm/pnpm publish`, `gh release`,
  `docker push`); P3 red explícita (`curl`, `wget`, `npm install|i|add`,
  `pnpm add`, `pip/go/brew install`); P2 ejecución segura reversible
  (`test`, `lint`, `build`, `fmt/format`, `typecheck`, `verify`). Un comando
  sin coincidencias se reporta como UNKNOWN y **no** se bloquea: solo P5
  bloquea.

Deny-list destructiva completa (campo `why` textual del código):

| Patrón detectado | Motivo reportado |
|------------------|------------------|
| `rm` con flags cortos `-r/-f/-R/-F` combinados | rm recursivo/forzado |
| `rm --recursive` / `rm --force` (anclado al binario) | rm recursivo/forzado |
| `git reset --hard` | git reset --hard |
| `git clean` con `-f`, `-d` o `-x` | git clean -fdx |
| `git push --force`, `--force-with-lease`, `-f` o refspec `+ref` | git push forzado (flag o refspec +ref) |
| `drop database` / `drop table` (case-insensitive) | DROP DATABASE/TABLE |
| `truncate table` | TRUNCATE TABLE (alto radio: requiere bypass auditable) |
| `terraform destroy` | terraform destroy |
| `kubectl delete` | kubectl delete (verificar recurso con estado) |
| `mkfs` (con o sin tipo de filesystem) | mkfs |
| `dd` con `of=/dev/…` | dd hacia dispositivo de bloques |

Ejemplo real (salida literal de `classify`; el modo `classify` jamás
bloquea):

```console
$ node scripts/security-gate.ts classify -- rm -rf /tmp/probe-x
nivel: P5 · bloqueado: true
motivos: rm recursivo/forzado
$ node scripts/security-gate.ts classify -- pnpm test
nivel: P2 · bloqueado: false
motivos: ejecución segura reversible
```

En modo `command`, ese mismo P5 termina con exit 1 y un mensaje
`✘ BLOQUEADO (P5): …` que nombra los motivos, exige aprobación humana
explícita (policy/AGENTS.md §3) y anuncia el escape auditable
`DC_SECURITY_BYPASS="quién aprobó y cuándo"` antes del comando. Todo evento
de bloqueo también queda registrado en la traza de auditoría.

`stage-check` (el músculo del pre-commit) revisa dos cosas sobre el índice:

1. los nombres de archivos staged (`git diff --cached --name-only`) contra
   los patrones de rutas sensibles;
2. las líneas añadidas (`git diff --cached --unified=0`, excluyendo
   `*.lock`) contra el marcador `-----BEGIN … PRIVATE KEY-----`.

Si está limpio imprime `✔ stage-check OK — N archivo(s) staged sin rutas
sensibles ni claves privadas` (exit 0); si no, nombra cada ruta sensible y/o
declara `✘ clave privada detectada en el diff staged`, cierra con
`✘ Commit bloqueado por security-gate (policy/AGENTS.md §4)` y sale 1.

## Bypass auditable

Hay exactamente un escape, y es deliberadamente incómodo:

```bash
DC_SECURITY_BYPASS="quién aprobó y cuándo" node scripts/security-gate.ts \
  command -- <comando P5 aprobado>
```

Contrato del bypass:

- el valor debe ser no-vacío (tras recortar espacios): una cadena vacía no
  habilita nada;
- el formato exigido responde **quién aprobó y cuándo** — es texto libre,
  pero su contenido es la regla de la política §3;
- cada bypass agrega una línea JSONL a
  `.evidence/security-gate-audit.jsonl` con esta forma:

```json
{"event":"bypass","at":"<ISO-8601>","user":"<USER o unknown>","command":"<cmd>","reason":"<valor del bypass>","level":"<P5>"}
```

  (la ruta `.evidence/` es relativa al directorio desde donde corre el gate).
- los bloqueos sin bypass se registran igual, con `"event":"block"` y los
  motivos concatenados.

**Fail-closed**: si la traza no puede escribirse (permisos, disco lleno), el
bypass se deniega con exit 1 y el mensaje
`✘ BYPASS DENEGADO: no se pudo escribir la traza de auditoría en .evidence/.`
— el escape exige registro; sin traza no hay escape. Con la traza escrita, el
gate avisa por stderr (`⚠ BYPASS auditado (…)`) y permite el comando.

## Hooks

```bash
bash scripts/install.sh --with-hooks
```

Instala dos hooks en `.git/hooks/` del repo (idempotente; si existe un hook
ajeno —husky, gitleaks— lo respalda con timestamp antes de reemplazarlo):

**pre-commit** — anti-secretos. Cuerpo generado:

```bash
#!/usr/bin/env bash
# Generado por scripts/install.sh --with-hooks (policy/AGENTS.md §4).
exec node "$(git rev-parse --show-toplevel)/scripts/security-gate.ts" stage-check
```

Impide commitear rutas sensibles o claves privadas en el diff staged; el
commit muere con el exit 1 de `stage-check`.

**pre-push** — nada sale del repo sin la suite en verde (policy §5: sin
evidencia no está hecho; el push es P4 EXTERNAL-WRITE). Cuerpo generado:

```bash
#!/usr/bin/env bash
# Generado por scripts/install.sh --with-hooks (policy/AGENTS.md §5).
set -e
ROOT="$(git rev-parse --show-toplevel)"
echo "==> pre-push: suite completa antes de publicar…"
node "$ROOT/scripts/security-gate.ts" stage-check
cd "$ROOT" && pnpm test
```

O sea: re-chequeo de secretos **más** `pnpm test` completo; cualquier fallo
cancela el push.

## Puente Claude Code (M14)

El enforcement hasta aquí ocurre fuera de la sesión (hooks de Git). El puente
M14 lo lleva **dentro** de cada sesión: un hook `PreToolUse(Bash)` del
dialecto Claude Code, ejecutado por el bridge upstream
`@deepseek-ai/dsh-hooks-claude-code`, decide cada comando de shell con su
exit code. La decisión la toma siempre
[`scripts/cc-hook-guard.ts`](../scripts/cc-hook-guard.ts), que delega en el
security-gate — no el modelo.

Plantilla:
[`hooks/claude-hooks.template.json`](../hooks/claude-hooks.template.json)
(matcher `Bash`, comando `node @REPO_ROOT@/scripts/cc-hook-guard.ts`,
timeout 30). `install.sh --with-hook-bridge[=<checkout DSH>]` (o `DSH_CHECKOUT`)
renderiza la plantilla sustituyendo `@REPO_ROOT@` hacia
`$DSH_HOME/hooks/dreamcoder-hooks.json` y añade la fila del bridge al patch
del perfil, validando la composición con rollback si rompe.

Tabla de decisión del guard (payload JSON por stdin):

| Situación | Exit | Nota |
|-----------|------|------|
| tool ≠ Bash, payload vacío/malformado, comando vacío | 0 | fail-open declarado: fuera del contrato del gate |
| gate corrió y reporta `bloqueado: true` | 2 | stderr accionable al modelo: nombra policy §3–§4, el comando (máx. 300 chars) y el escape `DC_SECURITY_BYPASS` |
| gate no corrió limpio (crash, timeout 15 s, binario ausente) | 0 o 2 | según `CC_HOOK_GUARD_FAIL_MODE`: `open` (default) permite declarándolo en stderr; `closed` bloquea |

Estado actual (roadmap M14 del README): el guard está **listo** —script,
plantilla y flag de instalación— pero la activación del puente está
**bloqueada por empaquetado upstream**: `@deepseek-ai/dsh-hooks-claude-code`
declara dependencias `workspace:^` sobre paquetes sin publicar en npm,
imposibles de resolver fuera del monorepo DSH. El instalador falla ruidoso
nombrando el paquete; el puente se reactiva cuando upstream publique. El
enforcement vigente mientras tanto: pre-commit/pre-push más la invocación
directa del gate. El bench journey `j8` verifica los exit codes del guard.

## Modelo de amenazas

Cubre:

- errores del agente u operador al lanzar comandos destructivos canónicos
  (`rm -rf`, resets duros, drops, etc.);
- filtrado de secretos y claves privadas antes de que entren a un commit;
- visibilidad: toda operación bloqueada y todo bypass quedan con traza
  fecha+usuario en `.evidence/security-gate-audit.jsonl`;
- presión por sesión vía PreToolUse cuando el puente esté activo.

No cubre (fuera de alcance declarado):

- **usuario malicioso con acceso al mismo repo/máquina**: puede editar la
  deny-list, borrar los hooks de Git (locales y editables por diseño) o
  correr el comando sin pasar por el gate;
- código arbitrario que ejecute operaciones P5 *dentro* de un proceso
  permitido (p. ej. un script de build que internamente borre archivos): el
  gate clasifica la línea de comando, no el efecto;
- exfiltración por canales no inspeccionados ni análisis de contenido de
  archivos que no sean diffs staged;
- operaciones P3/P4 legítimas pero arriesgadas (instalar dependencias,
  publicar): son etiquetas informativas, no bloqueos.

El bypass existe porque hay operaciones P5 legítimas; la garantía que ofrece
este sistema no es imposibilidad sino **trazabilidad obligatoria**. Lo no
determinable escala a aprobación humana, que sigue siendo la autoridad final.

## Ver también

- [`policy/AGENTS.md`](../policy/AGENTS.md) — secciones 3 (permisos) y 4
  (rutas sensibles): la norma que este aparato hace cumplir.
- [Evidencia y receipts](evidence.md) — el bypass deja traza; la trazabilidad
  es una forma de evidencia.
- [Troubleshooting](troubleshooting.md) — diagnóstico post-instalación con
  dream-doctor, incluidos los chequeos de seguridad.
