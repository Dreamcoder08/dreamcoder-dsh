# Guía de contribución

Gracias por interesarte en Dreamcoder DSH. Este proyecto aplica su propia
filosofía a sí mismo: proceso proporcional al riesgo, evidencia observable y
separación entre quien propone y quien aprueba.

## Cómo proponer cambios

**Issue-first.** Antes de un PR grande, abre un issue que describa:

1. el problema operativo observado (no la solución deseada);
2. evidencia: qué pasó, con salida literal o repro;
3. la clase de riesgo que le asignas (P0–P3, ver tabla abajo).

Los fixes triviales (typo, link roto) no requieren issue.

## Clasificación de riesgo (la misma del bundle)

| Nivel | Cambio típico | Expectativa de PR |
|---|---|---|
| P0 | typo, docs, comentario | 1 commit, sin test |
| P1 | fix puntual + unit test | test obligatorio |
| P2 | feature/refactor multi-archivo | descripción de decisión + tests |
| P3 | contratos, esquemas, build/CI | issue previo + diseño en el PR |

Si tu PR crece más allá de su nivel declarado, reclasifícalo y dilo en la
descripción — reclasificar no es fracasar; ocultarlo sí.

## Reglas del repositorio

- **Out-of-tree siempre.** Nada de este repo modifica el core de DeepSeek
  Harness. Si tu cambio parece requerir tocar DSH, propón primero un issue
  upstream (ver `docs/contribution-gentle-ai.md`).
- **Overrides deterministas.** `cordis.patch.yml` usa reemplazo completo de
  config (sin deep-merge): cualquier override nuevo debe restituir todo lo que
  quiere conservar, y explicar en un comentario por qué existe.
- **Sin rutas absolutas.** El bundle no registra `customSkillDirs`; las skills
  se enlazan vía `$DSH_HOME/skills`. No reintroduzcas rutas de máquina.
- **Español operativo.** Documentación y mensajes en español; identificadores
  de código en inglés cuando sea idiomático.

## Verificación obligatoria antes del PR

```bash
bun install
bun run typecheck             # tsgo sobre todo el tooling
bun run verify                # requiere instalación local de dsh + perfil
bash scripts/dream-doctor.sh  # salud post-instalación, si tocaste install.sh
```

`bun run verify` compone el perfil con el mismo algoritmo que el arranque real:
si pasa en tu máquina, el PR debería pasar el job best-effort de CI también.
Incluye en la descripción del PR la salida relevante de los comandos — no un
resumen verbal ("debería funcionar" es hipótesis, no resultado).

## Commits

Un commit = una unidad de trabajo revisable (código + su test + su doc juntos).
Convención: `type(scope): summary` — p. ej.
`fix(doctor): check skills via default user-dsh root after portable refactor`.

## Revisión

Todo PR recibe revisión bajo las cuatro lentes 4R (Readability / Reliability /
Resilience / Risk). Un veredicto CHANGES_REQUIRED nunca es personal: es la
misma disciplina que este bundle le exige a cualquier agente.
