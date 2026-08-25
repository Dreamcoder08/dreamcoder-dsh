#!/usr/bin/env node
// verify-presets.mjs — validación de los agent presets del bundle.
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
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const dshHome = process.env.DSH_HOME ?? join(process.env.HOME ?? '', '.dsh')
const anchorDir = join(dshHome, 'profiles', 'engineering')
// Dependencias del verificador se resuelven del árbol del perfil instalado
// (este repo no embarca node_modules propio).
const anchorRequire = createRequire(pathToFileURL(join(anchorDir, 'noop.js')))
const { parse: parseYaml } = anchorRequire('yaml')

// Etiqueta !!js tolerante: el loader la evalúa en su dialecto; aquí solo se
// conserva para validar estructura sin ejecutar expresiones.
const jsTag = {
  tag: '!!js',
  collection: 'any',
  resolve: () => null,
  stringify: () => '',
}

let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  ✔' : '  ✘'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures += 1
}

const collectRows = (node, acc = []) => {
  if (Array.isArray(node)) {
    for (const item of node) collectRows(item, acc)
  } else if (node && typeof node === 'object') {
    if (typeof node.id === 'string' && typeof node.name === 'string') acc.push(node)
    for (const value of Object.values(node)) collectRows(value, acc)
  }
  return acc
}

const resolvesFromProfile = (specifier) => {
  try {
    const require = createRequire(pathToFileURL(join(anchorDir, 'noop.js')))
    require.resolve(specifier)
    return true
  } catch {
    return false
  }
}

console.log('==> Verificando agent presets…')
for (const role of ['explorer', 'architect', 'implementer', 'tester', 'reviewer', 'security']) {
  const file = join(repoRoot, 'agents', role, 'agent.cordis.yml')
  console.log(`── preset '${role}'`)
  let tree
  try {
    tree = parseYaml(readFileSync(file, 'utf8'), { customTags: [jsTag] })
    check('YAML parsea', true)
  } catch (error) {
    check('YAML parsea', false, error.message)
    continue
  }
  const rows = Array.isArray(tree) ? collectRows(tree) : []
  check('lista de filas nombradas no vacía', Array.isArray(tree) && rows.length > 0, `${rows.length} filas`)
  const personaRow = rows.find((r) => r.name === '@deepseek-ai/dsh-persona')
  check('declara persona propia', Boolean(personaRow))
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
