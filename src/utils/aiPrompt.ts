// Textos que la app manda a Gemini por la ruta /api/gemini (server/gemini.ts).
// Llevan tus datos ya resumidos; nunca rutas GPS.

import type { ActivitySummary, FitnessPoint, GlobalStats, PlannedEvent, PlannedWorkout, UserSettings } from '../types/suunto'
import { computePRs, formState, localWeekStart, predictRaces, sameHrEfficiency } from './calculations'
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
  lines.push(`Hoy es ${dayName(today)} ${today}. Corredor (≈97 % de las actividades son carrera a pie).`)
  lines.push(`Ajustes: FC máxima ${d.settings.maxHR} ppm${d.stats?.userMaxHR && d.stats.userMaxHR !== d.settings.maxHR ? ` (Suunto estima ${d.stats.userMaxHR})` : ''}, FC umbral ${d.settings.lthrRunning} ppm, ritmo umbral ${formatPace(d.settings.thresholdPace)}.`)
  lines.push('Aviso sobre los datos: el pulso es de muñeca y en competición sale anormalmente bajo (≈145 ppm a 3:30/km), así que no saques conclusiones del pulso en carreras. Las zonas del reloj están configuradas bajas.')

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
