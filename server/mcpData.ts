// Datos para la API del MCP (server/mcpApi.ts): lee public/data/ y los ajustes de la app guardados en el servidor
// (server/userState.ts), y los guarda en memoria hasta que cambia algún fichero (la descarga de Suunto o un cambio de
// ajustes en la app).

import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { ActivityDetail, ActivitySummary, GlobalStats, TrainingPlan, UserSettings } from '../src/types/suunto.ts'
import { DEFAULT_SETTINGS } from '../src/types/suunto.ts'
import { readState, stateDir } from './userState.ts'

export interface AppData {
  activities: ActivitySummary[]   // de la más reciente a la más antigua
  stats: GlobalStats | null
  plan: TrainingPlan | null
  settings: UserSettings
  settingsSaved: boolean          // false = valores por defecto: la app aún no ha guardado los suyos en el servidor
}

const FILES = ['activities.json', 'stats.json', 'plan.json']
const SETTINGS_KEY = 'suunto-settings'
const MAX_IDS = 5000

const inRange = (v: unknown, min: number, max: number): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? Math.round(v) : undefined

const ids = (v: unknown): number[] | undefined =>
  Array.isArray(v) ? v.filter((x): x is number => Number.isSafeInteger(x) && x >= 0).slice(0, MAX_IDS) : undefined

/** Solo los ajustes que usan los cálculos, y solo si sus valores tienen sentido (vienen del navegador). */
export function sanitizeSettings(raw: unknown): Partial<UserSettings> {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const out: Partial<UserSettings> = {
    maxHR: inRange(s.maxHR, 100, 240),
    ftp: inRange(s.ftp, 50, 700),
    lthrRunning: inRange(s.lthrRunning, 90, 230),
    lthrCycling: inRange(s.lthrCycling, 90, 230),
    lthrSwimming: inRange(s.lthrSwimming, 90, 230),
    thresholdPace: inRange(s.thresholdPace, 120, 900),
    raceIds: ids(s.raceIds),
    notRaceIds: ids(s.notRaceIds),
    hrUnreliable: typeof s.hrUnreliable === 'boolean' ? s.hrUnreliable : undefined,
    splitSessions: typeof s.splitSessions === 'boolean' ? s.splitSessions : undefined,
  }
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined)) as Partial<UserSettings>
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

function mtime(path: string): number {
  try {
    return statSync(path).mtimeMs
  } catch {
    return 0
  }
}

let cache: { dir: string; key: string; data: AppData } | null = null

export function loadAppData(dir: string): AppData {
  const key = [...FILES.map(f => join(dir, f)), join(stateDir(dir), `${SETTINGS_KEY}.json`)].map(mtime).join('|')
  if (cache?.dir === dir && cache.key === key) return cache.data

  const rawActs = readJson(join(dir, 'activities.json'))
  const activities = (Array.isArray(rawActs) ? rawActs as ActivitySummary[] : [])
    .filter(a => a && typeof a.id === 'number' && typeof a.startTime === 'string')
    .sort((a, b) => b.startTime.localeCompare(a.startTime))
  const rawPlan = readJson(join(dir, 'plan.json')) as TrainingPlan | null
  const plan = rawPlan && Array.isArray(rawPlan.workouts) ? { ...rawPlan, events: rawPlan.events ?? [] } : null
  // lo que guarda zustand: { state: { settings: {…} }, version }
  const saved = (readState(dir, SETTINGS_KEY)?.datos as { state?: { settings?: unknown } } | undefined)?.state?.settings

  const data: AppData = {
    activities,
    stats: readJson(join(dir, 'stats.json')) as GlobalStats | null,
    plan,
    settings: { ...DEFAULT_SETTINGS, ...sanitizeSettings(saved) },
    settingsSaved: saved != null,
  }
  cache = { dir, key, data }
  return data
}

/** Detalle de una actividad, o null si no hay fichero. */
export function loadDetail(dir: string, id: number): ActivityDetail | null {
  if (!Number.isSafeInteger(id) || id < 0) return null
  const d = readJson(join(dir, `activity_${id}.json`))
  return d && typeof d === 'object' ? d as ActivityDetail : null
}
