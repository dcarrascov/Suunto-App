import type { ActivitySummary, FitnessPoint, PlannedEvent, PlannedWorkout, UserSettings } from '../types/suunto'
import { riegel } from './calculations'
import { parseLocalDate, toLocalISODate } from './date'

// El entrenador pone esta sesión el día ANTES de cada competición
const PRE_RACE = /activaci[oó]n\s+precompetici[oó]n/i
const MIN_RACE_KM = 3  // el calentamiento y la vuelta a la calma del día de la carrera son más cortos

export type RaceSource = 'event' | 'plan' | 'manual'   // event = competición del calendario de TrainingPeaks

export interface Race {
  date: string                       // YYYY-MM-DD
  activity: ActivitySummary | null   // null = próxima (o sin actividad registrada ese día)
  source: RaceSource                 // event = del calendario · plan = deducida de la activación · manual = marcada
  event: PlannedEvent | null         // nombre, prioridad y distancia de TrainingPeaks
  upcoming: boolean
  formBefore: number | null          // TSB del día anterior: la forma con la que llegas
  vsPrevious: number | null          // s más (+) o menos (−) que la competición anterior, ajustada a esta distancia
  standardLabel: string | null       // "10 km", "Media maratón"... si la distancia se parece a una estándar
}

const STANDARD = [
  { km: 5, label: '5 km' }, { km: 10, label: '10 km' },
  { km: 21.097, label: 'Media maratón' }, { km: 42.195, label: 'Maratón' },
]

function addDays(iso: string, days: number): string {
  const d = parseLocalDate(iso)
  return toLocalISODate(new Date(d.getFullYear(), d.getMonth(), d.getDate() + days))
}

/** Distancia estándar más parecida (±5 %), o null si no se parece a ninguna. */
export function standardDistance(km: number): { km: number; label: string } | null {
  return STANDARD.find(s => Math.abs(km - s.km) / s.km <= 0.05) ?? null
}

/** Competiciones del calendario de TrainingPeaks por día. */
export function eventsByDate(events: PlannedEvent[]): Map<string, PlannedEvent[]> {
  const map = new Map<string, PlannedEvent[]>()
  for (const e of events) map.set(e.date, [...(map.get(e.date) ?? []), e])
  return map
}

/** Próximas competiciones (hoy incluido), de la más cercana a la más lejana. */
export function upcomingEvents(events: PlannedEvent[], today: string = toLocalISODate(new Date())): PlannedEvent[] {
  return events.filter(e => e.date >= today).sort((a, b) => a.date.localeCompare(b.date))
}

/** «15K Sevilla · prioridad A · 15 km» */
export function eventLabel(e: PlannedEvent): string {
  return [e.name, e.priority && `prioridad ${e.priority}`, e.distanceKm && `${e.distanceKm.toLocaleString('es-ES')} km`]
    .filter(Boolean).join(' · ')
}

/**
 * Días de competición: los eventos del calendario de TrainingPeaks y, de respaldo, el día siguiente a una
 * «Activación precompetición» o un entreno de tipo Competición (carreras que no estén apuntadas como evento).
 */
export function raceDatesFromPlan(workouts: PlannedWorkout[], events: PlannedEvent[] = []): string[] {
  const dates = new Set<string>(events.map(e => e.date))
  for (const w of workouts) {
    if (PRE_RACE.test(w.title)) dates.add(addDays(w.date, 1))
    if (w.typeName === 'Competición') dates.add(w.date)
  }
  return [...dates].sort()
}

/** La carrera de ese día: la más rápida de las de 3 km o más (descarta calentamiento y vuelta a la calma). */
export function mainRunOfDay(activities: ActivitySummary[], date: string): ActivitySummary | null {
  const runs = activities.filter(a => a.sport === 'running' && a.startTime.startsWith(date) && a.distance >= MIN_RACE_KM && a.avgPace)
  if (runs.length === 0) return null
  return runs.reduce((best, a) => (a.avgPace! < best.avgPace! ? a : best))
}

export function findRaces(
  activities: ActivitySummary[],
  workouts: PlannedWorkout[],
  fitness: FitnessPoint[],         // historia + proyección (para la forma de las próximas)
  settings: Pick<UserSettings, 'raceIds' | 'notRaceIds'>,
  today: string = toLocalISODate(new Date()),
  events: PlannedEvent[] = [],
): Race[] {
  const notRace = new Set(settings.notRaceIds ?? [])
  const byDate = eventsByDate(events)
  const tsbByDate = new Map(fitness.map(p => [p.date, p.tsb]))
  const races: Race[] = []
  const usedIds = new Set<number>()

  const build = (date: string, activity: ActivitySummary | null, source: RaceSource): Race => {
    const event = byDate.get(date)?.[0] ?? null
    const km = activity?.distance ?? event?.distanceKm ?? null
    const std = km ? standardDistance(km) : null
    return {
      date, activity, event, source: event && source === 'plan' ? 'event' : source,
      upcoming: !activity && date >= today,
      formBefore: tsbByDate.get(addDays(date, -1)) ?? null,
      vsPrevious: null, standardLabel: std?.label ?? null,
    }
  }

  for (const date of raceDatesFromPlan(workouts, events)) {
    const act = mainRunOfDay(activities, date)
    if (act && notRace.has(act.id)) continue
    if (!act && date < today) continue  // día de carrera sin actividad registrada: no hay nada que enseñar
    if (act) usedIds.add(act.id)
    races.push(build(date, act, 'plan'))
  }
  for (const id of settings.raceIds ?? []) {
    const act = activities.find(a => a.id === id)
    if (!act || usedIds.has(id)) continue
    usedIds.add(id)
    races.push(build(act.startTime.slice(0, 10), act, 'manual'))
  }
  races.sort((a, b) => b.date.localeCompare(a.date))
  // Diferencia con la competición anterior, llevada a la misma distancia (Riegel) por si no son idénticas
  const done = races.filter(r => r.activity)
  done.forEach((r, i) => {
    const prev = done[i + 1]?.activity
    const cur = r.activity!
    if (prev) r.vsPrevious = Math.round(cur.duration - riegel(prev.duration, prev.distance, cur.distance))
  })
  return races
}

/** Ids de todas las actividades que son competición (para excluirlas de otros análisis). */
export function raceActivityIds(
  activities: ActivitySummary[], workouts: PlannedWorkout[], settings: Pick<UserSettings, 'raceIds' | 'notRaceIds'>,
  events: PlannedEvent[] = [],
): Set<number> {
  const not = new Set(settings.notRaceIds ?? [])
  const ids = new Set(settings.raceIds ?? [])
  for (const date of raceDatesFromPlan(workouts, events)) {
    const act = mainRunOfDay(activities, date)
    if (act && !not.has(act.id)) ids.add(act.id)
  }
  return ids
}

/** ¿Es esta actividad una competición (detectada o marcada)? */
export function isRaceActivity(
  activity: ActivitySummary, activities: ActivitySummary[], workouts: PlannedWorkout[],
  settings: Pick<UserSettings, 'raceIds' | 'notRaceIds'>,
  events: PlannedEvent[] = [],
): { race: boolean; auto: boolean } {
  if ((settings.raceIds ?? []).includes(activity.id)) return { race: true, auto: false }
  const date = activity.startTime.slice(0, 10)
  const auto = raceDatesFromPlan(workouts, events).includes(date) && mainRunOfDay(activities, date)?.id === activity.id
  return { race: auto && !(settings.notRaceIds ?? []).includes(activity.id), auto }
}
