// Tests E2E del camino de instalación (scripts/install.sh) con un `dsh`
// simulado. install.sh es el camino primario del usuario y hasta ahora ningún
// test lo ejercía: solo se probaba scripts/dream-manifest.sh, uno de sus pasos.
//
// El stub emula lo único que install.sh consume de `dsh`: `plugin add` (que en
// DSH real ejecuta initProfile y escribe package.json, cordis.patch.yml y
// pnpm-workspace.yaml) y `plugin install` / `--dump-config` (no-op). Así el
// test corre en CI sin un DSH instalado y sin tocar $HOME real.
//
// Regresión que este archivo fija: `dsh-agent-presets` descubre presets con
// `readdir(..., { withFileTypes: true })` + `child.isDirectory()`
// (lib/index.js:403). Para un symlink, `Dirent.isDirectory()` es FALSE, así que
// enlazar el DIRECTORIO del preset —lo que hacía install.sh— dejaba el preset
// fuera del roster en silencio: `install.sh`, `dream-doctor` y
// `verify-presets` lo reportaban instalado, y ningún agente podía usarlo.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { after, describe, test } from 'node:test'
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const REPO_ROOT = join(import.meta.dirname, '..')
const INSTALL = join(REPO_ROOT, 'scripts', 'install.sh')
const MANIFEST = join(REPO_ROOT, 'scripts', 'dream-manifest.sh')

/** Los 6 roles que el README promete como agent presets. */
const ROLES = ['explorer', 'architect', 'implementer', 'tester', 'reviewer', 'security']

const tempDirs: string[] = []
after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
})

/**
 * PATH con un `dsh` (y un `pnpm`) simulados. Hermético a propósito: no depende
 * de que la máquina tenga dsh y jamás puede alcanzar el $HOME real.
 */
function fakeBin(root: string): string {
  const bin = join(root, 'bin')
  mkdirSync(bin, { recursive: true })
  const dsh = join(bin, 'dsh')
  writeFileSync(
    dsh,
    [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      ': "${DSH_HOME:?}"',
      'profile=engineering',
      'args=("$@")',
      'for i in "${!args[@]}"; do',
      '  if [ "${args[$i]}" = "--profile" ]; then profile="${args[$((i + 1))]}"; fi',
      'done',
      'joined=" ${args[*]} "',
      'case "$joined" in',
      '  *" plugin "*" add "*)',
      '    pdir="$DSH_HOME/profiles/$profile"',
      '    mkdir -p "$pdir"',
      '    [ -f "$pdir/package.json" ] || printf \'{"name":"dsh-profile-%s"}\\n\' "$profile" > "$pdir/package.json"',
      '    [ -f "$pdir/cordis.patch.yml" ] || printf \'[]\\n\' > "$pdir/cordis.patch.yml"',
      '    [ -f "$pdir/pnpm-workspace.yaml" ] || printf \'packages: []\\n\' > "$pdir/pnpm-workspace.yaml"',
      '    ;;',
      '  *" --dump-config "*) echo "[]" ;;',
      'esac',
      'exit 0',
      '',
    ].join('\n'),
  )
  chmodSync(dsh, 0o755)
  // install.sh exige `pnpm` en PATH; no lo invoca (lo haría dsh), así que un
  // stub basta y mantiene el test independiente del gestor de paquetes.
  const pnpm = join(bin, 'pnpm')
  writeFileSync(pnpm, '#!/usr/bin/env bash\nexit 0\n')
  chmodSync(pnpm, 0o755)
  return bin
}

interface Home {
  home: string
  bin: string
}

function makeHome(): Home {
  const root = mkdtempSync(join(tmpdir(), 'dsh-install-'))
  tempDirs.push(root)
  return { home: join(root, 'dsh-home'), bin: fakeBin(root) }
}

function runInstall({ home, bin }: Home, args: string[] = []) {
  return spawnSync('bash', [INSTALL, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 120000,
    env: { ...process.env, DSH_HOME: home, HOME: home, PATH: `${bin}:${process.env.PATH ?? ''}` },
  })
}

describe('install.sh (E2E con dsh simulado)', () => {
  test('instala política, perfil y manifiesto verificable', () => {
    const h = makeHome()
    const r = runInstall(h)
    assert.equal(r.status, 0, r.stderr)

    // Política global copiada byte a byte.
    const policy = join(h.home, 'AGENTS.md')
    assert.ok(existsSync(policy), 'falta AGENTS.md instalado')
    assert.equal(readFileSync(policy, 'utf8'), readFileSync(join(REPO_ROOT, 'policy', 'AGENTS.md'), 'utf8'))

    // Los placeholders del template se resuelven a rutas absolutas del repo: el
    // reemplazo consume el prefijo `link:` junto con el placeholder, y pnpm
    // resuelve la ruta pelada como symlink al repo (no una copia).
    const profilePkg = join(h.home, 'profiles', 'engineering', 'package.json')
    const body = readFileSync(profilePkg, 'utf8')
    assert.doesNotMatch(body, /@BUNDLE_DIR@|@RESTRICT_DIR@/, 'quedó un placeholder sin resolver')
    const parsed = JSON.parse(body) as { dependencies: Record<string, string> }
    assert.equal(
      parsed.dependencies['@dreamcoder/dsh-engineering-bundle'],
      join(REPO_ROOT, 'bundles', 'engineering'),
    )
    assert.equal(
      parsed.dependencies['@dreamcoder/dsh-tool-restrict'],
      join(REPO_ROOT, 'bundles', 'tool-restrict'),
    )

    // La procedencia se puede verificar con el script real.
    const verify = spawnSync('bash', [MANIFEST, 'verify', h.home, REPO_ROOT, 'engineering'], { encoding: 'utf8' })
    assert.equal(verify.status, 0, `verify del manifiesto: ${verify.stdout}${verify.stderr}`)
  })

  test('los agent presets son directorios REALES: el roster ignora symlinks', () => {
    const h = makeHome()
    assert.equal(runInstall(h).status, 0)
    const presetsDir = join(h.home, '.agent-presets')

    const missing: string[] = []
    for (const role of ROLES) {
      const target = join(presetsDir, role)
      if (!existsSync(target)) {
        missing.push(`${role}: no instalado`)
        continue
      }
      // La invariante exacta que rompía el roster: un symlink de directorio
      // pasa existsSync pero Dirent.isDirectory() es false.
      if (!lstatSync(target).isDirectory()) {
        missing.push(`${role}: es un symlink (dsh-agent-presets lo descarta en silencio)`)
        continue
      }
      if (!existsSync(join(target, 'agent.cordis.yml'))) missing.push(`${role}: sin agent.cordis.yml`)
      if (!existsSync(join(target, 'preset.yml'))) missing.push(`${role}: sin preset.yml`)
    }
    assert.deepEqual(missing, [], `presets invisibles para el roster:\n - ${missing.join('\n - ')}`)
  })

  test('el contenido del preset sigue al repo (editar el repo no exige reinstalar)', () => {
    const h = makeHome()
    assert.equal(runInstall(h).status, 0)
    const target = join(h.home, '.agent-presets', 'explorer', 'agent.cordis.yml')
    // Con directorio real + archivos enlazados, el repo sigue siendo la fuente
    // de verdad: lo instalado refleja el cambio sin volver a instalar.
    assert.equal(readFileSync(target, 'utf8'), readFileSync(join(REPO_ROOT, 'agents', 'explorer', 'agent.cordis.yml'), 'utf8'))
  })

  test('es idempotente: segunda corrida sin residuos ni cambios', () => {
    const h = makeHome()
    assert.equal(runInstall(h).status, 0)
    const snapshot = () => {
      const out: string[] = []
      const walk = (dir: string) => {
        for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
          const p = join(dir, e.name)
          out.push(`${p.replace(h.home, '')}:${lstatSync(p).isDirectory() ? 'dir' : 'file'}`)
          if (lstatSync(p).isDirectory()) walk(p)
        }
      }
      walk(h.home)
      return out
    }
    const before = snapshot()
    const r = runInstall(h)
    assert.equal(r.status, 0, r.stderr)
    assert.deepEqual(snapshot(), before, 'la segunda corrida cambió el árbol instalado')
    assert.deepEqual(
      before.filter((p) => p.includes('.backup.')),
      [],
      'la segunda corrida dejó backups: no es idempotente',
    )
  })

  test('preserva dependencias opcionales ya instaladas en el perfil', () => {
    const h = makeHome()
    assert.equal(runInstall(h).status, 0)
    const profilePkg = join(h.home, 'profiles', 'engineering', 'package.json')
    const parsed = JSON.parse(readFileSync(profilePkg, 'utf8')) as { dependencies: Record<string, string> }
    parsed.dependencies['@deepseek-ai/dsh-subagent-codex'] = '0.1.1-rc.3'
    writeFileSync(profilePkg, `${JSON.stringify(parsed, null, 2)}\n`)

    assert.equal(runInstall(h).status, 0)
    const after = JSON.parse(readFileSync(profilePkg, 'utf8')) as { dependencies: Record<string, string> }
    assert.equal(
      after.dependencies['@deepseek-ai/dsh-subagent-codex'],
      '0.1.1-rc.3',
      'la reinstalación borró una dependencia opcional del usuario',
    )
  })

  test('aborta con mensaje claro si falta dsh, antes de tocar nada', () => {
    const h = makeHome()
    // PATH con bash/node pero SIN dsh: el bin falso normal sí lo contiene.
    const binNoDsh = join(dirname(h.home), 'bin-no-dsh')
    mkdirSync(binNoDsh, { recursive: true })
    writeFileSync(join(binNoDsh, 'pnpm'), '#!/usr/bin/env bash\nexit 0\n')
    chmodSync(join(binNoDsh, 'pnpm'), 0o755)
    const r = spawnSync('bash', [INSTALL], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, DSH_HOME: h.home, HOME: h.home, PATH: `${binNoDsh}:/usr/bin:/bin` },
    })
    assert.equal(r.status, 1)
    assert.match(r.stderr, /'dsh' no está en PATH/)
    assert.equal(existsSync(join(h.home, 'AGENTS.md')), false, 'no debe instalar nada si falta dsh')
  })

  test('rechaza un flag desconocido con exit 2', () => {
    const h = makeHome()
    const r = runInstall(h, ['--flag-inexistente'])
    assert.equal(r.status, 2)
    assert.match(r.stderr, /Argumento desconocido/)
  })
})
