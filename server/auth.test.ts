import { describe, expect, it } from 'vitest'
import { authModeOf, checkAccess, logoutUrlOf, SECRET_HEADER } from './auth.ts'

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
      expect(checkAccess(req({ host }), {})).toEqual({ ok: true, mode: 'none', user: null })
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
    expect(checkAccess(viaProxy(), AUTHELIA)).toEqual({ ok: true, mode: 'authelia', user: 'diego' })
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

describe('cerrar sesión', () => {
  it('solo acepta direcciones web', () => {
    expect(logoutUrlOf({ AUTH_LOGOUT_URL: 'https://auth.example.com/logout' })).toBe('https://auth.example.com/logout')
    expect(logoutUrlOf({ AUTH_LOGOUT_URL: 'javascript:alert(1)' })).toBeNull()
    expect(logoutUrlOf({})).toBeNull()
  })
})
