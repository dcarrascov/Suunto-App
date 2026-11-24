// Sincroniza con el servidor (/api/estado, server/userState.ts) lo que la app guarda en el navegador: ajustes, IA,
// entrenos propios y zapatillas (las mismas partes que la copia de seguridad), para verlo igual en todos tus
// dispositivos. El navegador sigue guardando su copia: la app abre al instante y funciona sin conexión.
// Al abrir la app y al volver a ella se trae lo del servidor si es más nuevo; cada cambio se sube a los pocos segundos.
// Si se cambia lo mismo en dos sitios, gana el último que guardó.

import { BACKUP_KEYS, type BackupKey } from './backup'

export const SYNC_META_KEY = 'suunto-sync'           // lo último sincronizado en este navegador, por parte
export const BEFORE_SYNC_SUFFIX = '.antes-de-sincronizar'
const PUSH_DELAY_MS = 2000
const PULL_EVERY_MS = 5 * 60_000
const PULL_MIN_GAP_MS = 20_000

export interface ServerPart { version: number; guardado: string; datos: unknown }
export interface SyncMeta { version: number; hash: string; dirtyAt?: number }
export type Decision = 'subir' | 'bajar' | 'nada'

/** Huella corta de un texto (djb2): basta para saber si algo ha cambiado. */
export function hashString(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36) + s.length.toString(36)
}

/**
 * Qué hacer con una parte. `local` = lo que guarda este navegador (null si nada), `meta` = lo último que se
 * sincronizó aquí (null si nunca), `server` = lo que hay en el servidor (null si nada).
 */
export function decide(local: string | null, meta: SyncMeta | null, server: ServerPart | null): Decision {
  if (!server) return local ? 'subir' : 'nada'
  if (!local) return 'bajar'
  const localHash = hashString(local)
  if (!meta) {
    // primera vez en este navegador: si ya coincide, nada; si no, manda lo del servidor (lo de aquí se guarda aparte)
    return localHash === hashString(JSON.stringify(server.datos)) ? 'nada' : 'bajar'
  }
  const changedHere = localHash !== meta.hash
  if (server.version === meta.version) return changedHere ? 'subir' : 'nada'
  if (server.version < meta.version) return 'subir'   // el servidor ha vuelto atrás (p. ej. se vació): se repone
  // el servidor tiene algo más nuevo, de otro dispositivo
  if (!changedHere) return 'bajar'
  return (meta.dirtyAt ?? 0) > Date.parse(server.guardado) ? 'subir' : 'bajar'
}

// ─── en el navegador ─────────────────────────────────────────────────────────

interface PersistedStore {
  subscribe: (listener: () => void) => () => void
  persist: { rehydrate: () => Promise<void> | void }
}

type Meta = Partial<Record<BackupKey, SyncMeta>>

function readMeta(): Meta {
  try {
    return JSON.parse(localStorage.getItem(SYNC_META_KEY) ?? '{}') as Meta
  } catch {
    return {}
  }
}

function writeMeta(meta: Meta) {
  localStorage.setItem(SYNC_META_KEY, JSON.stringify(meta))
}

/** Arranca la sincronización. Sin servidor (ficheros estáticos), o en la demo, no hace nada. */
export function startStateSync(stores: Record<BackupKey, PersistedStore>): void {
  if (typeof window === 'undefined' || typeof fetch !== 'function') return
  const keys = Object.keys(BACKUP_KEYS) as BackupKey[]
  const timers: Partial<Record<BackupKey, ReturnType<typeof setTimeout>>> = {}
  let enabled = true
  let applying = false
  let lastPull = 0

  const setMeta = (key: BackupKey, m: SyncMeta) => writeMeta({ ...readMeta(), [key]: m })

  async function push(key: BackupKey, keepalive = false) {
    const raw = localStorage.getItem(key)
    const meta = readMeta()[key]
    if (!enabled || raw == null || (meta && hashString(raw) === meta.hash)) return
    try {
      const res = await fetch(`/api/estado/${key}`, {
        method: 'PUT', keepalive,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ datos: JSON.parse(raw) }),
      })
      if (!res.ok) return
      const saved = await res.json() as { version: number }
      // si ha cambiado algo mientras tanto, se queda pendiente para la próxima subida
      if (localStorage.getItem(key) === raw) setMeta(key, { version: saved.version, hash: hashString(raw) })
    } catch {
      // sin conexión: se vuelve a intentar con el próximo cambio o al volver a la app
    }
  }

  async function apply(key: BackupKey, part: ServerPart) {
    const local = localStorage.getItem(key)
    const raw = JSON.stringify(part.datos)
    // lo de este navegador, si no se había subido nunca y era distinto, se guarda aparte antes de sustituirlo
    if (local != null && local !== raw && !readMeta()[key]) localStorage.setItem(key + BEFORE_SYNC_SUFFIX, local)
    applying = true
    try {
      localStorage.setItem(key, raw)
      await stores[key].persist.rehydrate()
      // tras cargarla, la tienda la reescribe un instante después (con valores por defecto nuevos): se espera a eso,
      // y esa es la versión sincronizada (si no, se tomaría por un cambio hecho aquí y se volvería a subir)
      await new Promise(r => setTimeout(r, 0))
      setMeta(key, { version: part.version, hash: hashString(localStorage.getItem(key) ?? raw) })
    } finally {
      applying = false
    }
  }

  async function pull() {
    if (!enabled || Date.now() - lastPull < PULL_MIN_GAP_MS) return
    lastPull = Date.now()
    let body: { demo?: boolean; partes?: Partial<Record<BackupKey, ServerPart | null>> }
    try {
      const res = await fetch('/api/estado', { cache: 'no-store' })
      if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) { enabled = res.status >= 500; return }
      body = await res.json()
    } catch {
      return
    }
    if (body.demo || !body.partes) { enabled = false; return }
    for (const key of keys) {
      const server = body.partes[key] ?? null
      const local = localStorage.getItem(key)
      const meta = readMeta()[key] ?? null
      const decision = decide(local, meta, server)
      if (decision === 'bajar' && server) await apply(key, server)
      else if (decision === 'subir') await push(key)
      // ya coincide (p. ej. ajustes por defecto en un dispositivo nuevo): se apunta como sincronizada para no subirla
      else if (server && local != null && !meta) setMeta(key, { version: server.version, hash: hashString(local) })
    }
  }

  for (const key of keys) {
    stores[key].subscribe(() => {
      if (applying || !enabled) return
      const meta = readMeta()[key]
      if (meta && !meta.dirtyAt) setMeta(key, { ...meta, dirtyAt: Date.now() })
      clearTimeout(timers[key])
      timers[key] = setTimeout(() => {
        timers[key] = undefined
        void push(key)
      }, PUSH_DELAY_MS)
    })
  }

  void pull()
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void pull()
  })
  window.addEventListener('focus', () => void pull())
  setInterval(() => { if (document.visibilityState === 'visible') void pull() }, PULL_EVERY_MS)
  // al cerrar la pestaña, lo que quedaba por subir se sube igualmente
  window.addEventListener('pagehide', () => {
    for (const key of keys) {
      if (timers[key]) {
        clearTimeout(timers[key])
        void push(key, true)
      }
    }
  })
}
