import { useMemo } from 'react'
import { useActivityStore } from '../stores/activityStore'

export function useTrainingStreak(): number {
  const activities = useActivityStore(s => s.activities)

  return useMemo(() => {
    const activeDays = new Set(activities.map(a => a.startTime.slice(0, 10)))

    const candidate = new Date()
    let iso = candidate.toISOString().slice(0, 10)

    // Allow streak to start from yesterday if today has no activity yet
    if (!activeDays.has(iso)) {
      candidate.setDate(candidate.getDate() - 1)
      iso = candidate.toISOString().slice(0, 10)
      if (!activeDays.has(iso)) return 0
    }

    let streak = 0
    while (activeDays.has(iso)) {
      streak++
      candidate.setDate(candidate.getDate() - 1)
      iso = candidate.toISOString().slice(0, 10)
    }

    return streak
  }, [activities])
}
