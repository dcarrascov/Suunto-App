import { describe, expect, it } from 'vitest'
import type { ActivitySummary, PlannedWorkout } from '../types/suunto'
import { DEFAULT_SETTINGS } from '../types/suunto'
import type { AiProposal } from '../stores/aiStore'
import { observedMaxHR, settingsHints } from './settingsCheck'
import { DEFAULT_TAGS, NONE, defaultShoeOn, shoeFor, shoeUsage, shoesToWarn, migrateShoes, tagNames, withDefault, type Shoe, type ShoeData } from './shoes'
import { makeBackup, readBackup, restoreBackup } from './backup'
import { plannedForWeek, weekReviewPrompt } from './aiPrompt'
import type { CustomWorkout } from './customWorkouts'

function act(over: Partial<ActivitySummary>): ActivitySummary {
  return {
    id: 1, title: 'Carrera', sport: 'running', startTime: '2026-10-12T08:00:00',
    distance: 10, duration: 2700, movingTime: 2700, elevationGain: 0, avgHR: 150, maxHR: 175,
    calories: 0, tss: 50, avgPace: 270, avgSpeed: 13.3, avgPower: null, normalizedPower: null,
    avgCadence: null, vo2max: null, aerobicTE: null, anaerobicTE: null,
    ...over,
  }
}

describe('aviso de ajustes', () => {
  const runs = Array.from({ length: 20 }, (_, i) => act({ id: i + 1, startTime: `2026-10-${String(i + 1).padStart(2, '0')}T08:00:00`, maxHR: 170 + i }))
  it('FC máxima: propone la de Suunto si se aleja 5 ppm o más; el pico raro no cuenta', () => {
    expect(observedMaxHR(runs, '2026-01-01')).toBe(188)            // percentil 98: no el 189 suelto
    const h = settingsHints({ ...DEFAULT_SETTINGS, maxHR: 185 }, { userMaxHR: 199 } as never, runs, '2026-08-01', '2026-01-01')
    expect(h.find(x => x.key === 'maxHR')).toMatchObject({ current: 185, suggested: 199, apply: 'Usar 199 ppm' })
    expect(settingsHints({ ...DEFAULT_SETTINGS, maxHR: 197 }, { userMaxHR: 199 } as never, runs, '2026-08-01', '2026-01-01')
      .some(x => x.key === 'maxHR')).toBe(false)
  })
  it('ritmo umbral: avisa con el estimado por tus marcas y se puede descartar', () => {
    const fast = [act({ id: 50, startTime: '2026-10-20T08:00:00', distance: 10, duration: 2160, bestEfforts: { '10000': 2160 } })]
    const hints = settingsHints(DEFAULT_SETTINGS, null, fast, '2026-08-01', '2026-01-01')
    const pace = hints.find(x => x.key === 'thresholdPace')
    expect(pace?.suggested).toBeLessThan(DEFAULT_SETTINGS.thresholdPace - 8)
    const dismissed = { ...DEFAULT_SETTINGS, dismissedHints: { thresholdPace: pace!.suggested } }
    expect(settingsHints(dismissed, null, fast, '2026-08-01', '2026-01-01').some(x => x.key === 'thresholdPace')).toBe(false)
  })
})

describe('zapatillas', () => {
  const shoe = (over: Partial<Shoe>): Shoe => ({ id: 'a', name: 'Diarias', tagIds: ['rodaje'], startKm: 0, limitKm: 700, retiredDate: null, ...over })
  const a = shoe({})
  const b = shoe({ id: 'b', name: 'Nuevas', tagIds: ['rodaje', 'tempo'] })
  const comp = shoe({ id: 'c', name: 'Voladoras', tagIds: ['competicion'], limitKm: 400 })
  const data = (over: Partial<ShoeData> = {}): ShoeData => ({
    shoes: [a, b, comp], tags: DEFAULT_TAGS, defaults: withDefault(withDefault([], 'a', '2026-01-01'), 'b', '2026-06-01'), assignments: {}, ...over,
  })
  it('el por defecto cambia desde el día en que lo eliges, sin tocar lo anterior', () => {
    expect(data().defaults).toEqual([{ shoeId: 'a', from: '2026-01-01' }, { shoeId: 'b', from: '2026-06-01' }])
    expect(defaultShoeOn(data(), '2026-05-31')?.id).toBe('a')
    expect(defaultShoeOn(data(), '2026-06-01')?.id).toBe('b')
    expect(defaultShoeOn(data(), '2025-12-31')).toBeNull()
    // dos cambios el mismo día: vale el último
    expect(withDefault(data().defaults, 'c', '2026-06-01')).toEqual([{ shoeId: 'a', from: '2026-01-01' }, { shoeId: 'c', from: '2026-06-01' }])
  })
  it('varias etiquetas por par y datos de antes (una etiqueta y fecha de estreno) convertidos', () => {
    expect(tagNames(b, DEFAULT_TAGS)).toBe('Rodaje, Tempo')
    expect(migrateShoes([{ id: 'x', name: 'Viejas', tagId: 'series', startDate: '2025-01-01', startKm: 5, limitKm: 700, retiredDate: null }]))
      .toEqual([{ id: 'x', name: 'Viejas', tagIds: ['series'], startKm: 5, limitKm: 700, retiredDate: null }])
    expect(migrateShoes([b])[0].tagIds).toEqual(['rodaje', 'tempo'])
  })
  it('el día de competición se cambia a mano; «sin zapatillas» y otros deportes no suman', () => {
    const race = act({ id: 7, startTime: '2026-07-05T09:00:00' })
    const d = data({ assignments: { '7': 'c', '8': NONE } })
    expect(shoeFor(race, d)?.id).toBe('c')
    expect(shoeFor(act({ id: 8, startTime: '2026-07-06T09:00:00' }), d)).toBeNull()
    expect(shoeFor(act({ id: 9, sport: 'cycling', startTime: '2026-07-06T09:00:00' }), d)).toBeNull()
  })
  it('suma los km (más los previos), avisa al 90 % y deja de sumar al retirarlas', () => {
    const acts = [
      act({ id: 1, startTime: '2026-02-01T08:00:00', distance: 300 }),
      act({ id: 2, startTime: '2026-03-01T08:00:00', distance: 200 }),
      act({ id: 3, startTime: '2026-07-01T08:00:00', distance: 15 }),
    ]
    const u = shoeUsage(acts, data({ shoes: [{ ...a, startKm: 150 }, b, comp] }))
    expect(u.find(x => x.shoe.id === 'a')).toMatchObject({ km: 650, runs: 2, lastRun: '2026-03-01' })
    expect(u.find(x => x.shoe.id === 'b')).toMatchObject({ km: 15, runs: 1 })
    expect(shoesToWarn(u).map(x => x.shoe.id)).toEqual(['a'])          // 650 / 700 = 93 %
    const retired = data({ shoes: [shoe({ retiredDate: '2026-02-15' }), comp], defaults: [{ shoeId: 'a', from: '2026-01-01' }] })
    expect(shoeUsage(acts, retired).find(x => x.shoe.id === 'a')?.km).toBe(300)
  })
})

describe('copia de seguridad', () => {
  const store = (init: Record<string, string>) => {
    const m = new Map(Object.entries(init))
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }
  }
  it('exporta las claves de la app (y nada más), la lee con un resumen y la restaura', () => {
    const src = store({
      'suunto-settings': JSON.stringify({ state: { settings: { maxHR: 190 } }, version: 0 }),
      'suunto-entrenos': JSON.stringify({ state: { workouts: [{ id: 'x' }, { id: 'y' }] }, version: 0 }),
      'suunto-zapatillas': JSON.stringify({ state: { shoes: [{ id: 'a' }] }, version: 0 }),
      'otra-cosa': 'secreto',
    })
    const backup = makeBackup(src, new Date(2026, 9, 29))
    expect(Object.keys(backup.data).sort()).toEqual(['suunto-entrenos', 'suunto-settings', 'suunto-zapatillas'])
    const r = readBackup(JSON.stringify(backup))
    if (!r.ok) throw new Error(r.error)
    expect(r.summary).toContain('Entrenos propios y de la IA del Calendario: 2')
    expect(r.summary).toContain('Zapatillas y sus km: 1 pares')
    const dst = store({ 'suunto-settings': '{}' })
    restoreBackup(r.backup, dst)
    expect(JSON.parse(dst.m.get('suunto-settings')!).state.settings.maxHR).toBe(190)
    expect(dst.m.has('otra-cosa')).toBe(false)
  })
  it('rechaza ficheros que no son una copia', () => {
    expect(readBackup('no es json')).toMatchObject({ ok: false })
    expect(readBackup(JSON.stringify({ app: 'otra', version: 1, data: {} }))).toMatchObject({ ok: false })
  })
})

describe('revisión de la semana', () => {
  const coach: PlannedWorkout = {
    id: 1, date: '2026-10-20', sport: 'running', typeName: 'Carrera', title: "RODAJE 45'", description: 'OBJETIVO: base.',
    coachComments: null, athleteComments: null, planned: { duration: 2700, distance: null, tss: 50, if: null },
    actual: null, completed: true, hasPlan: true,
  }
  const ia: AiProposal = {
    weekStart: '2026-10-26', createdAt: '', explanation: '', mode: 'free',
    workouts: [{ date: '2026-10-27', type: 'series', title: 'SERIES 6x1000', description: '', durationMin: 55, distanceKm: null, tss: 70 }],
  }
  const own: CustomWorkout = { id: 'x', date: '2026-11-03', sport: 'running', title: 'Mi rodaje', durationMin: 40, distanceKm: null, description: '' }
  it('lo planificado sale del entrenador, si no de la IA y si no de los entrenos propios', () => {
    expect(plannedForWeek('2026-10-19', [coach], [ia], [own]).kind).toBe('coach')
    expect(plannedForWeek('2026-10-26', [coach], [ia], [own])).toEqual({ kind: 'ia', lines: ['- mar 2026-10-27: SERIES 6x1000 (55 min)'] })
    expect(plannedForWeek('2026-11-02', [coach], [ia], [own]).kind).toBe('custom')
    expect(plannedForWeek('2026-11-09', [coach], [ia], [own]).kind).toBe('none')
  })
  it('el texto compara planificado y hecho, con la forma; avisa si la semana no ha terminado', () => {
    const data = {
      activities: [act({ id: 5, startTime: '2026-10-27T19:00:00', duration: 3300, distance: 12 })], stats: null,
      workouts: [], events: [], settings: DEFAULT_SETTINGS, projection: [], today: '2026-10-29',
      history: [{ date: '2026-10-28', ctl: 40, atl: 45, tsb: -5, tss: 60 }],
    }
    const p = weekReviewPrompt(data, '2026-10-26', plannedForWeek('2026-10-26', [], [ia], []))
    expect(p).toContain('la semana aún no ha terminado')
    expect(p).toContain('## Planificado (propuesta de la IA)')
    expect(p).toContain('SERIES 6x1000')
    expect(p).toContain('12,0 km')
    expect(p).toContain('Tiempo de carrera de la semana: 55 min')
    expect(p).toContain('Forma al día de hoy: Fitness 40')
  })
})
