#!/usr/bin/env node
// verify-presets.ts — validación de los agent presets del bundle.
//
// Para cada agents/<rol>/agent.cordis.yml afirma que:
//   1. el YAML parsea con la misma semántica de etiquetas que usa el Loader
//      (las expresiones !!js se aceptan sin evaluar),
//   2. es una lista de filas nombradas (`id` + `name`),
//   3. cada especificador bare (@deepseek-ai/*) resuelve desde el directorio
//      del perfil instalado — el mismo ancla que usa el Loader al montar.
//
// Los errores de config por fila (claves desconocidas, realms mal puestos)
// los detecta el audit de montaje de dsh-agent-presets al crear la sesión;
// esta suite cubre la capa que falla antes: sintaxis y resolución.
//
// Se ejecuta con el type-stripping nativo de Node (≥26), sin build, y se tipa con tsgo 7.x.

import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const dshHome = process.env.DSH_HOME ?? join(process.env.HOME ?? '', '.dsh')
const anchorDir = join(dshHome, 'profiles', 'engineering')

const PRESET_ROLES = ['explorer', 'architect', 'implementer', 'tester', 'reviewer', 'security'] as const

interface CordisRow {
  id: string
  name: string
}

/** Dependencias del verificador se resuelven del árbol del perfil instalado. */
const anchorRequire = createRequire(pathToFileURL(join(anchorDir, 'noop.js')))
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- el paquete `yaml` del árbol del perfil no embarca tipos resolubles aquí
const parseYaml: (src: string, opts?: any) => any = anchorRequire('yaml').parse

interface YamlTag {
  tag: string
  collection: string
  resolve(): null
  stringify(): string
}

// Etiqueta !!js tolerante: el loader la evalúa en su dialecto; aquí solo se
// conserva para validar estructura sin ejecutar expresiones.
const jsTag: YamlTag = {
  tag: '!!js',
  collection: 'any',
  resolve: () => null,
  stringify: () => '',
}

let failures = 0
const check = (name: string, ok: boolean, detail = ''): void => {
  console.log(`${ok ? '  ✔' : '  ✘'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures += 1
}

const collectRows = (node: unknown, acc: CordisRow[] = []): CordisRow[] => {
  if (Array.isArray(node)) {
    for (const item of node) collectRows(item, acc)
  } else if (node !== null && typeof node === 'object') {
    const record = node as Record<string, unknown>
    if (typeof record['id'] === 'string' && typeof record['name'] === 'string') {
      acc.push({ id: record['id'], name: record['name'] })
    }
    for (const value of Object.values(record)) collectRows(value, acc)
  }
  return acc
}

const resolvesFromProfile = (specifier: string): boolean => {
  try {
    anchorRequire.resolve(specifier)
    return true
  } catch {
    return false
  }
}

console.log('==> Verificando agent presets…')
for (const role of PRESET_ROLES) {
  const file = join(repoRoot, 'agents', role, 'agent.cordis.yml')
  console.log(`── preset '${role}'`)
  let tree: unknown
  try {
    tree = parseYaml(readFileSync(file, 'utf8'), { customTags: [jsTag] })
    check('YAML parsea', true)
  } catch (error) {
    check('YAML parsea', false, error instanceof Error ? error.message : String(error))
    continue
  }
  const rows = Array.isArray(tree) ? collectRows(tree) : []
  check('lista de filas nombradas no vacía', Array.isArray(tree) && rows.length > 0, `${rows.length} filas`)
  const personaRow: CordisRow | undefined = rows.find((r) => r.name === '@deepseek-ai/dsh-persona')
  check('declara persona propia', personaRow !== undefined)
  const bare = [...new Set(rows.map((r) => r.name).filter((n) => !n.startsWith('cordis:')))]
  for (const specifier of bare) {
    // Resolución dos-anclada: instalación DSH primero, luego el perfil.
    const ok = existsSync(join(dirname(file), 'node_modules', specifier)) || resolvesFromProfile(specifier)
    check(`paquete ${specifier} resuelve`, ok, anchorDir)
  }
}

console.log(
  failures === 0
    ? '\n✔ Presets verificados: sintaxis, forma y resolución correctas.'
    : `\n✘ ${failures} verificación(es) fallaron — revisa arriba.`,
)
process.exit(failures === 0 ? 0 : 1)
