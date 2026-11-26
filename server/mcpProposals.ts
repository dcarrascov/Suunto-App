// Propuestas de semana que guarda Claude por el MCP (fase 2 del MCP, GUIA_MCP.md). Se escriben en la parte «entrenador IA»
// que la app guarda en el servidor (public/data/estado/suunto-ai.json, server/userState.ts), así que tu app las recibe
// sola al sincronizar y las enseña como cualquier propuesta: «Propuesta IA», con «Pasar al calendario» y «Borrar».
// Se validan con las mismas reglas que las de Gemini (parseProposal). Nunca se envían a TrainingPeaks.

import type { AiProposal } from '../src/stores/aiStore.ts'
import { parseProposal } from '../src/utils/aiProposal.ts'
import { localWeekStart } from '../src/utils/calculations.ts'
import { parseLocalDate, toLocalISODate } from '../src/utils/date.ts'
import { readState, writeState } from './userState.ts'

export type ProposalMode = 'como_entrenador' | 'sin_entrenador'
export const MCP_MODEL = 'Claude (MCP)'
const AI_KEY = 'suunto-ai'
const MAX_SESSIONS = 21
const WEEKS_BACK = 12
const WEEKS_AHEAD = 26

export class ProposalError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export interface SessionInput {
  fecha: string
  tipo: string
  titulo: string
  descripcion?: string
  duracion_min?: number | null
  distancia_km?: number | null
  tss?: number | null
}

interface AiState { proposals?: Record<string, AiProposal>; freeProposals?: Record<string, AiProposal>; [k: string]: unknown }

function readAi(dataDir: string): { state: AiState; version: number } {
  const datos = readState(dataDir, AI_KEY)?.datos as { state?: AiState; version?: number } | undefined
  return { state: datos?.state ?? {}, version: typeof datos?.version === 'number' ? datos.version : 0 }
}

const field = (mode: ProposalMode) => (mode === 'sin_entrenador' ? 'freeProposals' : 'proposals')

function addDays(iso: string, days: number): string {
  const d = parseLocalDate(iso)
  return toLocalISODate(new Date(d.getFullYear(), d.getMonth(), d.getDate() + days))
}

/** El lunes de la semana (vale cualquier día), dentro del margen permitido. */
export function weekOf(day: string, today: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || toLocalISODate(parseLocalDate(day)) !== day) throw new ProposalError(400, 'La semana se indica con una fecha AAAA-MM-DD.')
  const monday = localWeekStart(parseLocalDate(day))
  const thisMonday = localWeekStart(parseLocalDate(today))
  if (monday < addDays(thisMonday, -7 * WEEKS_BACK) || monday > addDays(thisMonday, 7 * WEEKS_AHEAD)) {
    throw new ProposalError(400, `Solo semanas entre ${WEEKS_BACK} semanas atrás y ${WEEKS_AHEAD} adelante.`)
  }
  return monday
}

const num = (v: unknown, max: number, name: string): number | null => {
  if (v == null) return null
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > max) throw new ProposalError(400, `«${name}» debe ser un número entre 0 y ${max}.`)
  return v
}
const text = (v: unknown, max: number, name: string): string => {
  if (v == null) return ''
  if (typeof v !== 'string') throw new ProposalError(400, `«${name}» debe ser un texto.`)
  if (v.length > max) throw new ProposalError(400, `«${name}» pasa de ${max} caracteres.`)
  return v
}

/** Guarda (o sustituye) la propuesta de una semana. Devuelve la propuesta tal como la verá la app. */
export function saveProposal(
  dataDir: string,
  input: { semana: string; modo: ProposalMode; explicacion: unknown; sesiones: unknown; reemplazar?: boolean },
  today: string,
): AiProposal {
  if (input.modo !== 'como_entrenador' && input.modo !== 'sin_entrenador') throw new ProposalError(400, '«modo» debe ser como_entrenador o sin_entrenador.')
  const monday = weekOf(input.semana, today)
  if (!Array.isArray(input.sesiones) || input.sesiones.length === 0) throw new ProposalError(400, 'Faltan las sesiones.')
  if (input.sesiones.length > MAX_SESSIONS) throw new ProposalError(400, `Como mucho ${MAX_SESSIONS} sesiones.`)
  const entrenos = input.sesiones.map((raw, i) => {
    const s = (raw ?? {}) as SessionInput
    const n = `sesiones[${i + 1}]`
    return {
      fecha: text(s.fecha, 10, `${n}.fecha`),
      tipo: text(s.tipo, 20, `${n}.tipo`),
      titulo: text(s.titulo, 150, `${n}.titulo`),
      descripcion: text(s.descripcion, 2000, `${n}.descripcion`),
      duracion_min: num(s.duracion_min, 600, `${n}.duracion_min`),
      distancia_km: num(s.distancia_km, 300, `${n}.distancia_km`),
      tss: num(s.tss, 1000, `${n}.tss`),
    }
  })
  const explicacion = text(input.explicacion, 3000, 'explicacion')
  // las mismas reglas que las propuestas de Gemini: fechas dentro de la semana, tipos válidos…
  const parsed = parseProposal(JSON.stringify({ explicacion, entrenos }), monday)
  if (!parsed.ok) throw new ProposalError(400, parsed.error)

  const { state, version } = readAi(dataDir)
  const key = field(input.modo)
  const list = { ...(state[key] ?? {}) }
  if (list[monday] && list[monday].model !== MCP_MODEL) {
    throw new ProposalError(403, `Esa semana ya tiene una propuesta del Entrenador IA de la app (${list[monday].model ?? 'sin modelo'}): no se sustituye desde el MCP. Bórrala en la app si quieres otra.`)
  }
  if (list[monday] && !input.reemplazar) {
    throw new ProposalError(409, `Ya hay una propuesta ${input.modo === 'sin_entrenador' ? 'sin entrenador' : 'como el entrenador'} para la semana del ${monday}: usa reemplazar=true para sustituirla.`)
  }
  const proposal: AiProposal = { ...parsed.proposal, model: MCP_MODEL, ...(input.modo === 'sin_entrenador' ? { mode: 'free' as const } : {}) }
  list[monday] = proposal
  writeState(dataDir, AI_KEY, { state: { ...state, [key]: list }, version })
  return proposal
}

/** Borra la propuesta de una semana (solo las que guardó Claude por el MCP). */
export function deleteProposal(dataDir: string, semana: string, modo: ProposalMode, today: string): void {
  if (modo !== 'como_entrenador' && modo !== 'sin_entrenador') throw new ProposalError(400, '«modo» debe ser como_entrenador o sin_entrenador.')
  const monday = weekOf(semana, today)
  const { state, version } = readAi(dataDir)
  const key = field(modo)
  const list = { ...(state[key] ?? {}) }
  if (!list[monday]) throw new ProposalError(404, `No hay propuesta para la semana del ${monday}.`)
  if (list[monday].model !== MCP_MODEL) throw new ProposalError(403, 'Esa propuesta no la guardó Claude: bórrala desde la app.')
  delete list[monday]
  writeState(dataDir, AI_KEY, { state: { ...state, [key]: list }, version })
}

/** Propuestas guardadas (de Claude y de la app), resumidas. */
export function listProposals(dataDir: string, semana: string | null, today: string) {
  const monday = semana ? weekOf(semana, today) : null
  const { state } = readAi(dataDir)
  const rows = (['como_entrenador', 'sin_entrenador'] as const).flatMap(modo =>
    Object.values(state[field(modo)] ?? {}).filter(p => !monday || p.weekStart === monday).map(p => ({
      semana: p.weekStart, modo, de: p.model === MCP_MODEL ? 'Claude (MCP)' : (p.model ?? 'la app'), creada: p.createdAt,
      explicacion: p.explanation.length > 400 ? `${p.explanation.slice(0, 400)}…` : p.explanation,
      sesiones: p.workouts.map(w => ({ fecha: w.date, tipo: w.type, titulo: w.title, duracion_min: w.durationMin, distancia_km: w.distanceKm, tss: w.tss })),
    })))
  return { propuestas: rows.sort((a, b) => b.semana.localeCompare(a.semana)).slice(0, monday ? 2 : 12) }
}
