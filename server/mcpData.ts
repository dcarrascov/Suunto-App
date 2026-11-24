// Datos para la API del MCP (server/mcpApi.ts): lee public/data/ y la copia de los ajustes de la app, y los guarda en
// memoria hasta que cambia algún fichero (la descarga de Suunto o la app al guardar ajustes).

import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { ActivityDetail, ActivitySummary, GlobalStats, TrainingPlan, UserSettings } from '../src/types/suunto.ts'
import { DEFAULT_SETTINGS } from '../src/types/suunto.ts'
import { sanitizeSettings, SETTINGS_FILE } from './settingsSync.ts'

export interface AppData {
  activities: ActivitySummary[]   // de la más reciente a la más antigua
  stats: GlobalStats | null
  plan: TrainingPlan | null
  settings: UserSettings
  settingsSaved: boolean          // false = valores por defecto: la app aún no ha mandado los suyos
}

const FILES = ['activities.json', 'stats.json', 'plan.json', SETTINGS_FILE]

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
  const key = FILES.map(f => mtime(join(dir, f))).join('|')
  if (cache?.dir === dir && cache.key === key) return cache.data

  const rawActs = readJson(join(dir, 'activities.json'))
  const activities = (Array.isArray(rawActs) ? rawActs as ActivitySummary[] : [])
    .filter(a => a && typeof a.id === 'number' && typeof a.startTime === 'string')
    .sort((a, b) => b.startTime.localeCompare(a.startTime))
  const rawPlan = readJson(join(dir, 'plan.json')) as TrainingPlan | null
  const plan = rawPlan && Array.isArray(rawPlan.workouts) ? { ...rawPlan, events: rawPlan.events ?? [] } : null
  const saved = readJson(join(dir, SETTINGS_FILE))

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
