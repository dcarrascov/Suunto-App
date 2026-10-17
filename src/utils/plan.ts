import type { ActivitySummary, PlanSport, PlannedWorkout } from '../types/suunto'
import { localWeekStart } from './calculations'
import { parseLocalDate, toLocalISODate } from './date'

export type PlanStatus = 'done' | 'missed' | 'today' | 'upcoming' | 'rest'

export interface PlanItem {
  workout: PlannedWorkout
  activity: ActivitySummary | null   // actividad de Suunto con la que se ha emparejado
  status: PlanStatus
  compliance: number | null          // % de la duración (o distancia) planificada que se hizo
}

/** Deporte de la app con el que se compara cada deporte de TrainingPeaks. */
function sameSport(plan: PlanSport, act: ActivitySummary['sport']): boolean {
  if (plan === 'running' || plan === 'cycling' || plan === 'swimming') return plan === act
  return act === 'other'  // fuerza, cross training... suelen registrarse como "otro"
}

/**
 * Empareja cada entreno planificado con una actividad de Suunto del mismo día y deporte.
 * Si hay varias, se queda con la de duración más parecida; cada actividad se usa una sola vez.
 */
export function matchPlan(workouts: PlannedWorkout[], activities: ActivitySummary[]): Map<number, ActivitySummary> {
  const byDay = new Map<string, ActivitySummary[]>()
  for (const a of activities) {
    const day = a.startTime.slice(0, 10)
    byDay.set(day, [...(byDay.get(day) ?? []), a])
  }
  const used = new Set<number>()
  const out = new Map<number, ActivitySummary>()
  // Primero los que tienen duración planificada: así el emparejamiento por duración es más fiable
  const ordered = [...workouts].sort((a, b) => (b.planned.duration ?? 0) - (a.planned.duration ?? 0))
  for (const w of ordered) {
    if (w.sport === 'rest') continue
    const candidates = (byDay.get(w.date) ?? []).filter(a => !used.has(a.id) && sameSport(w.sport, a.sport))
    if (candidates.length === 0) continue
    const target = w.planned.duration
    const best = target
      ? candidates.reduce((x, y) => (Math.abs(y.duration - target) < Math.abs(x.duration - target) ? y : x))
      : candidates[0]
    used.add(best.id)
    out.set(w.id, best)
  }
  return out
}

/** % cumplido: duración real / planificada (o distancia si no hay duración). */
export function compliancePct(w: PlannedWorkout, act: ActivitySummary | null): number | null {
  const realDuration = act?.duration ?? w.actual?.duration ?? null
  const realDistance = act?.distance ?? w.actual?.distance ?? null
  if (w.planned.duration && realDuration) return Math.round(realDuration / w.planned.duration * 100)
  if (w.planned.distance && realDistance) return Math.round(realDistance / w.planned.distance * 100)
  return null
}

export function planItems(
  workouts: PlannedWorkout[], activities: ActivitySummary[], today: string = toLocalISODate(new Date()),
): PlanItem[] {
  const matches = matchPlan(workouts, activities)
  return workouts.map(w => {
    const activity = matches.get(w.id) ?? null
    const done = activity != null || w.completed
    const status: PlanStatus = w.sport === 'rest' ? 'rest'
      : done ? 'done'
      : w.date < today ? 'missed'
      : w.date === today ? 'today'
      : 'upcoming'
    return { workout: w, activity, status, compliance: done ? compliancePct(w, activity) : null }
  })
}

export interface PlanWeek {
  weekStart: string   // lunes (YYYY-MM-DD)
  items: PlanItem[]
  planned: number     // sesiones planificadas (sin descansos)
  done: number
  missed: number
  plannedSeconds: number
  doneSeconds: number
  plannedKm: number
  doneKm: number
}

/** Agrupa por semana (lunes a domingo, hora local), de la más reciente a la más antigua. */
export function planWeeks(items: PlanItem[]): PlanWeek[] {
  const weeks = new Map<string, PlanWeek>()
  for (const it of items) {
    const key = localWeekStart(parseLocalDate(it.workout.date))
    let w = weeks.get(key)
    if (!w) {
      w = { weekStart: key, items: [], planned: 0, done: 0, missed: 0, plannedSeconds: 0, doneSeconds: 0, plannedKm: 0, doneKm: 0 }
      weeks.set(key, w)
    }
    w.items.push(it)
    if (it.status === 'rest') continue
    w.planned += 1
    w.plannedSeconds += it.workout.planned.duration ?? 0
    w.plannedKm += it.workout.planned.distance ?? 0
    if (it.status === 'done') {
      w.done += 1
      w.doneSeconds += it.activity?.duration ?? it.workout.actual?.duration ?? 0
      w.doneKm += it.activity?.distance ?? it.workout.actual?.distance ?? 0
    }
    if (it.status === 'missed') w.missed += 1
  }
  for (const w of weeks.values()) w.items.sort((a, b) => a.workout.date.localeCompare(b.workout.date))
  return [...weeks.values()].sort((a, b) => b.weekStart.localeCompare(a.weekStart))
}

/** Los 7 días (YYYY-MM-DD) de la semana que empieza en `weekStart`. */
export function weekDays(weekStart: string): string[] {
  const d = parseLocalDate(weekStart)
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate() + i)
    return toLocalISODate(day)
  })
}

/** Lunes de la semana `offset` semanas antes (negativo) o después (positivo) de `weekStart`. */
export function shiftWeek(weekStart: string, offset: number): string {
  const d = parseLocalDate(weekStart)
  return toLocalISODate(new Date(d.getFullYear(), d.getMonth(), d.getDate() + offset * 7))
}
