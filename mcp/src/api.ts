// Cliente de la API del MCP de la app (/api/mcp/v1/…, server/mcpApi.ts). No depende del SDK de MCP.

export interface ApiConfig {
  baseUrl: string                 // https://suunto.tudominio.com o http://localhost:5173
  token: string                   // el mismo que MCP_TOKEN en el servidor
  fetchImpl?: typeof fetch        // para los tests
  timeoutMs?: number
}

export class ApiCallError extends Error {}

const MIN_TOKEN = 32
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/** HTTPS siempre, salvo con la app en este ordenador. Devuelve el origen (la API cuelga de la raíz). */
export function checkBaseUrl(raw: string): string {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    throw new Error(`SUUNTO_APP_URL no es una dirección válida: «${raw}».`)
  }
  const local = LOCAL_HOSTS.has(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new Error('SUUNTO_APP_URL tiene que empezar por https:// (o ser http://localhost:… para la app en tu ordenador).')
  }
  return url.origin
}

/** Configuración desde las variables de entorno que pone Claude Desktop. */
export function configFromEnv(env: Record<string, string | undefined> = process.env): ApiConfig {
  const token = env.SUUNTO_MCP_TOKEN?.trim() ?? ''
  if (token.length < MIN_TOKEN) throw new Error(`Falta SUUNTO_MCP_TOKEN (mínimo ${MIN_TOKEN} caracteres): el mismo valor que MCP_TOKEN en el servidor.`)
  return { baseUrl: checkBaseUrl(env.SUUNTO_APP_URL ?? ''), token }
}

/** /api/mcp/v1/<ruta>?<parámetros sin los vacíos> */
export function buildPath(path: string, query: Record<string, string | number | boolean | undefined> = {}): string {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== '') qs.set(k, String(v))
  const s = qs.toString()
  return `/api/mcp/v1/${path}${s ? `?${s}` : ''}`
}

/** GET a la API; lanza ApiCallError con un mensaje en español que Claude puede enseñar tal cual. */
export async function apiGet(cfg: ApiConfig, path: string, query: Record<string, string | number | boolean | undefined> = {}): Promise<unknown> {
  let res: Response
  try {
    res = await (cfg.fetchImpl ?? fetch)(cfg.baseUrl + buildPath(path, query), {
      headers: { Authorization: `Bearer ${cfg.token}`, Accept: 'application/json' },
      redirect: 'manual',   // una redirección = Authelia pidiendo login: la ruta del MCP no está bien en Traefik
      signal: AbortSignal.timeout(cfg.timeoutMs ?? 30_000),
    })
  } catch (e) {
    const timeout = e instanceof Error && e.name === 'TimeoutError'
    throw new ApiCallError(timeout ? 'La app ha tardado demasiado en responder.' : `No hay conexión con ${cfg.baseUrl}. ¿Está en marcha la app?`)
  }
  if (res.status >= 300 && res.status < 400) {
    throw new ApiCallError('La app ha redirigido al login de Authelia: falta (o no funciona) la ruta suunto-mcp de Traefik para /api/mcp/.')
  }
  let body: unknown = null
  if ((res.headers.get('content-type') ?? '').includes('json')) body = await res.json().catch(() => null)
  const message = (body as { error?: unknown } | null)?.error
  if (!res.ok) {
    if (res.status === 401) throw new ApiCallError('La app rechaza el token: SUUNTO_MCP_TOKEN tiene que ser igual que MCP_TOKEN en el servidor.')
    throw new ApiCallError(typeof message === 'string' ? message : `La app ha respondido con el código ${res.status}.`)
  }
  if (body == null) throw new ApiCallError('La respuesta no es de la API del MCP. ¿SUUNTO_APP_URL apunta a la app?')
  return body
}
