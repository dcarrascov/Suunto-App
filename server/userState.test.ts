import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { loadAppData, sanitizeSettings } from './mcpData.ts'
import { readState, stateMiddleware, writeState } from './userState.ts'

const dir = mkdtempSync(join(tmpdir(), 'suunto-estado-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

function call(url: string, method: string, body?: string, demo = false): Promise<{ status: number; body: Record<string, unknown> }> {
  const req = Object.assign(new EventEmitter(), { url, method, destroy: () => {}, resume: () => {} }) as unknown as IncomingMessage
  return new Promise(resolve => {
    const res = {
      statusCode: 0, setHeader: () => {},
      end(chunk: string) { resolve({ status: this.statusCode, body: JSON.parse(chunk) }) },
    }
    stateMiddleware(() => dir, () => demo)(req, res as unknown as ServerResponse, () => resolve({ status: -1, body: {} }))
    if (body !== undefined) setTimeout(() => { req.emit('data', Buffer.from(body)); req.emit('end') }, 0)
  })
}

const shoes = { state: { shoes: [{ id: 'a', name: 'Diarias' }] }, version: 1 }

describe('lo del navegador, en el servidor', () => {
  it('guarda cada parte con una versión que sube en cada cambio', () => {
    expect(readState(dir, 'suunto-entrenos')).toBeNull()
    expect(writeState(dir, 'suunto-entrenos', { state: { workouts: [] }, version: 0 }).version).toBe(1)
    expect(writeState(dir, 'suunto-entrenos', { state: { workouts: [{ id: 'x' }] }, version: 0 }).version).toBe(2)
    expect(readState(dir, 'suunto-entrenos')?.datos).toEqual({ state: { workouts: [{ id: 'x' }] }, version: 0 })
    expect(() => writeState(dir, 'suunto-entrenos', { nada: 1 })).toThrow(TypeError)
    expect(() => writeState(dir, 'suunto-entrenos', null)).toThrow(TypeError)
  })

  it('GET da todas las partes; PUT guarda una y devuelve su versión', async () => {
    const put = await call('/api/estado/suunto-zapatillas', 'PUT', JSON.stringify({ datos: shoes }))
    expect(put).toMatchObject({ status: 200, body: { version: 1 } })
    const all = await call('/api/estado', 'GET')
    const partes = all.body.partes as Record<string, { version: number; datos: unknown } | null>
    expect(Object.keys(partes).sort()).toEqual(['suunto-ai', 'suunto-entrenos', 'suunto-settings', 'suunto-zapatillas'])
    expect(partes['suunto-zapatillas']).toMatchObject({ version: 1, datos: shoes })
    expect(partes['suunto-ai']).toBeNull()
  })

  it('solo las cuatro partes conocidas, con formato válido', async () => {
    expect((await call('/api/estado/otra-cosa', 'PUT', JSON.stringify({ datos: shoes }))).status).toBe(404)
    expect((await call('/api/estado/..%2f..%2f.env', 'PUT', JSON.stringify({ datos: shoes }))).status).toBe(404)
    expect((await call('/api/estado/suunto-ai', 'PUT', JSON.stringify({ datos: { state: [] } }))).status).toBe(400)
    expect((await call('/api/estado/suunto-ai', 'PUT', '{roto')).status).toBe(400)
    expect((await call('/api/estado', 'PUT', '{}')).status).toBe(405)
    expect((await call('/api/otra', 'GET')).status).toBe(-1)   // no es suya: sigue al resto del servidor
  })

  it('en la demo no se guarda nada y el navegador no sincroniza', async () => {
    expect(await call('/api/estado', 'GET', undefined, true)).toMatchObject({ status: 200, body: { demo: true } })
    expect((await call('/api/estado/suunto-ai', 'PUT', JSON.stringify({ datos: shoes }), true)).status).toBe(403)
    expect(readState(dir, 'suunto-ai')).toBeNull()
  })

  it('el MCP usa los ajustes guardados en el servidor, limpios', () => {
    writeFileSync(join(dir, 'activities.json'), '[]')
    expect(loadAppData(dir)).toMatchObject({ settingsSaved: false, settings: { maxHR: 185 } })
    writeState(dir, 'suunto-settings', { state: { settings: { maxHR: 199, thresholdPace: 226, hrUnreliable: true, otro: 'x' } }, version: 0 })
    expect(loadAppData(dir)).toMatchObject({ settingsSaved: true, settings: { maxHR: 199, thresholdPace: 226, hrUnreliable: true } })
    expect(loadAppData(dir).settings).not.toHaveProperty('otro')
  })

  it('ajustes: solo los campos que usan los cálculos, con valores con sentido', () => {
    expect(sanitizeSettings({ maxHR: 199, raceIds: [1, 'x', -3], dismissedHints: {}, thresholdPace: -1 })).toEqual({ maxHR: 199, raceIds: [1] })
    expect(sanitizeSettings(null)).toEqual({})
  })
})
