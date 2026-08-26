// Tests for scripts/migrate-engram-row.mjs — the profile-patch auto-repair
// used by install.sh --with-engram. Each case runs the real script against a
// fixture patch and asserts EXACTLY what survived: the historical regression
// was silent over-deletion of sibling rows inside the same `- insert:` block,
// which composed fine and then deleted its own backup (irrecoverable).
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { after, describe, test } from 'node:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SCRIPT = join(import.meta.dirname, 'migrate-engram-row.mjs')

const tempDirs: string[] = []
after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
})

interface Run {
  status: number | null
  stdout: string
  result: () => string
}

/** Escribe el fixture, corre el script real y devuelve salida + lectura perezosa. */
const run = (content: string): Run => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-migrate-'))
  tempDirs.push(dir)
  const file = join(dir, 'cordis.patch.yml')
  writeFileSync(file, content)
  const r = spawnSync(process.execPath, [SCRIPT, file], { encoding: 'utf8' })
  return { status: r.status, stdout: r.stdout, result: () => readFileSync(file, 'utf8') }
}

const OTHER = [
  '- insert:',
  '    - id: other-thing',
  "      name: '@x/y'",
  '      config:',
  '        command: foo',
].join('\n')

const ENGRAM_ROW = ['    - id: memory-engram', "      name: '@deepseek-ai/dsh-mcp-client'", '      config:', '        command: engram'].join('\n')

describe('migrate-engram-row.mjs', () => {
  test('REGRESIÓN: hermanas en el MISMO insert — solo cae la fila objetivo', () => {
    const r = run(`${OTHER}\n${ENGRAM_ROW}\n`)
    assert.equal(r.status, 0, r.stdout)
    const out = r.result()
    assert.match(out, /- id: other-thing/) // la hermana SOBREVIVE
    assert.match(out, /command: foo/)
    assert.doesNotMatch(out, /^[\t ]*- id: memory-engram$/m)
    assert.match(r.stdout, /1 fila\(s\) quirúrgica/)
  })

  test('bloque monofila clásico: fuera el bloque y su banner, vecinos intactos', () => {
    const content = [
      '# header',
      '- id: session-query-sqlite',
      '  config:',
      '    path: x',
      '',
      '# ── Memoria longitudinal ──',
      '# banner dos',
      '- insert:',
      ENGRAM_ROW,
      '',
      '# siguiente sección',
      '- id: web',
      '  config:',
      '    searchProvider: exa',
      '',
    ].join('\n')
    const r = run(content)
    assert.equal(r.status, 0, r.stdout)
    const out = r.result()
    assert.doesNotMatch(out, /memory-engram/)
    assert.doesNotMatch(out, /Memoria longitudinal/)
    assert.match(out, /# header/)
    assert.match(out, /- id: session-query-sqlite/)
    assert.match(out, /- id: web/)
    assert.match(out, /searchProvider: exa/)
    assert.match(r.stdout, /1 bloque\(s\) completo/)
  })

  test('polifila con banner de fila: cirugía deja el banner del insert', () => {
    const content = ['# banner del INSERT (permanece)', '- insert:', '    # nota pegada a la fila objetivo', ENGRAM_ROW, '    - id: other-thing', '      config:', '        command: foo'].join('\n')
    const r = run(content)
    assert.equal(r.status, 0, r.stdout)
    const out = r.result()
    assert.match(out, /# banner del INSERT/)
    assert.match(out, /- id: other-thing/)
    assert.doesNotMatch(out, /nota pegada a la fila objetivo/)
    assert.doesNotMatch(out, /memory-engram/)
  })

  test('dos bloques duplicados: ambos desaparecen', () => {
    const content = [`- insert:\n${ENGRAM_ROW}`, '- id: middle', '  config: {a: 1}', `- insert:\n${ENGRAM_ROW}`].join('\n')
    const r = run(content)
    assert.equal(r.status, 0, r.stdout)
    const out = r.result()
    assert.doesNotMatch(out, /memory-engram/)
    assert.match(out, /- id: middle/)
    assert.match(r.stdout, /2 bloque\(s\) completo/)
  })

  test('sin la fila: no-op byte a byte', () => {
    const content = `${OTHER}\n- id: otra\n  config: {a: 1}\n`
    const r = run(content)
    assert.equal(r.status, 0)
    assert.equal(r.result(), content)
  })

  test('solo menciones en comentarios: no-op byte a byte', () => {
    const content = '# el error fue: duplicate loader entry id: memory-engram\n[]\n'
    const r = run(content)
    assert.equal(r.status, 0)
    assert.equal(r.result(), content)
  })

  test('EOF sin newline final: remueve y normaliza a newline final', () => {
    const content = `- id: keep\n  config: {a: 1}\n- insert:\n${ENGRAM_ROW}`
    const r = run(content)
    assert.equal(r.status, 0, r.stdout)
    const out = r.result()
    assert.ok(out.endsWith('\n'))
    assert.match(out, /- id: keep/)
    assert.doesNotMatch(out, /memory-engram/)
  })

  test('bloque único en el archivo: queda la capa vacía canónica []', () => {
    const r = run(`# solo esto\n- insert:\n${ENGRAM_ROW}\n`)
    assert.equal(r.status, 0, r.stdout)
    assert.equal(r.result(), '[]\n')
  })

  test('detector estricto unificado: tabs y trailing spaces también cuentan', () => {
    const content = '- insert:\n\t- id:\tmemory-engram  \n      config:\n        command: engram\n'
    const r = run(content)
    assert.equal(r.status, 0, r.stdout)
    assert.equal(r.result(), '[]\n')
  })

  test('CRLF en la fila: detectada y removida', () => {
    const content = '- insert:\r\n' + ENGRAM_ROW.replace(/$/gm, '\r') + '\r\n'
    const r = run(content)
    assert.equal(r.status, 0, r.stdout)
    assert.equal(r.result(), '[]\n')
  })

  test('estructura ajena a nivel hijo: exit 3 y archivo intacto (falla ruidosa)', () => {
    const content = `- insert:\n${ENGRAM_ROW}\n    claveSuelta: misterio\n`
    const r = run(content)
    assert.equal(r.status, 3)
    assert.equal(r.result(), content) // byte a byte: jamás pérdida silenciosa
  })
})
