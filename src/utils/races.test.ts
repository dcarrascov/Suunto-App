import { describe, expect, it } from 'vitest'
import type { ActivitySummary, FitnessPoint, PlannedEvent, PlannedWorkout } from '../types/suunto'
import { projectFitness, sameHrEfficiency } from './calculations'
import { findRaces, isRaceActivity, mainRunOfDay, raceActivityIds, raceDatesFromPlan, standardDistance } from './races'

function act(over: Partial<ActivitySummary>): ActivitySummary {
  return {
    id: 1, title: 'Carrera', sport: 'running', startTime: '2026-05-10T09:00:00',
    distance: 10, duration: 3000, movingTime: 3000, elevationGain: 0, avgHR: 150, maxHR: 170,
    calories: 0, tss: 50, avgPace: 300, avgSpeed: 12, avgPower: null, normalizedPower: null,
    avgCadence: null, vo2max: null, aerobicTE: null, anaerobicTE: null,
    ...over,
  }
}

function workout(over: Partial<PlannedWorkout>): PlannedWorkout {
  return {
    id: 1, date: '2026-05-09', sport: 'running', typeName: 'Carrera', title: 'ACTIVACIÓN PRECOMPETICIÓN',
    description: null, coachComments: null, athleteComments: null,
    planned: { duration: 1560, distance: 5.5, tss: 29, if: null }, actual: null, completed: true, hasPlan: true,
    ...over,
  }
}

describe('projectFitness', () => {
  const history: FitnessPoint[] = [{ date: '2026-10-17', ctl: 40, atl: 30, tsb: 10, tss: 0 }]
  it('continúa la EMA con el TSS planificado y cuenta 0 los días sin plan', () => {
    const p = projectFitness(history, { '2026-10-18': 80 }, '2026-10-19')
    expect(p.map(x => x.date)).toEqual(['2026-10-18', '2026-10-19'])
    expect(p[0].atl).toBeCloseTo(30 + (80 - 30) * 2 / 8, 1)   // 42.5
    expect(p[0].ctl).toBeCloseTo(40 + (80 - 40) * 2 / 43, 1)  // ~41.9
    expect(p[1].tss).toBe(0)
    expect(p[1].tsb).toBeCloseTo(p[1].ctl - p[1].atl, 0)
  })
  it('sin días futuros no proyecta nada', () => {
    expect(projectFitness(history, {}, '2026-10-17')).toEqual([])
  })
})

describe('sameHrEfficiency', () => {
  it('solo carreras de 25 min o más con FC a ±4 ppm de la habitual, y meses con al menos 2', () => {
    const runs = [
      act({ id: 1, startTime: '2026-08-02T08:00:00', distance: 10, duration: 3000, avgHR: 160 }),  // 5:00 a 160
      act({ id: 2, startTime: '2026-08-09T08:00:00', distance: 10, duration: 3000, avgHR: 160 }),
      act({ id: 3, startTime: '2026-09-02T08:00:00', distance: 10, duration: 2880, avgHR: 160 }),  // 4:48: mejora
      act({ id: 4, startTime: '2026-09-09T08:00:00', distance: 10, duration: 2880, avgHR: 160 }),
      act({ id: 5, startTime: '2026-09-12T08:00:00', distance: 10, duration: 2400, avgHR: 175 }),  // fuera de la banda
      act({ id: 6, startTime: '2026-10-01T08:00:00', distance: 10, duration: 3000, avgHR: 160 }),  // un solo dato en octubre
      act({ id: 7, startTime: '2026-10-02T08:00:00', distance: 3, duration: 900, avgHR: 160 }),    // menos de 25 min
    ]
    const { points, refHR } = sameHrEfficiency(runs)
    expect(refHR).toBe(160)
    expect(points.map(p => [p.month, p.paceAtRef, p.runs])).toEqual([['2026-08', 300, 2], ['2026-09', 288, 2]])
  })
  it('excluye las competiciones', () => {
    const runs = [1, 2].map(i => act({ id: i, startTime: `2026-08-0${i}T08:00:00`, avgHR: 160 }))
    expect(sameHrEfficiency(runs, new Set([1])).points).toEqual([])
  })
})

describe('competiciones', () => {
  const day = [
    act({ id: 10, startTime: '2026-05-10T08:27:00', distance: 2.0, duration: 608, avgPace: 302 }),   // calentamiento
    act({ id: 11, startTime: '2026-05-10T09:00:00', distance: 10.13, duration: 2130, avgPace: 210 }), // carrera
    act({ id: 12, startTime: '2026-05-10T09:50:00', distance: 1.0, duration: 380, avgPace: 380 }),    // vuelta a la calma
  ]
  it('la carrera es el día siguiente a la activación y la más rápida de 3 km o más', () => {
    expect(raceDatesFromPlan([workout({})])).toEqual(['2026-05-10'])
    expect(raceDatesFromPlan([workout({ title: 'SERIES PRECOMPETICION: 5X300' })])).toEqual([])
    expect(mainRunOfDay(day, '2026-05-10')?.id).toBe(11)
  })
  it('lista resultados, próximas, y respeta lo marcado a mano', () => {
    const plan = [workout({}), workout({ id: 2, date: '2026-10-17' })]
    const fitness: FitnessPoint[] = [
      { date: '2026-05-09', ctl: 40, atl: 35, tsb: 5, tss: 0 },
      { date: '2026-10-17', ctl: 40, atl: 30, tsb: 3, tss: 0 },
    ]
    const races = findRaces(day, plan, fitness, {}, '2026-10-17')
    expect(races.map(r => [r.date, r.activity?.id ?? null, r.upcoming])).toEqual([
      ['2026-10-18', null, true],
      ['2026-05-10', 11, false],
    ])
    expect(races[1].formBefore).toBe(5)
    expect(races[1].standardLabel).toBe('10 km')

    const without = findRaces(day, plan, fitness, { notRaceIds: [11] }, '2026-10-17')
    expect(without.some(r => r.activity?.id === 11)).toBe(false)
    const manual = findRaces(day, [], fitness, { raceIds: [12] }, '2026-10-17')
    expect(manual.map(r => [r.activity?.id, r.source])).toEqual([[12, 'manual']])
  })
  it('compara cada competición con la anterior a la misma distancia', () => {
    const acts = [
      act({ id: 21, startTime: '2026-04-12T09:00:00', distance: 10, duration: 2160, avgPace: 216 }),
      act({ id: 22, startTime: '2026-05-10T09:00:00', distance: 10, duration: 2130, avgPace: 213 }),
    ]
    const plan = [workout({ id: 1, date: '2026-04-11' }), workout({ id: 2, date: '2026-05-09' })]
    const races = findRaces(acts, plan, [], {}, '2026-10-17')
    expect(races.map(r => [r.activity?.id, r.vsPrevious])).toEqual([[22, -30], [21, null]])
    expect([...raceActivityIds(acts, plan, { notRaceIds: [21] })]).toEqual([22])
  })
  it('isRaceActivity distingue detección automática y manual', () => {
    expect(isRaceActivity(day[1], day, [workout({})], {})).toEqual({ race: true, auto: true })
    expect(isRaceActivity(day[1], day, [workout({})], { notRaceIds: [11] })).toEqual({ race: false, auto: true })
    expect(isRaceActivity(day[0], day, [workout({})], { raceIds: [10] })).toEqual({ race: true, auto: false })
  })
  it('distancias estándar con ±5 %', () => {
    expect(standardDistance(10.13)?.label).toBe('10 km')
    expect(standardDistance(21.3)?.label).toBe('Media maratón')
    expect(standardDistance(8)).toBeNull()
  })
})

describe('competiciones del calendario de TrainingPeaks', () => {
  const ev = (over: Partial<PlannedEvent>): PlannedEvent => ({
    id: 1, date: '2026-09-06', name: 'CARRERA DEL PUEBLO', type: 'RunningRoad', priority: null, distanceKm: null,
    description: null, comment: null, ...over,
  })
  const runs = [
    act({ id: 30, startTime: '2026-09-06T09:00:00', distance: 8.1, duration: 1700, avgPace: 210 }),
    act({ id: 31, startTime: '2026-09-06T08:20:00', distance: 2.0, duration: 600, avgPace: 300 }),
  ]
  it('los eventos son días de competición aunque no haya activación', () => {
    expect(raceDatesFromPlan([], [ev({})])).toEqual(['2026-09-06'])
  })
  it('las carreras llevan el nombre, la prioridad y salen como «event»', () => {
    const races = findRaces(runs, [], [], {}, '2026-10-28', [ev({}), ev({ id: 2, date: '2026-11-01', name: '15K Sevilla', priority: 'A', distanceKm: 15 })])
    expect(races.map(r => [r.date, r.event?.name, r.source, r.activity?.id ?? null, r.upcoming])).toEqual([
      ['2026-11-01', '15K Sevilla', 'event', null, true],
      ['2026-09-06', 'CARRERA DEL PUEBLO', 'event', 30, false],
    ])
    expect(races[0].standardLabel).toBeNull()   // 15 km no es una distancia estándar
  })
  it('sin evento, la detección por la activación sigue funcionando', () => {
    const races = findRaces(runs, [workout({ date: '2026-09-05' })], [], {}, '2026-10-28', [])
    expect(races[0]).toMatchObject({ source: 'plan', event: null })
  })
})
