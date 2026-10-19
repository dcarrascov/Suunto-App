// Cliente de la ruta /api/gemini del servidor de Vite (server/gemini.ts).
// El navegador nunca ve la clave: solo manda el texto y recibe la respuesta.

export interface GeminiStatus {
  configured: boolean   // hay GEMINI_API_KEY en .env
  model: string         // modelo principal
  fallbacks?: string[]  // inferiores que se prueban si el principal falla varias veces
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
 * Manda el texto a Gemini y devuelve su respuesta. Con `json`, Gemini responde directamente en JSON.
 * El servidor reintenta si Gemini está saturado y, si no hay manera, usa un modelo inferior.
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
  if (!res.ok || typeof data.text !== 'string') throw new Error(data.error ?? `Error ${res.status} al llamar a Gemini.`)
  return { text: data.text, model: data.model ?? '', fellBack: data.fellBack === true }
}
