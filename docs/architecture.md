# Arquitectura

Cómo se compone y por qué cada pieza existe. Este documento explica decisiones,
no repite el README.

## Posición en la pila

```text
        Filosofía Gentle-AI + contrato operativo de ingeniería
                            │
          @dreamcoder/dsh-engineering-bundle   ← este repo
                            │
                  DeepSeek Harness (dsh)
                            │
          ┌─────────────────┼──────────────────┐
       bundle base      bundle web-app    presets/skills propios
```

El repo **no modifica el core de DSH**. Todo lo que aporta entra por dos
mecanismos oficiales de composición: un *bundle* Cordis aplicado como patch
sobre el árbol compuesto, y un *perfil* que declara qué bundles se montan.

## El bundle: `bundles/engineering/cordis.patch.yml`

El bundle es un array de overrides Cordis sobre el árbol compuesto
`base + web-app`. Hoy declara un único override:

### Override `system-prompt`

La fila existente `system-prompt` (@deepseek-ai/dsh-system-prompt) declara
`config: { persona: '' }`. El override reemplaza esa `persona` con el contrato
operativo Gentle-AI:

- tono profesional, directo y medido;
- pipeline obligatorio de diez etapas (Architect → … → Publish evidence);
- reglas de evidencia (salida observable o no está hecho);
- reglas de delegación (subagentes con contexto fresco cuando el riesgo P2/P3
  lo justifica);
- encuadre de las skills del bundle y del español como idioma operativo.

### Decisión 1 — reemplazo completo, sin deep-merge

Cada entrada del array es un PatchOptions; los overrides usan la forma
`- id: <row-id>` + `config:` que **REEMPLAZA la config completa** de la fila
objetivo. No hay deep-merge, así que cada override restituye explícitamente
todo lo que quiere conservar. Consecuencia deliberada: el efecto final del
patch es determinista y auditable leyendo un solo archivo.

### Decisión 2 — portabilidad sin rutas absolutas

Versiones anteriores registraban `customSkillDirs` con rutas absolutas al
directorio del repo. Hoy el bundle **no registra `customSkillDirs`**: las
skills se exponen por la raíz de usuario por defecto de dsh-skill-filesystem
(`<dshHome>/skills`), donde `scripts/install.sh` enlaza cada directorio de
`bundles/engineering/skills/`. El patch queda libre de rutas dependientes de
la máquina y el bundle es portable entre instalaciones.

## El perfil: `profiles/engineering/package.json`

Manifiesto estándar de perfil DSH:

```json
{
  "dependencies": {
    "@dreamcoder/dsh-engineering-bundle": "link:@BUNDLE_DIR@"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "@dreamcoder/dsh-engineering-bundle"
      ]
    }
  }
}
```

`install.sh` sustituye el placeholder `@BUNDLE_DIR@` por la ruta real del repo.
El orden importa: el engineering-bundle se aplica **después** de base y
web-app, de modo que sus overrides ganan.

## Instalación: `scripts/install.sh`

Idempotente, con `DSH_HOME="${DSH_HOME:-$HOME/.dsh}"`:

| Paso | Destino | Nota |
|---|---|---|
| Perfil | `$DSH_HOME/profiles/engineering/` | Renderiza el manifiesto |
| Política | `$DSH_HOME/AGENTS.md` | Backup previo como `AGENTS.md.backup.<timestamp>` |
| Presets | `$DSH_HOME/.agent-presets/` | Seis roles |
| Skills | `$DSH_HOME/skills/` | Enlace de cada skill |
| Memoria | overlay MCP | Solo con `--with-engram`; exige binario `engram` v1.20.0 en PATH |

## Agent presets

Cada preset vive en `agents/<rol>/` con dos archivos:

- `preset.yml` — identidad visible (nombre, descripción);
- `agent.cordis.yml` — composición del agente (herramientas, permisos, prompt).

Los seis roles implementan la separación estructural implementar/verificar:
`solver` e `implementer` mutan; `explorer`, `architect`, `tester`, `reviewer`
y `security` observan, planifican o emiten veredictos. La independencia de
criterio no depende de que el modelo "sea honesto": depende de que el rol que
implementa no tenga ni la herramienta ni la autoridad para aprobarse.

## Verificación: cómo se comprueba todo esto

- `scripts/verify-compat.ts` — compone el perfil con el mismo algoritmo que el
  arranque de DSH contra la versión pineada; detecta rupturas de compatibilidad
  antes de que lleguen a una sesión.
- `scripts/verify-presets.ts` — valida cada preset: sintaxis YAML, forma de
  filas y resolución de paquetes desde el perfil instalado.
- `scripts/dream-doctor.sh` — diagnóstico post-instalación (ver
  [`troubleshooting.md`](troubleshooting.md)).

## Evolución conocida

Ver [Roadmap](../README.md#roadmap) en el README: receipts como plugin TS
propio (cuando DSH estabilice su API de plugins de terceros) y pinning
per-preset de modelo (requiere cambios host-plane upstream).
