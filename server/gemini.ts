// Ruta /api/gemini del servidor de Vite (npm run dev / npm run preview): la IA del Entrenador IA.
// Por defecto Gemini; con AI_PROVIDER en .env, cualquier servicio con el formato de OpenAI (openai.ts) o Claude
// (anthropic.ts). Las claves se leen del .env en el servidor y nunca llegan al navegador ni al repositorio.

import type { IncomingMessage, ServerResponse } from 'node:http'
import { loadEnv } from 'vite'
import type { Connect, Plugin } from 'vite'
import { callClaude, CLAUDE_DEFAULT_MODEL } from './anthropic.ts'
import { callOpenAi, isLocalBase, OPENAI_DEFAULT_BASE } from './openai.ts'

export const DEFAULT_MODEL = 'gemini-3.8-flash'
// Si el principal falla varias veces, se prueba con estos (de mejor a más ligero; modelos estables de la documentación)
export const FALLBACK_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite']
export const ATTEMPTS_PER_MODEL = 3
const RETRY_DELAYS_MS = [2000, 4000]   // espera antes del 2.º y del 3.er intento con el mismo modelo
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta'
const TIMEOUT_MS = 180_000          // el análisis del entrenador lleva ~150 mil caracteres: puede tardar
const MAX_BODY_BYTES = 3_000_000
const LOCAL = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

interface GeminiPart { text?: string; thought?: boolean }
interface GeminiResponse {
  candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[]
  promptFeedback?: { blockReason?: string }
}

/** Texto de la respuesta: une las partes de texto y descarta las de razonamiento interno. */
export function extractText(data: GeminiResponse): string {
  if (data.promptFeedback?.blockReason) {
    throw new GeminiError(`Gemini ha bloqueado la petición (${data.promptFeedback.blockReason}).`, 422)
  }
  const cand = data.candidates?.[0]
  const text = (cand?.content?.parts ?? []).filter(p => !p.thought && p.text).map(p => p.text).join('')
  if (!text) {
    throw new GeminiError(`Gemini no ha devuelto texto${cand?.finishReason ? ` (motivo: ${cand.finishReason})` : ''}.`, 502)
  }
  return text
}

export class GeminiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

/** Mensaje claro, en español, para cada error de la API. */
export function describeHttpError(status: number, model: string): string {
  if (status === 400) return 'Gemini ha rechazado la petición (400). Puede que el texto sea demasiado largo para este modelo.'
  if (status === 401 || status === 403) return 'La clave de Gemini no es válida o no tiene permiso. Revisa GEMINI_API_KEY en .env.'
  if (status === 404) return `El modelo «${model}» no existe o no está disponible en tu cuenta. Prueba otro con GEMINI_MODEL en .env.`
  if (status === 429) return 'Has llegado al límite de uso de Gemini (nivel gratuito). Espera un rato o mañana y vuelve a probar.'
  if (status >= 500) return `Gemini no está disponible ahora mismo (${status}). Vuelve a probar en unos minutos.`
  return `Error de Gemini (${status}).`
}

/** Cadena de modelos: el elegido (GEMINI_MODEL o el de por defecto) y después los inferiores, sin repetir. */
export function modelChain(primary: string, fallbacks: string[] = FALLBACK_MODELS): string[] {
  return [primary, ...fallbacks.filter(m => m !== primary)]
}

/** Saturación o fallo del servidor de Google: vale la pena repetir con el mismo modelo. */
const isRetryable = (status: number) => status === 500 || status === 502 || status === 503
/** Con otro modelo puede funcionar: cupo agotado de ese modelo (429), modelo no disponible (404) o sin respuesta (504). */
const tryNextModel = (status: number) => isRetryable(status) || status === 429 || status === 404 || status === 504

export interface GeminiResult {
  text: string
  model: string        // el que respondió
  fellBack: boolean    // no fue el principal
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

/**
 * Llama a Gemini con reintentos: hasta ATTEMPTS_PER_MODEL intentos por modelo cuando está saturado (espera creciente),
 * y si no hay manera, pasa al siguiente modelo de la cadena. Los errores que no se arreglan repitiendo (clave inválida,
 * petición rechazada) se devuelven al momento.
 */
export async function callWithFallback(
  opts: { apiKey: string; models: string[]; prompt: string; json?: boolean; call?: (model: string) => Promise<string> },
  wait: (ms: number) => Promise<void> = sleep,
): Promise<GeminiResult> {
  let last: GeminiError | null = null
  for (const [i, model] of opts.models.entries()) {
    for (let attempt = 1; attempt <= ATTEMPTS_PER_MODEL; attempt++) {
      try {
        // `call` = otro proveedor (OpenAI, Claude); sin él, Gemini
        const text = opts.call
          ? await opts.call(model)
          : await callGemini({ apiKey: opts.apiKey, model, prompt: opts.prompt, json: opts.json })
        return { text, model, fellBack: i > 0 }
      } catch (e) {
        if (!(e instanceof GeminiError)) throw e
        last = e
        if (!tryNextModel(e.status)) throw e                      // repetir no lo arregla
        if (!isRetryable(e.status) || attempt === ATTEMPTS_PER_MODEL) break  // a por el siguiente modelo
        await wait(RETRY_DELAYS_MS[attempt - 1] ?? 4000)
      }
    }
  }
  const tried = opts.models.join(', ')
  throw new GeminiError(`${last?.message ?? 'La IA no ha respondido.'} (probados: ${tried})`, last?.status ?? 503)
}

/** Llama a models.generateContent. Con `json`, pide la respuesta directamente en JSON. */
export async function callGemini(opts: { apiKey: string; model: string; prompt: string; json?: boolean }): Promise<string> {
  const res = await fetch(`${API_BASE}/models/${encodeURIComponent(opts.model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': opts.apiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: opts.prompt }] }],
      ...(opts.json ? { generationConfig: { responseMimeType: 'application/json' } } : {}),
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch((e: unknown) => {
    const timeout = e instanceof Error && e.name === 'TimeoutError'
    throw new GeminiError(timeout ? 'Gemini ha tardado demasiado en responder. Vuelve a probar.' : 'No hay conexión con Gemini. Revisa tu internet.', 504)
  })
  if (!res.ok) throw new GeminiError(describeHttpError(res.status, opts.model), res.status)
  return extractText(await res.json() as GeminiResponse)
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > MAX_BODY_BYTES) {
        reject(new GeminiError('El texto es demasiado largo.', 413))
        req.destroy()
      } else chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

export type Provider = 'gemini' | 'openai' | 'anthropic'

/** Qué IA usar según el .env: proveedor, modelos (el primero es el principal) y cómo llamarla. */
export interface AiConfig {
  provider: Provider | null       // null = AI_PROVIDER no reconocido
  label: string                   // para mostrar en la app («Gemini», «Claude», «api.mistral.ai», «IA local»)
  models: string[]
  missing: string | null          // qué falta en .env para poder usarla
  call: (model: string, prompt: string, json: boolean) => Promise<string>
}

const list = (v: string | undefined) => (v ?? '').split(',').map(x => x.trim()).filter(Boolean)

export function aiConfig(env: Record<string, string>): AiConfig {
  const provider = env.AI_PROVIDER?.trim().toLowerCase() || 'gemini'
  if (provider === 'openai') {
    const base = env.AI_BASE_URL?.trim() || OPENAI_DEFAULT_BASE
    const apiKey = env.AI_API_KEY?.trim() ?? ''
    const model = env.AI_MODEL?.trim() ?? ''
    const local = isLocalBase(base)
    let host = base
    try { host = new URL(base).hostname } catch { /* se deja tal cual */ }
    return {
      provider, label: local ? 'IA local' : host,
      models: model ? [model, ...list(env.AI_FALLBACK_MODELS).filter(m => m !== model)] : [],
      missing: !model ? 'AI_MODEL' : !apiKey && !local ? 'AI_API_KEY' : null,
      call: (m, prompt, json) => callOpenAi({ baseUrl: base, apiKey, model: m, prompt, json }),
    }
  }
  if (provider === 'anthropic') {
    const apiKey = env.AI_API_KEY?.trim() || env.ANTHROPIC_API_KEY?.trim() || ''
    const model = env.AI_MODEL?.trim() || CLAUDE_DEFAULT_MODEL
    return {
      provider, label: 'Claude',
      models: [model, ...list(env.AI_FALLBACK_MODELS).filter(m => m !== model)],
      missing: apiKey ? null : 'AI_API_KEY',
      call: (m, prompt) => callClaude({ apiKey, model: m, prompt }),
    }
  }
  if (provider === 'gemini') {
    const apiKey = env.GEMINI_API_KEY?.trim() ?? ''
    return {
      provider, label: 'Gemini',
      models: modelChain(env.GEMINI_MODEL?.trim() || DEFAULT_MODEL),
      missing: apiKey ? null : 'GEMINI_API_KEY',
      call: (m, prompt, json) => callGemini({ apiKey, model: m, prompt, json }),
    }
  }
  return {
    provider: null, label: provider, models: [], missing: 'AI_PROVIDER (gemini, openai o anthropic)',
    call: async () => { throw new GeminiError('AI_PROVIDER no es gemini, openai ni anthropic.', 400) },
  }
}

/** Middleware: GET /api/gemini/status (¿está configurada?) y POST /api/gemini ({prompt, json} → {text}). */
export function geminiMiddleware(getEnv: () => Record<string, string>): Connect.NextHandleFunction {
  return (req, res, next) => {
    const url = req.url?.split('?')[0]
    if (url !== '/api/gemini' && url !== '/api/gemini/status') return next()
    // solo desde este ordenador: aunque el servidor se abra a la red (--host), nadie más gasta tu clave
    if (!LOCAL.has(req.socket.remoteAddress ?? '')) return send(res, 403, { error: 'Solo disponible desde este ordenador.' })

    const cfg = aiConfig(getEnv())
    const [model = '', ...fallbacks] = cfg.models
    if (url === '/api/gemini/status') {
      return send(res, 200, { configured: !cfg.missing, model, fallbacks, provider: cfg.provider ?? 'desconocido', label: cfg.label, missing: cfg.missing })
    }
    if (req.method !== 'POST') return send(res, 405, { error: 'Usa POST.' })
    if (cfg.missing) return send(res, 400, { error: `Falta ${cfg.missing} en el fichero .env.` })

    readBody(req)
      .then(raw => {
        const body = JSON.parse(raw) as { prompt?: unknown; json?: unknown }
        if (typeof body.prompt !== 'string' || !body.prompt.trim()) throw new GeminiError('Falta el texto de la petición.', 400)
        const prompt = body.prompt
        const json = body.json === true
        return callWithFallback({ apiKey: '', models: cfg.models, prompt, json, call: m => cfg.call(m, prompt, json) })
      })
      .then(result => send(res, 200, result))
      .catch((e: unknown) => {
        if (e instanceof GeminiError) return send(res, e.status, { error: e.message })
        if (e instanceof SyntaxError) return send(res, 400, { error: 'Petición mal formada.' })
        send(res, 500, { error: 'Error inesperado al llamar a la IA.' })
      })
  }
}

/** Plugin de Vite: añade la ruta en `npm run dev` y en `npm run preview`. El .env se relee en cada petición. */
export function geminiPlugin(): Plugin {
  let mode = 'development'
  let root = process.cwd()
  const getEnv = () => loadEnv(mode, root, '')   // prefijo '' = todas las variables, solo en el servidor
  return {
    name: 'suunto-gemini',
    configResolved(config) {
      mode = config.mode
      root = config.root
    },
    configureServer(server) {
      server.middlewares.use(geminiMiddleware(getEnv))
    },
    configurePreviewServer(server) {
      server.middlewares.use(geminiMiddleware(getEnv))
    },
  }
}
