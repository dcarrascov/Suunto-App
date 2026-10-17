import { describe, expect, it } from 'vitest'
import type { ActivitySummary, PlannedWorkout } from '../types/suunto'
import { compliancePct, matchPlan, planItems, planWeeks, shiftWeek, weekDays } from './plan'

function act(over: Partial<ActivitySummary>): ActivitySummary {
  return {
    id: 1, title: 'Carrera', sport: 'running', startTime: '2026-10-14T08:00:00',
    distance: 10, duration: 3000, movingTime: 3000, elevationGain: 0, avgHR: 150, maxHR: 170,
    calories: 0, tss: null, avgPace: 300, avgSpeed: 12, avgPower: null, normalizedPower: null,
    avgCadence: null, vo2max: null, aerobicTE: null, anaerobicTE: null,
    ...over,
  }
}

function plan(over: Partial<PlannedWorkout>): PlannedWorkout {
  return {
    id: 1, date: '2026-10-14', sport: 'running', typeName: 'Carrera', title: 'Rodaje',
    description: null, coachComments: null, athleteComments: null,
    planned: { duration: 3600, distance: 12, tss: 60, if: null },
    actual: null, completed: false, hasPlan: true,
    ...over,
  }
}

describe('matchPlan', () => {
  it('empareja por día y deporte, eligiendo la duración más parecida', () => {
    const acts = [
      act({ id: 10, duration: 1200 }),                       // calentamiento corto
      act({ id: 11, duration: 3500 }),                       // la sesión de verdad
      act({ id: 12, sport: 'cycling', duration: 3600 }),     // otro deporte
    ]
    const m = matchPlan([plan({ id: 1 })], acts)
    expect(m.get(1)?.id).toBe(11)
  })
  it('no usa una actividad para dos entrenos', () => {
    const m = matchPlan([plan({ id: 1, planned: { duration: 3600, distance: null, tss: null, if: null } }),
      plan({ id: 2, planned: { duration: 1800, distance: null, tss: null, if: null } })],
    [act({ id: 10, duration: 3500 })])
    expect(m.get(1)?.id).toBe(10)
    expect(m.has(2)).toBe(false)
  })
  it('los días de descanso nunca se emparejan', () => {
    expect(matchPlan([plan({ sport: 'rest' })], [act({})]).size).toBe(0)
  })
})

describe('planItems', () => {
  const today = '2026-10-15'
  it('hecho, no hecho, hoy y próximo', () => {
    const items = planItems([
      plan({ id: 1, date: '2026-10-14' }),
      plan({ id: 2, date: '2026-10-13' }),
      plan({ id: 3, date: '2026-10-15' }),
      plan({ id: 4, date: '2026-10-16' }),
      plan({ id: 5, date: '2026-10-12', completed: true, actual: { duration: 3600, distance: 12, tss: 60 } }),
    ], [act({ id: 10, startTime: '2026-10-14T08:00:00', duration: 3240 })], today)
    const status = Object.fromEntries(items.map(i => [i.workout.id, i.status]))
    expect(status).toEqual({ 1: 'done', 2: 'missed', 3: 'today', 4: 'upcoming', 5: 'done' })
    expect(items[0].compliance).toBe(90)    // 3240 / 3600
    expect(items[4].compliance).toBe(100)   // completado en TrainingPeaks sin actividad de Suunto
  })
})

describe('compliancePct', () => {
  it('usa la distancia si no hay duración planificada', () => {
    const w = plan({ planned: { duration: null, distance: 10, tss: null, if: null } })
    expect(compliancePct(w, act({ distance: 8 }))).toBe(80)
  })
})

describe('planWeeks', () => {
  it('agrupa por semana local y suma lo planificado y lo hecho', () => {
    const items = planItems([
      plan({ id: 1, date: '2026-10-12' }),             // lunes
      plan({ id: 2, date: '2026-10-18' }),             // domingo, misma semana
      plan({ id: 3, date: '2026-10-19' }),             // lunes siguiente
      plan({ id: 4, date: '2026-10-13', sport: 'rest', planned: { duration: null, distance: null, tss: null, if: null } }),
    ], [act({ id: 10, startTime: '2026-10-12T07:00:00', duration: 3600, distance: 12 })], '2026-10-20')
    const [later, first] = planWeeks(items)
    expect(later.weekStart).toBe('2026-10-19')
    expect(first.weekStart).toBe('2026-10-12')
    expect(first.planned).toBe(2)          // el descanso no cuenta como sesión
    expect(first.done).toBe(1)
    expect(first.missed).toBe(1)
    expect(first.doneKm).toBe(12)
    expect(first.plannedSeconds).toBe(7200)
  })
})

describe('weekDays / shiftWeek', () => {
  it('7 días desde el lunes y cambio de mes', () => {
    expect(weekDays('2026-09-28')).toEqual([
      '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04',
    ])
    expect(shiftWeek('2026-10-12', -1)).toBe('2026-10-05')
    expect(shiftWeek('2026-12-28', 1)).toBe('2027-01-04')
  })
})
