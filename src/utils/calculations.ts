import type { ActivitySummary, FitnessPoint, HRZone, Sport, UserSettings } from '../types/suunto'
import { parseLocalDate, toLocalISODate } from './date'

// ─── TSS Estimation ─────────────────────────────────────────────────────────

// Diferencia típica del umbral láctico respecto a carrera cuando no se ha configurado:
// en bici suele ser ~5 bpm más bajo y nadando ~10 bpm (menos masa muscular, posición horizontal)
export const LTHR_OFFSET: Record<'cycling' | 'swimming', number> = { cycling: 5, swimming: 10 }

/** FC de umbral láctico para un deporte ("other" usa la de carrera). */
export function lthrFor(sport: Sport, settings: UserSettings): number {
  if (sport === 'cycling') return settings.lthrCycling ?? settings.lthrRunning - LTHR_OFFSET.cycling
  if (sport === 'swimming') return settings.lthrSwimming ?? settings.lthrRunning - LTHR_OFFSET.swimming
  return settings.lthrRunning
}

/**
 * Estimates TSS for activities that don't have it from Suunto.
 * Uses TRIMP-derived method based on HR zones.
 */
export function estimateTSS(activity: ActivitySummary, settings: UserSettings): number {
  if (activity.tss != null) return activity.tss

  const durationHours = activity.movingTime / 3600
  // Sin frecuencia cardiaca (avgHR = 0) no se puede usar TRIMP: se asume una carga suave de ~30 TSS/hora.
  // Antes salía un TSS NEGATIVO que restaba carga al Fitness/Fatiga.
  if (!activity.avgHR) return Math.round(durationHours * 30)
  const hrReserve = Math.min(Math.max((activity.avgHR - 60) / (settings.maxHR - 60), 0), 1)

  // TRIMP exponential weighting
  const trimp = durationHours * 60 * hrReserve * 0.64 * Math.exp(1.92 * hrReserve)
  // Normalize: assume 100 TSS ≈ 1h at threshold (TRIMP ~100 at threshold)
  const thresholdHRReserve = (lthrFor(activity.sport, settings) - 60) / (settings.maxHR - 60)
  const thresholdTRIMP = 60 * thresholdHRReserve * 0.64 * Math.exp(1.92 * thresholdHRReserve)

  return Math.round((trimp / thresholdTRIMP) * 100)
}

// ─── CTL / ATL / TSB ────────────────────────────────────────────────────────

/**
 * Calculates the complete Fitness & Freshness time series.
 * CTL (Fitness) = 42-day EMA of daily TSS
 * ATL (Fatigue) = 7-day EMA of daily TSS
 * TSB (Form)    = CTL - ATL
 */
export function calculateFitnessHistory(
  activities: ActivitySummary[],
  settings: UserSettings
): FitnessPoint[] {
  if (activities.length === 0) return []

  // Build daily TSS map
  const dailyTSS: Record<string, number> = {}
  for (const act of activities) {
    const date = act.startTime.slice(0, 10)
    const tss = estimateTSS(act, settings)
    dailyTSS[date] = (dailyTSS[date] ?? 0) + tss
  }

  // Sort and fill date range
  const dates = Object.keys(dailyTSS).sort()
  if (dates.length === 0) return []

  // Días seguidos en hora local, desde la primera actividad hasta hoy
  const endDate = toLocalISODate(new Date())
  const allDates: string[] = []
  const d = parseLocalDate(dates[0])
  for (let day = dates[0]; day <= endDate; day = toLocalISODate(d)) {
    allDates.push(day)
    d.setDate(d.getDate() + 1)
  }

  // EMA calculation
  const ctlK = 2 / (42 + 1)  // 42-day EMA factor
  const atlK = 2 / (7 + 1)   // 7-day EMA factor

  let ctl = 0
  let atl = 0
  const points: FitnessPoint[] = []

  for (const date of allDates) {
    const tss = dailyTSS[date] ?? 0
    ctl = ctl + ctlK * (tss - ctl)
    atl = atl + atlK * (tss - atl)
    points.push({
      date,
      ctl: Math.round(ctl * 10) / 10,
      atl: Math.round(atl * 10) / 10,
      tsb: Math.round((ctl - atl) * 10) / 10,
      tss,
    })
  }

  return points
}

// ─── HR Zones ───────────────────────────────────────────────────────────────

export interface ZoneDef {
  zone: number
  name: string
  color: string
  minPct: number
  maxPct: number
}

export const HR_ZONE_DEFS: ZoneDef[] = [
  { zone: 1, name: 'Recuperación', color: '#22c55e', minPct: 0, maxPct: 0.6 },
  { zone: 2, name: 'Aeróbica', color: '#84cc16', minPct: 0.6, maxPct: 0.7 },
  { zone: 3, name: 'Tempo', color: '#eab308', minPct: 0.7, maxPct: 0.8 },
  { zone: 4, name: 'Umbral', color: '#f97316', minPct: 0.8, maxPct: 0.9 },
  { zone: 5, name: 'VO2max', color: '#ef4444', minPct: 0.9, maxPct: 1.0 },
]

export function getZoneBPM(maxHR: number): { zone: number; low: number; high: number }[] {
  return HR_ZONE_DEFS.map((z, i) => ({
    zone: z.zone,
    low: Math.round(maxHR * z.minPct),
    high: i === HR_ZONE_DEFS.length - 1 ? maxHR : Math.round(maxHR * z.maxPct),
  }))
}

export function hrZoneForBPM(bpm: number, maxHR: number): number {
  const pct = bpm / maxHR
  for (let i = HR_ZONE_DEFS.length - 1; i >= 0; i--) {
    if (pct >= HR_ZONE_DEFS[i].minPct) return i + 1
  }
  return 1
}

/**
 * Returns seconds spent in each zone for an activity that lacks zone data from Suunto.
 */
export function estimateZonesFromHR(
  avgHR: number,
  duration: number,
  maxHR: number
): HRZone[] {
  const zone = hrZoneForBPM(avgHR, maxHR)
  return HR_ZONE_DEFS.map((z) => ({
    zone: z.zone,
    name: z.name,
    seconds: z.zone === zone ? duration : 0,
    lowBPM: Math.round(maxHR * z.minPct),
    highBPM: Math.round(maxHR * z.maxPct),
  }))
}

// ─── Weekly / Monthly Aggregation ───────────────────────────────────────────

export interface WeekSummary {
  weekStart: string   // YYYY-MM-DD (Monday)
  totalTSS: number
  totalDistance: number
  totalDuration: number
  byType: Record<string, { distance: number; duration: number; count: number }>
}

// Lunes de la semana de una fecha, como YYYY-MM-DD en hora LOCAL.
// (toISOString() convierte a UTC y mandaba las actividades de madrugada a una semana "fantasma")
export function localWeekStart(d: Date): string {
  return toLocalISODate(new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)))
}

export interface WeeklyVo2 {
  value: number       // media de las mediciones de esa semana
  weekStart: string   // lunes de esa semana (YYYY-MM-DD)
  isCurrent: boolean  // false si se usa la última semana que tuvo mediciones
  samples: number     // nº de mediciones promediadas
}

// Media del VO2max de la semana actual; si esta semana aún no hay mediciones,
// la de la última semana que sí las tuvo.
export function weeklyVo2max(
  history: { date: string; value: number }[] | undefined,
  today: Date = new Date(),
): WeeklyVo2 | null {
  const byWeek = new Map<string, number[]>()
  for (const p of history ?? []) {
    if (!(p.value > 0)) continue
    const key = localWeekStart(new Date(`${p.date}T12:00:00`))
    byWeek.set(key, [...(byWeek.get(key) ?? []), p.value])
  }
  if (byWeek.size === 0) return null
  const currentKey = localWeekStart(today)
  const key = byWeek.has(currentKey) ? currentKey : [...byWeek.keys()].sort().at(-1)!
  const values = byWeek.get(key)!
  return {
    value: values.reduce((a, b) => a + b, 0) / values.length,
    weekStart: key,
    isCurrent: key === currentKey,
    samples: values.length,
  }
}

export function aggregateByWeek(activities: ActivitySummary[], settings: UserSettings): WeekSummary[] {
  const weeks: Record<string, WeekSummary> = {}

  for (const act of activities) {
    const weekKey = localWeekStart(new Date(act.startTime))

    if (!weeks[weekKey]) {
      weeks[weekKey] = {
        weekStart: weekKey,
        totalTSS: 0,
        totalDistance: 0,
        totalDuration: 0,
        byType: {},
      }
    }

    const w = weeks[weekKey]
    const tss = estimateTSS(act, settings)
    w.totalTSS += tss
    w.totalDistance += act.distance
    w.totalDuration += act.duration

    const sport = act.sport
    if (!w.byType[sport]) w.byType[sport] = { distance: 0, duration: 0, count: 0 }
    w.byType[sport].distance += act.distance
    w.byType[sport].duration += act.duration
    w.byType[sport].count += 1
  }

  return Object.values(weeks).sort((a, b) => a.weekStart.localeCompare(b.weekStart))
}

// ─── Personal Records ────────────────────────────────────────────────────────

export interface PR {
  distance: number   // km
  label: string
  activityId: number
  date: string
  pace: number       // sec/km
  duration: number   // seconds
  approx: boolean    // calculado con los parciales (no con las muestras)
}

// Deben coincidir con EFFORT_DISTANCES de fetch/normalizer.py (claves de bestEfforts en metros)
const RUNNING_DISTANCES = [
  { km: 1, label: '1 km' },
  { km: 5, label: '5 km' },
  { km: 10, label: '10 km' },
  { km: 21.097, label: 'Media maratón' },
  { km: 42.195, label: 'Maratón' },
]

const CYCLING_DISTANCES = [
  { km: 10, label: '10 km' },
  { km: 20, label: '20 km' },
  { km: 40, label: '40 km' },
  { km: 90, label: '90 km' },
  { km: 180, label: '180 km' },
]

/** Nombre de cada distancia de bestEfforts (clave en metros). */
export const EFFORT_LABELS: Record<string, string> = Object.fromEntries(
  [...RUNNING_DISTANCES, ...CYCLING_DISTANCES].map(d => [String(Math.round(d.km * 1000)), d.label]),
)

export function computePRs(activities: ActivitySummary[]): Record<string, PR[]> {
  const running = activities.filter(a => a.sport === 'running')
  const cycling = activities.filter(a => a.sport === 'cycling')

  return {
    running: findPRsForSport(running, RUNNING_DISTANCES),
    cycling: findPRsForSport(cycling, CYCLING_DISTANCES),
  }
}

function findPRsForSport(
  activities: ActivitySummary[],
  distances: { km: number; label: string }[]
): PR[] {
  return distances.map(({ km, label }) => {
    const key = String(Math.round(km * 1000))
    // Mejor tramo de esa distancia dentro de cada actividad (no el ritmo medio de toda ella)
    let best: PR | null = null
    for (const act of activities) {
      const secs = act.bestEfforts?.[key]
      if (!secs || (best && secs >= best.duration)) continue
      best = {
        distance: km,
        label,
        activityId: act.id,
        date: act.startTime.slice(0, 10),
        pace: Math.round(secs / km),
        duration: secs,
        approx: act.bestEffortsSource === 'laps',
      }
    }
    return best
  }).filter(Boolean) as PR[]
}

// ─── Predicción de carreras (Riegel) ─────────────────────────────────────────

export const RIEGEL_EXPONENT = 1.06

/** Tiempo (s) previsto para `toKm` a partir de un tiempo real en `fromKm` (fórmula de Riegel). */
export function riegel(fromSecs: number, fromKm: number, toKm: number): number {
  return fromSecs * Math.pow(toKm / fromKm, RIEGEL_EXPONENT)
}

export interface RacePrediction {
  label: string
  km: number
  seconds: number
  pace: number           // s/km
  fromLabel: string      // distancia de la que sale la predicción
  fromSeconds: number
  fromActivityId: number
  fromDate: string
  approx: boolean        // el tramo de origen se calculó con parciales
}

export const PREDICTION_TARGETS = [
  { km: 5, label: '5 km' },
  { km: 10, label: '10 km' },
  { km: 21.097, label: 'Media maratón' },
  { km: 42.195, label: 'Maratón' },
]

interface RecentEffort { km: number; label: string; seconds: number; activityId: number; date: string; approx: boolean }

/** Mejor tramo de cada distancia en las carreras desde `sinceDate` (y antes de `untilDate`, si se da). */
function recentRunningEfforts(activities: ActivitySummary[], sinceDate: string, untilDate?: string): RecentEffort[] {
  return RUNNING_DISTANCES.flatMap(({ km, label }) => {
    const key = String(Math.round(km * 1000))
    let best: RecentEffort | null = null
    for (const a of activities) {
      const day = a.startTime.slice(0, 10)
      if (a.sport !== 'running' || day < sinceDate || (untilDate && day >= untilDate)) continue
      const secs = a.bestEfforts?.[key]
      if (secs && (!best || secs < best.seconds)) {
        best = { km, label, seconds: secs, activityId: a.id, date: a.startTime.slice(0, 10), approx: a.bestEffortsSource === 'laps' }
      }
    }
    return best ? [best] : []
  })
}

/**
 * Predicción de 5K, 10K, media y maratón con los mejores tramos desde `sinceDate`.
 * Para cada objetivo se usa el tramo de distancia más parecida (en escala logarítmica),
 * que es la predicción más fiable; el de 1 km solo se usa si no hay otro.
 */
export function predictRaces(activities: ActivitySummary[], sinceDate: string, untilDate?: string): RacePrediction[] {
  const efforts = recentRunningEfforts(activities, sinceDate, untilDate)
  const usable = efforts.some(e => e.km >= 5) ? efforts.filter(e => e.km >= 5) : efforts
  if (usable.length === 0) return []
  return PREDICTION_TARGETS.map(({ km, label }) => {
    const src = usable.reduce((a, b) => Math.abs(Math.log(b.km / km)) < Math.abs(Math.log(a.km / km)) ? b : a)
    const seconds = Math.round(riegel(src.seconds, src.km, km))
    return {
      label, km, seconds, pace: Math.round(seconds / km),
      fromLabel: src.label, fromSeconds: src.seconds, fromActivityId: src.activityId, fromDate: src.date,
      approx: src.approx,
    }
  })
}

/**
 * Ritmo umbral estimado (s/km) = ritmo que se puede mantener ~60 min, por Riegel desde
 * el tramo reciente más largo (de 5 km o más). null si no hay datos.
 */
export function estimateThresholdPace(activities: ActivitySummary[], sinceDate: string): number | null {
  const efforts = recentRunningEfforts(activities, sinceDate).filter(e => e.km >= 5)
  if (efforts.length === 0) return null
  const src = efforts.reduce((a, b) => (b.km > a.km ? b : a))
  // distancia que se cubriría en 3600 s: D = D1 · (3600 / T1)^(1/k)
  const km = src.km * Math.pow(3600 / src.seconds, 1 / RIEGEL_EXPONENT)
  return Math.round(3600 / km)
}

// ─── Zonas de ritmo (a partir del ritmo umbral) ──────────────────────────────

export interface PaceZoneDef {
  zone: number
  name: string
  color: string
  minPct: number   // % del ritmo umbral (en tiempo por km: 100 = umbral, 120 = 20 % más lento)
  maxPct: number
}

// Zonas de ritmo de Friel simplificadas a 5: cuanto mayor el %, más lento
export const PACE_ZONE_DEFS: PaceZoneDef[] = [
  { zone: 1, name: 'Recuperación', color: '#22c55e', minPct: 129, maxPct: Infinity },
  { zone: 2, name: 'Suave', color: '#84cc16', minPct: 114, maxPct: 129 },
  { zone: 3, name: 'Tempo', color: '#eab308', minPct: 106, maxPct: 114 },
  { zone: 4, name: 'Umbral', color: '#f97316', minPct: 100, maxPct: 106 },
  { zone: 5, name: 'Intervalos', color: '#ef4444', minPct: 0, maxPct: 100 },
]

/** Zona de ritmo (1-5) de un ritmo en s/km, o null si no hay ritmo. */
export function paceZoneFor(pace: number | null, thresholdPace: number): PaceZoneDef | null {
  if (!pace || !thresholdPace) return null
  const pct = (pace / thresholdPace) * 100
  return PACE_ZONE_DEFS.find(z => pct >= z.minPct && pct < z.maxPct) ?? null
}

/** Rango de ritmos (s/km) de cada zona: `slow` null = sin límite (Z1), `fast` null = sin límite (Z5). */
export function paceZoneRanges(thresholdPace: number): { def: PaceZoneDef; fast: number | null; slow: number | null }[] {
  return PACE_ZONE_DEFS.map(def => ({
    def,
    fast: def.minPct > 0 ? Math.round(thresholdPace * def.minPct / 100) : null,
    slow: Number.isFinite(def.maxPct) ? Math.round(thresholdPace * def.maxPct / 100) : null,
  }))
}

// ─── Distribución de intensidad (80/20) ──────────────────────────────────────

/** Segundos en Z1..Z5: los del reloj si están en el resumen; si no, estimados con la FC media. */
export function zoneSecondsFor(a: ActivitySummary, maxHR: number): { seconds: number[]; real: boolean } {
  if (a.hrZoneSeconds && a.hrZoneSeconds.length === 5) return { seconds: a.hrZoneSeconds, real: true }
  if (!a.avgHR) return { seconds: [0, 0, 0, 0, 0], real: false }
  return { seconds: estimateZonesFromHR(a.avgHR, a.duration, maxHR).map(z => z.seconds), real: false }
}

export interface IntensitySplit {
  low: number    // segundos en Z1-Z2 (suave)
  mid: number    // Z3 (zona media / tempo)
  high: number   // Z4-Z5 (umbral e intervalos)
}

/** Reparte el tiempo en suave / medio / intenso (modelo de 3 zonas para el 80/20). */
export function intensitySplit(activities: ActivitySummary[], maxHR: number): IntensitySplit {
  const out = { low: 0, mid: 0, high: 0 }
  for (const a of activities) {
    const [z1, z2, z3, z4, z5] = zoneSecondsFor(a, maxHR).seconds
    out.low += z1 + z2
    out.mid += z3
    out.high += z4 + z5
  }
  return out
}

// ─── Totales por año ─────────────────────────────────────────────────────────

export interface PeriodTotals {
  km: number
  seconds: number
  runs: number
  elevation: number
}

const emptyTotals = (): PeriodTotals => ({ km: 0, seconds: 0, runs: 0, elevation: 0 })

function addTo(t: PeriodTotals, a: ActivitySummary) {
  t.km += a.distance
  t.seconds += a.duration
  t.runs += 1
  t.elevation += a.elevationGain
}

/** Totales del año entero y hasta el mismo día del año que `today` (para comparar años). */
export function yearTotals(
  activities: ActivitySummary[], year: number, today: Date = new Date(),
): { full: PeriodTotals; toDate: PeriodTotals } {
  const prefix = String(year)
  const mmdd = toLocalISODate(today).slice(5)  // "MM-DD"
  const full = emptyTotals()
  const toDate = emptyTotals()
  for (const a of activities) {
    if (!a.startTime.startsWith(prefix)) continue
    addTo(full, a)
    if (a.startTime.slice(5, 10) <= mmdd) addTo(toDate, a)
  }
  return { full, toDate }
}

/** Km por mes (índice 0 = enero) de un año. */
export function monthlyKm(activities: ActivitySummary[], year: number): number[] {
  const km = Array(12).fill(0)
  const prefix = String(year)
  for (const a of activities) {
    if (a.startTime.startsWith(prefix)) km[Number(a.startTime.slice(5, 7)) - 1] += a.distance
  }
  return km.map(v => +v.toFixed(1))
}

// ─── Forma prevista con el plan del entrenador ───────────────────────────────

/**
 * Continúa la serie CTL/ATL/TSB día a día desde el último punto (hoy) con el TSS planificado
 * de cada día futuro (`plannedTss`, YYYY-MM-DD → TSS; los días sin plan cuentan 0).
 */
export function projectFitness(
  history: FitnessPoint[], plannedTss: Record<string, number>, untilDate: string,
): FitnessPoint[] {
  const last = history.at(-1)
  if (!last || untilDate <= last.date) return []
  const ctlK = 2 / (42 + 1)
  const atlK = 2 / (7 + 1)
  let { ctl, atl } = last
  const out: FitnessPoint[] = []
  const d = parseLocalDate(last.date)
  for (;;) {
    d.setDate(d.getDate() + 1)
    const date = toLocalISODate(d)
    if (date > untilDate) break
    const tss = plannedTss[date] ?? 0
    ctl = ctl + ctlK * (tss - ctl)
    atl = atl + atlK * (tss - atl)
    out.push({
      date,
      ctl: Math.round(ctl * 10) / 10,
      atl: Math.round(atl * 10) / 10,
      tsb: Math.round((ctl - atl) * 10) / 10,
      tss,
    })
  }
  return out
}

// ─── Eficiencia a la misma FC ────────────────────────────────────────────────

export const SAME_HR_BAND = 4      // ±ppm alrededor de tu FC habitual
const SAME_HR_MIN_S = 1500          // carreras de 25 min o más
const SAME_HR_MIN_RUNS = 2          // meses con menos carreras en la banda no se muestran

export interface EfficiencyPoint {
  month: string        // YYYY-MM
  paceAtRef: number    // s/km que saldrían a refHR con la eficiencia mediana de ese mes
  runs: number
}

/**
 * Ritmo a una misma FC, por mes. Se usan las carreras de 25 min o más cuya FC media está a ±4 ppm
 * de tu FC habitual (`refHR`, la mediana de esas carreras): así se compara lo comparable sin depender
 * de las zonas del reloj. Si el ritmo a la misma FC baja, la base aeróbica mejora.
 */
export function sameHrEfficiency(
  activities: ActivitySummary[], excludeIds: Set<number> = new Set(),
): { points: EfficiencyPoint[]; refHR: number | null } {
  const runs = activities.filter(a =>
    a.sport === 'running' && !excludeIds.has(a.id) && a.duration >= SAME_HR_MIN_S && a.avgHR > 0 && a.distance > 0)
  if (runs.length === 0) return { points: [], refHR: null }
  const median = (v: number[]) => {
    const s = [...v].sort((x, y) => x - y)
    const m = Math.floor(s.length / 2)
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
  }
  const refHR = Math.round(median(runs.map(a => a.avgHR)))
  const byMonth: Record<string, number[]> = {}
  for (const a of runs) {
    if (Math.abs(a.avgHR - refHR) > SAME_HR_BAND) continue
    const ef = (a.distance * 1000) / (a.duration / 60) / a.avgHR   // m/min por pulsación
    ;(byMonth[a.startTime.slice(0, 7)] ??= []).push(ef)
  }
  const points = Object.entries(byMonth)
    .filter(([, efs]) => efs.length >= SAME_HR_MIN_RUNS)
    .sort(([x], [y]) => x.localeCompare(y))
    .map(([month, efs]) => ({ month, paceAtRef: Math.round(60000 / (median(efs) * refHR)), runs: efs.length }))
  return { points, refHR }
}

// ─── Estado de forma (TSB) ───────────────────────────────────────────────────

export const RACE_FORM_BAND = { min: -10, max: 5 }  // forma típica para competir

/** Texto y color del estado de forma, el mismo en toda la app. */
export function formState(tsb: number): { label: string; color: string } {
  if (tsb > 10) return { label: 'Descansado', color: '#86efac' }
  if (tsb > -5) return { label: 'Óptima', color: '#c5f23c' }
  if (tsb > -15) return { label: 'Entrenando fuerte', color: '#fbbf24' }
  if (tsb > -25) return { label: 'Acumulando fatiga', color: '#fb923c' }
  return { label: 'Descansa ya', color: '#f87171' }
}
