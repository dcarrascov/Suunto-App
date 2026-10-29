// Adaptador para Claude (Anthropic) con su SDK oficial. Solo en el servidor: la clave nunca llega al navegador.

import Anthropic from '@anthropic-ai/sdk'
import { GeminiError } from './gemini.ts'

export const CLAUDE_DEFAULT_MODEL = 'claude-opus-5-5'
const TIMEOUT_MS = 180_000

/** Mensaje claro, en español, para cada error de la API de Anthropic. */
export function describeClaudeError(status: number, model: string): string {
  if (status === 400) return 'Claude ha rechazado la petición (400). Puede que el texto sea demasiado largo para este modelo.'
  if (status === 401 || status === 403) return 'La clave de Anthropic no es válida o no tiene permiso. Revisa AI_API_KEY en .env.'
  if (status === 404) return `El modelo «${model}» no existe o no está disponible en tu cuenta. Revisa AI_MODEL en .env.`
  if (status === 429) return 'Has llegado al límite de uso de Anthropic. Espera un rato y vuelve a probar.'
  if (status >= 500) return `Claude no está disponible ahora mismo (${status}). Vuelve a probar en unos minutos.`
  return `Error de Anthropic (${status}).`
}

/**
 * Un mensaje y su respuesta. Lleva el respaldo del servidor de Anthropic (`fallbacks: "default"`): si el modelo
 * rechaza la petición por sus filtros, la API la repite sola con otro modelo dentro de la misma llamada.
 */
export async function callClaude(
  opts: { apiKey: string; model: string; prompt: string },
  client: Pick<Anthropic, 'beta'> = new Anthropic({ apiKey: opts.apiKey, timeout: TIMEOUT_MS, maxRetries: 0 }),
): Promise<string> {
  let response
  try {
    response = await client.beta.messages.create({
      model: opts.model,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      messages: [{ role: 'user', content: opts.prompt }],
    })
  } catch (e) {
    if (e instanceof Anthropic.APIConnectionTimeoutError) throw new GeminiError('Claude ha tardado demasiado en responder. Vuelve a probar.', 504)
    if (e instanceof Anthropic.APIConnectionError) throw new GeminiError('No hay conexión con Anthropic. Revisa tu internet.', 504)
    if (e instanceof Anthropic.APIError && typeof e.status === 'number') throw new GeminiError(describeClaudeError(e.status, opts.model), e.status)
    throw e
  }
  if (response.stop_reason === 'refusal') {
    throw new GeminiError('Claude no ha querido responder a esta petición (filtros de seguridad).', 422)
  }
  const text = response.content.map(b => (b.type === 'text' ? b.text : '')).join('')
  if (!text) throw new GeminiError(`Claude no ha devuelto texto (motivo: ${response.stop_reason ?? 'desconocido'}).`, 502)
  return text
}
