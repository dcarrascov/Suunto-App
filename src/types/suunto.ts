export type Sport = 'running' | 'cycling' | 'swimming' | 'other'

export interface HRZone {
  zone: number
  name: string
  seconds: number
  lowBPM: number | null
  highBPM: number | null
}

export interface Lap {
  index: number
  distance: number     // km
  duration: number     // seconds
  avgHR: number | null
  avgPace: number | null  // sec/km
  avgSpeed: number | null // km/h
  avgPower: number | null // watts
  elevationGain: number
}

export interface ActivitySummary {
  id: number
  title: string
  sport: Sport
  startTime: string    // ISO local datetime
  distance: number     // km
  duration: number     // seconds
  movingTime: number   // seconds
  elevationGain: number
  avgHR: number
  maxHR: number
  calories: number
  tss: number | null
  avgPace: number | null    // sec/km (running/swim)
  avgSpeed: number | null   // km/h (cycling)
  avgPower: number | null   // watts (cycling)
  normalizedPower: number | null
  avgCadence: number | null
  vo2max: number | null
  aerobicTE: number | null
  anaerobicTE: number | null
  // Mejor tiempo (s) por distancia en metros ("1000", "5000"...): el tramo más rápido de la actividad.
  // Opcional: los datos de versiones anteriores no lo traen.
  bestEfforts?: Record<string, number> | null
  bestEffortsSource?: 'samples' | 'laps' | null  // samples = exacto · laps = aprox. con los parciales
  hrZoneSeconds?: number[] | null  // segundos en Z1..Z5 según el reloj (copia de hrZones del detalle)
  decoupling?: number | null       // % que cae velocidad/FC de la 2.ª mitad frente a la 1.ª (≥ 40 min)
  // Swimming only
  swolf?: number | null
  avgStrokesPerLength?: number | null
}

// Datos extra de la pantalla de detalle. Todos opcionales: si el reloj no los envía valen null.
export interface ActivityExtra {
  maxSpeed: number | null        // km/h
  maxPace: number | null         // s/km
  ngp: number | null             // s/km (ritmo ajustado a la pendiente)
  peakPace30s: number | null     // s/km (mejor ritmo en 30 s, 1, 3 y 5 min)
  peakPace1m: number | null
  peakPace3m: number | null
  peakPace5m: number | null
  ascent: number | null          // m
  descent: number | null         // m
  ascentTime: number | null      // s
  descentTime: number | null     // s
  minAltitude: number | null     // m
  maxAltitude: number | null     // m
  ascentSpeed: number | null     // m/min
  descentSpeed: number | null    // m/min
  minHR: number | null           // bpm
  tssMethod: string | null       // 'HR' | 'PACE' | 'MET'...
  epoc: number | null
  recoveryTime: number | null    // s
  steps: number | null
  stepCadence: number | null     // pasos/min
  maxStepCadence: number | null
  cadence: number | null         // rpm
  maxCadence: number | null
  stepLength: number | null      // cm
  strideLength: number | null    // cm
}

export interface ActivityDetail extends ActivitySummary {
  bestEffortsVersion?: number  // versión del cálculo con muestras (EFFORTS_VERSION en normalizer.py)
  extra?: ActivityExtra | null
  laps: Lap[]
  hrZones: HRZone[]
  gpxCoords: [number, number][]  // [lat, lon] pairs
  routePace?: (number | null)[] | null  // ritmo (s/km) en cada punto de gpxCoords (rutas sincronizadas a 1 Hz)
  avgStrideLength?: number | null
  trainingEffect?: number | null
}

export interface FitnessPoint {
  date: string   // YYYY-MM-DD
  ctl: number    // Chronic Training Load (Fitness)
  atl: number    // Acute Training Load (Fatigue)
  tsb: number    // Training Stress Balance (Form)
  tss: number    // TSS accumulated that day
}

export interface GlobalStats {
  totalActivities: number
  byType: Record<string, number>
  vo2maxHistory: { date: string; value: number }[]
  syncedAt: string
  userMaxHR?: number   // FC máxima según Suunto (la escribe sync.py si la cuenta la tiene)
  // Tiempo de recuperación acumulado tras el último entrenamiento (s) y cuándo terminó (ms epoch)
  recovery?: { seconds: number; endedAt: number } | null
}

// ─── TrainingPeaks (plan del entrenador) ─── espejo de normalize_tp() en fetch/tp_sync.py

export type PlanSport = 'running' | 'cycling' | 'swimming' | 'strength' | 'rest' | 'other'

export interface PlannedWorkout {
  id: number
  date: string               // YYYY-MM-DD (día local del entreno)
  sport: PlanSport
  typeName: string           // "Carrera", "Fuerza", "Descanso"...
  title: string
  description: string | null // lo que escribe el entrenador
  coachComments: string | null
  athleteComments: string | null
  planned: { duration: number | null; distance: number | null; tss: number | null; if: number | null }  // s, km
  actual: { duration: number | null; distance: number | null; tss: number | null } | null
  completed: boolean
  hasPlan: boolean           // false = entreno registrado sin plan (subido desde el reloj)
}

/** Evento del calendario de TrainingPeaks: una competición. Espejo de normalize_event() en fetch/tp_sync.py */
export interface PlannedEvent {
  id: number
  date: string               // YYYY-MM-DD
  name: string               // «15K Sevilla», «MEDIA MARATÓN DE SEVILLA»…
  type: string | null        // RunningRoad…
  priority: 'A' | 'B' | 'C' | null
  distanceKm: number | null  // de TrainingPeaks o deducida del nombre («10k», «media maratón»)
  description: string | null
  comment: string | null
}

export interface TrainingPlan {
  syncedAt: string
  workouts: PlannedWorkout[]
  events?: PlannedEvent[]    // los plan.json anteriores no lo traen
}

export interface UserSettings {
  maxHR: number
  ftp: number          // Functional Threshold Power (watts)
  lthrRunning: number  // Lactate threshold HR for running
  // Umbral de bici y natación: sin valor se deducen del de carrera (ver lthrFor en calculations.ts)
  lthrCycling?: number
  lthrSwimming?: number
  thresholdPace: number // seconds per km at threshold
  ftpDate?: string
  raceIds?: number[]      // actividades marcadas a mano como competición
  notRaceIds?: number[]   // actividades que la detección automática toma por competición y no lo son
  dismissedHints?: Record<string, number>  // avisos de ajustes descartados: clave → valor propuesto (ver settingsCheck.ts)
  // Avisos para el Entrenador IA (desactivados por defecto; ver «Entrenador IA» en Ajustes)
  hrUnreliable?: boolean   // pulso de muñeca poco fiable (sobre todo en competición): no planificar ni juzgar por pulso
  splitSessions?: boolean  // graba por separado calentamiento, parte principal y vuelta a la calma
}

export const DEFAULT_SETTINGS: UserSettings = {
  maxHR: 185,
  ftp: 250,
  lthrRunning: 165,
  thresholdPace: 270, // ~4:30/km
}
