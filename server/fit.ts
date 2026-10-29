// Ruta /api/fit del servidor de Vite (npm run dev / npm run preview): sube ficheros .fit desde el navegador a
// fetch/fit/. Solo desde este ordenador, solo ficheros FIT de verdad y sin salir de esa carpeta. En la demo no hace nada.

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import type { Connect, Plugin } from 'vite'

const LOCAL = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])
export const MAX_FIT_BYTES = 20 * 1024 * 1024

/** Nombre seguro dentro de fetch/fit/: sin carpetas ni caracteres raros, y con extensión .fit. null si no vale. */
export function safeFitName(raw: string): string | null {
  const base = raw.split(/[\\/]/).pop()?.trim() ?? ''
  if (!/\.fit$/i.test(base)) return null
  const stem = base.slice(0, -4).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._ ()-]+/g, '_')
    .replace(/^[.\s]+/, '').slice(0, 100)
  return stem ? `${stem}.fit` : null
}

/** ¿Empieza como un FIT? Cabecera de 12 o 14 bytes con «.FIT» en los bytes 8 a 11. */
export function isFitHeader(buf: Uint8Array): boolean {
  return buf.length >= 14 && (buf[0] === 12 || buf[0] === 14) && String.fromCharCode(buf[8], buf[9], buf[10], buf[11]) === '.FIT'
}

export type SaveResult = { status: 'saved' | 'exists'; name: string } | { status: 'invalid'; error: string }

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')

/**
 * Guarda el fichero en `dir`. Si ya hay uno igual (mismo contenido) no lo duplica; si hay otro con ese nombre pero
 * distinto, lo guarda como «nombre-2.fit».
 */
export function saveFit(dir: string, rawName: string, body: Uint8Array): SaveResult {
  const name = safeFitName(rawName)
  if (!name) return { status: 'invalid', error: 'El nombre debe acabar en .fit.' }
  if (body.length > MAX_FIT_BYTES) return { status: 'invalid', error: 'Pasa de 20 MB.' }
  if (!isFitHeader(body)) return { status: 'invalid', error: 'No es un fichero FIT.' }
  mkdirSync(dir, { recursive: true })
  const hash = sha(body)
  for (const f of readdirSync(dir)) {
    if (/\.fit$/i.test(f) && statSync(join(dir, f)).size === body.length && sha(readFileSync(join(dir, f))) === hash) {
      return { status: 'exists', name: f }
    }
  }
  let target = name
  for (let n = 2; existsSync(join(dir, target)); n++) target = name.replace(/\.fit$/i, `-${n}.fit`)
  writeFileSync(join(dir, target), body)
  return { status: 'saved', name: target }
}

/** Ficheros que ya hay en la carpeta. */
export function listFit(dir: string): { name: string; size: number }[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter(f => /\.fit$/i.test(f)).sort().map(f => ({ name: f, size: statSync(join(dir, f)).size }))
}

function readBody(req: IncomingMessage): Promise<Uint8Array | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > MAX_FIT_BYTES) {
        resolve(null)
        req.destroy()
      } else chunks.push(c)
    })
    req.on('end', () => resolve(new Uint8Array(Buffer.concat(chunks))))
    req.on('error', reject)
  })
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(body))
}

/** GET /api/fit (lista) y PUT /api/fit?name=… (sube uno; el cuerpo es el fichero tal cual). */
export function fitMiddleware(dir: () => string, demo: () => boolean = () => false): Connect.NextHandleFunction {
  return (req, res, next) => {
    const [path, query = ''] = (req.url ?? '').split('?')
    if (path !== '/api/fit') return next()
    if (!LOCAL.has(req.socket.remoteAddress ?? '')) return send(res, 403, { error: 'Solo disponible desde este ordenador.' })
    if (req.method === 'GET') return send(res, 200, { files: listFit(dir()), demo: demo() })
    if (req.method !== 'PUT') return send(res, 405, { error: 'Usa PUT.' })
    if (demo()) return send(res, 403, { error: 'En la demo no se suben ficheros.' })
    const name = new URLSearchParams(query).get('name') ?? ''
    readBody(req)
      .then(body => {
        if (!body) return send(res, 413, { status: 'invalid', error: 'Pasa de 20 MB.' })
        const r = saveFit(dir(), name, body)
        send(res, r.status === 'invalid' ? 400 : 200, r)
      })
      .catch(() => send(res, 500, { status: 'invalid', error: 'No se ha podido guardar el fichero.' }))
  }
}

/** Plugin de Vite: añade la ruta en `npm run dev` y en `npm run preview`. */
export function fitPlugin(): Plugin {
  let root = process.cwd()
  let demo = false
  const dir = () => join(root, 'fetch', 'fit')
  return {
    name: 'suunto-fit',
    configResolved(config) {
      root = config.root
      demo = config.mode === 'demo'
    },
    configureServer(server) {
      server.middlewares.use(fitMiddleware(dir, () => demo))
    },
    configurePreviewServer(server) {
      server.middlewares.use(fitMiddleware(dir, () => demo))
    },
  }
}
