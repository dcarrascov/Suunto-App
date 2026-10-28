// Lee la propuesta de semana que devuelve Gemini (pegada a mano) y la compara con la del entrenador.

import type { PlannedEvent, PlannedWorkout } from '../types/suunto'
import type { AiProposal, AiWorkout } from '../stores/aiStore'
import { FAMILY_OF, sessionType, weekdayIndex } from './coach'
import type { SessionFamily, SessionType } from './coach'
import { localWeekStart } from './calculations'
import { parseLocalDate } from './date'

const TYPES: SessionType[] = ['rodaje', 'progresivo', 'rectas', 'series', 'cuestas', 'cambios', 'activacion', 'competicion', 'fuerza', 'natacion', 'descanso', 'otro']

/** Saca el JSON de la respuesta: dentro de ```json ... ``` o, si no, del primer «{» al último «}». */
function extractJson(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced) return fenced[1].trim()
  const a = text.indexOf('{')
  const b = text.lastIndexOf('}')
  return a >= 0 && b > a ? text.slice(a, b + 1) : null
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v.replace(',', '.'))
    return Number.isFinite(n) ? n : null
  }
  return null
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

export type ParseResult = { ok: true; proposal: AiProposal } | { ok: false; error: string }

/** Convierte la respuesta pegada en una propuesta para la semana `weekStart`. */
export function parseProposal(text: string, weekStart: string): ParseResult {
  const raw = extractJson(text)
  if (!raw) return { ok: false, error: 'No encuentro el bloque JSON en la respuesta. Copia la respuesta completa de Gemini.' }
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return { ok: false, error: 'El JSON no es válido (puede que la respuesta esté cortada). Pide a Gemini que lo repita completo.' }
  }
  const obj = data as Record<string, unknown>
  const list = Array.isArray(obj?.entrenos) ? obj.entrenos : null
  if (!list || list.length === 0) return { ok: false, error: 'La respuesta no trae la lista "entrenos".' }

  const weekEnd = (() => {
    const d = parseLocalDate(weekStart)
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 6)
  })()
  const workouts: AiWorkout[] = []
  for (const [i, item] of list.entries()) {
    const w = item as Record<string, unknown>
    const date = str(w.fecha)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: `El entreno ${i + 1} no tiene una fecha válida (YYYY-MM-DD).` }
    const day = parseLocalDate(date)
    if (day < parseLocalDate(weekStart) || day > weekEnd) {
      return { ok: false, error: `El entreno del ${date} no es de la semana del ${weekStart}.` }
    }
    const title = str(w.titulo)
    const declared = str(w.tipo).toLowerCase() as SessionType
    // si el tipo que dice Gemini no es válido, se deduce del título como con el entrenador
    const type = TYPES.includes(declared) ? declared : sessionType({ title, sport: 'running' })
    workouts.push({
      date, type,
      title: title || (type === 'descanso' ? 'Descanso' : 'Entreno'),
      description: str(w.descripcion),
      durationMin: num(w.duracion_min),
      distanceKm: num(w.distancia_km),
      tss: num(w.tss),
    })
  }
  workouts.sort((a, b) => a.date.localeCompare(b.date))
  return {
    ok: true,
    proposal: {
      weekStart, workouts,
      explanation: str(obj.explicacion),
      createdAt: new Date().toLocaleString('es-ES'),
    },
  }
}

// ─── Parecido con la semana del entrenador ───────────────────────────────────

export interface DayComparison {
  weekday: number              // 0 = lunes
  coach: SessionFamily[]
  ai: SessionFamily[]
  score: number                // 0..1
}

export interface WeekComparison {
  days: DayComparison[]
  typeScore: number            // 0..1: mismo tipo de sesión cada día
  minutesScore: number | null  // 0..1: tiempo total parecido
  tssScore: number | null      // 0..1: carga (TSS) parecida
  total: number                // 0..100
  coachMinutes: number
  aiMinutes: number
  coachTss: number
  aiTss: number
}

const ratio = (a: number, b: number) => (Math.max(a, b) === 0 ? 1 : 1 - Math.abs(a - b) / Math.max(a, b))

/**
 * Compara día a día por familia de sesión (suave, calidad, rectas, activación, fuerza…) con el índice de
 * Jaccard; un día sin nada cuenta como descanso. Total = 60 % tipos + 25 % tiempo + 15 % TSS.
 * No se usan los km: el entrenador planifica por tiempo y solo indica la distancia en algunas sesiones.
 */
export function compareWeek(proposal: AiProposal, coach: PlannedWorkout[], events: PlannedEvent[] = []): WeekComparison {
  const coachWeek = coach.filter(w => (w.hasPlan || w.sport === 'rest') && localWeekStart(parseLocalDate(w.date)) === proposal.weekStart)
  const fam = (list: SessionFamily[]) => {
    const s = new Set(list.filter(f => f !== 'descanso'))
    return s.size ? [...s] : ['descanso' as SessionFamily]
  }
  const days: DayComparison[] = Array.from({ length: 7 }, (_, d) => {
    // el día de una competición del calendario cuenta como «competición» aunque el entrenador no ponga entreno
    const raceDay = events.some(e => localWeekStart(parseLocalDate(e.date)) === proposal.weekStart && weekdayIndex(e.date) === d)
    const c = fam([
      ...coachWeek.filter(w => weekdayIndex(w.date) === d).map(w => FAMILY_OF[sessionType(w)]),
      ...(raceDay ? ['competicion' as SessionFamily] : []),
    ])
    const a = fam(proposal.workouts.filter(w => weekdayIndex(w.date) === d).map(w => FAMILY_OF[w.type]))
    const inter = c.filter(x => a.includes(x)).length
    const union = new Set([...c, ...a]).size
    return { weekday: d, coach: c, ai: a, score: inter / union }
  })
  const typeScore = days.reduce((s, d) => s + d.score, 0) / 7
  const coachMinutes = coachWeek.reduce((s, w) => s + (w.planned.duration ?? 0) / 60, 0)
  const aiMinutes = proposal.workouts.reduce((s, w) => s + (w.durationMin ?? 0), 0)
  const coachTss = coachWeek.reduce((s, w) => s + (w.planned.tss ?? 0), 0)
  const aiTss = proposal.workouts.reduce((s, w) => s + (w.tss ?? 0), 0)
  const minutesScore = coachMinutes > 0 && aiMinutes > 0 ? ratio(coachMinutes, aiMinutes) : null
  const tssScore = coachTss > 0 && aiTss > 0 ? ratio(coachTss, aiTss) : null
  // si falta algún volumen, su peso pasa a los tipos de sesión
  const parts: [number, number][] = [[typeScore, 0.6]]
  if (minutesScore != null) parts.push([minutesScore, 0.25])
  if (tssScore != null) parts.push([tssScore, 0.15])
  const weight = parts.reduce((s, [, w]) => s + w, 0)
  const total = Math.round(parts.reduce((s, [v, w]) => s + v * w, 0) / weight * 100)
  return { days, typeScore, minutesScore, tssScore, total, coachMinutes, aiMinutes, coachTss, aiTss }
}

/** ¿Tiene el entrenador plan para esa semana? (para saber si ya se puede comparar) */
export function coachHasWeek(coach: PlannedWorkout[], weekStart: string): boolean {
  return coach.some(w => w.hasPlan && localWeekStart(parseLocalDate(w.date)) === weekStart)
}
