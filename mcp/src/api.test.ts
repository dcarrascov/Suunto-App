import { describe, expect, it } from 'vitest'
import { apiGet, buildPath, checkBaseUrl, configFromEnv } from './api.js'
import { TOOLS } from './tools.js'

const TOKEN = 'k'.repeat(40)
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('configuración del MCP', () => {
  it('HTTPS siempre; HTTP solo en este ordenador', () => {
    expect(checkBaseUrl('https://suunto.example.com/algo')).toBe('https://suunto.example.com')
    expect(checkBaseUrl('http://localhost:5173')).toBe('http://localhost:5173')
    expect(() => checkBaseUrl('http://suunto.example.com')).toThrow(/https/)
    expect(() => checkBaseUrl('ftp://x')).toThrow()
    expect(() => checkBaseUrl('no es una url')).toThrow(/válida/)
  })
  it('exige un token largo', () => {
    expect(() => configFromEnv({ SUUNTO_APP_URL: 'http://localhost:5173', SUUNTO_MCP_TOKEN: 'corto' })).toThrow(/SUUNTO_MCP_TOKEN/)
    expect(configFromEnv({ SUUNTO_APP_URL: 'http://localhost:5173', SUUNTO_MCP_TOKEN: TOKEN })).toEqual({ baseUrl: 'http://localhost:5173', token: TOKEN })
  })
})

describe('llamadas a la app', () => {
  it('ruta con los parámetros que no están vacíos y el token en la cabecera', async () => {
    expect(buildPath('actividades', { desde: '2026-11-01', texto: '', limite: 5, deporte: undefined })).toBe('/api/mcp/v1/actividades?desde=2026-11-01&limite=5')
    let seen: { url: string; auth: string | null } | null = null
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen = { url, auth: new Headers(init.headers).get('authorization') }
      return json(200, { ok: 1 })
    }) as unknown as typeof fetch
    expect(await apiGet({ baseUrl: 'https://x.example', token: TOKEN, fetchImpl }, 'perfil')).toEqual({ ok: 1 })
    expect(seen).toEqual({ url: 'https://x.example/api/mcp/v1/perfil', auth: `Bearer ${TOKEN}` })
  })
  it('errores explicados en español', async () => {
    const cfg = (res: Response | Error) => ({
      baseUrl: 'https://x.example', token: TOKEN,
      fetchImpl: (async () => { if (res instanceof Error) throw res; return res }) as unknown as typeof fetch,
    })
    await expect(apiGet(cfg(json(401, { error: 'x' })), 'perfil')).rejects.toThrow(/MCP_TOKEN/)
    await expect(apiGet(cfg(json(400, { error: '«dias» debe ser…' })), 'forma')).rejects.toThrow('«dias» debe ser…')
    await expect(apiGet(cfg(new Response('', { status: 302, headers: { location: '/login' } })), 'perfil')).rejects.toThrow(/Authelia/)
    await expect(apiGet(cfg(new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } })), 'perfil')).rejects.toThrow(/SUUNTO_APP_URL/)
    await expect(apiGet(cfg(new TypeError('fetch failed')), 'perfil')).rejects.toThrow(/conexión/)
  })
})

describe('herramientas', () => {
  it('cada herramienta apunta a su ruta', () => {
    const route = (name: string, args: Record<string, string | number | boolean | undefined> = {}) =>
      TOOLS.find(t => t.name === name)!.route(args)
    expect(TOOLS.map(t => t.name)).toEqual([
      'perfil_atleta', 'listar_actividades', 'ver_actividad', 'resumen_semanal', 'estado_de_forma',
      'records_y_predicciones', 'distribucion_intensidad', 'plan_entrenador', 'estilo_entrenador', 'competiciones', 'comparar_semana',
    ])
    expect(route('estilo_entrenador', { antes_de: '2026-11-23' })).toEqual(['estilo', { antes_de: '2026-11-23' }])
    expect(route('ver_actividad', { id: 42 })).toEqual(['actividades/42', {}])
    expect(route('listar_actividades', { solo_competiciones: true })[1]).toMatchObject({ competiciones: true })
    expect(route('comparar_semana', { semana: '2026-11-16' })).toEqual(['semana/2026-11-16', {}])
  })
})
