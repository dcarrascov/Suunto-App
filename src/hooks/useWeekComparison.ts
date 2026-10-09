import { useMemo } from 'react'
import { useActivityStore } from '../stores/activityStore'
import { estimateTSS } from '../utils/calculations'
import { startOfWeek, endOfWeek } from '../utils/date'
import type { ActivitySummary } from '../types/garmin'

export interface WeekTotals {
  count: number
  distance: number   // km
  duration: number   // seconds
  tss: number
  elevation: number  // m
  calories: number
}

export interface WeekComparisonData {
  thisWeek: ActivitySummary[]
  lastWeek: ActivitySummary[]
  current: WeekTotals
  previous: WeekTotals
}

function sumWeek(acts: ActivitySummary[], settings: ReturnType<typeof useActivityStore.getState>['settings']): WeekTotals {
  return {
    count: acts.length,
    distance: acts.reduce((s, a) => s + a.distance, 0),
    duration: acts.reduce((s, a) => s + a.duration, 0),
    tss: acts.reduce((s, a) => s + estimateTSS(a, settings), 0),
    elevation: acts.reduce((s, a) => s + (a.elevationGain ?? 0), 0),
    calories: acts.reduce((s, a) => s + (a.calories ?? 0), 0),
  }
}

export function useWeekComparison(): WeekComparisonData {
  const activities = useActivityStore(s => s.activities)
  const settings = useActivityStore(s => s.settings)

  const thisWeek = useMemo(() => {
    const mon = startOfWeek()
    return activities.filter(a => new Date(a.startTime) >= mon)
  }, [activities])

  const lastWeek = useMemo(() => {
    const mon = startOfWeek(1)
    const sun = endOfWeek(1)
    return activities.filter(a => {
      const t = new Date(a.startTime)
      return t >= mon && t <= sun
    })
  }, [activities])

  const current = useMemo(() => sumWeek(thisWeek, settings), [thisWeek, settings])
  const previous = useMemo(() => sumWeek(lastWeek, settings), [lastWeek, settings])

  return { thisWeek, lastWeek, current, previous }
}
