// Ruta /api/estado del servidor de Vite: guarda en el servidor lo que la app guarda en el navegador (ajustes, IA,
// entrenos propios y zapatillas), para verlo igual en todos tus dispositivos. La sincronización está en
// src/utils/stateSync.ts. Cada parte va en public/data/estado/<clave>.json con su versión y la hora del último cambio.
// El acceso lo decide server/auth.ts (como el resto de la app). En la demo no se guarda nada.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import type { Connect, Plugin } from 'vite'

// Las mismas claves que la copia de seguridad (src/utils/backup.ts): nada más se acepta
export const STATE_KEYS = ['suunto-settings', 'suunto-ai', 'suunto-entrenos', 'suunto-zapatillas'] as const
export type StateKey = typeof STATE_KEYS[number]
export const MAX_STATE_BYTES = 2_000_000

export interface StoredState {
  version: number       // sube en cada cambio
  guardado: string      // ISO, hora del servidor
  datos: unknown        // lo mismo que guarda el navegador: { state, version } de zustand
}

const isKey = (k: string): k is StateKey => (STATE_KEYS as readonly string[]).includes(k)
export const stateDir = (dataDir: string) => join(dataDir, 'estado')

/** Escribe sin dejar nunca un fichero a medias: primero uno temporal y luego se renombra. */
export function writeJsonAtomic(path: string, data: unknown): void {
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(data), 'utf8')
  renameSync(tmp, path)
}

export function readState(dataDir: string, key: StateKey): StoredState | null {
  const file = join(stateDir(dataDir), `${key}.json`)
  if (!existsSync(file)) return null
  try {
    const s = JSON.parse(readFileSync(file, 'utf8')) as StoredState
    return typeof s?.version === 'number' && s.datos && typeof s.datos === 'object' ? s : null
  } catch {
    return null
  }
}

/** Guarda una parte y devuelve su versión nueva. `datos` tiene que ser lo que guarda zustand: { state: {…} }. */
export function writeState(dataDir: string, key: StateKey, datos: unknown, now: Date = new Date()): StoredState {
  const d = datos as { state?: unknown } | null
  if (!d || typeof d !== 'object' || !d.state || typeof d.state !== 'object' || Array.isArray(d.state)) {
    throw new TypeError('Formato no válido.')
  }
  const next: StoredState = { version: (readState(dataDir, key)?.version ?? 0) + 1, guardado: now.toISOString(), datos }
  mkdirSync(stateDir(dataDir), { recursive: true })
  writeJsonAtomic(join(stateDir(dataDir), `${key}.json`), next)
  return next
}

function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > MAX_STATE_BYTES) {
        resolve(null)
        req.destroy()
      } else chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(body))
}

/** GET /api/estado (todas las partes) y PUT /api/estado/<clave> ({ datos }). */
export function stateMiddleware(dataDir: () => string, demo: () => boolean = () => false): Connect.NextHandleFunction {
  return (req, res, next) => {
    const path = req.url?.split('?')[0] ?? ''
    if (path !== '/api/estado' && !path.startsWith('/api/estado/')) return next()
    if (demo()) {
      // la demo es de solo lectura: el navegador no sincroniza nada
      if (req.method === 'GET' && path === '/api/estado') return send(res, 200, { demo: true, partes: {} })
      req.resume()
      return send(res, 403, { error: 'En la demo no se guarda nada.' })
    }
    if (path === '/api/estado') {
      if (req.method !== 'GET') return send(res, 405, { error: 'Usa GET.' })
      return send(res, 200, { partes: Object.fromEntries(STATE_KEYS.map(k => [k, readState(dataDir(), k)])) })
    }
    const key = decodeURIComponent(path.slice('/api/estado/'.length))
    if (!isKey(key)) return send(res, 404, { error: 'No existe esa parte.' })
    if (req.method !== 'PUT') return send(res, 405, { error: 'Usa PUT.' })
    readBody(req)
      .then(raw => {
        if (raw == null) return send(res, 413, { error: 'Ocupa demasiado.' })
        const body = JSON.parse(raw) as { datos?: unknown }
        const saved = writeState(dataDir(), key, body?.datos)
        send(res, 200, { version: saved.version, guardado: saved.guardado })
      })
      .catch((e: unknown) => send(res, e instanceof SyntaxError || e instanceof TypeError ? 400 : 500,
        { error: e instanceof TypeError ? e.message : 'No se ha podido guardar.' }))
  }
}

/** Plugin de Vite: añade la ruta en `npm run dev` y en `npm run preview`. */
export function statePlugin(): Plugin {
  let dir = ''
  let demo = false
  return {
    name: 'suunto-state',
    configResolved(config) {
      dir = join(config.publicDir, 'data')
      demo = config.mode === 'demo'
    },
    configureServer(server) {
      server.middlewares.use(stateMiddleware(() => dir, () => demo))
    },
    configurePreviewServer(server) {
      server.middlewares.use(stateMiddleware(() => dir, () => demo))
    },
  }
}
