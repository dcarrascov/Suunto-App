// Textos que la app manda a Gemini por la ruta /api/gemini (server/gemini.ts).
// Llevan tus datos ya resumidos; nunca rutas GPS.

import type { ActivitySummary, FitnessPoint, GlobalStats, PlannedEvent, PlannedWorkout, UserSettings } from '../types/suunto'
import type { AiProposal, FreeGoal, FreeGoalDistance } from '../stores/aiStore'
import type { CustomWorkout } from './customWorkouts'
import { computePRs, formState, localWeekStart, paceZoneRanges, predictRaces, sameHrEfficiency } from './calculations'
import { isoDateOffset, parseLocalDate, toLocalISODate } from './date'
import { formatDuration, formatPace, formatRaceTime } from './formatters'
import { eventLabel, findRaces, raceActivityIds, upcomingEvents } from './races'
import { coachStats, coachStatsText, coachWeeks, SESSION_LABEL, sessionType } from './coach'

export interface AthleteData {
  activities: ActivitySummary[]
  stats: GlobalStats | null
  workouts: PlannedWorkout[]       // plan de TrainingPeaks (puede estar vacío)
  events: PlannedEvent[]           // competiciones del calendario de TrainingPeaks (pueden faltar)
  settings: UserSettings
  history: FitnessPoint[]
  projection: FitnessPoint[]
  today?: string
}

const DAY = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom']

function dayName(iso: string): string {
  return DAY[(parseLocalDate(iso).getDay() + 6) % 7]
}

function addDays(iso: string, n: number): string {
  const d = parseLocalDate(iso)
  return toLocalISODate(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n))
}

const km = (v: number) => v.toFixed(1).replace('.', ',')
const signed = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v)}`

function plannedLine(w: PlannedWorkout): string {
  const p = w.planned
  const parts = [
    p.duration ? formatDuration(p.duration) : null,
    p.distance ? `${km(p.distance)} km` : null,
    p.tss ? `${Math.round(p.tss)} TSS` : null,
  ].filter(Boolean)
  return `${w.title}${parts.length ? ` (${parts.join(', ')})` : ''}`
}

// Avisos sobre los datos del usuario, solo si los activa en Ajustes → Entrenador IA
const HR_UNRELIABLE = 'Aviso sobre los datos: su pulso es de muñeca y no es fiable (en competición suele salir anormalmente bajo): no saques conclusiones del pulso, sobre todo en carreras.'
const SPLIT_SESSIONS = 'Suele grabar por separado el calentamiento, la parte principal y la vuelta a la calma: varias actividades seguidas del mismo día son una sola sesión, no interrupciones.'

/** Bloque con tu situación actual: forma, semanas recientes, competiciones, récords y plan cercano. */
export function athleteContext(d: AthleteData): string {
  const today = d.today ?? toLocalISODate(new Date())
  const runs = d.activities.filter(a => a.sport === 'running')
  const cur = d.history.at(-1)
  const races = findRaces(d.activities, d.workouts, [...d.history, ...d.projection], d.settings, today, d.events)
  const next = races.filter(r => r.upcoming).sort((a, b) => a.date.localeCompare(b.date))[0]
  const nextTsb = next ? d.projection.find(p => p.date === next.date)?.tsb : undefined
  const lines: string[] = []

  lines.push('## Atleta')
  const runShare = d.activities.length ? Math.round(runs.length / d.activities.length * 100) : null
  lines.push(`Hoy es ${dayName(today)} ${today}.${runShare != null ? ` El ${runShare} % de sus actividades son carrera a pie.` : ''}`)
  lines.push(`Ajustes: FC máxima ${d.settings.maxHR} ppm${d.stats?.userMaxHR && d.stats.userMaxHR !== d.settings.maxHR ? ` (Suunto estima ${d.stats.userMaxHR})` : ''}, FC umbral ${d.settings.lthrRunning} ppm, ritmo umbral ${formatPace(d.settings.thresholdPace)}.`)
  if (d.settings.hrUnreliable) lines.push(HR_UNRELIABLE)
  if (d.settings.splitSessions) lines.push(SPLIT_SESSIONS)

  if (cur) {
    lines.push('', '## Forma (modelo CTL/ATL/TSB)')
    lines.push(`Hoy: Fitness ${Math.round(cur.ctl)}, Fatiga ${Math.round(cur.atl)}, Forma ${signed(cur.tsb)} (${formState(cur.tsb).label}).`)
    if (next) lines.push(`Próxima competición: ${next.event ? `«${next.event.name}» ` : ''}${dayName(next.date)} ${next.date}${nextTsb != null ? `, forma prevista ${signed(nextTsb)}` : ''}.`)
  }

  // Próximas competiciones del calendario (nombre, prioridad, distancia y notas)
  const coming = upcomingEvents(d.events, today).slice(0, 6)
  if (coming.length) {
    lines.push('', '## Próximas competiciones (calendario de TrainingPeaks; prioridad A = objetivo principal)')
    for (const e of coming) {
      const notes = [e.description, e.comment].filter(Boolean).join(' ')
      lines.push(`- ${dayName(e.date)} ${e.date}: ${eventLabel(e)}${notes ? ` · ${notes}` : ''}`)
    }
  }

  // Últimas 8 semanas de carrera
  lines.push('', '## Últimas 8 semanas (carrera)')
  lines.push('semana (lunes) | km | salidas | tiempo | tirada más larga')
  const monday = parseLocalDate(localWeekStart(parseLocalDate(today)))
  for (let i = 7; i >= 0; i--) {
    const start = toLocalISODate(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - 7 * i))
    const end = addDays(start, 6)
    const wk = runs.filter(a => a.startTime.slice(0, 10) >= start && a.startTime.slice(0, 10) <= end)
    const dist = wk.reduce((s, a) => s + a.distance, 0)
    const time = wk.reduce((s, a) => s + a.duration, 0)
    const longest = Math.max(0, ...wk.map(a => a.distance))
    lines.push(`${start}${i === 0 ? ' (en curso)' : ''} | ${km(dist)} | ${wk.length} | ${formatDuration(time)} | ${km(longest)} km`)
  }

  // Competiciones
  const done = races.filter(r => r.activity).slice(0, 8)
  if (done.length) {
    lines.push('', '## Competiciones recientes')
    for (const r of done) {
      const a = r.activity!
      lines.push(`- ${r.date}${r.event ? ` «${r.event.name}»` : ''}: ${km(a.distance)} km en ${formatRaceTime(a.duration)} (${formatPace(a.avgPace)})${r.formBefore != null ? `, forma al llegar ${signed(r.formBefore)}` : ''}`)
    }
  }

  // Récords y predicción
  const prs = computePRs(d.activities).running
  if (prs.length) {
    lines.push('', '## Mejores marcas (mejor tramo dentro de una actividad)')
    lines.push(prs.map(p => `${p.label}: ${formatRaceTime(p.duration)} (${p.date})`).join(' · '))
  }
  const pred = predictRaces(d.activities, isoDateOffset(90))
  if (pred.length) lines.push(`Predicción actual (Riegel, últimos 90 días): ${pred.map(p => `${p.label} ${formatRaceTime(p.seconds)}`).join(' · ')}`)

  // Eficiencia y desacoplamiento
  const eff = sameHrEfficiency(d.activities.filter(a => a.startTime.slice(0, 10) >= isoDateOffset(180)),
    raceActivityIds(d.activities, d.workouts, d.settings, d.events))
  if (eff.points.length) {
    lines.push('', `## Ritmo a su FC habitual (${eff.refHR} ppm), por mes`)
    lines.push(eff.points.map(p => `${p.month}: ${formatPace(p.paceAtRef)}`).join(' · '))
  }
  const longRuns = runs.filter(a => a.duration >= 3600 && a.decoupling != null).slice(0, 5)
  if (longRuns.length) {
    lines.push(`Desacoplamiento de las últimas tiradas de ≥1 h: ${longRuns.map(a => `${a.startTime.slice(0, 10)} ${a.decoupling}%`).join(' · ')} (por debajo de 5 % = buena base aeróbica).`)
  }

  // Plan cercano
  const near = d.workouts.filter(w => w.hasPlan && w.date >= addDays(today, -7) && w.date <= addDays(today, 7))
  if (near.length) {
    lines.push('', '## Plan del entrenador (7 días atrás y 7 adelante)')
    for (const w of near) {
      const status = w.date > today ? 'pendiente' : w.completed ? 'hecho' : w.date === today ? 'hoy' : 'no hecho'
      lines.push(`- ${dayName(w.date)} ${w.date}: ${plannedLine(w)} · ${status}`)
    }
  }

  // Últimas actividades
  lines.push('', '## Últimas 12 actividades')
  for (const a of d.activities.slice(0, 12)) {
    lines.push(`- ${a.startTime.slice(0, 16).replace('T', ' ')} · ${a.sport} · ${km(a.distance)} km · ${formatDuration(a.duration)}`
      + `${a.avgPace ? ` · ${formatPace(a.avgPace)}` : ''}${a.avgHR ? ` · FC ${a.avgHR}` : ''}${a.tss != null ? ` · ${Math.round(a.tss)} TSS` : ''}`)
  }
  return lines.join('\n')
}

// ─── 1. Preguntar ────────────────────────────────────────────────────────────

export function questionPrompt(d: AthleteData, question: string): string {
  return [
    'Eres un entrenador de atletismo con experiencia en carreras de fondo. Te paso los datos de entrenamiento',
    'de un corredor, sacados de su reloj Suunto y del plan que le envía su entrenador en TrainingPeaks.',
    'Responde en español, de forma concreta y apoyándote en los datos. Si algo no se puede saber con estos datos, dilo.',
    'Ten en cuenta que ya tiene un entrenador: no contradigas su plan sin explicar por qué, y recomienda consultarle',
    'los cambios importantes. Si la pregunta es sobre dolor o lesión, recomienda ver a un profesional.',
    '',
    athleteContext(d),
    '',
    '## Pregunta',
    question.trim(),
  ].join('\n')
}

// ─── 2. Analizar al entrenador ───────────────────────────────────────────────

/** Competiciones de la semana que empieza en `weekStart`. */
function weekEvents(events: PlannedEvent[], weekStart: string): PlannedEvent[] {
  const end = addDays(weekStart, 6)
  return events.filter(e => e.date >= weekStart && e.date <= end)
}

/**
 * Sesiones del entrenador por semanas, con la descripción literal. Las semanas con competición van marcadas
 * («SEMANA DE COMPETICIÓN») y el día de la carrera aparece aunque él no ponga entreno: así se ve qué cambia.
 * Con `onlyWeeks`, solo esas semanas.
 */
function coachHistory(workouts: PlannedWorkout[], events: PlannedEvent[], fromWeek?: string, onlyWeeks?: Set<string>): string {
  const out: string[] = []
  for (const wk of coachWeeks(workouts)) {
    if (fromWeek && wk.weekStart < fromWeek) continue
    if (onlyWeeks && !onlyWeeks.has(wk.weekStart)) continue
    const races = weekEvents(events, wk.weekStart)
    const raceMark = races.length ? ` · SEMANA DE COMPETICIÓN: ${races.map(e => `${eventLabel(e)} (${dayName(e.date)})`).join(', ')}` : ''
    out.push(`### Semana del ${wk.weekStart} · ${wk.sessions} sesiones · ${Math.round(wk.minutes)} min · ${Math.round(wk.tss)} TSS${raceMark}`)
    const days = [...wk.workouts.map(w => ({ date: w.date, w })), ...races.map(e => ({ date: e.date, e }))]
      .sort((a, b) => a.date.localeCompare(b.date))
    for (const item of days) {
      if ('e' in item) {
        out.push(`#### ${dayName(item.date)} ${item.date} · COMPETICIÓN: ${eventLabel(item.e!)}`)
        continue
      }
      const w = item.w!
      out.push(`#### ${dayName(w.date)} ${w.date} · ${SESSION_LABEL[sessionType(w)]} · ${plannedLine(w)}${w.completed ? ' · hecho' : ''}`)
      if (w.description) out.push(w.description.trim())
      if (w.coachComments) out.push(`Comentario del entrenador: ${w.coachComments.trim()}`)
    }
    out.push('')
  }
  return out.join('\n')
}

export function coachProfilePrompt(workouts: PlannedWorkout[], events: PlannedEvent[] = []): string {
  const stats = coachStats(workouts, events)
  return [
    'Te paso todos los entrenamientos que un entrenador de atletismo ha planificado a un corredor en los últimos meses',
    '(TrainingPeaks), con sus descripciones literales, y unas estadísticas calculadas a partir de ellos.',
    '',
    'Quiero que escribas en español un PERFIL DEL ENTRENADOR que sirva después para proponer semanas de',
    'entrenamiento lo más parecidas posible a como él las planifica. Básate solo en los datos; no inventes.',
    'Estructura el perfil en estas secciones:',
    '1. Estructura de la semana tipo (qué pone cada día, cuántas sesiones, días de descanso).',
    '2. Tipos de sesión que usa y cómo los formula (títulos, series típicas, duraciones, ritmos o zonas, RPE).',
    '3. Cómo progresa la carga entre semanas (volumen, intensidad, semanas de descarga).',
    '4. Cómo planifica las SEMANAS DE COMPETICIÓN (marcadas así abajo) y la semana anterior: qué sesiones quita,',
    '   cuánto baja el volumen, qué hace los días previos (series precompetición, activación) y si cambia según la',
    '   prioridad de la carrera (A = objetivo principal).',
    '5. Cómo redacta las descripciones (secciones que usa, tono, extensión) con un ejemplo corto.',
    '6. Reglas concretas para imitarle (una lista breve de «siempre / nunca / normalmente»).',
    'Máximo 1.200 palabras.',
    '',
    '## Estadísticas',
    coachStatsText(stats),
    '',
    ...(events.length ? ['## Competiciones del calendario', ...events.map(e => `- ${e.date}: ${eventLabel(e)}`), ''] : []),
    '## Entrenamientos (por semanas)',
    coachHistory(workouts, events),
  ].join('\n')
}

// ─── 3. Proponer una semana ──────────────────────────────────────────────────

export const PROPOSAL_FORMAT = `{
  "semana": "YYYY-MM-DD",
  "explicacion": "2-4 frases: por qué esta semana así, según el estilo del entrenador y la situación actual",
  "entrenos": [
    {
      "fecha": "YYYY-MM-DD",
      "tipo": "rodaje | progresivo | rectas | series | cuestas | cambios | activacion | competicion | fuerza | natacion | descanso",
      "titulo": "en el mismo formato que usa el entrenador, p. ej. RODAJE 45'",
      "descripcion": "con las mismas secciones que usa el entrenador (OBJETIVO, DESCRIPCIÓN, ESTRUCTURA, RPE, OBSERVACIONES)",
      "duracion_min": 45,
      "distancia_km": null,
      "tss": 50
    }
  ]
}`

/** ¿Es una semana que ya empezó o pasó? Entonces la propuesta es una prueba: se compara con lo que puso el entrenador. */
export function isBacktestWeek(weekStart: string, today: string = toLocalISODate(new Date())): boolean {
  return weekStart <= today
}

/**
 * Texto para proponer la semana que empieza en `weekStart`. Nunca incluye nada del plan de esa semana ni
 * posterior (sería copiar al entrenador). En una semana de prueba (ya empezada o pasada) además se recortan
 * las actividades y la forma a lo anterior a esa semana, y no se usa el perfil guardado (se hizo con todas las
 * semanas, incluida esa): así la prueba es justa.
 */
export function weekPrompt(full: AthleteData, weekStart: string, profile: string | null): string {
  const today = full.today ?? toLocalISODate(new Date())
  const backtest = isBacktestWeek(weekStart, today)
  const d: AthleteData = backtest
    ? {
        ...full,
        today: addDays(weekStart, -1),
        activities: full.activities.filter(a => a.startTime.slice(0, 10) < weekStart),
        workouts: full.workouts.filter(w => w.date < weekStart),
        history: full.history.filter(p => p.date < weekStart),
        projection: [],
      }
    : { ...full, workouts: full.workouts.filter(w => w.date < weekStart) }
  const useProfile = backtest ? null : profile
  const weekEnd = addDays(weekStart, 6)
  const examplesFrom = addDays(weekStart, -7 * 6)  // las 6 semanas anteriores, literales
  // Las competiciones se conocen con antelación: se usan aunque sea una semana de prueba
  const racesThisWeek = weekEvents(d.events, weekStart)
  const racesNextWeek = weekEvents(d.events, addDays(weekStart, 7))
  const seasonGoal = upcomingEvents(d.events, weekStart).find(e => e.priority === 'A' && !racesThisWeek.includes(e))
  // Ejemplos extra: sus últimas semanas de competición (y la anterior a cada una) que no estén ya entre las 6 últimas
  const pastRaceWeeks = [...new Set(d.events.filter(e => e.date < examplesFrom).map(e => localWeekStart(parseLocalDate(e.date))))]
    .sort().slice(-3)
  const extraWeeks = new Set(pastRaceWeeks.flatMap(w => [addDays(w, -7), w]))
  const raceBlock: string[] = []
  if (racesThisWeek.length || racesNextWeek.length || seasonGoal) {
    raceBlock.push('## Competiciones')
    for (const e of racesThisWeek) {
      raceBlock.push(`- ESTA ES UNA SEMANA DE COMPETICIÓN: ${eventLabel(e)}, el ${dayName(e.date)} ${e.date}.`)
    }
    for (const e of racesNextWeek) raceBlock.push(`- La semana siguiente hay competición: ${eventLabel(e)}, el ${dayName(e.date)} ${e.date}.`)
    if (seasonGoal) raceBlock.push(`- Objetivo de temporada: ${eventLabel(seasonGoal)}, el ${seasonGoal.date}.`)
    raceBlock.push('')
  }
  return [
    'Eres un ayudante que imita a un entrenador de atletismo concreto. Tu tarea es proponer la semana del',
    `${weekStart} (lunes) al ${weekEnd} (domingo) para su corredor, lo más parecida posible a como la planificaría`,
    'ese entrenador: mismos tipos de sesión, mismos días, mismo formato de título y de descripción, y una carga',
    'coherente con sus semanas anteriores y con la situación actual del corredor.',
    '',
    'Reglas:',
    '- Imita al entrenador; no apliques tu propio método. Si dudas, sigue lo que hizo en semanas parecidas.',
    '- No subas el volumen semanal más de lo que él suele subirlo entre semanas.',
    '- Una semana de competición es distinta: planifícala como él planifica sus semanas de competición (marcadas',
    '  «SEMANA DE COMPETICIÓN» en sus semanas anteriores): menos volumen, sus series precompetición, la activación',
    '  el día antes… El día de la carrera pon "tipo": "competicion" con el nombre de la carrera como título.',
    '- Si la competición es la semana siguiente, haz lo que él hace la semana previa a competir.',
    '- Ten en cuenta la prioridad: las carreras A son el objetivo; no comprometas la preparación del objetivo de temporada.',
    '- Incluye los 7 días; los días sin sesión van con "tipo": "descanso".',
    '- Indica siempre "duracion_min" y "tss"; "distancia_km" solo si el entrenador la indicaría en esa sesión (si no, null).',
    '- Esto es solo una propuesta orientativa: el plan real lo decide el entrenador.',
    '',
    'Responde solo con un objeto JSON con exactamente este formato (sin texto antes ni después):',
    PROPOSAL_FORMAT,
    '',
    ...raceBlock,
    useProfile ? `## Perfil del entrenador\n${useProfile}` : '## Estadísticas del entrenador\n' + coachStatsText(coachStats(d.workouts, d.events)),
    '',
    athleteContext(d),
    '',
    '## Sus últimas semanas planificadas (literal)',
    coachHistory(d.workouts.filter(w => w.date < weekStart), d.events.filter(e => e.date < weekStart), examplesFrom),
    ...(extraWeeks.size ? [
      '## Sus semanas de competición anteriores y la semana previa a cada una (literal)',
      coachHistory(d.workouts.filter(w => w.date < examplesFrom), d.events.filter(e => e.date < examplesFrom), undefined, extraWeeks),
    ] : []),
  ].join('\n')
}

// ─── 4. Proponer una semana sin entrenador ───────────────────────────────────

export const GOAL_LABEL: Record<FreeGoalDistance, string> = {
  '5k': '5 km', '10k': '10 km', '21k': 'media maratón (21,1 km)', '42k': 'maratón (42,2 km)', none: 'sin carrera objetivo',
}
/** Semanas de afinado (taper) antes de la carrera según la distancia. */
const TAPER_WEEKS: Record<FreeGoalDistance, number> = { '5k': 1, '10k': 1, '21k': 2, '42k': 3, none: 0 }

/** Semanas desde `weekStart` hasta la semana de la carrera (0 = es la semana de la carrera; negativo = ya pasó). */
export function weeksToRace(weekStart: string, raceDate: string | null): number | null {
  if (!raceDate) return null
  const raceWeek = parseLocalDate(localWeekStart(parseLocalDate(raceDate)))
  return Math.round((raceWeek.getTime() - parseLocalDate(weekStart).getTime()) / (7 * 86_400_000))
}

/** Fase del plan para esa semana. */
export function freePhase(goal: Pick<FreeGoal, 'distance' | 'raceDate'>, weekStart: string): string {
  const left = goal.distance === 'none' ? null : weeksToRace(weekStart, goal.raceDate)
  if (left == null) return goal.distance === 'none' ? 'desarrollo general: mejorar la forma sin carrera a la vista' : 'preparación del objetivo (sin fecha de carrera)'
  if (left < 0) return 'después de la carrera: semana de recuperación y vuelta progresiva'
  if (left === 0) return 'SEMANA DE LA CARRERA'
  const taper = TAPER_WEEKS[goal.distance]
  if (left <= taper) return `afinado (taper): faltan ${left} semana${left === 1 ? '' : 's'} para la carrera`
  if (left <= taper + 6) return `específico: faltan ${left} semanas, trabajo al ritmo de la carrera`
  return `base: faltan ${left} semanas, construir volumen aeróbico`
}

/** Tiempo medio semanal de carrera (min) y tirada más larga (min) de las 4 semanas completas antes de `weekStart`. */
export function recentRunningLoad(activities: ActivitySummary[], weekStart: string): { avgMin: number; longestMin: number; weeks: number[] } {
  const weeks: number[] = []
  let longest = 0
  for (let i = 4; i >= 1; i--) {
    const start = addDays(weekStart, -7 * i)
    const end = addDays(start, 6)
    const wk = activities.filter(a => a.sport === 'running' && a.startTime.slice(0, 10) >= start && a.startTime.slice(0, 10) <= end)
    weeks.push(Math.round(wk.reduce((t, a) => t + a.duration, 0) / 60))
    longest = Math.max(longest, ...wk.map(a => a.duration / 60))
  }
  return { avgMin: Math.round(weeks.reduce((a, b) => a + b, 0) / 4), longestMin: Math.round(longest), weeks }
}

export const FREE_PROPOSAL_FORMAT = `{
  "semana": "YYYY-MM-DD",
  "explicacion": "2-4 frases: qué busca esta semana dentro del plan y por qué esta carga",
  "entrenos": [
    {
      "fecha": "YYYY-MM-DD",
      "tipo": "rodaje | progresivo | rectas | series | cuestas | cambios | activacion | competicion | fuerza | natacion | descanso",
      "titulo": "corto y claro, p. ej. RODAJE 45' o SERIES 6x1000",
      "descripcion": "OBJETIVO, ESTRUCTURA (calentamiento, parte principal con ritmos en min/km o RPE, vuelta a la calma) y OBSERVACIONES",
      "duracion_min": 45,
      "distancia_km": null,
      "tss": 50
    }
  ]
}`

const LEVEL_LABEL: Record<NonNullable<FreeGoal['level']>, string> = {
  nuevo: 'empieza a correr (no corre o corre muy poco)',
  algo: 'corre algo, sin constancia',
  habitual: 'corre habitualmente',
}
const WEEKDAY_LONG = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']

/**
 * Texto para proponer la semana `weekStart` SIN entrenador: con tus actividades de Suunto (si las hay) o, si no,
 * con tu nivel, para el objetivo elegido. Lleva las semanas ya generadas de este plan para que la progresión siga.
 */
export function freeWeekPrompt(full: AthleteData, weekStart: string, goal: FreeGoal, previous: AiProposal[] = []): string {
  const weekEnd = addDays(weekStart, 6)
  const hasData = full.activities.some(a => a.sport === 'running')
  // el plan del entrenador no se usa en este modo (las competiciones del calendario sí)
  const d: AthleteData = { ...full, workouts: [] }
  const left = goal.distance === 'none' ? null : weeksToRace(weekStart, goal.raceDate)
  const raceThisWeek = left === 0 && goal.raceDate
  const load = recentRunningLoad(full.activities, weekStart)
  const prev = previous.filter(p => p.weekStart < weekStart).sort((a, b) => a.weekStart.localeCompare(b.weekStart)).slice(-3)
  const lastPrev = prev.at(-1)
  const lastMin = lastPrev ? Math.round(lastPrev.workouts.reduce((t, w) => t + (w.durationMin ?? 0), 0)) : null

  const goalLines = [
    '## Objetivo',
    `- Objetivo: ${GOAL_LABEL[goal.distance]}${goal.raceName ? ` («${goal.raceName}»)` : ''}${goal.raceDate && goal.distance !== 'none' ? `, el ${dayName(goal.raceDate)} ${goal.raceDate}` : ''}.`,
    `- Fase de esta semana: ${freePhase(goal, weekStart)}.`,
    `- Días que puede entrenar: ${goal.daysPerWeek} por semana${goal.longRunDay != null ? `; tirada larga preferida el ${WEEKDAY_LONG[goal.longRunDay]}` : ''}.`,
  ]
  if (raceThisWeek) goalLines.push(`- La carrera es el ${dayName(goal.raceDate!)} ${goal.raceDate}: ese día "tipo": "competicion" con el nombre de la carrera como título.`)

  const athlete: string[] = []
  if (hasData) {
    athlete.push(athleteContext(d), '')
    athlete.push('## Carga real reciente (carrera)')
    athlete.push(`Tiempo por semana en las 4 semanas anteriores: ${load.weeks.join(', ')} min (media ${load.avgMin} min). Salida más larga: ${load.longestMin} min.`)
    const zones = paceZoneRanges(full.settings.thresholdPace)
    athlete.push(`Zonas de ritmo con su ritmo umbral (${formatPace(full.settings.thresholdPace)}): ${zones.map(z => `Z${z.def.zone} ${z.def.name} ${z.fast ? formatPace(z.fast) : '…'}–${z.slow ? formatPace(z.slow) : '…'}`).join(' · ')}.`)
    athlete.push('Si el ritmo umbral no cuadra con sus marcas y su predicción, fíate más de las marcas recientes.')
  } else {
    athlete.push('## Atleta (sin datos de reloj)')
    athlete.push(`Nivel: ${goal.level ? LEVEL_LABEL[goal.level] : 'no indicado'}.${goal.hoursPerWeek ? ` Corre unas ${goal.hoursPerWeek} h a la semana.` : ''}`)
    athlete.push('No hay ritmos medidos: indica la intensidad con RPE (1-10) y sensaciones («puedes hablar», «te cuesta hablar»).')
  }

  const prevLines: string[] = []
  if (prev.length) {
    prevLines.push('## Semanas anteriores de este mismo plan (las propusiste tú; continúa la progresión)')
    for (const p of prev) {
      const min = Math.round(p.workouts.reduce((t, w) => t + (w.durationMin ?? 0), 0))
      prevLines.push(`### Semana del ${p.weekStart} · ${min} min`)
      for (const w of p.workouts.filter(x => x.type !== 'descanso')) {
        prevLines.push(`- ${dayName(w.date)}: ${w.title} (${SESSION_LABEL[w.type]}${w.durationMin ? `, ${Math.round(w.durationMin)} min` : ''})`)
      }
    }
  }

  const base = lastMin ?? (hasData ? load.avgMin : null)
  return [
    'Eres un entrenador de atletismo con experiencia en carreras de fondo. Este corredor entrena SIN entrenador y',
    `quiere que le propongas la semana del ${weekStart} (lunes) al ${weekEnd} (domingo) dentro de un plan hacia su objetivo,`,
    hasData ? 'adaptada a su nivel real (te paso sus datos del reloj) y pensada para que mejore.' : 'a partir de su nivel declarado (no hay datos del reloj).',
    '',
    'Reglas:',
    `- Exactamente ${goal.daysPerWeek} días con sesión de carrera (o ${goal.daysPerWeek - 1} de carrera y uno de fuerza si lo ves útil); el resto "tipo": "descanso". Incluye los 7 días.`,
    `- Progresión prudente: el tiempo total no debe superar en más de un 10 % ${base != null ? `${base} min (${lastPrev ? 'la semana anterior de este plan' : 'su media real de las últimas 4 semanas'})` : 'lo que sea razonable para su nivel'}.`,
    '  Cada 3-4 semanas, una de descarga (−20 a −30 % de tiempo), salvo en el afinado.',
    '- Distribución 80/20: al menos el 80 % del tiempo suave (Z1-Z2 o RPE 3-4); una sesión de calidad por semana (dos solo si',
    '  entrena 5 o más días, corre habitualmente y no es semana de descarga ni de afinado).',
    '- Calidad según el objetivo: 5 km → series cortas (200-1000 m) a ritmo de 5 km o más rápido; 10 km → series de 1-2 km a',
    '  ritmo umbral / 10 km; media maratón → tempo y bloques largos a ritmo de media; maratón → tirada larga con bloques a ritmo',
    '  de maratón; sin objetivo → variedad (fartlek, cuestas, tempo corto, rectas).',
    '- Tirada larga: como mucho el 30 % del tiempo semanal (35 % en maratón); que no supere en más de 15 min la más larga reciente.',
    full.settings.hrUnreliable
      ? '- Planifica por TIEMPO y por ritmo o RPE, nunca por pulso: su pulso de muñeca no es fiable.'
      : '- Planifica por TIEMPO y por ritmo o RPE; el pulso, solo como referencia secundaria.',
    '- Semana de la carrera: baja el volumen un 40-50 %, mantén algo de ritmo corto, activación suave el día antes y la carrera',
    '  ese día. Afinado: baja el volumen progresivamente y conserva la intensidad.',
    '- Si empieza a correr: alterna correr y andar (p. ej. 1 min corriendo / 2 andando) y sube poco a poco.',
    '- Indica siempre "duracion_min" y "tss" (estimado); "distancia_km" solo si aporta (si no, null).',
    '- Es una propuesta orientativa; si hay dolor o lesión, que consulte a un profesional.',
    '',
    'Responde solo con un objeto JSON con exactamente este formato (sin texto antes ni después):',
    FREE_PROPOSAL_FORMAT,
    '',
    ...goalLines,
    '',
    ...athlete,
    '',
    ...prevLines,
  ].join('\n')
}

// ─── 5. Revisar una semana hecha ─────────────────────────────────────────────

/** Lo planificado de la semana, de donde haya: plan del entrenador, propuesta de la IA o entrenos propios. */
export interface PlannedSource {
  kind: 'coach' | 'ia' | 'custom' | 'none'
  lines: string[]
}

export function plannedForWeek(
  weekStart: string, workouts: PlannedWorkout[], proposals: AiProposal[], custom: CustomWorkout[],
): PlannedSource {
  const end = addDays(weekStart, 6)
  const inWeek = (date: string) => date >= weekStart && date <= end
  const coach = workouts.filter(w => w.hasPlan && inWeek(w.date)).sort((a, b) => a.date.localeCompare(b.date))
  if (coach.length) {
    return { kind: 'coach', lines: coach.map(w => `- ${dayName(w.date)} ${w.date}: ${plannedLine(w)}${w.description ? ` — ${w.description.trim().replace(/\s+/g, ' ').slice(0, 220)}` : ''}`) }
  }
  const ia = proposals.find(p => p.weekStart === weekStart)
  if (ia) {
    return {
      kind: 'ia',
      lines: ia.workouts.filter(w => w.type !== 'descanso').map(w => `- ${dayName(w.date)} ${w.date}: ${w.title}${w.durationMin ? ` (${Math.round(w.durationMin)} min)` : ''}`),
    }
  }
  const own = custom.filter(w => inWeek(w.date)).sort((a, b) => a.date.localeCompare(b.date))
  if (own.length) {
    return { kind: 'custom', lines: own.map(w => `- ${dayName(w.date)} ${w.date}: ${w.title}${w.durationMin ? ` (${w.durationMin} min)` : ''}`) }
  }
  return { kind: 'none', lines: [] }
}

const PLANNED_LABEL: Record<PlannedSource['kind'], string> = {
  coach: 'plan de su entrenador en TrainingPeaks',
  ia: 'propuesta de la IA',
  custom: 'entrenos que se puso él mismo',
  none: 'nada planificado',
}

/**
 * Texto para revisar la semana que empieza en `weekStart`: lo planificado frente a lo hecho con el reloj,
 * con la forma al terminar. Nunca rutas GPS.
 */
export function weekReviewPrompt(d: AthleteData, weekStart: string, planned: PlannedSource): string {
  const today = d.today ?? toLocalISODate(new Date())
  const end = addDays(weekStart, 6)
  const inProgress = today <= end
  const done = d.activities
    .filter(a => a.startTime.slice(0, 10) >= weekStart && a.startTime.slice(0, 10) <= end)
    .sort((a, b) => a.startTime.localeCompare(b.startTime))
  const prevLoad = recentRunningLoad(d.activities, weekStart)
  const runMin = Math.round(done.filter(a => a.sport === 'running').reduce((t, a) => t + a.duration, 0) / 60)
  const form = d.history.filter(p => p.date <= (inProgress ? today : end)).at(-1)
  const races = weekEvents(d.events, weekStart)
  return [
    'Eres un entrenador de atletismo con experiencia en carreras de fondo. Revisa la semana de entrenamiento de un',
    `corredor (del ${weekStart} al ${end}${inProgress ? `; la semana aún no ha terminado, hoy es ${dayName(today)} ${today}` : ''}).`,
    'Compara lo planificado con lo que hizo según su reloj y escribe en español, en 150-300 palabras, con estas secciones:',
    '1. Cumplimiento (sesiones y tiempo, qué se saltó o cambió).',
    '2. Lo que salió bien.',
    '3. A vigilar (carga, descanso, intensidad).',
    '4. Para la semana siguiente (2-3 consejos concretos).',
    'Sé concreto y apóyate en los datos. Habla de tú y no te presentes como su entrenador.',
    d.settings.hrUnreliable ? HR_UNRELIABLE : '',
    d.settings.splitSessions ? SPLIT_SESSIONS : '',
    'Texto plano, sin Markdown (sin asteriscos ni almohadillas): cada sección empieza con su número y título en una línea.',
    planned.kind === 'coach' ? 'Tiene entrenador: no le contradigas; si algo preocupa, que lo hable con él.' : '',
    '',
    `## Planificado (${PLANNED_LABEL[planned.kind]})`,
    ...(planned.lines.length ? planned.lines : ['- (nada)']),
    ...(races.length ? ['', '## Competiciones de la semana', ...races.map(e => `- ${dayName(e.date)} ${e.date}: ${eventLabel(e)}`)] : []),
    '',
    '## Hecho (reloj)',
    ...(done.length
      ? done.map(a => `- ${dayName(a.startTime.slice(0, 10))} ${a.startTime.slice(0, 16).replace('T', ' ')} · ${a.sport} · ${km(a.distance)} km · ${formatDuration(a.duration)}`
        + `${a.avgPace ? ` · ${formatPace(a.avgPace)}` : ''}${a.tss != null ? ` · ${Math.round(a.tss)} TSS` : ''}`)
      : ['- (ninguna actividad)']),
    `Tiempo de carrera de la semana: ${runMin} min (media de las 4 semanas anteriores: ${prevLoad.avgMin} min).`,
    ...(form ? [`Forma al ${inProgress ? 'día de hoy' : 'terminar la semana'}: Fitness ${Math.round(form.ctl)}, Fatiga ${Math.round(form.atl)}, Forma ${signed(form.tsb)} (${formState(form.tsb).label}).`] : []),
  ].filter(l => l !== '').join('\n').replace(/\n## /g, '\n\n## ')
}
