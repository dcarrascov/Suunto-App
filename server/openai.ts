// Adaptador para cualquier servicio con el formato de OpenAI (POST {base}/chat/completions): OpenAI, Mistral, Groq,
// DeepSeek, OpenRouter… y también Ollama o LM Studio en tu propio ordenador (sin clave). Solo en el servidor.

import { GeminiError } from './gemini.ts'

const TIMEOUT_MS = 180_000
export const OPENAI_DEFAULT_BASE = 'https://api.openai.com/v1'

interface ChatResponse {
  choices?: { message?: { content?: string | null }; finish_reason?: string }[]
}

/** ¿Es un servicio en este ordenador (Ollama, LM Studio…)? Entonces no hace falta clave. */
export function isLocalBase(base: string): boolean {
  try {
    const host = new URL(base).hostname
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]'
  } catch {
    return false
  }
}

/** Mensaje claro, en español, para cada error del servicio. */
export function describeOpenAiError(status: number, model: string): string {
  if (status === 400) return 'El servicio de IA ha rechazado la petición (400). Puede que el texto sea demasiado largo para este modelo.'
  if (status === 401 || status === 403) return 'La clave de la IA no es válida o no tiene permiso. Revisa AI_API_KEY en .env.'
  if (status === 404) return `El modelo «${model}» o la dirección AI_BASE_URL no existen. Revisa AI_MODEL y AI_BASE_URL en .env.`
  if (status === 429) return 'Has llegado al límite de uso del servicio de IA. Espera un rato y vuelve a probar.'
  if (status >= 500) return `El servicio de IA no está disponible ahora mismo (${status}). Vuelve a probar en unos minutos.`
  return `Error del servicio de IA (${status}).`
}

async function post(base: string, apiKey: string, body: unknown): Promise<Response> {
  return fetch(`${base.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch((e: unknown) => {
    const timeout = e instanceof Error && e.name === 'TimeoutError'
    throw new GeminiError(timeout ? 'La IA ha tardado demasiado en responder. Vuelve a probar.' : `No hay conexión con ${base}. ¿Está en marcha el servicio?`, 504)
  })
}

/**
 * Un mensaje y su respuesta. Con `json` pide la respuesta en JSON (response_format); si el servicio no lo admite
 * (400), lo repite una vez sin esa opción: los textos ya piden JSON y la app lo saca de la respuesta.
 */
export async function callOpenAi(opts: { baseUrl: string; apiKey: string; model: string; prompt: string; json?: boolean }): Promise<string> {
  const body = { model: opts.model, messages: [{ role: 'user', content: opts.prompt }] }
  let res = await post(opts.baseUrl, opts.apiKey, opts.json ? { ...body, response_format: { type: 'json_object' } } : body)
  if (res.status === 400 && opts.json) res = await post(opts.baseUrl, opts.apiKey, body)
  if (!res.ok) throw new GeminiError(describeOpenAiError(res.status, opts.model), res.status)
  const data = await res.json() as ChatResponse
  const text = data.choices?.[0]?.message?.content
  if (!text) throw new GeminiError(`La IA no ha devuelto texto${data.choices?.[0]?.finish_reason ? ` (motivo: ${data.choices[0].finish_reason})` : ''}.`, 502)
  return text
}
