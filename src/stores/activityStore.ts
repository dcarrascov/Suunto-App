import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ActivitySummary, ActivityDetail, GlobalStats, UserSettings } from '../types/garmin'
import { DEFAULT_SETTINGS } from '../types/garmin'

interface ActivityState {
  activities: ActivitySummary[]
  stats: GlobalStats | null
  settings: UserSettings
  loading: boolean
  error: string | null
  detailCache: Record<number, ActivityDetail>

  loadActivities: () => Promise<void>
  loadStats: () => Promise<void>
  updateSettings: (s: Partial<UserSettings>) => void
  loadDetail: (id: number) => Promise<ActivityDetail | null>
}

export const useActivityStore = create<ActivityState>()(
  persist(
    (set, get) => ({
      activities: [],
      stats: null,
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
      name: 'garmin-settings',
      partialize: (state) => ({ settings: state.settings }),
    }
  )
)
