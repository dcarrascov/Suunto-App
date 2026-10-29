// Zapatillas: km por par con aviso. Cada par tiene una etiqueta (Rodaje, Competición, Series…); las carreras van al
// par por defecto de su fecha y, en el Detalle, se puede cambiar el de un día (p. ej. la competición).
// Todo se guarda solo en este navegador (stores/shoeStore.ts).

import type { ActivitySummary } from '../types/suunto'

export interface ShoeTag {
  id: string
  name: string
}

export interface Shoe {
  id: string
  name: string
  tagId: string
  startDate: string          // YYYY-MM-DD: desde cuándo se usan
  startKm: number            // km que ya traían
  limitKm: number            // aviso al acercarse
  retiredDate: string | null // retiradas: ya no reciben carreras desde el día siguiente
}

/** Cambio del par por defecto: desde `from` (incluido) las carreras sin elegir van a `shoeId`. */
export interface DefaultChange {
  shoeId: string
  from: string
}

export interface ShoeData {
  shoes: Shoe[]
  tags: ShoeTag[]
  defaults: DefaultChange[]                  // en orden de fecha
  assignments: Record<string, string>       // id de actividad → id del par, o NONE
}

export const NONE = 'none'
export const DEFAULT_LIMIT_KM = 700
export const WARN_AT = 0.9                   // aviso al 90 % del límite

export const DEFAULT_TAGS: ShoeTag[] = [
  { id: 'rodaje', name: 'Rodaje' },
  { id: 'competicion', name: 'Competición' },
  { id: 'series', name: 'Series' },
  { id: 'tempo', name: 'Tempo' },
  { id: 'rodaje-suave', name: 'Rodaje suave' },
]

const dayOf = (a: ActivitySummary) => a.startTime.slice(0, 10)

function isActiveOn(shoe: Shoe, date: string): boolean {
  return date >= shoe.startDate && (shoe.retiredDate == null || date <= shoe.retiredDate)
}

/** Día siguiente (YYYY-MM-DD). */
function nextDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const x = new Date(y, m - 1, d + 1)
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
}

/**
 * Nueva lista de cambios al poner `shoe` por defecto: cuenta desde su estreno, pero sin pisar el cambio anterior
 * (como pronto, el día siguiente a ese cambio). Las carreras de antes siguen con el par que tenían.
 */
export function withDefault(defaults: DefaultChange[], shoe: Shoe): DefaultChange[] {
  const last = defaults.at(-1)
  if (last?.shoeId === shoe.id) return defaults
  const from = last ? [shoe.startDate, nextDay(last.from)].sort()[1] : shoe.startDate
  return [...defaults, { shoeId: shoe.id, from }]
}

/** Par por defecto en una fecha (null si no hay o está retirado). */
export function defaultShoeOn(data: ShoeData, date: string): Shoe | null {
  const change = [...data.defaults].reverse().find(d => d.from <= date)
  const shoe = change ? data.shoes.find(s => s.id === change.shoeId) : undefined
  return shoe && isActiveOn(shoe, date) ? shoe : null
}

/** Par de una actividad: el elegido a mano o, en carreras a pie, el por defecto de ese día. */
export function shoeFor(a: ActivitySummary, data: ShoeData): Shoe | null {
  const chosen = data.assignments[String(a.id)]
  if (chosen === NONE) return null
  if (chosen) return data.shoes.find(s => s.id === chosen) ?? null
  return a.sport === 'running' ? defaultShoeOn(data, dayOf(a)) : null
}

export interface ShoeUsage {
  shoe: Shoe
  km: number                 // incluidos los km de partida
  runs: number
  lastRun: string | null
  ratio: number              // km / límite
}

export function shoeUsage(activities: ActivitySummary[], data: ShoeData): ShoeUsage[] {
  const acc = new Map(data.shoes.map(s => [s.id, { km: s.startKm, runs: 0, lastRun: null as string | null }]))
  for (const a of activities) {
    const s = shoeFor(a, data)
    const u = s && acc.get(s.id)
    if (!u) continue
    u.km += a.distance
    u.runs += 1
    if (!u.lastRun || dayOf(a) > u.lastRun) u.lastRun = dayOf(a)
  }
  return data.shoes.map(shoe => {
    const u = acc.get(shoe.id)!
    return { shoe, km: u.km, runs: u.runs, lastRun: u.lastRun, ratio: shoe.limitKm > 0 ? u.km / shoe.limitKm : 0 }
  })
}

/** Pares activos que pasan del 90 % de su límite. */
export function shoesToWarn(usage: ShoeUsage[]): ShoeUsage[] {
  return usage.filter(u => u.shoe.retiredDate == null && u.ratio >= WARN_AT)
}

/** Color de la barra según lo gastadas que estén. */
export function wearColor(ratio: number): string {
  return ratio >= 1 ? '#f87171' : ratio >= WARN_AT ? '#fb923c' : ratio >= 0.75 ? '#fbbf24' : '#c5f23c'
}
