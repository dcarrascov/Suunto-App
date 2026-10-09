import { useMemo } from 'react'
import { useActivityStore } from '../stores/activityStore'
import { isoDateOffset, monthKey } from '../utils/date'
import type { ActivitySummary, Sport } from '../types/garmin'

// ─── Aerobic Efficiency ───────────────────────────────────────────────────────

function aerobicEF(a: ActivitySummary): number | null {
  if (!a.avgHR || a.avgHR < 60) return null
  if (a.sport === 'running' && a.avgSpeed) return +(a.avgSpeed / a.avgHR * 100).toFixed(2)
  if (a.sport === 'cycling' && a.avgPower) return +(a.avgPower / a.avgHR).toFixed(2)
  return null
}

export interface AerobicEFPoint {
  month: string
  run: number | null
  bike: number | null
}

export function useAerobicEfficiency(): { data: AerobicEFPoint[]; trendPct: number | null } {
  const activities = useActivityStore(s => s.activities)

  return useMemo(() => {
    const byMonth: Record<string, { run: number[]; bike: number[] }> = {}

    for (const a of activities) {
      const m = monthKey(a.startTime)
      if (!byMonth[m]) byMonth[m] = { run: [], bike: [] }
      const ef = aerobicEF(a)
      if (ef == null) continue
      if (a.sport === 'running') byMonth[m].run.push(ef)
      if (a.sport === 'cycling') byMonth[m].bike.push(ef)
    }

    const avg = (arr: number[]): number | null =>
      arr.length ? +(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2) : null

    const data = Object.entries(byMonth)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-12)
      .map(([month, d]) => ({ month: month.slice(5), run: avg(d.run), bike: avg(d.bike) }))

    const runPoints = data.filter(d => d.run != null)
    const trendPct = runPoints.length >= 2
      ? +((runPoints.at(-1)!.run! - runPoints[0].run!) / runPoints[0].run! * 100).toFixed(1)
      : null

    return { data, trendPct }
  }, [activities])
}

// ─── Triathlon Balance ────────────────────────────────────────────────────────

const IDEAL_PCT: Record<Sport, number> = { running: 35, cycling: 50, swimming: 15, other: 0 }

export interface SportBalanceRow {
  sport: string
  emoji: string
  actual: number
  ideal: number
  hours: number
  gap: number
}

export function useTriathlonBalance(windowDays = 21): SportBalanceRow[] {
  const activities = useActivityStore(s => s.activities)

  return useMemo(() => {
    const cutoff = isoDateOffset(windowDays)
    const recent = activities.filter(a => a.startTime.slice(0, 10) >= cutoff)
    const hours: Record<string, number> = { running: 0, cycling: 0, swimming: 0 }

    for (const a of recent) {
      if (Object.hasOwn(hours, a.sport)) hours[a.sport] += a.duration / 3600
    }

    const total = Object.values(hours).reduce((s, h) => s + h, 0) || 1

    return [
      { sport: 'Running', emoji: '🏃', key: 'running' },
      { sport: 'Ciclismo', emoji: '🚴', key: 'cycling' },
      { sport: 'Natación', emoji: '🏊', key: 'swimming' },
    ].map(({ sport, emoji, key }) => {
      const actual = Math.round(hours[key] / total * 100)
      const ideal = IDEAL_PCT[key as Sport]
      return { sport, emoji, actual, ideal, hours: +hours[key].toFixed(1), gap: actual - ideal }
    })
  }, [activities, windowDays])
}

// ─── Cadence vs Speed ─────────────────────────────────────────────────────────

export interface CadencePoint {
  cadencia: number
  velocidad: number
  optimal: boolean
}

export function useCadenceData(): CadencePoint[] {
  const activities = useActivityStore(s => s.activities)

  return useMemo(() =>
    activities
      .filter(a => a.sport === 'running' && a.avgCadence && a.avgSpeed)
      .map(a => ({
        cadencia: a.avgCadence!,
        velocidad: +a.avgSpeed!.toFixed(1),
        optimal: a.avgCadence! >= 170 && a.avgCadence! <= 180,
      })),
    [activities]
  )
}

// ─── VO2max Trend ─────────────────────────────────────────────────────────────

export interface Vo2maxPoint {
  date: string
  vo2max: number
}

export function useVo2maxTrend(): { points: Vo2maxPoint[]; current: number | null } {
  const activities = useActivityStore(s => s.activities)

  return useMemo(() => {
    const bestPerDay: Record<string, number> = {}
    for (const a of activities) {
      if (!a.vo2max) continue
      const day = a.startTime.slice(0, 10)
      bestPerDay[day] = Math.max(bestPerDay[day] ?? 0, a.vo2max)
    }

    const points = Object.entries(bestPerDay)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, vo2max]) => ({ date: date.slice(5), vo2max }))

    const current = points.length > 0 ? points.at(-1)!.vo2max : null
    return { points, current }
  }, [activities])
}

// ─── Consistency Heatmap ──────────────────────────────────────────────────────

export interface HeatmapData {
  dates: string[]
  bySport: Record<Sport, number[]>
  activeDaysCount: number
}

const HEATMAP_SPORTS: Sport[] = ['running', 'cycling', 'swimming']

export function useConsistencyHeatmap(windowDays = 28): HeatmapData {
  const activities = useActivityStore(s => s.activities)

  return useMemo(() => {
    const days: Record<string, Record<Sport, number>> = {}
    for (let i = windowDays - 1; i >= 0; i--) {
      const key = isoDateOffset(i)
      days[key] = { running: 0, cycling: 0, swimming: 0, other: 0 }
    }

    for (const a of activities) {
      const key = a.startTime.slice(0, 10)
      if (Object.hasOwn(days, key) && Object.hasOwn(days[key], a.sport)) {
        days[key][a.sport as Sport] += a.duration / 3600
      }
    }

    const dateKeys = Object.keys(days).sort()

    const bySport = Object.fromEntries(
      HEATMAP_SPORTS.map(s => [s, dateKeys.map(d => days[d][s])])
    ) as Record<Sport, number[]>

    const activeDaysCount = dateKeys.filter(d =>
      HEATMAP_SPORTS.some(s => days[d][s] > 0)
    ).length

    return { dates: dateKeys.map(d => d.slice(5)), bySport, activeDaysCount }
  }, [activities, windowDays])
}

// ─── Weekly TSS load (re-exported from useWeeklyLoad for perf page) ───────────
export { useWeeklyLoad } from './useWeeklyLoad'
export type { WeekLoadPoint } from './useWeeklyLoad'
