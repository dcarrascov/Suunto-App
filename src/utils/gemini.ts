// Cliente de la ruta /api/gemini del servidor de Vite (server/gemini.ts): la IA que haya en .env (Gemini por
// defecto; o un servicio con el formato de OpenAI, o Claude, con AI_PROVIDER). El navegador nunca ve la clave.

export interface GeminiStatus {
  configured: boolean   // está todo lo necesario en .env
  model: string         // modelo principal
  fallbacks?: string[]  // los que se prueban si el principal falla varias veces
  provider?: 'gemini' | 'openai' | 'anthropic' | 'desconocido'
  label?: string        // nombre para mostrar: «Gemini», «Claude», «api.mistral.ai», «IA local»
  missing?: string | null  // qué falta en .env (p. ej. GEMINI_API_KEY)
}

export interface GeminiAnswer {
  text: string
  model: string         // el que respondió
  fellBack: boolean     // respondió un modelo inferior porque el principal estaba saturado o sin cupo
}

/** null si la ruta no existe (app abierta sin `npm run dev` / `npm run preview`). */
export async function geminiStatus(): Promise<GeminiStatus | null> {
  try {
    const res = await fetch('/api/gemini/status')
    if (!res.ok || !res.headers.get('content-type')?.includes('json')) return null
    return await res.json() as GeminiStatus
  } catch {
    return null
  }
}

/**
 * Manda el texto a la IA y devuelve su respuesta. Con `json`, se le pide la respuesta en JSON.
 * El servidor reintenta si está saturada y, si no hay manera, prueba los modelos de reserva.
 */
export async function askGemini(prompt: string, json = false): Promise<GeminiAnswer> {
  let res: Response
  try {
    res = await fetch('/api/gemini', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, json }),
    })
  } catch {
    throw new Error('No se pudo contactar con el servidor de la app. ¿Está abierto `npm run dev`?')
  }
  const data = await res.json().catch(() => ({})) as Partial<GeminiAnswer> & { error?: string }
  if (!res.ok || typeof data.text !== 'string') throw new Error(data.error ?? `Error ${res.status} al llamar a la IA.`)
  return { text: data.text, model: data.model ?? '', fellBack: data.fellBack === true }
}
