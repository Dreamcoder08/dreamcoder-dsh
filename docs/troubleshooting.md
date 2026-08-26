# Troubleshooting

Diagnóstico de la instalación de Dreamcoder DSH. La regla que gobierna este
documento es la misma del bundle: ninguna afirmación sin evidencia observable.
Cada problema arranca de un síntoma concreto (con salida literal), explica la
causa raíz y termina en un remedio verificable paso a paso.

## Primera herramienta: el doctor

```bash
bash scripts/dream-doctor.sh [--profile engineering]
```

El doctor ejecuta **13 chequeos** en orden fijo, marca cada línea con `✔`
(ok), `✘` (problema) o `·` (informativo, no afecta el resultado) y agrega todo
en el exit code: `0` instalación saludable, `1` problemas detectados. El
resumen final es literal:

```
✔ Doctor: instalación saludable.
✘ Doctor: N problema(s). Revisa las líneas ✘.
```

| # | Chequeo | Qué verifica | Remedio típico |
|---|---------|--------------|----------------|
| 1 | Binarios | `dsh`, `pnpm` y `node` presentes y en qué versión | Instalar lo que falte |
| 2 | Perfil instalado | Manifiesto del perfil en `$DSH_HOME/profiles/engineering/` y que la composición (`dsh --dump-config`) genere config | `bash scripts/install.sh`; si la composición falla, `pnpm verify` da el detalle |
| 3 | Política global | `~/.dsh/AGENTS.md` existe e idéntico a `policy/AGENTS.md` | Reinstalar; `install.sh` respalda el archivo previo |
| 4 | Presets de agentes | Cada rol bajo `agents/` tiene su `agent.cordis.yml` y está enlazado en `$DSH_HOME/.agent-presets/` | `bash scripts/install.sh` (idempotente) |
| 5 | Skills del bundle | Las siete skills existen en `bundles/engineering/skills/` y están enlazadas en `$DSH_HOME/skills/` | Reinstalar; ver caso más abajo |
| 6 | Memoria longitudinal (opcional) | Binario `engram` disponible y overlay Engram habilitado en el patch del perfil | Informativo: es opcional (`install.sh --with-engram`) |
| 7 | Evidencia reciente | Registros bajo `.evidence/` del repo actual | Informativo |
| 8 | Proveedores de subagente | Providers core `spawn` y `fork` compuestos; externos codex / claude-code detectados (opcionales); CLIs presentes | Patch huérfano: reinstalar los paquetes (`install.sh --with-external-subagents`) |
| 9 | Contratos SDD | `contracts/` + schema presentes, `scripts/context-governor.ts`, Node ≥26 y `verify-contracts` en verde | Actualizar Node o corregir contratos según la línea ✘ |
| 10 | Seguridad mecánica | `scripts/security-gate.ts` presente, hook pre-commit instalado (opcional) y `DSH_PERMISSION_MODE` ≠ `danger-full-access` | `install.sh --with-hooks`; no operar en danger-full-access |
| 11 | Gates SDD y skills | `scripts/sdd-gate.ts` y `scripts/skill-router.ts` disponibles | Restaurar los archivos señalados |
| 12 | Vanguardia | Pin local vs upstream usando el cache offline (`node scripts/update-guard.ts --offline`) | Correr el guard con red para refrescar el cache |
| 13 | Procedencia | SHA-256 de `$DSH_HOME` contra el manifiesto (`dream-manifest.sh verify`) | Regenerar el manifiesto reinstalando |

Corregí las líneas `✘` y volvé a ejecutar hasta tener las 13 en verde antes de
culpar a cualquier otra cosa.

## Problemas comunes

### El push falla: los tests mueren con `EROFS` en `mkdtemp`

**Síntoma.** Con el hook pre-push instalado (`install.sh --with-hooks`), todo
`git push` corre primero `stage-check` + `pnpm test`. La suite arranca —el
banner del hook es literal— y muere con errores como:

```
==> pre-push: suite completa antes de publicar…
EROFS: read-only file system, mkdtemp '/home/dreamcoder08/.tmp/probe-dsh-doc-XXXXXX'
```

(El prefijo del directorio varía según la suite: `dsh-ledger-…`,
`skill-router-…`, `sdd-gate-…`. Salida capturada creando un directorio
temporario directamente sobre `$TMPDIR`.) El push se cancela porque el hook
sale distinto de cero.

**Causa.** Los tests crean sus workspaces con `mkdtempSync(join(tmpdir(), …))`
y `os.tmpdir()` respeta `$TMPDIR`. En este entorno `TMPDIR` apunta a `~/.tmp`,
que queda **fuera del workspace**: el sandbox en modo `workspace-write` la ve
de solo lectura y `mkdtemp` explota con `EROFS`.

**Remedio.** Apuntar `TMPDIR` a un directorio dentro del repo (`.tmp/` ya está
en `.gitignore`):

```bash
mkdir -p .tmp
TMPDIR="$PWD/.tmp" git push      # para ese push
# o exportalo en la sesión si vas a correr tests seguido:
export TMPDIR="$PWD/.tmp"
```

El mismo remedio aplica aunque no empujes: cualquier `pnpm test` corrido desde
una sesión sandboxeada necesita un `TMPDIR` dentro del workspace.

### ssh rechaza `20-systemd-ssh-proxy.conf`

**Síntoma.** Operaciones Git remotas (push, fetch, clone por SSH) abortan con
un error de configuración que nombra
`/etc/ssh/ssh_config.d/20-systemd-ssh-proxy.conf`.

**Causa.** Ese archivo es un symlink gestionado por systemd y su dueño es
`nobody`, no tu usuario (listado real):

```text
lrwxrwxrwx 1 nobody nobody  63 Jul 23 12:43 20-systemd-ssh-proxy.conf -> ../../../usr/lib/systemd/ssh_config.d/20-systemd-ssh-proxy.conf
```

Desde una sesión sandboxeada, ssh no puede procesar ese include del
`/etc/ssh/ssh_config.d/` y corta la conexión antes de autenticar.

**Remedio.** Pasarle a ssh un config propio hace que ignore el archivo global
completo (semántica de `-F` en `ssh(1)`), y desactivar multiplexado evita
sockets de control fuera del workspace:

```bash
GIT_SSH_COMMAND="ssh -F ~/.ssh/config -o ControlMaster=no -o ControlPath=none" git push
```

Exportalo en la sesión si vas a hacer varias operaciones remotas.

### El instalador del hook bridge falla nombrando `@deepseek-ai/dsh-hooks-claude-code`

**Síntoma.** Con `install.sh --with-hook-bridge[=<checkout>]` hay dos fallos
posibles, ambos ruidosos. Sin valor explícito, el flag usa `$DSH_CHECKOUT` o,
por defecto, `~/deepseek-harness`:

1. Si la ruta pasada no contiene el paquete, el mensaje es exactamente:

   ```
   ERROR: no existe <checkout>/packages/hooks/hooks-claude-code — pasa el checkout con --with-hook-bridge=<ruta>
   ```

2. Si el checkout es correcto, la instalación avanza hasta añadir el paquete y
   muere con un error de resolución que nombra
   `@deepseek-ai/dsh-hooks-claude-code`.

**Causa.** El segundo caso **no es un bug tuyo**: el paquete del puente declara
dependencias `workspace:^` de paquetes que upstream todavía no publicó en npm,
imposibles de resolver fuera del monorepo de DeepSeek Harness. Es una
limitación declarada del bundle (M14 del roadmap) mientras upstream publique.

**Remedio.**

1. Nada que reparar localmente: no insistas ni fuerces el enlace.
2. Si pasaste el flag por accidente, reinstalá sin él: el resto de la
   instalación es idempotente y queda usable.
3. El enforcement interno del puente ya está en el repo
   (`scripts/cc-hook-guard.ts` + plantilla de hooks); se activa solo cuando
   upstream publique el paquete.

### El instalador falla con "requiere el binario 'engram'"

**Síntoma** (literal de `scripts/install.sh`):

```
ERROR: --with-engram requiere el binario 'engram' en PATH (pin v1.20.0)
```

**Causa.** `--with-engram` verifica que el binario exista antes de escribir el
overlay; sin él, aborta en vez de dejar una capa de patch rota.

**Remedio.** Instalá `engram` v1.20.0 primero, o ejecutá `install.sh` sin el
flag: el overlay es opcional y la sesión opera sin memoria longitudinal
declarándolo una vez — jamás se simula memoria que no existe.

### Una skill no aparece en la sesión

1. Corré el doctor y mirá el chequeo 5 (skills en repo + enlace en usuario).
2. Verificá el enlace directamente: `ls -la "$DSH_HOME/skills/"`.
3. Si falta, re-ejecutá `bash scripts/install.sh` — es idempotente.

Las skills se exponen vía la raíz de usuario por defecto de dsh-skill-filesystem
(`$DSH_HOME/skills`), no vía rutas absolutas del bundle; el symlink apunta al
repo, así que editar el `SKILL.md` alcanza sin reinstalar. Si editaste el patch
a mano, asegurate de no haber reintroducido `customSkillDirs`.

### La persona operativa no se aplica

El override `system-prompt` **reemplaza la config completa** de la fila (no hay
deep-merge). Si otro bundle o un cambio upstream añadió campos a esa config,
este bundle debe restituirlos explícitamente. Diagnóstico:

```bash
dsh --profile engineering --dump-config | less   # inspecciona la fila system-prompt
```

`pnpm verify` (verify-compat) compone el perfil con el mismo algoritmo que el
arranque y detecta este tipo de ruptura contra la versión pineada de DSH.

### Un preset falla al cargar

```bash
node scripts/verify-presets.ts
```

Valida sintaxis YAML, forma de filas y resolución de paquetes desde el perfil
instalado. Causa típica: preset instalado desactualizado respecto al repo —
re-ejecutá `install.sh` (también lo cubre el chequeo 4 del doctor).

### DSH se actualizó y algo rompió

El repo opera contra una versión compatible de DSH y lo verifica contra el tag
upstream. Tras una actualización de dsh:

```bash
git pull                                  # trae posibles re-pins del bundle
node scripts/update-guard.ts              # pin local vs último tag upstream
pnpm verify                               # compatibilidad contra lo instalado
```

`update-guard` acepta `--offline` (reporta contra el cache en
`.evidence/upstream-cache.json`, es lo que usa el doctor y CI) y `--strict`
(exit 1 si hay versión nueva). Si `verify` falla con una versión nueva de DSH,
el fix pertenece a este repo (actualizar overrides/pin), no a tu instalación
local.

### Residuos de una instalación previa

El instalador respalda antes de sobreescribir, con timestamp:

- `$DSH_HOME/AGENTS.md.backup.<timestamp>` — política previa distinta.
- `$DSH_HOME/profiles/engineering/cordis.patch.yml.backup.<timestamp>` — patch
  con contenido propio cuando un overlay se fusiona con append-and-verify.
- `.git/hooks/pre-commit.backup.<timestamp>` y
  `.git/hooks/pre-push.backup.<timestamp>` — hooks ajenos (husky/gitleaks…).

Para revertir manualmente, restaurá el backup más reciente de la pieza
afectada y re-ejecutá el doctor: el chequeo 13 compara SHA-256 contra el
manifiesto y detecta drift posterior a la instalación.

## Regla general

Ante cualquier síntoma, la secuencia canónica es:

```bash
pnpm typecheck                 # el tooling compila
pnpm verify                    # la composición es válida
bash scripts/dream-doctor.sh   # la instalación está completa
```

Tres verdes = el problema está fuera de este bundle. Si el síntoma aparece
recién al empujar o conectarte por SSH, empezá por los casos de sandbox de
este documento: son condiciones del entorno, no regresiones del bundle.
