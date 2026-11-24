import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { mcpHandler } from './mcpApi.ts'
import { deleteProposal, listProposals, MCP_MODEL, saveProposal } from './mcpProposals.ts'
import { readState, writeState } from './userState.ts'

// «Hoy» = jueves 19-11-2026; la semana que viene empieza el lunes 23
const TODAY = '2026-11-19'
const NOW = () => new Date(2026, 10, 19, 12, 0)
const dir = mkdtempSync(join(tmpdir(), 'suunto-propuestas-'))
writeFileSync(join(dir, 'activities.json'), '[]')
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const week = [
  { fecha: '2026-11-23', tipo: 'rodaje', titulo: 'Rodaje 50 min', descripcion: 'Z2', duracion_min: 50 },
  { fecha: '2026-11-25', tipo: 'series', titulo: 'Series 6x1000', duracion_min: 60, tss: 75 },
  { fecha: '2026-11-29', tipo: 'rodaje', titulo: 'Tirada larga', duracion_min: 90 },
]
const ai = () => (readState(dir, 'suunto-ai')!.datos as { state: Record<string, Record<string, { model: string; mode?: string; workouts: unknown[] }>> }).state

describe('propuestas que guarda Claude', () => {
  it('se guardan en la parte «entrenador IA» del servidor, en el formato de la app, y la versión sube', () => {
    const p = saveProposal(dir, { semana: '2026-11-25', modo: 'como_entrenador', explicacion: 'Semana de carga', sesiones: week }, TODAY)
    expect(p).toMatchObject({ weekStart: '2026-11-23', model: MCP_MODEL, explanation: 'Semana de carga' })
    expect(p.workouts.map(w => [w.date, w.type, w.durationMin])).toEqual([['2026-11-23', 'rodaje', 50], ['2026-11-25', 'series', 60], ['2026-11-29', 'rodaje', 90]])
    expect(ai().proposals['2026-11-23']).toMatchObject({ model: MCP_MODEL })
    expect(readState(dir, 'suunto-ai')?.version).toBe(1)
  })

  it('no pisa lo que ya hay salvo que se pida, y conserva lo demás de la parte (perfil, objetivo…)', () => {
    const datos = readState(dir, 'suunto-ai')!.datos as { state: Record<string, unknown>; version: number }
    writeState(dir, 'suunto-ai', { ...datos, state: { ...datos.state, profile: { text: 'perfil', savedAt: 'x' } } })
    expect(() => saveProposal(dir, { semana: '2026-11-23', modo: 'como_entrenador', explicacion: '', sesiones: week }, TODAY)).toThrow(/reemplazar/)
    saveProposal(dir, { semana: '2026-11-23', modo: 'como_entrenador', explicacion: 'Otra', sesiones: week.slice(0, 1), reemplazar: true }, TODAY)
    expect(ai().proposals['2026-11-23'].workouts).toHaveLength(1)
    expect(ai().profile).toEqual({ text: 'perfil', savedAt: 'x' })
    // sin entrenador va aparte, con su modo
    saveProposal(dir, { semana: '2026-11-23', modo: 'sin_entrenador', explicacion: '', sesiones: week }, TODAY)
    expect(ai().freeProposals['2026-11-23']).toMatchObject({ mode: 'free', model: MCP_MODEL })
  })

  it('valida como las de la app: fechas de esa semana, números con sentido, semanas cercanas', () => {
    const bad = (sesiones: unknown, semana = '2026-11-23', modo = 'como_entrenador') =>
      () => saveProposal(dir, { semana, modo: modo as 'como_entrenador', explicacion: '', sesiones, reemplazar: true }, TODAY)
    expect(bad([{ ...week[0], fecha: '2026-12-01' }])).toThrow(/no es de la semana/)
    expect(bad([{ ...week[0], duracion_min: 9999 }])).toThrow(/duracion_min/)
    expect(bad([{ ...week[0], titulo: 'x'.repeat(200) }])).toThrow(/titulo/)
    expect(bad([])).toThrow(/Faltan/)
    expect(bad(Array(22).fill(week[0]))).toThrow(/21/)
    expect(bad(week, '2027-12-06')).toThrow(/semanas/)
    expect(bad(week, '2026-11-23', 'otro')).toThrow(/modo/)
  })

  it('solo borra las que guardó Claude', () => {
    const datos = readState(dir, 'suunto-ai')!.datos as { state: Record<string, Record<string, unknown>>; version: number }
    const app = { weekStart: '2026-11-30', createdAt: 'x', explanation: '', model: 'gemini-3.8-flash', workouts: [] }
    writeState(dir, 'suunto-ai', { ...datos, state: { ...datos.state, proposals: { ...datos.state.proposals, '2026-11-30': app } } })
    expect(() => deleteProposal(dir, '2026-11-30', 'como_entrenador', TODAY)).toThrow(/no la guardó Claude/)
    // ni siquiera con reemplazar se pisa una propuesta del Entrenador IA de la app
    expect(() => saveProposal(dir, { semana: '2026-11-30', modo: 'como_entrenador', explicacion: '', sesiones: [{ ...week[0], fecha: '2026-11-30' }], reemplazar: true }, TODAY)).toThrow(/Entrenador IA de la app/)
    expect(() => deleteProposal(dir, '2026-12-07', 'como_entrenador', TODAY)).toThrow(/No hay propuesta/)
    deleteProposal(dir, '2026-11-24', 'sin_entrenador', TODAY)
    expect(ai().freeProposals['2026-11-23']).toBeUndefined()
    expect(listProposals(dir, null, TODAY).propuestas.map(p => [p.semana, p.de])).toEqual([['2026-11-30', 'gemini-3.8-flash'], ['2026-11-23', 'Claude (MCP)']])
  })
})

function call(url: string, method: string, body?: string, readOnly = false): Promise<{ status: number; body: Record<string, unknown> }> {
  const req = Object.assign(new EventEmitter(), { url, method, destroy: () => {} }) as unknown as IncomingMessage
  return new Promise(resolve => {
    const res = { statusCode: 0, setHeader: () => {}, end(chunk: string) { resolve({ status: this.statusCode, body: JSON.parse(chunk) }) } }
    mcpHandler(() => dir, NOW, () => readOnly)(req, res as unknown as ServerResponse)
    if (body !== undefined) setTimeout(() => { req.emit('data', Buffer.from(body)); req.emit('end') }, 0)
  })
}

describe('rutas de escritura del MCP', () => {
  it('PUT guarda, GET lista y DELETE borra; nada más escribe', async () => {
    const put = await call('/api/mcp/v1/propuestas/2026-12-02', 'PUT', JSON.stringify({ modo: 'sin_entrenador', explicacion: 'x', sesiones: [{ ...week[0], fecha: '2026-12-01' }] }))
    expect(put).toMatchObject({ status: 200, body: { guardada: true, semana: '2026-11-30', sesiones: 1 } })
    expect((await call('/api/mcp/v1/propuestas?semana=2026-12-01', 'GET')).body.propuestas).toHaveLength(2)
    expect((await call('/api/mcp/v1/propuestas/2026-12-02?modo=sin_entrenador', 'DELETE')).body).toEqual({ borrada: true })
    expect((await call('/api/mcp/v1/perfil', 'PUT', '{}')).status).toBe(405)
    expect((await call('/api/mcp/v1/propuestas', 'POST', '{}')).status).toBe(405)
    expect((await call('/api/mcp/v1/propuestas/2026-12-02', 'PUT', '{roto')).status).toBe(400)
    expect((await call('/api/mcp/v1/propuestas/2026-12-02', 'PUT', 'x'.repeat(200_000))).status).toBe(413)
  })
  it('en la demo no se guarda nada', async () => {
    expect((await call('/api/mcp/v1/propuestas/2026-12-02', 'PUT', JSON.stringify({ modo: 'sin_entrenador', sesiones: week }), true)).status).toBe(403)
  })
})
