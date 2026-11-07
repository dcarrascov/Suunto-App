// Quién puede entrar a la app. Va delante de todo lo que sirve el servidor de Vite: páginas, /data y /api.
// AUTH_MODE (en .env o en las variables del servidor; se lee al arrancar):
//   none (por defecto): solo desde este ordenador, sin login.
//   authelia: dominio público. Solo pasa lo que llega por el proxy (Traefik) tras identificarse en Authelia.
// El modo nunca se decide en el navegador: si no está claro qué hacer, se niega el acceso.

import { createHash, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { loadEnv } from 'vite'
import type { Connect, Plugin } from 'vite'

export type AuthMode = 'none' | 'authelia'
type Headers = IncomingMessage['headers']

export const SECRET_HEADER = 'x-auth-proxy-secret'
export const MIN_SECRET_LENGTH = 32

const LOCAL_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])
// Si llega alguna de estas, hay un proxy delante aunque la conexión parezca local
const PROXY_HEADERS = ['forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-real-ip']

export type Access =
  | { ok: true; mode: AuthMode; user: string | null }
  | { ok: false; status: number; reason: string }

/** Modo configurado; null si AUTH_MODE trae algo que no se entiende. */
export function authModeOf(env: Record<string, string | undefined>): AuthMode | null {
  const mode = env.AUTH_MODE?.trim().toLowerCase() || 'none'
  return mode === 'none' || mode === 'authelia' ? mode : null
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() ?? ''

function hostnameOf(host: string): string | null {
  try {
    return new URL(`http://${host}`).hostname
  } catch {
    return null
  }
}

/** Comparación que no revela por el tiempo de respuesta cuánto se ha acertado. */
function sameSecret(a: string, b: string): boolean {
  const hash = (s: string) => createHash('sha256').update(s).digest()
  return timingSafeEqual(hash(a), hash(b))
}

// Rutas que solo pide la propia app (datos, /api y las internas de Vite, como la que abre el editor)
const APP_ONLY = /^\/(?:api|data)\/|^\/(?:__|@)/

/**
 * ¿La pide otra web? Desde otra web (aunque sea otro puerto de localhost) solo se puede abrir una página de la app con
 * un enlace; ni leer datos, ni incrustarla, ni lanzar acciones con tu sesión (actualizar, subir ficheros, gastar tu
 * clave de IA). Lo dicen las cabeceras Sec-Fetch-* de los navegadores; sin ellas, el Origin en lo que no es lectura.
 */
function isFromOtherSite(method: string | undefined, path: string, headers: Headers): boolean {
  const read = method === 'GET' || method === 'HEAD'
  const site = first(headers['sec-fetch-site'])
  if (site === 'cross-site' || site === 'same-site') {
    const openPage = read && !APP_ONLY.test(path)
      && first(headers['sec-fetch-mode']) === 'navigate' && first(headers['sec-fetch-dest']) === 'document'
    if (!openPage) return true
  }
  if (read) return false
  const origin = first(headers.origin)
  if (!origin) return false
  try {
    return new URL(origin).host !== first(headers.host)
  } catch {
    return true
  }
}

/** ¿Se atiende esta petición? */
export function checkAccess(
  req: { method?: string; url?: string; headers: Headers; socket: { remoteAddress?: string } },
  env: Record<string, string | undefined>,
): Access {
  const mode = authModeOf(env)
  if (!mode) return { ok: false, status: 500, reason: 'AUTH_MODE no es válido: usa none o authelia.' }

  let user: string | null = null
  if (mode === 'none') {
    const local = LOCAL_ADDRESSES.has(req.socket.remoteAddress ?? '')
      && LOCAL_HOSTS.has(hostnameOf(first(req.headers.host)) ?? '')
      && !PROXY_HEADERS.some(h => req.headers[h] !== undefined)
    if (!local) {
      return {
        ok: false, status: 403,
        reason: 'Sin login, la app solo se abre desde el ordenador donde se ejecuta. Para publicarla en un dominio, activa AUTH_MODE=authelia (ver GUIA_DESPLIEGUE.md).',
      }
    }
  } else {
    const secret = env.AUTH_PROXY_SECRET?.trim() ?? ''
    if (secret.length < MIN_SECRET_LENGTH) {
      return { ok: false, status: 503, reason: `Con AUTH_MODE=authelia falta AUTH_PROXY_SECRET (mínimo ${MIN_SECRET_LENGTH} caracteres).` }
    }
    user = first(req.headers['remote-user'])
    // el secreto solo lo añade el proxy: sin él, alguien ha llegado a la app sin pasar por Authelia
    if (!sameSecret(first(req.headers[SECRET_HEADER]), secret) || !user) {
      return { ok: false, status: 401, reason: 'Entra por la dirección pública de la app, identificándote en Authelia.' }
    }
  }
  if (isFromOtherSite(req.method, req.url?.split('?')[0] ?? '', req.headers)) {
    return { ok: false, status: 403, reason: 'Petición rechazada: viene de otro sitio web.' }
  }
  return { ok: true, mode, user }
}

/** Dirección para cerrar sesión; solo si es una URL web válida. */
export function logoutUrlOf(env: Record<string, string | undefined>): string | null {
  const raw = env.AUTH_LOGOUT_URL?.trim()
  if (!raw) return null
  try {
    return ['http:', 'https:'].includes(new URL(raw).protocol) ? raw : null
  } catch {
    return null
  }
}

function send(res: ServerResponse, status: number, type: string, body: string) {
  res.statusCode = status
  res.setHeader('Content-Type', `${type}; charset=utf-8`)
  res.setHeader('Cache-Control', 'no-store')
  res.end(body)
}

function deniedPage(reason: string): string {
  return `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Acceso no permitido</title><body style="margin:0;padding:40px 16px;background:#0f0f11;color:#e5e5e5;font:16px system-ui,sans-serif">
<h1 style="font-size:20px">Acceso no permitido</h1><p style="max-width:40rem;color:#a3a3a3">${reason}</p></body></html>`
}

/** Cabeceras de seguridad para todas las respuestas. HSTS solo en el dominio público, que siempre va por HTTPS. */
export function securityHeaders(mode: AuthMode | null): Record<string, string> {
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',                          // nadie puede incrustar la app en su web
    'Content-Security-Policy': "frame-ancestors 'none'",
    ...(mode === 'authelia' ? { 'Strict-Transport-Security': 'max-age=15552000' } : {}),
  }
}

/** Middleware: corta lo no permitido y responde GET /api/auth/status (lo que enseña Ajustes). */
export function authMiddleware(env: Record<string, string | undefined>): Connect.NextHandleFunction {
  const headers = securityHeaders(authModeOf(env))
  return (req, res, next) => {
    for (const [k, v] of Object.entries(headers)) res.setHeader(k, v)
    const path = req.url?.split('?')[0] ?? ''
    const access = checkAccess(req, env)
    if (!access.ok) {
      return path.startsWith('/api/') || path.startsWith('/data/')
        ? send(res, access.status, 'application/json', JSON.stringify({ error: access.reason }))
        : send(res, access.status, 'text/html', deniedPage(access.reason))
    }
    if (path === '/api/auth/status') {
      return send(res, 200, 'application/json', JSON.stringify({
        mode: access.mode, user: access.user, logoutUrl: access.mode === 'authelia' ? logoutUrlOf(env) : null,
      }))
    }
    next()
  }
}

/** Plugin de Vite: debe ir el primero de la lista para quedar delante de todo, en `npm run dev` y en `npm run preview`. */
export function authPlugin(): Plugin {
  let env: Record<string, string> = {}
  return {
    name: 'suunto-auth',
    configResolved(config) {
      env = loadEnv(config.mode, config.root, '')   // prefijo '' = todas las variables, solo en el servidor
    },
    configureServer(server) {
      server.middlewares.use(authMiddleware(env))
    },
    configurePreviewServer(server) {
      server.middlewares.use(authMiddleware(env))
    },
  }
}
