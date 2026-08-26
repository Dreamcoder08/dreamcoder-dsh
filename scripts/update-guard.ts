#!/usr/bin/env node
// update-guard.ts — guard de vanguardia: compara el pin local de DSH contra
// la última release publicada upstream, para que "estar en la vanguardia" sea
// una verificación, no una intención.
//
// Uso:
//   node scripts/update-guard.ts [--strict] [--offline]
//
// Sin red (--offline): reporta el pin local y usa .evidence/upstream-cache.json
// si existe (cache escrita por corridas previas con red).
// Con red: consulta la API pública de GitHub (P3 NETWORK, declarado) y refresca
// el cache.
// --strict: exit 1 si hay versión nueva disponible; sin él, solo avisa (exit 0).
//
// Exit codes: 0 actualizado/aviso · 1 desactualizado bajo --strict · 2 uso/error.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO_TAGS = 'https://api.github.com/repos/deepseek-ai/deepseek-harness/tags?per_page=1'
const CACHE = join(process.cwd(), '.evidence', 'upstream-cache.json')

interface CacheShape {
  fetchedAt: string
  latest: string | null
}

const argv: readonly string[] = process.argv.slice(2)
const strict = argv.includes('--strict')
const offline = argv.includes('--offline')
if (argv.some((a) => a !== '--strict' && a !== '--offline')) {
  console.error('Uso: node scripts/update-guard.ts [--strict] [--offline]')
  process.exit(2)
}

/** Pin local: versión del paquete global dsh instalado vía pnpm. */
const localVersion = (): string | null => {
  const r = spawnSync('dsh', ['--version'], { encoding: 'utf8' })
  if (r.status === 0 && r.stdout !== '') return r.stdout.trim().replace(/^v/, '')
  return null
}

const fetchUpstream = async (): Promise<string | null> => {
  try {
    // El repo no publica "releases/latest": el canal de versiones son los
    // tags con prefijo dsh-v…; pedimos el primero (más reciente).
    const res = await fetch(REPO_TAGS, { headers: { 'User-Agent': 'dreamcoder-update-guard' } })
    if (!res.ok) return null
    const body = (await res.json()) as { name?: string }[]
    const tag = body[0]?.name ?? ''
    const m = tag.match(/v?(\d[\w.\-+]*)$/)
    return m !== null ? (m[1] ?? null) : null
  } catch {
    return null
  }
}

const compare = (local: string, upstream: string): number => {
  const seg = (v: string): number[] => v.split(/[.\-+]/).map((x) => Number.parseInt(x, 10) || 0)
  const a = seg(local)
  const b = seg(upstream)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (b[i] ?? 0) - (a[i] ?? 0)
    if (diff !== 0) return diff > 0 ? -1 : 1 // -1: upstream mayor → desactualizado
  }
  return 0
}

const local = localVersion()
console.log(`pin local de dsh: ${local ?? '(no detectado)'}`)

let upstream: string | null = null
let source = ''
if (!offline) {
  upstream = await fetchUpstream()
  if (upstream !== null) {
    source = 'GitHub API'
    try {
      mkdirSync(join(process.cwd(), '.evidence'), { recursive: true })
      writeFileSync(CACHE, JSON.stringify({ fetchedAt: new Date().toISOString(), latest: upstream } satisfies CacheShape, null, 2) + '\n')
    } catch {
      /* cache best-effort */
    }
  }
}
if (upstream === null) {
  if (existsSync(CACHE)) {
    try {
      upstream = (JSON.parse(readFileSync(CACHE, 'utf8')) as CacheShape).latest ?? null
      source = `cache ${CACHE} (${(JSON.parse(readFileSync(CACHE, 'utf8')) as CacheShape).fetchedAt})`
    } catch {
      /* cache corrupta: se ignora */
    }
  }
}

if (upstream === null || local === null) {
  console.error('⚠ No se pudo determinar la comparación (sin red y sin cache, o pin local indetectable).')
  process.exit(offline ? 0 : 2)
}
console.log(`última upstream: ${upstream} (fuente: ${source})`)

const cmp = compare(local, upstream)
if (cmp === 0) {
  console.log('✔ En la vanguardia: el pin local coincide con la última release.')
  process.exit(0)
}
if (cmp < 0) {
  console.error(`✘ Hay release nueva upstream (${upstream} > ${local}). Ejecuta la suite verify-compat tras actualizar.`)
  process.exit(strict ? 1 : 0)
}
console.log('ℹ El pin local está por delante de la última release etiquetada.')
process.exit(0)
