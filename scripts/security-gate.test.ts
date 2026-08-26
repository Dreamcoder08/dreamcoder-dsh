// security-gate.test.ts — matriz P0–P5, rutas sensibles y stage-check.
// Se ejecuta con `node --test scripts/security-gate.test.ts` (type-stripping nativo).

import { spawnSync } from 'node:child_process'
import { strictEqual } from 'node:assert'
import { test } from 'node:test'
import { join } from 'node:path'

const script = join(import.meta.dirname, 'security-gate.ts')
const run = (args: string[], env: Record<string, string> = {}) =>
  spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  })

test('classify: comando seguro de build queda en P2 sin bloqueo', () => {
  const r = run(['classify', '--', 'pnpm', 'test'])
  strictEqual(r.status, 0)
  strictEqual(/nivel: P2/.test(r.stdout), true, r.stdout)
})

test('classify: instalación de dependencias es P3 red', () => {
  const r = run(['classify', '--', 'pnpm', 'add', 'zod'])
  strictEqual(r.status, 0)
  strictEqual(/nivel: P3/.test(r.stdout), true, r.stdout)
})

const p5Cases: readonly [string, string[]][] = [
  ['rm -rf', ['bash', '-c', 'rm -rf /tmp/x']],
  ['git reset --hard', ['git', 'reset', '--hard']],
  ['git clean -fdx', ['git', 'clean', '-fdx']],
  ['git push --force', ['git', 'push', '--force', 'origin', 'main']],
  ['DROP DATABASE', ['psql', '-c', 'DROP DATABASE prod;']],
  ['terraform destroy', ['terraform', 'destroy', '-auto-approve']],
  ['kubectl delete pvc', ['kubectl', 'delete', 'pvc', 'datos']],
]

for (const [why, cmd] of p5Cases) {
  test(`command: bloquea ${why} (P5)`, () => {
    const r = run(['command', '--', ...cmd])
    strictEqual(r.status, 1, `${why} debió bloquearse; salida: ${r.stdout}${r.stderr}`)
    strictEqual(/BLOQUEADO/.test(r.stderr), true, r.stderr)
  })
}

for (const [why, pathArg] of [
  ['.env', '.env.production'],
  ['*.pem', 'certs/server.pem'],
  ['~/.ssh', '~/.ssh/id_rsa'],
  ['credentials', 'config/credentials.yml'],
] as const) {
  test(`command: bloquea ruta sensible (${why})`, () => {
    const r = run(['command', '--', 'cat', pathArg])
    strictEqual(r.status, 1, `${pathArg} debió bloquearse`)
  })
}

test('command: bypass auditable permite y registra', () => {
  const r = run(['command', '--', 'git', 'clean', '-fdx'], { DC_SECURITY_BYPASS: 'humano aprobó 2026-08-25' })
  strictEqual(r.status, 0)
  strictEqual(/BYPASS auditado/.test(r.stderr), true, r.stderr)
})

// ── Regresiones de la revisión fresh-context (FN/FP reproducidos) ────────────

const p5RegressionCases: readonly [string, string[]][] = [
  ['git -C dir reset --hard (flag global)', ['git', '-C', 'subdir', 'reset', '--hard']],
  ['terraform -chdir=dir destroy', ['terraform', '-chdir=prod', 'destroy']],
  ['kubectl delete ns (abreviatura)', ['kubectl', 'delete', 'ns', 'prod']],
  ['kubectl delete namespace (plural)', ['kubectl', 'delete', 'namespace', 'prod']],
  ['git push refspec +main', ['git', 'push', 'origin', '+main']],
]

for (const [why, cmd] of p5RegressionCases) {
  test(`command: bloquea ${why} (regresión FN)`, () => {
    const r = run(['command', '--', ...cmd])
    strictEqual(r.status, 1, `${why} debió bloquearse; salida: ${r.stdout}${r.stderr}`)
  })
}

const fpCases: readonly [string, string[]][] = [
  ['cp --recursive no es P5', ['cp', '--recursive', 'a', 'b']],
  ['grep --recursive no es P5', ['grep', '--recursive', 'x', '.']],
  ['filter credentials-api no es ruta sensible', ['pnpm', 'test', '--filter', 'credentials-api']],
  ['rama fix-token-logic no es ruta sensible', ['git', 'push', 'origin', 'fix-token-logic']],
]

for (const [why, cmd] of fpCases) {
  test(`classify: NO bloquea (${why})`, () => {
    const r = run(['command', '--', ...cmd])
    strictEqual(r.status, 0, `${why} fue FP: ${r.stdout}${r.stderr}`)
  })
}

test('classify: .env.production.local es sensible (doble sufijo)', () => {
  const r = run(['command', '--', 'cat', '.env.production.local'])
  strictEqual(r.status, 1)
})

test('classify: patrones insensibles a mayúsculas (.PEM)', () => {
  const r = run(['command', '--', 'cat', 'certs/SERVER.PEM'])
  strictEqual(r.status, 1)
})

test('uso inválido → exit 2', () => {
  const r = run([])
  strictEqual(r.status, 2)
})
