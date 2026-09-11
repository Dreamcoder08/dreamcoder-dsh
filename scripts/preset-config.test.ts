// Lint de configuración requerida por los schemas de DSH en los agent presets.
//
// Por qué existe: `verify-presets.ts` valida sintaxis, forma y RESOLUCIÓN de
// cada fila, y `dream-doctor.sh` comprobaba que el preset estuviera instalado.
// Ninguno de los dos monta el preset, así que los tres defectos siguientes
// convivieron con un "✔" en ambos gates y con los 6 presets SIN PODER MONTAR:
//
//   · persona       — el schema exige `prefix`; los presets usaban `text`
//                     (campo inexistente) → "invalid config: $.prefix missing
//                     required value".
//   · tool-todo     — `allowParallelInProgress` es `z.boolean().required()`.
//   · plan-mode     — rechaza un `section` vacío en el montaje.
//
// La verificación autoritativa sigue siendo el montaje real
// (`agentPresets.standingKeyFor(id)` con un DSH vivo, que es como se
// encontraron). Este test es la alarma temprana que corre en CI sin DSH: un
// preset que no monta no debe poder llegar a main.
//
// El parseo es deliberadamente acotado al subconjunto de YAML que usan estas
// composiciones (listas de bloques con `- id:`, `name:` y `config:` anidado).
// No es un parser de YAML general y no pretende serlo.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, test } from 'node:test'

const ROOT = join(import.meta.dirname, '..')
const AGENTS = join(ROOT, 'agents')

/** Campos que el Config del paquete exige: sin ellos el preset NO monta. */
interface RequiredField {
  key: string
  /** Campo que el schema NO conoce y cuya presencia delata un malentendido. */
  forbidden?: string
}

const REQUIRED: Record<string, RequiredField[]> = {
  '@deepseek-ai/dsh-persona': [{ key: 'prefix', forbidden: 'text' }],
  '@deepseek-ai/dsh-tool-todo': [{ key: 'allowParallelInProgress' }],
  '@deepseek-ai/dsh-plan-mode': [{ key: 'section' }],
}

interface Row {
  name: string
  block: string
}

/**
 * Bloques de cada fila nombrada de una composición. Una fila empieza en
 * `- id:` y termina en la siguiente línea con indentación menor o igual que
 * inicia un nuevo `- `, o al bajar de la indentación de la fila.
 */
function rows(text: string): Row[] {
  const lines = text.split('\n')
  const indentOf = (line: string): number => line.length - line.trimStart().length
  const out: Row[] = []
  for (let i = 0; i < lines.length; i++) {
    const start = /^(\s*)-[ \t]+\S/.exec(lines[i] ?? '')
    if (start === null) continue
    const indent = indentOf(lines[i] ?? '')
    let end = i + 1
    while (end < lines.length) {
      const line = lines[end] ?? ''
      if (line.trim() !== '' && indentOf(line) <= indent && /^-/.test(line.trimStart())) break
      if (line.trim() !== '' && indentOf(line) < indent) break
      end += 1
    }
    const block = lines.slice(i, end).join('\n')
    const name = /^\s*name:[ \t]*'?([^'\n]+?)'?[ \t]*$/m.exec(block)?.[1]?.trim()
    if (name !== undefined) out.push({ name, block })
  }
  return out
}

/** ¿Aparece la clave dentro del bloque de la fila? */
function declares(block: string, key: string): boolean {
  return new RegExp(`^\\s*${key}:[ \\t]*`, 'm').test(block)
}

describe('config requerida por schema en agent presets', () => {
  const roles = readdirSync(AGENTS, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(AGENTS, e.name, 'agent.cordis.yml')))
    .map((e) => e.name)
    .sort()

  test('hay presets que revisar', () => {
    assert.ok(roles.length >= 6, `esperaba los 6 roles, encontré: ${roles.join(', ')}`)
  })

  for (const role of roles) {
    test(`${role}: las filas declaran los campos que su schema exige`, () => {
      const file = join(AGENTS, role, 'agent.cordis.yml')
      const text = readFileSync(file, 'utf8')
      const found = rows(text)
      assert.ok(found.length > 0, `${role}: no pude leer ninguna fila con nombre`)

      const problems: string[] = []
      let checked = 0
      for (const row of found) {
        const required = REQUIRED[row.name]
        if (required === undefined) continue
        checked += 1
        for (const field of required) {
          if (!declares(row.block, field.key)) {
            problems.push(`${row.name}: falta \`${field.key}\` (el preset no monta sin él)`)
          }
          if (field.forbidden !== undefined && declares(row.block, field.forbidden)) {
            problems.push(
              `${row.name}: usa \`${field.forbidden}\`, que el schema no conoce (el texto se pierde y el montaje falla)`,
            )
          }
        }
      }
      // Si un refactor deja de usar estos paquetes, este test lo dice en vez de
      // pasar vacío: un lint que no revisa nada es peor que ninguno.
      assert.ok(checked > 0, `${role}: ninguna fila usa un paquete con campos requeridos conocidos`)
      assert.deepEqual(problems, [], `${role}: config incompleta:\n - ${problems.join('\n - ')}`)
    })
  }
})
