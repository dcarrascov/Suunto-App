import { useMemo } from 'react'
import { useActivityStore } from '../stores/activityStore'
import { estimateZonesFromHR, HR_ZONE_DEFS } from '../utils/calculations'
import { isoDateOffset } from '../utils/date'
import type { Sport } from '../types/garmin'

export interface ZoneSlice {
  zone: string
  pct: number
  hours: number
  color: string
}

export interface ZoneDistributionData {
  slices: ZoneSlice[]
  isAerobicFocused: boolean
}

export function useZoneDistribution(windowDays = 30, sport: Sport | 'all' = 'all'): ZoneDistributionData {
  const activities = useActivityStore(s => s.activities)
  const settings = useActivityStore(s => s.settings)

  return useMemo(() => {
    const cutoff = isoDateOffset(windowDays)
    const recent = activities.filter(a =>
      a.startTime.slice(0, 10) >= cutoff &&
      (sport === 'all' || a.sport === sport)
    )

    const totals = [0, 0, 0, 0, 0]
    for (const a of recent) {
      const zones = estimateZonesFromHR(a.avgHR, a.duration, settings.maxHR)
      zones.forEach(z => { totals[z.zone - 1] += z.seconds / 3600 })
    }

    const total = totals.reduce((s, v) => s + v, 0) || 1
    const slices = HR_ZONE_DEFS.map((z, i) => ({
      zone: z.name,
      pct: Math.round(totals[i] / total * 100),
      hours: +totals[i].toFixed(2),
      color: z.color,
    }))

    const aerobicPct = slices[0].pct + slices[1].pct
    return { slices, isAerobicFocused: aerobicPct >= 60 }
  }, [activities, settings.maxHR, windowDays, sport])
}
