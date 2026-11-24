// Ruta PUT /api/ajustes del servidor de Vite: la app manda una copia de sus ajustes (que viven en el navegador) para
// que el MCP calcule con los mismos números que la pantalla (zonas, TSS estimado, competiciones marcadas).
// Solo se guardan los campos conocidos y con valores con sentido. En la demo no se guarda nada.

import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import type { Connect, Plugin } from 'vite'
import type { UserSettings } from '../src/types/suunto.ts'

export const SETTINGS_FILE = 'ajustes.json'
const MAX_BODY_BYTES = 20_000
const MAX_IDS = 5000

const inRange = (v: unknown, min: number, max: number): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? Math.round(v) : undefined

const ids = (v: unknown): number[] | undefined =>
  Array.isArray(v) ? v.filter((x): x is number => Number.isSafeInteger(x) && x >= 0).slice(0, MAX_IDS) : undefined

/** Solo los ajustes que usan los cálculos, y solo si sus valores tienen sentido. */
export function sanitizeSettings(raw: unknown): Partial<UserSettings> {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const out: Partial<UserSettings> = {
    maxHR: inRange(s.maxHR, 100, 240),
    ftp: inRange(s.ftp, 50, 700),
    lthrRunning: inRange(s.lthrRunning, 90, 230),
    lthrCycling: inRange(s.lthrCycling, 90, 230),
    lthrSwimming: inRange(s.lthrSwimming, 90, 230),
    thresholdPace: inRange(s.thresholdPace, 120, 900),
    raceIds: ids(s.raceIds),
    notRaceIds: ids(s.notRaceIds),
    hrUnreliable: typeof s.hrUnreliable === 'boolean' ? s.hrUnreliable : undefined,
    splitSessions: typeof s.splitSessions === 'boolean' ? s.splitSessions : undefined,
  }
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined)) as Partial<UserSettings>
}

/** Escribe sin dejar nunca un fichero a medias: primero uno temporal y luego se renombra. */
export function writeJsonAtomic(path: string, data: unknown): void {
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(data, null, 1), 'utf8')
  renameSync(tmp, path)
}

function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > MAX_BODY_BYTES) {
        resolve(null)
        req.destroy()
      } else chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function send(res: ServerResponse, status: number, body?: unknown) {
  res.statusCode = status
  res.setHeader('Cache-Control', 'no-store')
  if (body === undefined) return res.end()
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

/** PUT /api/ajustes con los ajustes de la app en JSON. */
export function settingsMiddleware(dir: () => string, demo: () => boolean = () => false): Connect.NextHandleFunction {
  return (req, res, next) => {
    if (req.url?.split('?')[0] !== '/api/ajustes') return next()
    if (req.method !== 'PUT') return send(res, 405, { error: 'Usa PUT.' })
    readBody(req)
      .then(raw => {
        if (raw == null) return send(res, 413, { error: 'Los ajustes ocupan demasiado.' })
        const settings = sanitizeSettings(JSON.parse(raw))
        if (demo()) return send(res, 204)   // la demo es de solo lectura: se acepta y no se guarda
        mkdirSync(dir(), { recursive: true })
        writeJsonAtomic(join(dir(), SETTINGS_FILE), settings)
        send(res, 204)
      })
      .catch((e: unknown) => send(res, e instanceof SyntaxError ? 400 : 500, { error: 'No se han podido guardar los ajustes.' }))
  }
}

/** Plugin de Vite: añade la ruta en `npm run dev` y en `npm run preview`. */
export function settingsPlugin(): Plugin {
  let dir = ''
  let demo = false
  return {
    name: 'suunto-settings',
    configResolved(config) {
      dir = join(config.publicDir, 'data')
      demo = config.mode === 'demo'
    },
    configureServer(server) {
      server.middlewares.use(settingsMiddleware(() => dir, () => demo))
    },
    configurePreviewServer(server) {
      server.middlewares.use(settingsMiddleware(() => dir, () => demo))
    },
  }
}
