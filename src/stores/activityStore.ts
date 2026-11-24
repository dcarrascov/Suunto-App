import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ActivitySummary, ActivityDetail, GlobalStats, TrainingPlan, UserSettings } from '../types/suunto'
import { DEFAULT_SETTINGS } from '../types/suunto'

const SETTINGS_KEY = 'suunto-settings'
const LEGACY_SETTINGS_KEY = 'garmin-settings' // nombre antiguo: se migra una vez para no perder los ajustes

try {
  if (!localStorage.getItem(SETTINGS_KEY)) {
    const legacy = localStorage.getItem(LEGACY_SETTINGS_KEY)
    if (legacy) {
      localStorage.setItem(SETTINGS_KEY, legacy)
      localStorage.removeItem(LEGACY_SETTINGS_KEY)
    }
  }
} catch {
  // sin acceso a localStorage (modo privado...): se usan los ajustes por defecto
}

interface ActivityState {
  activities: ActivitySummary[]
  stats: GlobalStats | null
  plan: TrainingPlan | null   // entrenos de TrainingPeaks (opcional: solo si se ejecutó tp_sync.py)
  settings: UserSettings
  loading: boolean
  error: string | null
  detailCache: Record<number, ActivityDetail>

  loadActivities: () => Promise<void>
  loadStats: () => Promise<void>
  loadPlan: () => Promise<void>
  reloadData: () => Promise<void>
  updateSettings: (s: Partial<UserSettings>) => void
  loadDetail: (id: number) => Promise<ActivityDetail | null>
}

export const useActivityStore = create<ActivityState>()(
  persist(
    (set, get) => ({
      activities: [],
      stats: null,
      plan: null,
      settings: DEFAULT_SETTINGS,
      loading: false,
      error: null,
      detailCache: {},

      loadActivities: async () => {
        set({ loading: true, error: null })
        try {
          const res = await fetch('/data/activities.json')
          if (!res.ok) throw new Error(`No se encontró /data/activities.json (status ${res.status})`)
          const data: ActivitySummary[] = await res.json()
          data.sort((a, b) => b.startTime.localeCompare(a.startTime))
          set({ activities: data, loading: false })
        } catch (e) {
          set({ loading: false, error: (e as Error).message })
        }
      },

      loadStats: async () => {
        try {
          const res = await fetch('/data/stats.json')
          if (!res.ok) return
          const data: GlobalStats = await res.json()
          set({ stats: data })
        } catch {
          // stats are optional
        }
      },

      loadPlan: async () => {
        try {
          const res = await fetch('/data/plan.json')
          if (!res.ok) return
          const data: TrainingPlan = await res.json()
          if (Array.isArray(data?.workouts)) set({ plan: data })
        } catch {
          // el plan es opcional
        }
      },

      // Tras actualizar desde el botón: vuelve a leer los JSON sin pasar por la pantalla de carga
      reloadData: async () => {
        const read = async <T,>(url: string): Promise<T | null> => {
          try {
            const res = await fetch(url, { cache: 'no-store' })
            return res.ok ? await res.json() as T : null
          } catch {
            return null
          }
        }
        const [activities, stats, plan] = await Promise.all([
          read<ActivitySummary[]>('/data/activities.json'),
          read<GlobalStats>('/data/stats.json'),
          read<TrainingPlan>('/data/plan.json'),
        ])
        activities?.sort((a, b) => b.startTime.localeCompare(a.startTime))
        set(state => ({
          activities: activities ?? state.activities,
          stats: stats ?? state.stats,
          plan: Array.isArray(plan?.workouts) ? plan : state.plan,
          detailCache: {},
        }))
      },

      updateSettings: (s) => {
        set(state => ({ settings: { ...state.settings, ...s } }))
      },

      loadDetail: async (id: number) => {
        const cached = get().detailCache[id]
        if (cached) return cached
        try {
          const res = await fetch(`/data/activity_${id}.json`)
          if (!res.ok) return null
          const detail: ActivityDetail = await res.json()
          set(state => ({ detailCache: { ...state.detailCache, [id]: detail } }))
          return detail
        } catch {
          return null
        }
      },
    }),
    {
      name: SETTINGS_KEY,
      partialize: (state) => ({ settings: state.settings }),
      // Mezcla con los valores por defecto: así los ajustes nuevos tienen valor aunque haya ajustes guardados antiguos
      merge: (persisted, current) => ({
        ...current,
        settings: { ...DEFAULT_SETTINGS, ...(persisted as Partial<ActivityState> | undefined)?.settings },
      }),
    }
  )
)
