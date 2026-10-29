// Ruta /api/sync del servidor de Vite (npm run dev / npm run preview): lanza el script de actualización
// (actualizar.ps1 en Windows, actualizar.sh en Mac/Linux) y dice cómo va.
// Al navegador solo le llegan el paso y el porcentaje, nunca la salida del script.

import { spawn } from 'node:child_process'
import type { ServerResponse } from 'node:http'
import { join } from 'node:path'
import type { Connect, Plugin } from 'vite'

const LOCAL = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

export type SyncStep = 'inicio' | 'suunto' | 'trainingpeaks' | 'validacion' | 'fin'

export interface SyncState {
  running: boolean
  step: SyncStep
  percent: number            // 0..100
  done: number | null        // actividades revisadas de Suunto
  total: number | null
  planSkipped: boolean       // TrainingPeaks omitido (sin cookie)
  planFailed: boolean        // TrainingPeaks falló, pero Suunto se guardó
  ok: boolean | null         // null mientras corre
  error: string | null
  startedAt: number | null
  seconds: number | null     // duración al terminar
}

export const IDLE: SyncState = {
  running: false, step: 'inicio', percent: 0, done: null, total: null, planSkipped: false, planFailed: false,
  ok: null, error: null, startedAt: null, seconds: null,
}

// Reparto de la barra: lista de Suunto 0–40 % (por tiempo), actividades 40–80 % (por contador),
// TrainingPeaks 80–95 % y validación 95–100 %
const LIST_END = 40
const SUUNTO_END = 80
const PLAN_END = 95
const LIST_SECONDS = 20   // ritmo al que avanza mientras Suunto manda la lista (suele tardar ~30 s)

/** Programa y argumentos para lanzar la actualización en cada sistema. `fit` = sin cuenta de Suunto (solo .fit). */
export function updateCommand(platform: NodeJS.Platform, root: string, mode: 'normal' | 'fit' = 'normal'): { cmd: string; args: string[] } {
  if (platform === 'win32') {
    return {
      cmd: 'powershell.exe',
      args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'actualizar.ps1'), ...(mode === 'fit' ? ['-SoloFit'] : [])],
    }
  }
  return { cmd: 'bash', args: [join(root, 'actualizar.sh'), ...(mode === 'fit' ? ['--solo-fit'] : [])] }
}

const SCRIPT_HINT = 'Ejecuta el script en la terminal para ver el motivo (.\\actualizar.ps1 en Windows, ./actualizar.sh en Mac/Linux).'

/** Actualiza el estado con una línea de la salida del script de actualización. */
export function applyLine(s: SyncState, raw: string): SyncState {
  const line = raw.trim()
  const step = /^== (.+) ==$/.exec(line)?.[1]
  if (step) {
    if (step.startsWith('Suunto')) return { ...s, step: 'suunto', percent: Math.max(s.percent, 2) }
    if (step.startsWith('TrainingPeaks')) {
      return { ...s, step: 'trainingpeaks', percent: Math.max(s.percent, SUUNTO_END), planSkipped: step.includes('omitido') }
    }
    if (step.startsWith('Validaci')) return { ...s, step: 'validacion', percent: Math.max(s.percent, PLAN_END) }
    return s
  }
  const m = /^\[(\d+)\/(\d+)\]/.exec(line)
  if (m && s.step === 'suunto') {
    const done = Number(m[1])
    const total = Number(m[2])
    const pct = total > 0 ? LIST_END + (done / total) * (SUUNTO_END - LIST_END) : s.percent
    return { ...s, done, total, percent: Math.max(s.percent, Math.min(SUUNTO_END, pct)) }
  }
  if (line.startsWith('TrainingPeaks ha fallado')) return { ...s, planFailed: true }
  return s
}

/**
 * Mientras Suunto manda la lista no hay contador: el corredor avanza por tiempo, cada vez más despacio,
 * sin llegar nunca al 40 % hasta que aparece la primera actividad.
 */
export function withListProgress(s: SyncState, now: number): SyncState {
  if (!s.running || s.step !== 'suunto' || s.total != null || s.startedAt == null) return s
  const t = Math.max(0, (now - s.startedAt) / 1000)
  const pct = 2 + (LIST_END - 2) * (1 - Math.exp(-t / LIST_SECONDS))
  return { ...s, percent: Math.max(s.percent, pct) }
}

/** Estado final según el código de salida del script. */
export function finish(s: SyncState, code: number | null, now: number): SyncState {
  const seconds = s.startedAt != null ?Math.round((now - s.startedAt) / 1000) : null
  if (code === 0) return { ...s, running: false, step: 'fin', percent: 100, ok: true, error: null, seconds }
  const error = s.step === 'validacion'
    ? `La validación ha encontrado errores en los datos. ${SCRIPT_HINT}`
    : s.step === 'suunto'
      ? `Ha fallado la sincronización de Suunto (¿sesión de suuntool caducada o sin internet?). ${SCRIPT_HINT}`
      : `El script ha terminado con error (código ${code ?? '?'}).`
  return { ...s, running: false, ok: false, error, seconds }
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(body))
}

/** Middleware: POST /api/sync (lanza el script) y GET /api/sync/status (cómo va). En la demo no actualiza nada. */
export function syncMiddleware(root: () => string, demo: () => boolean = () => false): Connect.NextHandleFunction {
  let state: SyncState = IDLE
  return (req, res, next) => {
    const [url, query = ''] = (req.url ?? '').split('?')
    if (url !== '/api/sync' && url !== '/api/sync/status') return next()
    if (!LOCAL.has(req.socket.remoteAddress ?? '')) return send(res, 403, { error: 'Solo disponible desde este ordenador.' })
    if (url === '/api/sync/status') return send(res, 200, withListProgress(state, Date.now()))
    if (req.method !== 'POST') return send(res, 405, { error: 'Usa POST.' })
    if (demo()) return send(res, 403, { error: 'En la demo no se actualizan datos: son inventados (fetch/make_demo.py).' })
    if (state.running) return send(res, 409, state)   // ya hay una en marcha

    state = { ...IDLE, running: true, startedAt: Date.now() }
    const mode = new URLSearchParams(query).get('mode') === 'fit' ? 'fit' : 'normal'
    const { cmd, args } = updateCommand(process.platform, root(), mode)
    const child = spawn(cmd, args, {
      cwd: root(), windowsHide: true, env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' },
    })
    let pending = ''
    const onData = (chunk: Buffer) => {
      pending += chunk.toString('utf8')
      const lines = pending.split(/\r?\n/)
      pending = lines.pop() ?? ''
      // lo ya mostrado por tiempo no se pierde al llegar el contador
      for (const l of lines) state = applyLine(withListProgress(state, Date.now()), l)
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('error', () => {
      state = { ...state, running: false, ok: false, error: `No se ha podido lanzar ${cmd}.` }
    })
    child.on('close', code => {
      if (pending) state = applyLine(state, pending)
      state = finish(state, code, Date.now())
    })
    send(res, 202, state)
  }
}

/** Plugin de Vite: añade la ruta en `npm run dev` y en `npm run preview`. */
export function syncPlugin(): Plugin {
  let root = process.cwd()
  let demo = false
  return {
    name: 'suunto-sync',
    configResolved(config) {
      root = config.root
      demo = config.mode === 'demo'
    },
    configureServer(server) {
      server.middlewares.use(syncMiddleware(() => root, () => demo))
    },
    configurePreviewServer(server) {
      server.middlewares.use(syncMiddleware(() => root, () => demo))
    },
  }
}
