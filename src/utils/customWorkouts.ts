import type { Sport } from '../types/suunto'

// Entrenos que crea el usuario en el Calendario. Se guardan solo en este navegador
// (stores/customWorkoutStore.ts); nunca se envían a TrainingPeaks ni se mezclan con el plan del entrenador.

export interface CustomWorkout {
  id: string
  date: string               // YYYY-MM-DD
  sport: Sport
  title: string
  durationMin: number | null
  distanceKm: number | null
  description: string
}

/** Lo que escribe el usuario en la ventana (los números llegan como texto). */
export interface CustomWorkoutForm {
  date: string
  sport: Sport
  title: string
  durationMin: string
  distanceKm: string
  description: string
}

export const EMPTY_FORM: Omit<CustomWorkoutForm, 'date'> = {
  sport: 'running', title: '', durationMin: '', distanceKm: '', description: '',
}

export function toForm(w: CustomWorkout): CustomWorkoutForm {
  return {
    date: w.date, sport: w.sport, title: w.title, description: w.description,
    durationMin: w.durationMin != null ? String(w.durationMin) : '',
    distanceKm: w.distanceKm != null ? String(w.distanceKm).replace('.', ',') : '',
  }
}

/** Número opcional > 0; acepta coma decimal. undefined = no válido. */
function optionalNumber(text: string): number | null | undefined {
  const t = text.trim().replace(',', '.')
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

/** Comprueba el formulario y devuelve el entreno (sin id) o el primer error. */
export function parseCustomWorkout(f: CustomWorkoutForm):
  { ok: true; workout: Omit<CustomWorkout, 'id'> } | { ok: false; error: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date)) return { ok: false, error: 'Fecha no válida.' }
  const title = f.title.trim()
  if (!title) return { ok: false, error: 'Ponle un título.' }
  const durationMin = optionalNumber(f.durationMin)
  if (durationMin === undefined) return { ok: false, error: 'La duración debe ser un número de minutos mayor que 0.' }
  const distanceKm = optionalNumber(f.distanceKm)
  if (distanceKm === undefined) return { ok: false, error: 'La distancia debe ser un número de km mayor que 0.' }
  return {
    ok: true,
    workout: {
      date: f.date, sport: f.sport, title, description: f.description.trim(),
      durationMin: durationMin != null ? Math.round(durationMin) : null,
      distanceKm: distanceKm != null ? Math.round(distanceKm * 100) / 100 : null,
    },
  }
}

export function customByDate(list: CustomWorkout[]): Map<string, CustomWorkout[]> {
  const m = new Map<string, CustomWorkout[]>()
  for (const w of list) m.set(w.date, [...(m.get(w.date) ?? []), w])
  return m
}

/** «45 min · 10 km» con lo que haya. */
export function customSummary(w: Pick<CustomWorkout, 'durationMin' | 'distanceKm'>): string {
  return [
    w.durationMin != null ? `${w.durationMin} min` : null,
    w.distanceKm != null ? `${w.distanceKm.toLocaleString('es-ES')} km` : null,
  ].filter(Boolean).join(' · ')
}
