import Anthropic from '@anthropic-ai/sdk'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { callClaude, CLAUDE_DEFAULT_MODEL } from './anthropic.ts'
import { aiConfig, DEFAULT_MODEL } from './gemini.ts'
import { callOpenAi, isLocalBase } from './openai.ts'

afterEach(() => { vi.unstubAllGlobals() })

describe('elegir la IA con AI_PROVIDER', () => {
  it('sin AI_PROVIDER es Gemini, como siempre', () => {
    const c = aiConfig({ GEMINI_API_KEY: 'k' })
    expect(c).toMatchObject({ provider: 'gemini', label: 'Gemini', missing: null })
    expect(c.models[0]).toBe(DEFAULT_MODEL)
    expect(aiConfig({}).missing).toBe('GEMINI_API_KEY')
  })
  it('openai: pide modelo; la clave no hace falta si el servicio está en este ordenador', () => {
    expect(aiConfig({ AI_PROVIDER: 'openai', AI_API_KEY: 'k' }).missing).toBe('AI_MODEL')
    expect(aiConfig({ AI_PROVIDER: 'openai', AI_MODEL: 'm' }).missing).toBe('AI_API_KEY')
    const local = aiConfig({ AI_PROVIDER: 'openai', AI_BASE_URL: 'http://localhost:11434/v1', AI_MODEL: 'llama' })
    expect(local).toMatchObject({ provider: 'openai', label: 'IA local', missing: null, models: ['llama'] })
    expect(aiConfig({ AI_PROVIDER: 'OpenAI', AI_BASE_URL: 'https://api.mistral.ai/v1', AI_MODEL: 'm', AI_API_KEY: 'k', AI_FALLBACK_MODELS: 'm, ligero' }))
      .toMatchObject({ label: 'api.mistral.ai', models: ['m', 'ligero'] })
    expect(isLocalBase('http://127.0.0.1:1234/v1')).toBe(true)
    expect(isLocalBase('https://api.openai.com/v1')).toBe(false)
  })
  it('anthropic: Claude con su modelo por defecto; un proveedor desconocido avisa', () => {
    expect(aiConfig({ AI_PROVIDER: 'anthropic', AI_API_KEY: 'k' })).toMatchObject({ label: 'Claude', missing: null, models: [CLAUDE_DEFAULT_MODEL] })
    expect(aiConfig({ AI_PROVIDER: 'anthropic' }).missing).toBe('AI_API_KEY')
    expect(aiConfig({ AI_PROVIDER: 'otra' })).toMatchObject({ provider: null, missing: expect.stringContaining('AI_PROVIDER') })
  })
})

describe('servicios con el formato de OpenAI', () => {
  it('manda el mensaje con la clave en la cabecera y lee la respuesta', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'hola' } }] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(callOpenAi({ baseUrl: 'https://api.mistral.ai/v1/', apiKey: 'k', model: 'm', prompt: 'p' })).resolves.toBe('hola')
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.mistral.ai/v1/chat/completions')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer k')
    expect(JSON.parse(init.body as string)).toEqual({ model: 'm', messages: [{ role: 'user', content: 'p' }] })
  })
  it('si no admite el modo JSON (400), lo repite sin él; sin clave no manda Authorization', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: '{"a":1}' } }] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(callOpenAi({ baseUrl: 'http://localhost:11434/v1', apiKey: '', model: 'llama', prompt: 'p', json: true })).resolves.toBe('{"a":1}')
    const bodies = fetchMock.mock.calls.map(c => JSON.parse((c[1] as RequestInit).body as string))
    expect(bodies[0].response_format).toEqual({ type: 'json_object' })
    expect(bodies[1].response_format).toBeUndefined()
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).not.toHaveProperty('Authorization')
  })
  it('errores con su código, para que la app reintente o avise', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })))
    await expect(callOpenAi({ baseUrl: 'https://x/v1', apiKey: 'k', model: 'm', prompt: 'p' })).rejects.toMatchObject({ status: 401, message: expect.stringContaining('AI_API_KEY') })
  })
})

describe('Claude', () => {
  const fakeClient = (create: (body: unknown) => Promise<unknown>) => ({ beta: { messages: { create } } }) as unknown as Pick<Anthropic, 'beta'>

  it('pide la respuesta con el respaldo del servidor y junta los bloques de texto', async () => {
    let sent: Record<string, unknown> = {}
    const client = fakeClient(async body => {
      sent = body as Record<string, unknown>
      return { stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: 'Hola ' }, { type: 'text', text: 'mundo' }] }
    })
    await expect(callClaude({ apiKey: 'k', model: CLAUDE_DEFAULT_MODEL, prompt: 'p' }, client)).resolves.toBe('Hola mundo')
    expect(sent).toMatchObject({ model: CLAUDE_DEFAULT_MODEL, fallbacks: 'default', betas: ['server-side-fallback-2026-07-01'], messages: [{ role: 'user', content: 'p' }] })
  })
  it('un rechazo por los filtros y los errores de la API se explican', async () => {
    await expect(callClaude({ apiKey: 'k', model: 'm', prompt: 'p' }, fakeClient(async () => ({ stop_reason: 'refusal', content: [] }))))
      .rejects.toMatchObject({ status: 422 })
    const apiError = Anthropic.APIError.generate(429, { error: { type: 'rate_limit_error', message: 'x' } }, 'x', new Headers())
    await expect(callClaude({ apiKey: 'k', model: 'm', prompt: 'p' }, fakeClient(async () => { throw apiError })))
      .rejects.toMatchObject({ status: 429, message: expect.stringContaining('límite') })
  })
})
