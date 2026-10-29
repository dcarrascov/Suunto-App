import { create } from 'zustand'
import { useActivityStore } from './activityStore'

// Botón de recargar: lanza actualizar.ps1 en el servidor de Vite (server/sync.ts) y sigue el progreso.

/** Copia de SyncState de server/sync.ts (lo que devuelve /api/sync/status). */
export interface SyncStatus {
  running: boolean
  step: 'inicio' | 'suunto' | 'trainingpeaks' | 'validacion' | 'fin'
  percent: number
  done: number | null
  total: number | null
  planSkipped: boolean
  planFailed: boolean
  ok: boolean | null
  error: string | null
  seconds: number | null
}

interface SyncStore {
  status: SyncStatus | null     // null = barra oculta
  start: (mode?: 'normal' | 'fit') => Promise<void>   // fit = sin cuenta de Suunto: solo los .fit
  resume: () => Promise<void>   // al abrir la app, por si ya había una en marcha
  dismiss: () => void
}

const EMPTY: SyncStatus = {
  running: false, step: 'inicio', percent: 0, done: null, total: null, planSkipped: false, planFailed: false,
  ok: null, error: null, seconds: null,
}

const POLL_MS = 700
const HIDE_AFTER_MS = 8000
let polling = false

export const useSyncStore = create<SyncStore>()((set, get) => {
  const poll = async () => {
    if (polling) return
    polling = true
    try {
      for (;;) {
        await new Promise(r => setTimeout(r, POLL_MS))
        const res = await fetch('/api/sync/status', { cache: 'no-store' })
        const s = await res.json() as SyncStatus
        set({ status: s })
        if (!s.running) {
          if (s.ok) {
            await useActivityStore.getState().reloadData()
            // sin avisos: la barra se va sola; con aviso (plan fallido) se queda hasta cerrarla
            if (!s.planFailed) setTimeout(() => { if (get().status === s) set({ status: null }) }, HIDE_AFTER_MS)
          }
          break
        }
      }
    } catch {
      set(st => ({ status: { ...(st.status ?? EMPTY), running: false, ok: false, error: 'Se ha perdido la conexión con el servidor de la app.' } }))
    } finally {
      polling = false
    }
  }

  return {
    status: null,
    start: async (mode = 'normal') => {
      if (get().status?.running) return
      set({ status: { ...EMPTY, running: true } })
      try {
        const res = await fetch(mode === 'fit' ? '/api/sync?mode=fit' : '/api/sync', { method: 'POST' })
        if (res.status === 404) throw new Error('El botón solo funciona con «npm run dev» o «npm run preview».')
        const body = await res.json() as SyncStatus & { error?: string }
        if (res.status !== 202 && res.status !== 409) throw new Error(body.error ?? `Error ${res.status}`)
        set({ status: body })
        void poll()
      } catch (e) {
        set({ status: { ...EMPTY, ok: false, error: (e as Error).message } })
      }
    },
    resume: async () => {
      try {
        const res = await fetch('/api/sync/status', { cache: 'no-store' })
        if (!res.ok) return
        const s = await res.json() as SyncStatus
        if (s.running) {
          set({ status: s })
          void poll()
        }
      } catch {
        // sin servidor de la app (p. ej. una build estática): no hay botón que seguir
      }
    },
    dismiss: () => set({ status: null }),
  }
})
