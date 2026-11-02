// Zapatillas: km por par con aviso. Cada par tiene una o varias etiquetas (Rodaje, Competición, Series…); las carreras
// van al par por defecto de su fecha y, en el Detalle, se puede cambiar el de un día (p. ej. la competición).
// Todo se guarda solo en este navegador (stores/shoeStore.ts).

import type { ActivitySummary } from '../types/suunto'

export interface ShoeTag {
  id: string
  name: string
}

export interface Shoe {
  id: string
  name: string
  tagIds: string[]
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

export function isRetiredOn(shoe: Shoe, date: string): boolean {
  return shoe.retiredDate != null && date > shoe.retiredDate
}

/**
 * Nueva lista de cambios al poner `shoeId` por defecto desde hoy. Las carreras de antes siguen con el par que tenían;
 * si ya se cambió hoy, ese cambio se sustituye.
 */
export function withDefault(defaults: DefaultChange[], shoeId: string, today: string): DefaultChange[] {
  const kept = defaults.filter(d => d.from < today)
  if (kept.at(-1)?.shoeId === shoeId) return kept
  return [...kept, { shoeId, from: today }]
}

/** Nombres de las etiquetas de un par, juntos («Rodaje, Tempo»). */
export function tagNames(shoe: Shoe, tags: ShoeTag[]): string {
  return shoe.tagIds.map(id => tags.find(t => t.id === id)?.name).filter(Boolean).join(', ')
}

/** Datos guardados de antes (una etiqueta `tagId` y fecha de estreno `startDate`) → formato actual. */
export function migrateShoes(shoes: unknown[]): Shoe[] {
  return shoes.map(raw => {
    const { tagId, startDate: _startDate, tagIds, ...rest } = raw as Shoe & { tagId?: string; startDate?: string }
    return { ...rest, tagIds: Array.isArray(tagIds) ? tagIds : tagId ? [tagId] : [] }
  })
}

/** Par por defecto en una fecha (null si no hay o está retirado). */
export function defaultShoeOn(data: ShoeData, date: string): Shoe | null {
  const change = [...data.defaults].reverse().find(d => d.from <= date)
  const shoe = change ? data.shoes.find(s => s.id === change.shoeId) : undefined
  return shoe && !isRetiredOn(shoe, date) ? shoe : null
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
