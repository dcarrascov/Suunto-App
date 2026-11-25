// Qué toca un día (la franja «Hoy» del Resumen): lo del entrenador; si él no puso nada ese día, tus entrenos del
// Calendario (también los pasados desde una propuesta de la IA, que pueden estar editados); si tampoco, la propuesta de
// la IA de esa semana. Así el Resumen sirve igual con entrenador, con la IA o sin nada.

import type { AiProposal } from '../stores/aiStore'
import type { CustomWorkout } from './customWorkouts'
import { formatDuration } from './formatters'
import type { PlanItem } from './plan'

export type DaySource = 'coach' | 'custom' | 'ia'

export interface DaySession {
  key: string
  title: string
  detail: string        // «1h 05m · 12 km · 70 TSS»
  minutes: number | null
  done: boolean
  source: DaySource
}

function detailOf(seconds: number | null, km: number | null, tss: number | null): string {
  return [
    seconds ? formatDuration(seconds) : null,
    km ? `${km.toLocaleString('es-ES')} km` : null,
    tss ? `${Math.round(tss)} TSS` : null,
  ].filter(Boolean).join(' · ')
}

export function sessionsForDay(
  day: string,
  coach: PlanItem[],
  custom: CustomWorkout[],
  proposal: AiProposal | undefined,
  activityDays: Set<string>,
): DaySession[] {
  const fromCoach = coach.filter(i => i.workout.date === day)
  if (fromCoach.length) {
    return fromCoach.map(i => ({
      key: `coach-${i.workout.id}`,
      title: i.workout.sport === 'rest' && !i.workout.title ? 'Descanso' : i.workout.title,
      detail: detailOf(i.workout.planned.duration, i.workout.planned.distance, i.workout.planned.tss),
      minutes: i.workout.planned.duration ? i.workout.planned.duration / 60 : null,
      done: i.status === 'done',
      source: 'coach' as const,
    }))
  }
  const done = activityDays.has(day)
  const own = custom.filter(w => w.date === day)
  if (own.length) {
    return own.map(w => ({
      key: `custom-${w.id}`, title: w.title,
      detail: detailOf(w.durationMin ? w.durationMin * 60 : null, w.distanceKm, null),
      minutes: w.durationMin, done, source: 'custom' as const,
    }))
  }
  return (proposal?.workouts ?? [])
    .map((w, i) => ({ w, i }))
    .filter(({ w }) => w.date === day && w.type !== 'descanso')
    .map(({ w, i }) => ({
      key: `ia-${day}-${i}`, title: w.title,
      detail: detailOf(w.durationMin ? w.durationMin * 60 : null, w.distanceKm, w.tss),
      minutes: w.durationMin, done, source: 'ia' as const,
    }))
}

/** Duración como en un cronómetro: «1:05:00» o «45:00». */
export function clockTime(seconds: number): string {
  const s = Math.round(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** Días que faltan de `today` a `date` (las dos YYYY-MM-DD, hora local). */
export function daysUntil(date: string, today: string): number {
  const [y1, m1, d1] = today.split('-').map(Number)
  const [y2, m2, d2] = date.split('-').map(Number)
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000)
}
