import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { sanitizeSettings, settingsMiddleware } from './settingsSync.ts'

function put(dir: string, body: string, demo = false): Promise<number> {
  const req = Object.assign(new EventEmitter(), { url: '/api/ajustes', method: 'PUT', destroy: () => {} }) as unknown as IncomingMessage
  return new Promise(resolve => {
    const res = { statusCode: 0, setHeader: () => {}, end() { resolve(this.statusCode) } }
    settingsMiddleware(() => dir, () => demo)(req, res as unknown as ServerResponse, () => resolve(-1))
    setTimeout(() => { req.emit('data', Buffer.from(body)); req.emit('end') }, 0)
  })
}

describe('PUT /api/ajustes', () => {
  it('guarda la copia limpia en ajustes.json; en la demo no guarda nada; un JSON roto da 400', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'suunto-ajustes-'))
    try {
      expect(await put(dir, JSON.stringify({ maxHR: 190, otro: 1 }))).toBe(204)
      expect(JSON.parse(readFileSync(join(dir, 'ajustes.json'), 'utf8'))).toEqual({ maxHR: 190 })
      expect(await put(dir, JSON.stringify({ maxHR: 170 }), true)).toBe(204)
      expect(JSON.parse(readFileSync(join(dir, 'ajustes.json'), 'utf8'))).toEqual({ maxHR: 190 })
      expect(await put(dir, '{roto')).toBe(400)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('copia de los ajustes en el servidor', () => {
  it('guarda solo los campos que usan los cálculos, con valores con sentido', () => {
    expect(sanitizeSettings({
      maxHR: 199, lthrRunning: 172, thresholdPace: 226, ftp: 250, raceIds: [1, 2, 'x', -3], hrUnreliable: true,
      dismissedHints: { maxHR: 199 }, otro: 'nada', lthrCycling: undefined,
    })).toEqual({ maxHR: 199, lthrRunning: 172, thresholdPace: 226, ftp: 250, raceIds: [1, 2], hrUnreliable: true })
  })
  it('descarta valores imposibles y lo que no es un objeto', () => {
    expect(sanitizeSettings({ maxHR: 999, thresholdPace: -1, splitSessions: 'sí' })).toEqual({})
    expect(sanitizeSettings(null)).toEqual({})
    expect(sanitizeSettings('ajustes')).toEqual({})
  })
})
