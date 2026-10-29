import { afterEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  ATTEMPTS_PER_MODEL, callGemini, callWithFallback, DEFAULT_MODEL, describeHttpError, extractText, FALLBACK_MODELS,
  GeminiError, geminiMiddleware, modelChain,
} from './gemini.ts'

afterEach(() => { vi.unstubAllGlobals() })

describe('extractText', () => {
  it('une las partes de texto y descarta el razonamiento interno', () => {
    expect(extractText({ candidates: [{ content: { parts: [{ text: 'pienso…', thought: true }, { text: 'Hola ' }, { text: 'mundo' }] } }] }))
      .toBe('Hola mundo')
  })
  it('explica los bloqueos y las respuestas vacías', () => {
    expect(() => extractText({ promptFeedback: { blockReason: 'SAFETY' } })).toThrow(/bloqueado/)
    expect(() => extractText({ candidates: [{ content: { parts: [] }, finishReason: 'MAX_TOKENS' }] })).toThrow(/MAX_TOKENS/)
  })
})

describe('describeHttpError', () => {
  it('mensajes claros por código', () => {
    expect(describeHttpError(429, 'm')).toMatch(/límite/)
    expect(describeHttpError(403, 'm')).toMatch(/GEMINI_API_KEY/)
    expect(describeHttpError(404, 'mi-modelo')).toMatch(/mi-modelo/)
  })
})

describe('callGemini', () => {
  it('manda la clave en la cabecera (nunca en la URL) y pide JSON cuando se indica', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"ok":1}' }] } }] })))
    vi.stubGlobal('fetch', fetchMock)
    const text = await callGemini({ apiKey: 'CLAVE', model: 'gemini-x', prompt: 'hola', json: true })
    expect(text).toBe('{"ok":1}')
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('/models/gemini-x:generateContent')
    expect(url).not.toContain('CLAVE')
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('CLAVE')
    const body = JSON.parse(init.body as string)
    expect(body.contents[0].parts[0].text).toBe('hola')
    expect(body.generationConfig.responseMimeType).toBe('application/json')
  })
  it('convierte los errores HTTP en GeminiError con su código', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 429 })))
    await expect(callGemini({ apiKey: 'k', model: 'm', prompt: 'p' })).rejects.toMatchObject({ status: 429 })
  })
})

// Petición y respuesta falsas para probar el middleware sin levantar un servidor
function fakeReq(url: string, method: string, address: string, body?: string): IncomingMessage {
  const req = new EventEmitter() as IncomingMessage
  Object.assign(req, { url, method, socket: { remoteAddress: address }, destroy: () => {} })
  if (body !== undefined) setTimeout(() => { req.emit('data', Buffer.from(body)); req.emit('end') }, 0)
  return req
}

function fakeRes() {
  const out: { status?: number; body?: Record<string, unknown> } = {}
  const done = new Promise<typeof out>(resolve => {
    const res = {
      statusCode: 0,
      setHeader: () => {},
      end(chunk: string) { out.status = this.statusCode; out.body = JSON.parse(chunk); resolve(out) },
    }
    ;(fakeRes as unknown as { last: unknown }).last = res
  })
  return { res: (fakeRes as unknown as { last: ServerResponse }).last, done }
}

describe('geminiMiddleware', () => {
  it('estado: dice si hay clave y qué modelo, sin enseñar la clave', async () => {
    const mw = geminiMiddleware(() => ({ GEMINI_API_KEY: 'SECRETA' }))
    const { res, done } = fakeRes()
    mw(fakeReq('/api/gemini/status', 'GET', '127.0.0.1'), res, () => {})
    const out = await done
    expect(out.body).toEqual({ configured: true, model: DEFAULT_MODEL, fallbacks: FALLBACK_MODELS, provider: 'gemini', label: 'Gemini', missing: null })
    expect(JSON.stringify(out.body)).not.toContain('SECRETA')
  })
  it('solo desde este ordenador', async () => {
    const mw = geminiMiddleware(() => ({ GEMINI_API_KEY: 'k' }))
    const { res, done } = fakeRes()
    mw(fakeReq('/api/gemini', 'POST', '192.168.1.40', '{"prompt":"x"}'), res, () => {})
    expect((await done).status).toBe(403)
  })
  it('sin clave avisa y no llama a Gemini', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const mw = geminiMiddleware(() => ({}))
    const { res, done } = fakeRes()
    mw(fakeReq('/api/gemini', 'POST', '::1', '{"prompt":"x"}'), res, () => {})
    const out = await done
    expect(out.status).toBe(400)
    expect(String(out.body?.error)).toMatch(/GEMINI_API_KEY/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('devuelve el texto de Gemini y usa GEMINI_MODEL si está', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'respuesta' }] } }] })))
    vi.stubGlobal('fetch', fetchMock)
    const mw = geminiMiddleware(() => ({ GEMINI_API_KEY: 'k', GEMINI_MODEL: 'otro-modelo' }))
    const { res, done } = fakeRes()
    mw(fakeReq('/api/gemini', 'POST', '127.0.0.1', '{"prompt":"hola"}'), res, () => {})
    const out = await done
    expect(out).toEqual({ status: 200, body: { text: 'respuesta', model: 'otro-modelo', fellBack: false } })
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain('otro-modelo')
  })
  it('deja pasar las demás rutas', () => {
    const next = vi.fn()
    geminiMiddleware(() => ({}))(fakeReq('/data/activities.json', 'GET', '127.0.0.1'), {} as ServerResponse, next)
    expect(next).toHaveBeenCalled()
  })
  it('GeminiError lleva su código', () => {
    expect(new GeminiError('x', 418).status).toBe(418)
  })
})

// Respuestas simuladas de Gemini, por orden: un número = error HTTP; un texto = respuesta correcta
function scripted(...steps: (number | string)[]) {
  const calls: string[] = []
  const fetchMock = vi.fn(async (url: string) => {
    calls.push(url.match(/models\/([^:]+):/)?.[1] ?? '?')
    const step = steps.shift()
    if (typeof step === 'number') return new Response('{}', { status: step })
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: step ?? 'fin' }] } }] }))
  })
  vi.stubGlobal('fetch', fetchMock)
  return calls
}

describe('callWithFallback', () => {
  const noWait = vi.fn(async () => {})
  const opts = { apiKey: 'k', models: modelChain('principal', ['ligero', 'mas-ligero']), prompt: 'p' }

  it('la cadena empieza por el elegido y no lo repite', () => {
    expect(modelChain('gemini-3.5-flash-lite')).toEqual(['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'])
    expect(modelChain(DEFAULT_MODEL)[0]).toBe(DEFAULT_MODEL)
  })
  it('si está saturado reintenta con el mismo modelo y responde', async () => {
    const calls = scripted(503, 503, 'ok')
    const r = await callWithFallback(opts, noWait)
    expect(r).toEqual({ text: 'ok', model: 'principal', fellBack: false })
    expect(calls).toEqual(['principal', 'principal', 'principal'])
    expect(noWait).toHaveBeenCalledTimes(2)
  })
  it(`tras ${ATTEMPTS_PER_MODEL} fallos pasa al modelo inferior`, async () => {
    const calls = scripted(503, 503, 503, 'del ligero')
    const r = await callWithFallback(opts, noWait)
    expect(r).toEqual({ text: 'del ligero', model: 'ligero', fellBack: true })
    expect(calls).toEqual(['principal', 'principal', 'principal', 'ligero'])
  })
  it('con el cupo agotado (429) o sin el modelo (404) cambia de modelo sin repetir', async () => {
    const calls = scripted(429, 404, 'ok')
    const r = await callWithFallback(opts, noWait)
    expect(r.model).toBe('mas-ligero')
    expect(calls).toEqual(['principal', 'ligero', 'mas-ligero'])
  })
  it('con la clave mal (403) no insiste', async () => {
    const calls = scripted(403, 'no debería llegar')
    await expect(callWithFallback(opts, noWait)).rejects.toMatchObject({ status: 403 })
    expect(calls).toEqual(['principal'])
  })
  it('si fallan todos, dice qué modelos ha probado', async () => {
    scripted(503, 503, 503, 503, 503, 503, 503, 503, 503)
    await expect(callWithFallback(opts, noWait)).rejects.toThrow(/probados: principal, ligero, mas-ligero/)
  })
})
