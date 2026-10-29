// Modo «sin entrenador» del Entrenador IA: objetivo y semanas que se pueden generar.

import type { FreeGoal, FreeGoalDistance } from '../stores/aiStore'
import { weeksToRace } from './aiPrompt'
import { parseLocalDate, toLocalISODate } from './date'

const MAX_WEEKS = 16

function shiftWeek(weekStart: string, n: number): string {
  const d = parseLocalDate(weekStart)
  return toLocalISODate(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7 * n))
}

export function weekLabel(weekStart: string): string {
  const d = parseLocalDate(weekStart)
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 6)
  const f = (x: Date) => x.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })
  return `${f(d)} – ${f(end)}`
}

/** Distancia del objetivo más cercana a la de una competición del calendario. */
export function goalForKm(km: number | null): FreeGoalDistance {
  if (km == null) return '10k'
  if (km <= 7.5) return '5k'
  if (km <= 15.5) return '10k'
  if (km <= 31) return '21k'
  return '42k'
}

/**
 * Semanas que se pueden generar: desde esta semana hasta la de la carrera (máximo 16)
 * o, sin carrera, las 8 próximas.
 */
export function freeWeekOptions(goal: Pick<FreeGoal, 'distance' | 'raceDate'>, thisWeek: string): string[] {
  const left = goal.distance === 'none' ? null : weeksToRace(thisWeek, goal.raceDate)
  const count = left != null && left >= 0 ? Math.min(left, MAX_WEEKS - 1) + 1 : 8
  return Array.from({ length: count }, (_, i) => shiftWeek(thisWeek, i))
}
