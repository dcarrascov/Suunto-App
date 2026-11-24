// API del MCP (docs/DISENO_MCP.md): rutas GET /api/mcp/v1/… con tus datos ya resumidos para Claude.
// Solo llega aquí lo que entra con MCP_TOKEN (server/auth.ts), y nunca sigue al resto del servidor.
// Nunca devuelve rutas GPS: cada respuesta se construye campo a campo, sin copiar objetos enteros del disco.
// Los cálculos son los mismos de la app (src/utils), para que Claude vea los números de la pantalla.

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ActivitySummary, FitnessPoint, PlannedWorkout } from '../src/types/suunto.ts'
import {
  calculateFitnessHistory, computePRs, EFFORT_LABELS, estimateTSS, estimateThresholdPace, formState, getZoneBPM,
  HR_ZONE_DEFS, intensitySplit, localWeekStart, lthrFor, paceZoneFor, paceZoneRanges, predictRaces, projectFitness,
  RACE_FORM_BAND, riegel, weeklyVo2max, zoneSecondsFor,
} from '../src/utils/calculations.ts'
import { coachStats, coachStatsText, sessionType } from '../src/utils/coach.ts'
import { parseLocalDate, toLocalISODate } from '../src/utils/date.ts'
import { planItems, shiftWeek, weekDays, type PlanStatus } from '../src/utils/plan.ts'
import { findRaces, raceActivityIds, raceDatesFromPlan, upcomingEvents } from '../src/utils/races.ts'
import { loadAppData, loadDetail, type AppData } from './mcpData.ts'

const MAX_LIST = 200
const MAX_TEXT = 1500
const SHORT_TEXT = 300         // descripciones del plan por defecto: lo justo para saber de qué va la sesión
const MAX_PLAN_DAYS = 120
const RATE_LIMIT = 60          // peticiones por minuto: de sobra para Claude, poco para abusar
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}
const bad = (message: string) => new ApiError(400, message)

// ─── formato ─────────────────────────────────────────────────────────────────

const r1 = (n: number) => Math.round(n * 10) / 10
const r2 = (n: number) => Math.round(n * 100) / 100

/** 1:02:03 o 45:30 */
export function fmtDuration(seconds: number | null | undefined): string | null {
  if (seconds == null || !Number.isFinite(seconds)) return null
  const t = Math.round(seconds)
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const s = String(t % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

/** 4:30/km */
export function fmtPace(secPerKm: number | null | undefined): string | null {
  if (!secPerKm || !Number.isFinite(secPerKm)) return null
  const t = Math.round(secPerKm)
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}/km`
}

const clip = (s: string | null | undefined, n = MAX_TEXT): string | null =>
  s ? (s.length > n ? `${s.slice(0, n)}…` : s) : null

function addDays(iso: string, days: number): string {
  const d = parseLocalDate(iso)
  return toLocalISODate(new Date(d.getFullYear(), d.getMonth(), d.getDate() + days))
}

const daysBetween = (from: string, to: string) => Math.round((parseLocalDate(to).getTime() - parseLocalDate(from).getTime()) / 86_400_000)
const dayOf = (a: ActivitySummary) => a.startTime.slice(0, 10)

// ─── parámetros ──────────────────────────────────────────────────────────────

function dateParam(q: URLSearchParams, name: string, fallback: string): string {
  const v = q.get(name)?.trim()
  if (!v) return fallback
  if (!ISO_DAY.test(v) || toLocalISODate(parseLocalDate(v)) !== v) throw bad(`«${name}» debe ser una fecha AAAA-MM-DD.`)
  return v
}

function intParam(q: URLSearchParams, name: string, fallback: number, min: number, max: number): number {
  const v = q.get(name)?.trim()
  if (!v) return fallback
  const n = Number(v)
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`«${name}» debe ser un número entero entre ${min} y ${max}.`)
  return n
}

function boolParam(q: URLSearchParams, name: string, fallback: boolean): boolean {
  const v = q.get(name)?.trim().toLowerCase()
  if (!v) return fallback
  if (['1', 'true', 'si', 'sí'].includes(v)) return true
  if (['0', 'false', 'no'].includes(v)) return false
  throw bad(`«${name}» debe ser true o false.`)
}

// ─── piezas comunes ──────────────────────────────────────────────────────────

function activityRow(a: ActivitySummary, data: AppData, races: Set<number>) {
  const running = a.sport === 'running'
  return {
    id: a.id,
    fecha: a.startTime.slice(0, 16),
    titulo: clip(a.title, 120),
    deporte: a.sport,
    km: r2(a.distance),
    duracion: fmtDuration(a.duration),
    ritmo: a.sport === 'cycling' ? null : fmtPace(a.avgPace),
    velocidad_kmh: a.sport === 'cycling' && a.avgSpeed ? r1(a.avgSpeed) : null,
    fc_media: a.avgHR || null,
    fc_max: a.maxHR || null,
    desnivel_m: Math.round(a.elevationGain || 0),
    tss: Math.round(estimateTSS(a, data.settings)),
    vo2max: a.vo2max ?? null,
    // solo cuando aportan: en casi todas las filas serían false o «suunto» y gastarían contexto de Claude
    ...(a.tss == null ? { tss_estimado: true } : {}),
    ...(running && races.has(a.id) ? { competicion: true } : {}),
    ...(a.sourceFile ? { origen: 'fit' } : {}),
  }
}

/** Sesiones del entrenador: las que planificó (y los descansos), no los entrenos subidos desde el reloj sin plan. */
const plannedOnly = (ws: PlannedWorkout[]) => ws.filter(w => w.hasPlan || w.sport === 'rest')

const workoutsOf = (data: AppData): PlannedWorkout[] => data.plan?.workouts ?? []
const eventsOf = (data: AppData) => data.plan?.events ?? []
const raceIdsOf = (data: AppData) => raceActivityIds(data.activities, workoutsOf(data), data.settings, eventsOf(data))

/** Forma real hasta hoy y la prevista con el TSS que ha planificado el entrenador (como useFitnessProjection). */
function fitnessOf(data: AppData, today: string): { history: FitnessPoint[]; projection: FitnessPoint[]; nextRace: string | null } {
  const history = calculateFitnessHistory(data.activities, data.settings).filter(p => p.date <= today)
  const future = workoutsOf(data).filter(w => w.date > today && w.hasPlan)
  const plannedTss: Record<string, number> = {}
  for (const w of future) plannedTss[w.date] = (plannedTss[w.date] ?? 0) + (w.planned.tss ?? 0)
  const until = future.reduce((max, w) => (w.date > max ? w.date : max), today)
  const nextRace = raceDatesFromPlan(workoutsOf(data), eventsOf(data)).find(d => d >= today) ?? null
  const end = nextRace && nextRace > until ? nextRace : until
  return { history, projection: projectFitness(history, plannedTss, end), nextRace }
}

const fitnessPoint = (p: FitnessPoint) => ({ fecha: p.date, ctl: r1(p.ctl), atl: r1(p.atl), tsb: r1(p.tsb), estado: formState(p.tsb).label })

/** Un punto cada 7 días, terminando en el último. */
const weekly = (points: FitnessPoint[]) => points.filter((_, i) => (points.length - 1 - i) % 7 === 0)

const STATUS: Record<PlanStatus, string> = { done: 'hecha', missed: 'no hecha', today: 'hoy', upcoming: 'pendiente', rest: 'descanso' }

// ─── rutas ───────────────────────────────────────────────────────────────────

export function perfil(data: AppData, today: string) {
  const s = data.settings
  const acts = data.activities
  const bySport: Record<string, number> = {}
  for (const a of acts) bySport[a.sport] = (bySport[a.sport] ?? 0) + 1
  const vo2 = weeklyVo2max(data.stats?.vo2maxHistory, parseLocalDate(today))
  const next = upcomingEvents(eventsOf(data), today)[0] ?? null
  const planned = workoutsOf(data).filter(w => w.hasPlan)
  return {
    hoy: today,
    ultima_descarga: data.stats?.syncedAt ?? null,
    ajustes_de_la_app: data.settingsSaved,
    ajustes: {
      fc_maxima: s.maxHR,
      fc_maxima_segun_suunto: data.stats?.userMaxHR ?? null,
      fc_umbral: { carrera: lthrFor('running', s), bici: lthrFor('cycling', s), natacion: lthrFor('swimming', s) },
      ritmo_umbral: fmtPace(s.thresholdPace),
      ftp_w: s.ftp,
      zonas_fc: getZoneBPM(s.maxHR).map(z => ({ zona: z.zone, nombre: HR_ZONE_DEFS[z.zone - 1]?.name ?? null, de_ppm: z.low, a_ppm: z.high })),
      zonas_ritmo: paceZoneRanges(s.thresholdPace).map(({ def, fast, slow }) => ({
        zona: def.zone, nombre: def.name,
        rango: fast == null ? `más rápido que ${fmtPace(slow)}` : slow == null ? `más lento que ${fmtPace(fast)}` : `${fmtPace(fast)} – ${fmtPace(slow)}`,
      })),
    },
    avisos_para_la_ia: { pulso_poco_fiable: !!s.hrUnreliable, graba_sesiones_partidas: !!s.splitSessions },
    actividades: {
      total: acts.length,
      por_deporte: bySport,
      porcentaje_carrera: acts.length ? Math.round((bySport.running ?? 0) / acts.length * 100) : 0,
      primera: acts.length ? dayOf(acts[acts.length - 1]) : null,
      ultima: acts.length ? dayOf(acts[0]) : null,
    },
    vo2max: vo2 ? { valor: r1(vo2.value), semana: vo2.weekStart, de_esta_semana: vo2.isCurrent } : null,
    plan_trainingpeaks: data.plan ? {
      sesiones_planificadas: planned.length,
      desde: planned.reduce<string | null>((m, w) => (!m || w.date < m ? w.date : m), null),
      hasta: planned.reduce<string | null>((m, w) => (!m || w.date > m ? w.date : m), null),
      actualizado: data.plan.syncedAt,
    } : null,
    proxima_competicion: next ? {
      fecha: next.date, nombre: clip(next.name, 120), prioridad: next.priority, distancia_km: next.distanceKm,
      dias: daysBetween(today, next.date),
    } : null,
  }
}

export function actividades(data: AppData, q: URLSearchParams, today: string) {
  const desde = dateParam(q, 'desde', addDays(today, -30))
  const hasta = dateParam(q, 'hasta', today)
  if (desde > hasta) throw bad('«desde» es posterior a «hasta».')
  const sports: Record<string, string | null> = {
    carrera: 'running', bici: 'cycling', natacion: 'swimming', 'natación': 'swimming', otro: 'other', todos: null,
    running: 'running', cycling: 'cycling', swimming: 'swimming', other: 'other',
  }
  const deporte = q.get('deporte')?.trim().toLowerCase() || 'todos'
  if (!(deporte in sports)) throw bad('«deporte» debe ser carrera, bici, natacion, otro o todos.')
  const texto = q.get('texto')?.trim().toLowerCase() || null
  const solo = boolParam(q, 'competiciones', false)
  const limite = intParam(q, 'limite', 50, 1, MAX_LIST)
  const races = raceIdsOf(data)
  const found = data.activities.filter(a => {
    const day = dayOf(a)
    return day >= desde && day <= hasta
      && (sports[deporte] == null || a.sport === sports[deporte])
      && (!texto || a.title?.toLowerCase().includes(texto))
      && (!solo || races.has(a.id))
  })
  return {
    desde, hasta,
    total: found.length,
    mostradas: Math.min(found.length, limite),
    ...(found.length > limite ? { aviso: `Hay ${found.length}: acota las fechas o sube «limite» (máx. ${MAX_LIST}).` } : {}),
    actividades: found.slice(0, limite).map(a => activityRow(a, data, races)),
  }
}

export function actividad(data: AppData, dir: string, id: number) {
  const a = data.activities.find(x => x.id === id)
  if (!a) throw new ApiError(404, `No hay ninguna actividad con id ${id}.`)
  const det = loadDetail(dir, id)
  const running = a.sport === 'running'
  const thr = data.settings.thresholdPace
  // récords: el mejor tramo de cada distancia es de esta actividad
  const records = new Set((computePRs(data.activities).running ?? []).filter(p => p.activityId === id).map(p => p.label))
  const zones = det?.hrZones?.length
    ? det.hrZones.map(z => ({ zona: z.zone, nombre: z.name, segundos: z.seconds }))
    : (a.hrZoneSeconds?.length === 5 ? a.hrZoneSeconds.map((sec, i) => ({ zona: i + 1, nombre: HR_ZONE_DEFS[i]?.name ?? '', segundos: sec })) : [])
  const zoneTotal = zones.reduce((t, z) => t + z.segundos, 0)
  const x = det?.extra ?? null
  return {
    ...activityRow(a, data, raceIdsOf(data)),
    en_movimiento: fmtDuration(a.movingTime),
    calorias: a.calories || null,
    cadencia: a.avgCadence ?? null,
    efecto_aerobico: a.aerobicTE ?? null,
    efecto_anaerobico: a.anaerobicTE ?? null,
    desacoplamiento_pct: a.decoupling ?? null,
    potencia_media_w: a.avgPower ?? null,
    potencia_normalizada_w: a.normalizedPower ?? null,
    swolf: a.swolf ?? null,
    parciales: (det?.laps ?? []).slice(0, 100).map(l => ({
      n: l.index,
      km: r2(l.distance),
      tiempo: fmtDuration(l.duration),
      ritmo: a.sport === 'cycling' ? null : fmtPace(l.avgPace),
      zona_ritmo: running ? paceZoneFor(l.avgPace, thr)?.zone ?? null : null,
      velocidad_kmh: a.sport === 'cycling' && l.avgSpeed ? r1(l.avgSpeed) : null,
      fc: l.avgHR ?? null,
      potencia_w: l.avgPower ?? null,
      desnivel_m: Math.round(l.elevationGain || 0),
    })),
    zonas_fc: zones.map(z => ({ zona: z.zona, nombre: z.nombre, tiempo: fmtDuration(z.segundos), porcentaje: zoneTotal ? Math.round(z.segundos / zoneTotal * 100) : 0 })),
    mejores_tramos: Object.entries(a.bestEfforts ?? {}).map(([meters, sec]) => {
      const label = EFFORT_LABELS[meters] ?? `${meters} m`
      return { distancia: label, tiempo: fmtDuration(sec), ritmo: running ? fmtPace(sec / (Number(meters) / 1000)) : null, es_record: records.has(label) }
    }),
    mejores_tramos_aproximados: a.bestEffortsSource === 'laps',
    ritmos_maximos: x && running ? { '30s': fmtPace(x.peakPace30s), '1min': fmtPace(x.peakPace1m), '3min': fmtPace(x.peakPace3m), '5min': fmtPace(x.peakPace5m) } : null,
    extra: x ? {
      ritmo_ajustado_pendiente: fmtPace(x.ngp),
      recuperacion_h: x.recoveryTime ? r1(x.recoveryTime / 3600) : null,
      epoc: x.epoc ?? null,
      zancada_cm: x.strideLength ?? null,
      ascenso_m: x.ascent ?? null,
      descenso_m: x.descent ?? null,
    } : null,
    ...(det ? {} : { aviso: 'No hay fichero de detalle de esta actividad: solo el resumen.' }),
  }
}

export function semanas(data: AppData, q: URLSearchParams, today: string) {
  const n = intParam(q, 'semanas', 12, 1, 52)
  const hasta = dateParam(q, 'hasta', today)
  const last = localWeekStart(parseLocalDate(hasta))
  const starts = Array.from({ length: n + 4 }, (_, i) => shiftWeek(last, i - (n + 3)))  // 4 más para la rampa
  const byWeek = new Map<string, ActivitySummary[]>()
  for (const a of data.activities) {
    const w = localWeekStart(parseLocalDate(a.startTime))
    byWeek.set(w, [...(byWeek.get(w) ?? []), a])
  }
  const km = (w: string) => (byWeek.get(w) ?? []).filter(a => a.sport === 'running').reduce((t, a) => t + a.distance, 0)
  const rows = starts.slice(4).map((w, i) => {
    const acts = byWeek.get(w) ?? []
    const runs = acts.filter(a => a.sport === 'running')
    const kmRun = km(w)
    const prev4 = starts.slice(i, i + 4).map(km)
    const avg4 = prev4.reduce((t, v) => t + v, 0) / 4
    const split = intensitySplit(runs, data.settings.maxHR)
    const total = split.low + split.mid + split.high
    return {
      semana: w,
      en_curso: w === localWeekStart(parseLocalDate(today)),
      km_carrera: r1(kmRun),
      tiempo_total: fmtDuration(acts.reduce((t, a) => t + a.duration, 0)),
      sesiones: acts.length,
      sesiones_carrera: runs.length,
      tirada_larga_km: r1(runs.reduce((m, a) => Math.max(m, a.distance), 0)),
      tss: Math.round(acts.reduce((t, a) => t + estimateTSS(a, data.settings), 0)),
      intensidad: total ? {
        suave_pct: Math.round(split.low / total * 100),
        media_pct: Math.round(split.mid / total * 100),
        alta_pct: Math.round(split.high / total * 100),
      } : null,
      rampa_pct: avg4 > 0 ? Math.round((kmRun / avg4 - 1) * 100) : null,
    }
  })
  return {
    semanas: rows,
    nota: 'rampa_pct = km de carrera frente a la media de las 4 semanas anteriores. intensidad = reparto 80/20 por zonas de FC.',
  }
}

export function forma(data: AppData, q: URLSearchParams, today: string) {
  const dias = intParam(q, 'dias', 90, 7, 730)
  const proyectar = boolParam(q, 'proyectar', true)
  const { history, projection, nextRace } = fitnessOf(data, today)
  if (history.length === 0) return { aviso: 'No hay actividades con las que calcular la forma.' }
  const now = history[history.length - 1]
  const ago = (days: number) => history.find(p => p.date === addDays(now.date, -days)) ?? null
  const all = [...history, ...projection]
  const atRace = nextRace ? all.find(p => p.date === addDays(nextRace, -1)) ?? null : null
  const since = addDays(today, -dias)
  return {
    hoy: fitnessPoint(now),
    hace_7_dias: ago(7) && fitnessPoint(ago(7)!),
    hace_28_dias: ago(28) && fitnessPoint(ago(28)!),
    serie_semanal: weekly(history.filter(p => p.date >= since)).map(fitnessPoint),
    prevision: proyectar && projection.length ? {
      hasta: projection[projection.length - 1].date,
      proxima_competicion: nextRace,
      dia_antes_de_la_competicion: atRace && fitnessPoint(atRace),
      serie_semanal: weekly(projection).map(fitnessPoint),
    } : null,
    explicacion: `CTL = forma (media de 42 días del TSS), ATL = fatiga (7 días) y TSB = CTL − ATL (frescura). Para competir suele ir bien un TSB entre ${RACE_FORM_BAND.min} y +${RACE_FORM_BAND.max}. La previsión usa el TSS que ha planificado el entrenador.`,
  }
}

export function records(data: AppData, today: string) {
  const since = addDays(today, -90)
  const thr = estimateThresholdPace(data.activities, since)
  return {
    mejores_marcas: (computePRs(data.activities).running ?? []).map(p => ({
      distancia: p.label, tiempo: fmtDuration(p.duration), ritmo: fmtPace(p.pace), fecha: p.date.slice(0, 10),
      actividad_id: p.activityId, aproximada: p.approx,
    })),
    prediccion_90_dias: predictRaces(data.activities, since).map(p => ({
      distancia: p.label, tiempo: fmtDuration(p.seconds), ritmo: fmtPace(p.pace),
      basada_en: `${p.fromLabel} en ${fmtDuration(p.fromSeconds)} (${p.fromDate.slice(0, 10)})`, aproximada: p.approx,
    })),
    ritmo_umbral: { estimado: fmtPace(thr), en_ajustes: fmtPace(data.settings.thresholdPace) },
    nota: 'Mejores tramos de cada distancia dentro de tus carreras. La predicción usa la fórmula de Riegel con tus mejores tramos de los últimos 90 días.',
  }
}

export function intensidad(data: AppData, q: URLSearchParams, today: string) {
  const dias = intParam(q, 'dias', 28, 7, 365)
  const desde = addDays(today, -dias)
  const runs = data.activities.filter(a => a.sport === 'running' && dayOf(a) >= desde && dayOf(a) <= today)
  const sums = [0, 0, 0, 0, 0]
  let real = 0
  for (const a of runs) {
    const z = zoneSecondsFor(a, data.settings.maxHR)
    if (z.real) real += 1
    z.seconds.forEach((s, i) => { sums[i] += s })
  }
  const total = sums.reduce((t, s) => t + s, 0)
  const pct = (s: number) => (total ? Math.round(s / total * 100) : 0)
  return {
    desde, hasta: today,
    carreras: runs.length,
    con_zonas_del_reloj: real,
    zonas: HR_ZONE_DEFS.map((d, i) => ({ zona: d.zone, nombre: d.name, tiempo: fmtDuration(sums[i]), porcentaje: pct(sums[i]) })),
    reparto_80_20: { suave_pct: pct(sums[0] + sums[1]), media_pct: pct(sums[2]), alta_pct: pct(sums[3] + sums[4]) },
    nota: 'Lo habitual es buscar ~80 % suave (Z1-Z2). Se usan las zonas del reloj cuando las hay; si no, se estiman con la FC media.'
      + (data.settings.hrUnreliable ? ' Ojo: el usuario indica que su pulso de muñeca no es fiable.' : ''),
  }
}

export function plan(data: AppData, q: URLSearchParams, today: string) {
  const monday = localWeekStart(parseLocalDate(today))
  const desde = dateParam(q, 'desde', monday)
  const hasta = dateParam(q, 'hasta', addDays(monday, 20))
  if (desde > hasta) throw bad('«desde» es posterior a «hasta».')
  if (daysBetween(desde, hasta) > MAX_PLAN_DAYS) throw bad(`Como mucho ${MAX_PLAN_DAYS} días de una vez.`)
  const fullText = boolParam(q, 'descripcion_completa', false)
  if (!data.plan) return { desde, hasta, aviso: 'No hay plan de TrainingPeaks descargado.', sesiones: [] }
  const ws = plannedOnly(workoutsOf(data)).filter(w => w.date >= desde && w.date <= hasta)
  const items = planItems(ws, data.activities, today).sort((a, b) => a.workout.date.localeCompare(b.workout.date))
  return {
    desde, hasta,
    sesiones: items.map(({ workout: w, activity, status, compliance }) => ({
      fecha: w.date,
      deporte: w.sport,
      tipo: sessionType(w),
      titulo: clip(w.title, 150),
      descripcion: clip(w.description, fullText ? MAX_TEXT : SHORT_TEXT),
      comentario_entrenador: clip(w.coachComments, fullText ? 600 : SHORT_TEXT),
      duracion_plan: fmtDuration(w.planned.duration),
      distancia_plan_km: w.planned.distance,
      tss_plan: w.planned.tss,
      estado: STATUS[status],
      cumplimiento_pct: compliance,
      actividad_id: activity?.id ?? null,
    })),
    competiciones: eventsOf(data).filter(e => e.date >= desde && e.date <= hasta)
      .map(e => ({ fecha: e.date, nombre: clip(e.name, 120), prioridad: e.priority, distancia_km: e.distanceKm })),
    nota: 'El entrenador planifica por tiempo: la duración viene casi siempre y la distancia pocas veces.'
      + (fullText ? '' : ` Descripciones recortadas a ${SHORT_TEXT} caracteres: pide descripcion_completa=true para verlas enteras.`),
  }
}

/**
 * Estilo del entrenador (el mismo resumen que usa la app con Gemini): sesiones por tipo y por día, carga media y qué
 * pone antes de cada competición, más sus 2 últimas semanas completas como ejemplo. Solo lo anterior a `antes_de`,
 * para poder probar contra semanas ya planificadas sin hacer trampa.
 */
export function estilo(data: AppData, q: URLSearchParams, today: string) {
  const before = dateParam(q, 'antes_de', addDays(localWeekStart(parseLocalDate(today)), 7))
  const ws = plannedOnly(workoutsOf(data)).filter(w => w.date < before)
  if (!data.plan || ws.length === 0) return { antes_de: before, aviso: 'No hay plan de TrainingPeaks con el que deducir el estilo.' }
  const stats = coachStats(ws, eventsOf(data).filter(e => e.date < before))
  const resumen = coachStatsText({ ...stats, preRace: stats.preRace.slice(-6) })   // las 6 últimas competiciones bastan
  const lastWeek = localWeekStart(parseLocalDate(addDays(before, -7)))
  const examples = [shiftWeek(lastWeek, -1), lastWeek].map(monday => {
    const end = addDays(monday, 6)
    return {
      semana: monday,
      sesiones: ws.filter(w => w.date >= monday && w.date <= end).sort((a, b) => a.date.localeCompare(b.date)).map(w => ({
        fecha: w.date, tipo: sessionType(w), titulo: clip(w.title, 120), duracion: fmtDuration(w.planned.duration),
        distancia_km: w.planned.distance, tss: w.planned.tss, descripcion: clip(w.description, 200),
      })),
    }
  })
  return { antes_de: before, resumen, ejemplos: examples }
}

export function competiciones(data: AppData, q: URLSearchParams, today: string) {
  const pasadas = boolParam(q, 'pasadas', true)
  const futuras = boolParam(q, 'futuras', true)
  const { history, projection } = fitnessOf(data, today)
  const fitness = [...history, ...projection]
  const tsb = new Map(fitness.map(p => [p.date, p.tsb]))
  const races = findRaces(data.activities, workoutsOf(data), fitness, data.settings, today, eventsOf(data))
  const preds = predictRaces(data.activities, addDays(today, -90))
  const predict = (km: number | null) => {
    if (!km || preds.length === 0) return null
    const p = preds.reduce((a, b) => (Math.abs(Math.log(b.km / km)) < Math.abs(Math.log(a.km / km)) ? b : a))
    const seconds = riegel(p.seconds, p.km, km)
    return { tiempo: fmtDuration(seconds), ritmo: fmtPace(seconds / km) }
  }
  return {
    ...(futuras ? {
      proximas: upcomingEvents(eventsOf(data), today).map(e => ({
        fecha: e.date, nombre: clip(e.name, 120), prioridad: e.priority, distancia_km: e.distanceKm,
        dias: daysBetween(today, e.date),
        descripcion: clip(e.description, 400),
        prediccion: predict(e.distanceKm),
        tsb_previsto_dia_antes: tsb.has(addDays(e.date, -1)) ? r1(tsb.get(addDays(e.date, -1))!) : null,
      })),
    } : {}),
    ...(pasadas ? {
      pasadas: races.filter(r => r.activity).slice(0, 30).map(r => {
        const a = r.activity!
        return {
          fecha: r.date, nombre: clip(r.event?.name, 120), prioridad: r.event?.priority ?? null,
          distancia_km: r2(a.distance), distancia_estandar: r.standardLabel,
          tiempo: fmtDuration(a.duration), ritmo: fmtPace(a.avgPace), actividad_id: a.id,
          tsb_dia_antes: r.formBefore != null ? r1(r.formBefore) : null,
          frente_a_la_anterior_s: r.vsPrevious,
          origen: r.source === 'event' ? 'calendario' : r.source === 'plan' ? 'deducida del plan' : 'marcada a mano',
        }
      }),
    } : {}),
    nota: 'frente_a_la_anterior_s: segundos más (+) o menos (−) que la competición anterior, llevada a la misma distancia con Riegel.',
  }
}

export function semana(data: AppData, day: string, today: string) {
  if (!ISO_DAY.test(day) || toLocalISODate(parseLocalDate(day)) !== day) throw bad('La semana se indica con una fecha AAAA-MM-DD.')
  const lunes = localWeekStart(parseLocalDate(day))   // vale cualquier día: se usa su semana
  const days = weekDays(lunes)
  const end = days[6]
  const items = planItems(plannedOnly(workoutsOf(data)).filter(w => w.date >= lunes && w.date <= end), data.activities, today)
  const acts = data.activities.filter(a => dayOf(a) >= lunes && dayOf(a) <= end)
  const work = items.filter(it => it.status !== 'rest')
  const done = work.filter(it => it.status === 'done')
  const plannedSec = work.reduce((t, it) => t + (it.workout.planned.duration ?? 0), 0)
  const doneSec = acts.reduce((t, a) => t + a.duration, 0)
  return {
    semana: lunes,
    en_curso: today >= lunes && today <= end,
    ...(data.plan ? {} : { aviso: 'No hay plan de TrainingPeaks: solo se ve lo hecho.' }),
    dias: days.map(d => ({
      fecha: d,
      planificado: items.filter(it => it.workout.date === d).map(({ workout: w, status, compliance }) => ({
        tipo: sessionType(w), titulo: clip(w.title, 150), duracion_plan: fmtDuration(w.planned.duration),
        distancia_plan_km: w.planned.distance, tss_plan: w.planned.tss, estado: STATUS[status], cumplimiento_pct: compliance,
      })),
      hecho: acts.filter(a => dayOf(a) === d).map(a => ({
        id: a.id, titulo: clip(a.title, 120), deporte: a.sport, km: r2(a.distance), duracion: fmtDuration(a.duration),
        ritmo: a.sport === 'cycling' ? null : fmtPace(a.avgPace), tss: Math.round(estimateTSS(a, data.settings)),
      })),
    })),
    totales: {
      sesiones_plan: work.length,
      sesiones_plan_hechas: done.length,
      tiempo_plan: fmtDuration(plannedSec),
      tiempo_hecho: fmtDuration(doneSec),
      km_hechos: r1(acts.reduce((t, a) => t + a.distance, 0)),
      tss_plan: Math.round(work.reduce((t, it) => t + (it.workout.planned.tss ?? 0), 0)),
      tss_real: Math.round(acts.reduce((t, a) => t + estimateTSS(a, data.settings), 0)),
      cumplimiento_tiempo_pct: plannedSec ? Math.round(doneSec / plannedSec * 100) : null,
    },
  }
}

// ─── servidor ────────────────────────────────────────────────────────────────

interface Ctx { data: AppData; dir: string; q: URLSearchParams; today: string }

const ROUTES: [RegExp, (m: RegExpExecArray, c: Ctx) => unknown][] = [
  [/^\/api\/mcp\/v1\/perfil$/, (_, c) => perfil(c.data, c.today)],
  [/^\/api\/mcp\/v1\/actividades$/, (_, c) => actividades(c.data, c.q, c.today)],
  [/^\/api\/mcp\/v1\/actividades\/(\d{1,15})$/, (m, c) => actividad(c.data, c.dir, Number(m[1]))],
  [/^\/api\/mcp\/v1\/semanas$/, (_, c) => semanas(c.data, c.q, c.today)],
  [/^\/api\/mcp\/v1\/forma$/, (_, c) => forma(c.data, c.q, c.today)],
  [/^\/api\/mcp\/v1\/records$/, (_, c) => records(c.data, c.today)],
  [/^\/api\/mcp\/v1\/intensidad$/, (_, c) => intensidad(c.data, c.q, c.today)],
  [/^\/api\/mcp\/v1\/plan$/, (_, c) => plan(c.data, c.q, c.today)],
  [/^\/api\/mcp\/v1\/competiciones$/, (_, c) => competiciones(c.data, c.q, c.today)],
  [/^\/api\/mcp\/v1\/semana\/(\d{4}-\d{2}-\d{2})$/, (m, c) => semana(c.data, m[1], c.today)],
  [/^\/api\/mcp\/v1\/estilo$/, (_, c) => estilo(c.data, c.q, c.today)],
]

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  // sin los campos vacíos: no aportan nada y gastan contexto de Claude (dentro de las listas se dejan, por la posición)
  res.end(JSON.stringify(body, function (this: unknown, _key, value) {
    return value === null && !Array.isArray(this) ? undefined : value
  }))
}

/**
 * Atiende todo lo que entra con el token del MCP. Siempre responde: nunca pasa la petición al resto del servidor.
 * `now` se puede fijar en los tests.
 */
export function mcpHandler(dir: () => string, now: () => Date = () => new Date()) {
  const hits: number[] = []
  return (req: IncomingMessage, res: ServerResponse): void => {
    const t = Date.now()
    while (hits.length && hits[0] < t - 60_000) hits.shift()
    if (hits.length >= RATE_LIMIT) return send(res, 429, { error: 'Demasiadas peticiones: espera un minuto.' })
    hits.push(t)

    const [path, query = ''] = (req.url ?? '').split('?')
    // nada de rutas raras: ni «..», ni caracteres codificados, ni barras invertidas
    if (/\.\.|%|\\/.test(path)) return send(res, 400, { error: 'Ruta no válida.' })
    if (req.method !== 'GET') return send(res, 405, { error: 'Solo lectura: usa GET.' })
    for (const [re, run] of ROUTES) {
      const m = re.exec(path)
      if (!m) continue
      try {
        const ctx: Ctx = { data: loadAppData(dir()), dir: dir(), q: new URLSearchParams(query), today: toLocalISODate(now()) }
        return send(res, 200, run(m, ctx))
      } catch (e) {
        if (e instanceof ApiError) return send(res, e.status, { error: e.message })
        console.error('[mcp]', e)
        return send(res, 500, { error: 'Error inesperado al preparar los datos.' })
      }
    }
    send(res, 404, { error: 'No existe esa ruta del MCP.' })
  }
}
