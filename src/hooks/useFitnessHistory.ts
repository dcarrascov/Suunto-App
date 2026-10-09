import { useMemo } from 'react'
import { useActivityStore } from '../stores/activityStore'
import { calculateFitnessHistory } from '../utils/calculations'
import type { FitnessPoint } from '../types/garmin'

export interface FitnessHistoryData {
  history: FitnessPoint[]
  current: FitnessPoint | null
  sparkPoints: { date: string; ctl: number; atl: number; tsb: number }[]
}

export function useFitnessHistory(): FitnessHistoryData {
  const activities = useActivityStore(s => s.activities)
  const settings = useActivityStore(s => s.settings)

  const history = useMemo(
    () => calculateFitnessHistory(activities, settings),
    [activities, settings]
  )

  const current = useMemo(
    () => history.length > 0 ? history[history.length - 1] : null,
    [history]
  )

  const sparkPoints = useMemo(
    () => history.slice(-60).map(p => ({
      date: p.date.slice(5),
      ctl: Math.round(p.ctl),
      atl: Math.round(p.atl),
      tsb: Math.round(p.tsb),
    })),
    [history]
  )

  return { history, current, sparkPoints }
}
