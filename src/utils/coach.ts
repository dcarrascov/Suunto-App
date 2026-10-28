import type { PlannedEvent, PlannedWorkout } from '../types/suunto'
import { localWeekStart } from './calculations'
import { parseLocalDate, toLocalISODate } from './date'
import { raceDatesFromPlan } from './races'

// ─── Tipos de sesión ─────────────────────────────────────────────────────────
// Se deducen del título (el entrenador es muy sistemático: «RODAJE 45'», «SERIES LT2 4x6'»...)

export type SessionType =
  | 'rodaje' | 'progresivo' | 'rectas' | 'series' | 'cuestas' | 'cambios'
  | 'activacion' | 'competicion' | 'fuerza' | 'natacion' | 'descanso' | 'otro'

export const SESSION_LABEL: Record<SessionType, string> = {
  rodaje: 'Rodaje', progresivo: 'Rodaje progresivo', rectas: 'Rectas', series: 'Series',
  cuestas: 'Cuestas', cambios: 'Cambios de ritmo', activacion: 'Activación precompetición', competicion: 'Competición',
  fuerza: 'Fuerza / core', natacion: 'Natación', descanso: 'Descanso', otro: 'Otro',
}

/** Familia de la sesión, para comparar semanas sin exigir el mismo formato exacto. */
export type SessionFamily = 'suave' | 'calidad' | 'rectas' | 'activacion' | 'competicion' | 'fuerza' | 'natacion' | 'descanso' | 'otro'

export const FAMILY_OF: Record<SessionType, SessionFamily> = {
  rodaje: 'suave', progresivo: 'suave', rectas: 'rectas', series: 'calidad', cuestas: 'calidad',
  cambios: 'calidad', activacion: 'activacion', competicion: 'competicion', fuerza: 'fuerza', natacion: 'natacion',
  descanso: 'descanso', otro: 'otro',
}

export function sessionType(w: Pick<PlannedWorkout, 'title' | 'sport'>): SessionType {
  const t = w.title.toLowerCase()
  if (w.sport === 'rest' || /descanso/.test(t)) return 'descanso'
  if (/activaci[oó]n/.test(t)) return 'activacion'
  // «competición» o «carrera …», pero no «series precompetición»
  if (!/precompetici/.test(t) && (/\bcompetici[oó]n\b/.test(t) || /^carrera\b/.test(t))) return 'competicion'
  if (w.sport === 'swimming' || /nataci[oó]n|piscina/.test(t)) return 'natacion'
  if (w.sport === 'strength' || /fuerza|core|gimnasio/.test(t)) return 'fuerza'
  if (/cuesta/.test(t)) return 'cuestas'
  if (/cambios|fartlek/.test(t)) return 'cambios'
  if (/rectas/.test(t)) return 'rectas'
  if (/progresiv/.test(t)) return 'progresivo'
  if (/rodaje|suave|regenerativ|continuo/.test(t)) return 'rodaje'
  if (/series|umbral|lt\d|tempo|\d+\s*[x×]\s*\d/.test(t)) return 'series'
  return 'otro'
}

// ─── Estadísticas del entrenador ─────────────────────────────────────────────

const WEEKDAY = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']

/** 0 = lunes … 6 = domingo */
export function weekdayIndex(iso: string): number {
  return (parseLocalDate(iso).getDay() + 6) % 7
}

export interface CoachWeek {
  weekStart: string
  workouts: PlannedWorkout[]
  sessions: number      // sin descansos
  km: number
  minutes: number
  tss: number
}

/** Semanas con plan del entrenador, de la más antigua a la más reciente. */
export function coachWeeks(workouts: PlannedWorkout[]): CoachWeek[] {
  const map = new Map<string, CoachWeek>()
  for (const w of workouts) {
    if (!w.hasPlan && w.sport !== 'rest') continue
    const key = localWeekStart(parseLocalDate(w.date))
    let wk = map.get(key)
    if (!wk) map.set(key, wk = { weekStart: key, workouts: [], sessions: 0, km: 0, minutes: 0, tss: 0 })
    wk.workouts.push(w)
    if (sessionType(w) === 'descanso') continue
    wk.sessions += 1
    wk.km += w.planned.distance ?? 0
    wk.minutes += (w.planned.duration ?? 0) / 60
    wk.tss += w.planned.tss ?? 0
  }
  for (const wk of map.values()) wk.workouts.sort((a, b) => a.date.localeCompare(b.date))
  return [...map.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart))
}

export interface CoachStats {
  weeks: number
  from: string | null
  to: string | null
  avgSessions: number
  avgKm: number
  avgMinutes: number
  avgTss: number
  typeCounts: Partial<Record<SessionType, number>>
  byWeekday: Partial<Record<SessionType, number>>[]   // por día (0 = lunes): cuántas veces pone cada tipo
  preRace: { date: string; name: string | null; days: { offset: number; types: SessionType[] }[] }[]  // 7 días antes de cada carrera
}

export function coachStats(workouts: PlannedWorkout[], events: PlannedEvent[] = []): CoachStats {
  const planned = workouts.filter(w => w.hasPlan || w.sport === 'rest')
  const weeks = coachWeeks(planned)
  const avg = (f: (w: CoachWeek) => number) => (weeks.length ? weeks.reduce((s, w) => s + f(w), 0) / weeks.length : 0)
  const typeCounts: Partial<Record<SessionType, number>> = {}
  const byWeekday: Partial<Record<SessionType, number>>[] = Array.from({ length: 7 }, () => ({}))
  for (const w of planned) {
    const t = sessionType(w)
    typeCounts[t] = (typeCounts[t] ?? 0) + 1
    const d = byWeekday[weekdayIndex(w.date)]
    d[t] = (d[t] ?? 0) + 1
  }
  const byDate = new Map<string, PlannedWorkout[]>()
  for (const w of planned) byDate.set(w.date, [...(byDate.get(w.date) ?? []), w])
  const preRace = raceDatesFromPlan(planned, events).map(date => {
    const race = parseLocalDate(date)
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(race.getFullYear(), race.getMonth(), race.getDate() - (7 - i))
      return { offset: -(7 - i), types: (byDate.get(toLocalISODate(d)) ?? []).map(sessionType) }
    })
    return { date, name: events.find(e => e.date === date)?.name ?? null, days }
  })
  return {
    weeks: weeks.length,
    from: weeks[0]?.weekStart ?? null,
    to: weeks.at(-1)?.weekStart ?? null,
    avgSessions: avg(w => w.sessions),
    avgKm: avg(w => w.km),
    avgMinutes: avg(w => w.minutes),
    avgTss: avg(w => w.tss),
    typeCounts, byWeekday, preRace,
  }
}

/** Resumen en texto de las estadísticas (para los textos que se copian a Gemini). */
export function coachStatsText(s: CoachStats): string {
  const top = (counts: Partial<Record<SessionType, number>>) =>
    Object.entries(counts).sort((a, b) => b[1]! - a[1]!).map(([t, n]) => `${SESSION_LABEL[t as SessionType]} ${n}`).join(', ')
  const lines = [
    `Semanas con plan: ${s.weeks} (de la semana del ${s.from} a la del ${s.to}).`,
    `Media semanal planificada: ${s.avgSessions.toFixed(1)} sesiones, ${Math.round(s.avgMinutes)} min, ${Math.round(s.avgTss)} TSS.`,
    'El entrenador planifica por tiempo: indica la duración en todas las sesiones y la distancia solo en algunas.',
    `Sesiones por tipo: ${top(s.typeCounts)}.`,
    'Qué pone cada día de la semana (veces):',
    ...s.byWeekday.map((d, i) => `- ${WEEKDAY[i]}: ${top(d) || 'nada'}`),
  ]
  if (s.preRace.length) {
    lines.push('Los 7 días antes de cada competición (día −7 a −1):')
    for (const r of s.preRace) {
      lines.push(`- ${r.name ? `«${r.name}»` : 'Carrera'} del ${r.date}: ` + r.days.map(d => `${d.offset}: ${d.types.map(t => SESSION_LABEL[t]).join('+') || '—'}`).join(' · '))
    }
  }
  return lines.join('\n')
}
