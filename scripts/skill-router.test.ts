// skill-router.test.ts — ranking acotado de skills (presupuesto máx 3, §10).
// Los fixtures viven en un directorio temporal para no depender del bundle real.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { describe, test } from 'node:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SCRIPT = join(import.meta.dirname, 'skill-router.ts')

const makeSkill = (dir: string, name: string, description: string, whenToUse: string): void => {
  const p = join(dir, name)
  mkdirSync(p, { recursive: true })
  const body = ['---', `name: ${name}`, 'description: >', `  ${description}`, 'whenToUse: >', `  ${whenToUse}`, '---', '# x'].join('\n')
  writeFileSync(join(p, 'SKILL.md'), body)
}

const newSkillsDir = (): string => {
  const ws = mkdtempSync(join(tmpdir(), 'skill-router-'))
  return ws
}

const runRouter = (ws: string, args: string[]) =>
  spawnSync(process.execPath, [SCRIPT, '--skills-dir', ws, ...args], { encoding: 'utf8' })

describe('skill-router.ts', () => {
  test('rankea primero la skill más relevante para la tarea', () => {
    const ws = newSkillsDir()
    try {
      makeSkill(ws, 'go-testing', 'Go tests, coverage y golden files.', 'Trigger: Go tests, teatest.')
      makeSkill(ws, 'tailwind-4', 'Estilos Tailwind y cn().', 'Trigger: styling Tailwind.')
      const r = runRouter(ws, ['--task', 'necesito arreglar un test de Go con teatest y golden files'])
      assert.equal(r.status, 0, r.stderr)
      assert.match(r.stdout, /1\.\s+go-testing/)
      // Una skill sin tokens en común no se carga ni se difiere: score 0.
      assert.doesNotMatch(r.stdout.split('deferridas')[0] ?? '', /tailwind-4/)
    } finally {
      rmSync(ws, { recursive: true, force: true })
    }
  })

  test('presupuesto por defecto: nunca devuelve más de 3 cargadas', () => {
    const ws = newSkillsDir()
    try {
      for (const n of ['alpha', 'beta', 'gamma', 'delta', 'epsilon']) {
        makeSkill(ws, n, `testing ${n} skills`, 'Trigger: testing skills budget.')
      }
      const r = runRouter(ws, ['--task', 'testing skills budget overload'])
      assert.equal(r.status, 0)
      const loaded = (r.stdout.match(/^→ /gm) ?? []).length
      assert.equal(loaded, 3)
      assert.match(r.stdout, /deferridas: 2/i)
    } finally {
      rmSync(ws, { recursive: true, force: true })
    }
  })

  test('--json emite estructura parseable con loaded y deferred', () => {
    const ws = newSkillsDir()
    try {
      makeSkill(ws, 'zod-4', 'Zod schema validation patterns.', 'Trigger: zod schemas.')
      const r = runRouter(ws, ['--task', 'validar schemas con zod', '--json'])
      assert.equal(r.status, 0)
      const out = JSON.parse(r.stdout) as { loaded: { name: string }[]; deferred: unknown[] }
      assert.equal(out.loaded.length, 1)
      assert.equal(out.loaded[0]?.name, 'zod-4')
      assert.equal(out.deferred.length, 0)
    } finally {
      rmSync(ws, { recursive: true, force: true })
    }
  })

  test('generaliza: consulta en inglés y desempate por coincidencia de nombre', () => {
    const ws = newSkillsDir()
    try {
      makeSkill(ws, 'pytest-fixtures', 'Pytest fixtures and mocking.', 'Trigger: python tests.')
      makeSkill(ws, 'django-drf', 'Django REST Framework patterns.', 'Trigger: REST APIs.')
      const r = runRouter(ws, ['--task', 'mocking patterns for pytest tests'])
      assert.equal(r.status, 0)
      // Ambas comparten tokens genéricos ("patterns", "tests"); gana la que
      // además coincide por nombre completo (pytest…).
      assert.match(r.stdout, /1\.\s+pytest-fixtures/)
      assert.match(r.stdout, /2\.\s+django-drf/)
    } finally {
      rmSync(ws, { recursive: true, force: true })
    }
  })
})
