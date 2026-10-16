import { useMemo } from 'react'
import { useActivityStore } from '../stores/activityStore'
import { isoDateOffset, monthKey, parseLocalDate, toLocalISODate } from '../utils/date'
import { localWeekStart } from '../utils/calculations'
import type { ActivitySummary } from '../types/suunto'

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

// ─── Running Volume ───────────────────────────────────────────────────────────

export interface RunWeekPoint {
  week: string        // MM-DD del lunes
  weekStart: string   // lunes (YYYY-MM-DD)
  km: number
  longRun: number     // km de la carrera más larga de la semana
  runs: number
  baseKm: number | null  // media de km de las 4 semanas anteriores
  rampPct: number | null // km de la semana frente a esa media
  riskLevel: 'ok' | 'warn' | 'high'
}

/** Km de carrera por semana (lunes a domingo, hora local), incluidas las semanas sin carreras. */
export function useRunningVolume(windowWeeks = 12): RunWeekPoint[] {
  const activities = useActivityStore(s => s.activities)

  return useMemo(() => {
    const total = windowWeeks + 4  // 4 semanas más para la media de referencia de la primera
    const monday = parseLocalDate(localWeekStart(new Date()))
    monday.setDate(monday.getDate() - 7 * (total - 1))
    const keys: string[] = []
    for (let i = 0; i < total; i++) {
      keys.push(toLocalISODate(monday))
      monday.setDate(monday.getDate() + 7)
    }

    const weeks = new Map(keys.map(k => [k, { km: 0, longRun: 0, runs: 0 }]))
    for (const a of activities) {
      if (a.sport !== 'running') continue
      const w = weeks.get(localWeekStart(new Date(a.startTime)))
      if (!w) continue
      w.km += a.distance
      w.longRun = Math.max(w.longRun, a.distance)
      w.runs += 1
    }

    const rows = keys.map(k => weeks.get(k)!)
    return keys.slice(4).map((k, j) => {
      const i = j + 4
      const w = rows[i]
      const prev = rows.slice(i - 4, i).map(r => r.km)
      const baseKm = prev.some(km => km > 0) ? prev.reduce((s, km) => s + km, 0) / 4 : null
      const rampPct = baseKm ? Math.round((w.km - baseKm) / baseKm * 100) : null
      const riskLevel = rampPct == null ? 'ok' : rampPct > 30 ? 'high' : rampPct > 15 ? 'warn' : 'ok'
      return {
        week: k.slice(5),
        weekStart: k,
        km: +w.km.toFixed(1),
        longRun: +w.longRun.toFixed(1),
        runs: w.runs,
        baseKm: baseKm != null ? +baseKm.toFixed(1) : null,
        rampPct,
        riskLevel,
      }
    })
  }, [activities, windowWeeks])
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
  date: string    // lunes de la semana (YYYY-MM-DD)
  vo2max: number  // media de las mediciones de esa semana
}

export function useVo2maxTrend(): { points: Vo2maxPoint[]; current: number | null } {
  const activities = useActivityStore(s => s.activities)

  return useMemo(() => {
    // Media semanal (como en el Dashboard): con una medición por carrera la serie diaria era ilegible
    const byWeek: Record<string, number[]> = {}
    for (const a of activities) {
      if (!a.vo2max) continue
      const week = localWeekStart(new Date(a.startTime))
      ;(byWeek[week] ??= []).push(a.vo2max)
    }

    const points = Object.entries(byWeek)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, vals]) => ({ date, vo2max: +(vals.reduce((s, v) => s + v, 0) / vals.length).toFixed(1) }))

    const current = points.length > 0 ? points.at(-1)!.vo2max : null
    return { points, current }
  }, [activities])
}

// ─── Consistency Heatmap ──────────────────────────────────────────────────────

export interface HeatmapData {
  dates: string[]
  running: number[]   // horas de carrera por día
  cross: number[]     // horas del resto de deportes (bici, natación, otros)
  activeDaysCount: number
}

export function useConsistencyHeatmap(windowDays = 28): HeatmapData {
  const activities = useActivityStore(s => s.activities)

  return useMemo(() => {
    const days: Record<string, { running: number; cross: number }> = {}
    for (let i = windowDays - 1; i >= 0; i--) {
      days[isoDateOffset(i)] = { running: 0, cross: 0 }
    }

    for (const a of activities) {
      const day = days[a.startTime.slice(0, 10)]
      if (!day) continue
      day[a.sport === 'running' ? 'running' : 'cross'] += a.duration / 3600
    }

    const dateKeys = Object.keys(days).sort()
    return {
      dates: dateKeys.map(d => d.slice(5)),
      running: dateKeys.map(d => days[d].running),
      cross: dateKeys.map(d => days[d].cross),
      activeDaysCount: dateKeys.filter(d => days[d].running > 0 || days[d].cross > 0).length,
    }
  }, [activities, windowDays])
}

// ─── Weekly TSS load (re-exported from useWeeklyLoad for perf page) ───────────
export { useWeeklyLoad } from './useWeeklyLoad'
export type { WeekLoadPoint } from './useWeeklyLoad'
