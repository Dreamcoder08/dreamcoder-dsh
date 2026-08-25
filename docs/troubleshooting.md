# Troubleshooting

Diagnóstico y problemas comunes de la instalación de Dreamcoder DSH.

## Primera herramienta: el doctor

```bash
bash scripts/dream-doctor.sh
```

Ejecuta siete chequeos en orden y marca cada línea con `✔` o `✘`:

1. **Binarios** — `dsh`, `pnpm`, `node` presentes y en versión.
2. **Perfil instalado** — `$DSH_HOME/profiles/engineering/` existe y resuelve.
3. **Política global** — `~/.dsh/AGENTS.md` instalado.
4. **Presets de agentes** — los seis roles publicados en `.agent-presets/`.
5. **Skills del bundle** — las siete skills enlazadas en `$DSH_HOME/skills`.
6. **Memoria longitudinal (opcional)** — overlay Engram si fue habilitado.
7. **Evidencia reciente** — registros bajo `<repo>/.evidence/`.

Salida final: `✔ Doctor: instalación saludable.` o
`✘ Doctor: N problema(s). Revisa las líneas ✘.` — corrige las líneas marcadas
y re-ejecuta.

## Problemas comunes

### El instalador falla con "requiere el binario 'engram'"

`--with-engram` exige `engram` v1.20.0 en PATH (verificado por el propio
script). Instala el binario primero, o ejecuta `install.sh` sin el flag: el
overlay es opcional y la sesión opera sin memoria longitudinal declarándolo
una vez.

### Una skill no aparece en la sesión

1. Corre el doctor (chequeo 5).
2. Verifica que el enlace exista: `ls -la $DSH_HOME/skills/`.
3. Si falta, re-ejecuta `bash scripts/install.sh` — es idempotente.

Las skills se exponen vía la raíz de usuario por defecto de dsh-skill-filesystem
(`<dshHome>/skills`), no vía rutas absolutas del bundle; si editaste el patch a
mano, asegúrate de no haber reintroducido `customSkillDirs`.

### La persona operativa no se aplica

El override `system-prompt` **reemplaza la config completa** de la fila (no hay
deep-merge). Si otro bundle o un cambio upstream añadió campos a esa config,
este bundle debe restituirlos explícitamente. Diagnóstico:

```bash
dsh --profile engineering --dump-config | less   # inspecciona la fila system-prompt
```

`pnpm verify` (verify-compat) compone el perfil con el mismo algoritmo que
el arranque y detecta este tipo de ruptura contra la versión pineada de DSH.

### Un preset falla al cargar

```bash
node scripts/verify-presets.ts
```

Valida sintaxis YAML, forma de filas y resolución de paquetes desde el perfil
instalado. Causa típica: preset instalado desactualizado respecto al repo —
re-ejecuta `install.sh`.

### DSH se actualizó y algo rompió

El repo pinea la versión compatible de DSH. Tras una actualización de dsh:

```bash
git pull                      # trae posibles re-pins del bundle
pnpm verify                   # compatibilidad contra la versión pineada
```

Si `verify` falla con una versión nueva de DSH, el fix pertenece a este repo
(actualizar overrides/pin), no a tu instalación local.

### Residuos de una instalación previa

La política se instala con backup automático:
`$DSH_HOME/AGENTS.md.backup.<timestamp>`. Para revertir manualmente, restaura
el backup más reciente y re-ejecuta el doctor.

## Regla general

Ante cualquier síntoma, la secuencia canónica es:

```bash
pnpm typecheck                # el tooling compila
pnpm verify                   # la composición es válida
bash scripts/dream-doctor.sh  # la instalación está completa
```

Tres verdes = el problema está fuera de este bundle.
