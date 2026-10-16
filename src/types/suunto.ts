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
  extra?: ActivityExtra | null
  laps: Lap[]
  hrZones: HRZone[]
  gpxCoords: [number, number][]  // [lat, lon] pairs
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
  // Tiempo de recuperación acumulado tras el último entrenamiento (s) y cuándo terminó (ms epoch)
  recovery?: { seconds: number; endedAt: number } | null
}

export interface UserSettings {
  maxHR: number
  ftp: number          // Functional Threshold Power (watts)
  lthrRunning: number  // Lactate threshold HR for running
  thresholdPace: number // seconds per km at threshold
  ftpDate?: string
}

export const DEFAULT_SETTINGS: UserSettings = {
  maxHR: 185,
  ftp: 250,
  lthrRunning: 165,
  thresholdPace: 270, // ~4:30/km
}
