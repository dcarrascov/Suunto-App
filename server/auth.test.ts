import { describe, expect, it } from 'vitest'
import { authModeOf, checkAccess, logoutUrlOf, SECRET_HEADER, securityHeaders } from './auth.ts'

const SECRET = 'x'.repeat(32)
const AUTHELIA = { AUTH_MODE: 'authelia', AUTH_PROXY_SECRET: SECRET }
const req = (headers: Record<string, string>, remoteAddress = '127.0.0.1', method = 'GET') =>
  ({ method, headers, socket: { remoteAddress } })
const viaProxy = (over: Record<string, string> = {}) =>
  req({ host: 'suunto.example.com', [SECRET_HEADER]: SECRET, 'remote-user': 'diego', ...over }, '10.0.1.5')

describe('sin login (por defecto)', () => {
  it('sin AUTH_MODE: entra este ordenador', () => {
    expect(authModeOf({})).toBe('none')
    for (const host of ['localhost:5173', '127.0.0.1:5173', '[::1]:5173']) {
      expect(checkAccess(req({ host }), {})).toEqual({ ok: true, mode: 'none', user: null, mcp: false })
    }
  })
  it('no entra otro equipo, ni un dominio, ni nada que venga por un proxy', () => {
    expect(checkAccess(req({ host: 'localhost:5173' }, '192.168.1.40'), {})).toMatchObject({ ok: false, status: 403 })
    expect(checkAccess(req({ host: 'suunto.example.com' }), {})).toMatchObject({ ok: false, status: 403 })
    expect(checkAccess(req({ host: 'localhost', 'x-forwarded-for': '8.8.8.8' }), {})).toMatchObject({ ok: false, status: 403 })
    expect(checkAccess(req({}), {})).toMatchObject({ ok: false, status: 403 })
  })
})

describe('con Authelia', () => {
  it('entra quien llega por el proxy e identificado', () => {
    expect(checkAccess(viaProxy(), AUTHELIA)).toEqual({ ok: true, mode: 'authelia', user: 'diego', mcp: false })
  })
  it('sin el secreto del proxy, o sin usuario, no entra (aunque se invente la cabecera del usuario)', () => {
    expect(checkAccess(req({ host: 'suunto.example.com', 'remote-user': 'diego' }), AUTHELIA)).toMatchObject({ ok: false, status: 401 })
    expect(checkAccess(viaProxy({ [SECRET_HEADER]: 'y'.repeat(32) }), AUTHELIA)).toMatchObject({ ok: false, status: 401 })
    expect(checkAccess(viaProxy({ 'remote-user': ' ' }), AUTHELIA)).toMatchObject({ ok: false, status: 401 })
  })
  it('mal configurado: se niega todo', () => {
    expect(checkAccess(viaProxy(), { AUTH_MODE: 'authelia' })).toMatchObject({ ok: false, status: 503 })
    expect(checkAccess(viaProxy({ [SECRET_HEADER]: 'corto' }), { AUTH_MODE: 'authelia', AUTH_PROXY_SECRET: 'corto' })).toMatchObject({ ok: false, status: 503 })
    expect(checkAccess(viaProxy(), { AUTH_MODE: 'abierto' })).toMatchObject({ ok: false, status: 500 })
  })
  it('una web de otro sitio no puede lanzar acciones; la propia sí', () => {
    const post = (headers: Record<string, string>) => ({ ...viaProxy(headers), method: 'POST' })
    expect(checkAccess(post({ origin: 'https://malo.example.org' }), AUTHELIA)).toMatchObject({ ok: false, status: 403 })
    expect(checkAccess(post({ 'sec-fetch-site': 'cross-site' }), AUTHELIA)).toMatchObject({ ok: false, status: 403 })
    expect(checkAccess(post({ origin: 'https://suunto.example.com' }), AUTHELIA).ok).toBe(true)
    expect(checkAccess(req({ host: 'localhost:5173', origin: 'https://malo.example.org' }, '127.0.0.1', 'POST'), {})).toMatchObject({ ok: false, status: 403 })
  })
})

describe('peticiones de otras webs', () => {
  const local = (url: string, headers: Record<string, string>, method = 'GET') =>
    ({ method, url, headers: { host: 'localhost:5173', ...headers }, socket: { remoteAddress: '127.0.0.1' } })
  const other = (dest: string, mode: string, site = 'cross-site') => ({ 'sec-fetch-site': site, 'sec-fetch-mode': mode, 'sec-fetch-dest': dest })
  it('desde otra web no se piden datos, ni rutas internas de Vite, ni se incrusta la app', () => {
    expect(checkAccess(local('/__open-in-editor?file=x', other('image', 'no-cors')), {})).toMatchObject({ ok: false, status: 403 })
    expect(checkAccess(local('/__open-in-editor?file=x', other('document', 'navigate')), {})).toMatchObject({ ok: false, status: 403 })
    expect(checkAccess(local('/data/activities.json', other('empty', 'cors', 'same-site')), {})).toMatchObject({ ok: false, status: 403 })
    expect(checkAccess(local('/api/sync/status', other('script', 'no-cors')), {})).toMatchObject({ ok: false, status: 403 })
    expect(checkAccess(local('/', other('iframe', 'navigate')), {})).toMatchObject({ ok: false, status: 403 })
  })
  it('un enlace desde otra web abre la app; la propia app y las herramientas sin navegador pasan', () => {
    expect(checkAccess(local('/activity/1', other('document', 'navigate')), {}).ok).toBe(true)
    expect(checkAccess(local('/data/activities.json', other('empty', 'cors', 'same-origin')), {}).ok).toBe(true)
    expect(checkAccess(local('/data/activities.json', {}), {}).ok).toBe(true)
    // vuelta del login de Authelia (auth.suunto… → suunto…: mismo sitio)
    expect(checkAccess({ ...viaProxy(other('document', 'navigate', 'same-site')), url: '/' }, AUTHELIA).ok).toBe(true)
  })
  it('cabeceras de seguridad; HSTS solo con el dominio público', () => {
    expect(securityHeaders('none')).toMatchObject({ 'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff' })
    expect(securityHeaders('none')['Strict-Transport-Security']).toBeUndefined()
    expect(securityHeaders('authelia')['Strict-Transport-Security']).toMatch(/max-age=/)
  })
})

describe('token del MCP', () => {
  const TOKEN = 'm'.repeat(40)
  const bearer = { authorization: `Bearer ${TOKEN}` }
  const mcpReq = (headers: Record<string, string>, remote = '127.0.0.1', url = '/api/mcp/v1/perfil') =>
    ({ method: 'GET', url, headers: { host: 'localhost:5173', ...headers }, socket: { remoteAddress: remote } })
  it('sin MCP_TOKEN (o corto) el MCP está apagado', () => {
    expect(checkAccess(mcpReq(bearer), {})).toMatchObject({ ok: false, status: 404 })
    expect(checkAccess(mcpReq(bearer), { MCP_TOKEN: 'corto' })).toMatchObject({ ok: false, status: 404 })
  })
  it('en local: entra con el token correcto y solo a /api/mcp/', () => {
    expect(checkAccess(mcpReq(bearer), { MCP_TOKEN: TOKEN })).toEqual({ ok: true, mode: 'none', user: null, mcp: true })
    expect(checkAccess(mcpReq({ authorization: `Bearer ${'x'.repeat(40)}` }), { MCP_TOKEN: TOKEN })).toMatchObject({ ok: false, status: 401 })
    // sin token, como si la ruta no existiera
    expect(checkAccess(mcpReq({}), { MCP_TOKEN: TOKEN })).toMatchObject({ ok: false, status: 404 })
    // el token no abre nada más: el resto sigue con sus reglas (aquí, solo este ordenador)
    expect(checkAccess(mcpReq(bearer, '127.0.0.1', '/data/activities.json'), { MCP_TOKEN: TOKEN })).toMatchObject({ ok: true, mcp: false })
    // otro equipo de la red no llega aunque tenga el token
    expect(checkAccess(mcpReq(bearer, '192.168.1.40'), { MCP_TOKEN: TOKEN })).toMatchObject({ ok: false, status: 403 })
  })
  it('con Authelia: sin usuario pero con el secreto del proxy y el token', () => {
    const env = { ...AUTHELIA, MCP_TOKEN: TOKEN }
    const viaTraefik = (h: Record<string, string>, url = '/api/mcp/v1/forma') =>
      ({ method: 'GET', url, headers: { host: 'suunto.example.com', [SECRET_HEADER]: SECRET, ...h }, socket: { remoteAddress: '10.0.1.5' } })
    expect(checkAccess(viaTraefik(bearer), env)).toEqual({ ok: true, mode: 'authelia', user: null, mcp: true })
    // sin el secreto (alguien que llega a la app sin pasar por Traefik) no entra aunque tenga el token
    expect(checkAccess({ ...viaTraefik(bearer), headers: { host: 'x', ...bearer } }, env)).toMatchObject({ ok: false, status: 401 })
    // fuera de /api/mcp/ el token no sirve: hace falta el usuario de Authelia
    expect(checkAccess(viaTraefik(bearer, '/data/activities.json'), env)).toMatchObject({ ok: false, status: 401 })
    expect(checkAccess(viaTraefik(bearer, '/api/sync/status'), env)).toMatchObject({ ok: false, status: 401 })
  })
  it('rutas con barras codificadas: fuera siempre (Traefik y la app podrían entenderlas distinto)', () => {
    const env = { ...AUTHELIA, MCP_TOKEN: TOKEN }
    const forged = (url: string) => ({
      method: 'GET', url,
      headers: { host: 'suunto.example.com', [SECRET_HEADER]: SECRET, 'remote-user': 'diego', ...bearer },
      socket: { remoteAddress: '10.0.1.5' },
    })
    for (const url of ['/api%2Fmcp/v1/perfil', '/api/mcp%2f..%2f..%2fdata/activities.json', '/data%5Cactivities.json']) {
      expect(checkAccess(forged(url), env), url).toMatchObject({ ok: false, status: 400 })
    }
  })
})

describe('cerrar sesión', () => {
  it('solo acepta direcciones web', () => {
    expect(logoutUrlOf({ AUTH_LOGOUT_URL: 'https://auth.example.com/logout' })).toBe('https://auth.example.com/logout')
    expect(logoutUrlOf({ AUTH_LOGOUT_URL: 'javascript:alert(1)' })).toBeNull()
    expect(logoutUrlOf({})).toBeNull()
  })
})
