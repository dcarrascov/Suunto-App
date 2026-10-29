import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { isFitHeader, listFit, MAX_FIT_BYTES, safeFitName, saveFit } from './fit.ts'

/** Cabecera FIT mínima de 14 bytes («.FIT» en los bytes 8 a 11) y algo de contenido. */
function fit(extra = 'x'): Uint8Array {
  const head = [14, 0x10, 0, 0, 0, 0, 0, 0, ...'.FIT'.split('').map(c => c.charCodeAt(0)), 0, 0]
  return new Uint8Array([...head, ...new TextEncoder().encode(extra)])
}

let dir = ''
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }) })
const tmp = () => (dir = mkdtempSync(join(tmpdir(), 'fit-')))

describe('subida de ficheros FIT', () => {
  it('el nombre no puede salir de la carpeta ni llevar caracteres raros', () => {
    expect(safeFitName('Carrera 28-10.FIT')).toBe('Carrera 28-10.fit')
    expect(safeFitName('../../.env.fit')).toBe('env.fit')
    expect(safeFitName('C:\\Users\\yo\\Mañana: 10k.fit')).toBe('Manana_ 10k.fit')
    expect(safeFitName('notas.txt')).toBeNull()
    expect(safeFitName('.fit')).toBeNull()
  })
  it('solo acepta ficheros que empiezan como un FIT', () => {
    expect(isFitHeader(fit())).toBe(true)
    expect(isFitHeader(new TextEncoder().encode('esto no es un fit, aunque se llame así'))).toBe(false)
  })
  it('guarda, no duplica el mismo fichero y renombra si es otro con el mismo nombre', () => {
    const d = tmp()
    expect(saveFit(d, 'a.fit', fit('uno'))).toEqual({ status: 'saved', name: 'a.fit' })
    expect(saveFit(d, 'copia.fit', fit('uno'))).toEqual({ status: 'exists', name: 'a.fit' })
    expect(saveFit(d, 'a.fit', fit('dos'))).toEqual({ status: 'saved', name: 'a-2.fit' })
    expect(readdirSync(d).sort()).toEqual(['a-2.fit', 'a.fit'])
    expect(listFit(d).map(f => f.name)).toEqual(['a-2.fit', 'a.fit'])
  })
  it('rechaza lo que no es FIT o pasa de 20 MB', () => {
    const d = tmp()
    expect(saveFit(d, 'a.fit', new Uint8Array(20))).toMatchObject({ status: 'invalid' })
    expect(saveFit(d, 'a.txt', fit())).toMatchObject({ status: 'invalid' })
    expect(saveFit(d, 'a.fit', new Uint8Array(MAX_FIT_BYTES + 1))).toMatchObject({ status: 'invalid' })
    expect(listFit(d)).toEqual([])
  })
})
