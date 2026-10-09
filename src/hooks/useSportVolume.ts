import { useMemo } from 'react'
import { useActivityStore } from '../stores/activityStore'
import { isoDateOffset } from '../utils/date'
import type { Sport } from '../types/garmin'

export interface SportVolume {
  hours: number
  count: number
}

export type SportVolumeMap = Record<Sport, SportVolume>

export interface SportsVolumeData {
  bySport: SportVolumeMap
  totalHours: number
  percentages: Record<Sport, number>
}

const SPORTS: Sport[] = ['running', 'cycling', 'swimming']

export function useSportVolume(windowDays = 30): SportsVolumeData {
  const activities = useActivityStore(s => s.activities)

  return useMemo(() => {
    const cutoff = isoDateOffset(windowDays)
    const recent = activities.filter(a => a.startTime.slice(0, 10) >= cutoff)

    const bySport = Object.fromEntries(
      SPORTS.map(s => [s, { hours: 0, count: 0 }])
    ) as SportVolumeMap

    for (const a of recent) {
      const sport = a.sport as Sport
      if (Object.hasOwn(bySport, sport)) {
        bySport[sport].hours += a.duration / 3600
        bySport[sport].count += 1
      }
    }

    const totalHours = SPORTS.reduce((s, sp) => s + bySport[sp].hours, 0)

    const percentages = Object.fromEntries(
      SPORTS.map(s => [s, totalHours > 0 ? bySport[s].hours / totalHours * 100 : 0])
    ) as Record<Sport, number>

    return { bySport, totalHours, percentages }
  }, [activities, windowDays])
}
