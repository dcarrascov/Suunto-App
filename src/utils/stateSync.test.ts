import { describe, expect, it } from 'vitest'
import { decide, hashString, type ServerPart } from './stateSync'

const local = JSON.stringify({ state: { shoes: ['a'] }, version: 1 })
const other = JSON.stringify({ state: { shoes: ['a', 'b'] }, version: 1 })
const server = (datos: string, version: number, guardado = '2026-11-25T10:00:00Z'): ServerPart => ({ version, guardado, datos: JSON.parse(datos) })
const synced = (raw: string, version: number, dirtyAt?: number) => ({ version, hash: hashString(raw), ...(dirtyAt ? { dirtyAt } : {}) })

describe('sincronizar con el servidor', () => {
  it('huella: cambia si cambia el texto', () => {
    expect(hashString(local)).toBe(hashString(local))
    expect(hashString(local)).not.toBe(hashString(other))
  })

  it('servidor vacío: sube lo de aquí (la primera vez, desde el dispositivo que tiene los datos)', () => {
    expect(decide(local, null, null)).toBe('subir')
    expect(decide(null, null, null)).toBe('nada')
  })

  it('primera vez en un dispositivo nuevo: manda lo del servidor; si ya coincide, nada', () => {
    expect(decide(null, null, server(other, 3))).toBe('bajar')
    expect(decide(local, null, server(other, 3))).toBe('bajar')
    expect(decide(local, null, server(local, 3))).toBe('nada')
  })

  it('misma versión: sube si se cambió aquí', () => {
    expect(decide(local, synced(local, 2), server(local, 2))).toBe('nada')
    expect(decide(other, synced(local, 2), server(local, 2))).toBe('subir')
  })

  it('otro dispositivo guardó algo más nuevo: se baja, salvo que lo de aquí sea posterior', () => {
    expect(decide(local, synced(local, 2), server(other, 3))).toBe('bajar')
    const t = Date.parse('2026-11-25T10:00:00Z')
    expect(decide(other, synced(local, 2, t + 60_000), server(local, 3))).toBe('subir')   // lo de aquí, después
    expect(decide(other, synced(local, 2, t - 60_000), server(local, 3))).toBe('bajar')   // lo del servidor, después
  })

  it('el servidor ha vuelto atrás (se vació o se restauró): se repone desde aquí', () => {
    expect(decide(local, synced(local, 5), server(other, 1))).toBe('subir')
  })
})
