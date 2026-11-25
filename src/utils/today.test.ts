import { describe, expect, it } from 'vitest'
import type { AiProposal } from '../stores/aiStore'
import type { PlannedWorkout } from '../types/suunto'
import type { CustomWorkout } from './customWorkouts'
import type { PlanItem } from './plan'
import { clockTime, daysUntil, sessionsForDay } from './today'

const coachItem = (date: string, title: string, status: PlanItem['status'] = 'upcoming'): PlanItem => ({
  workout: {
    id: 1, date, sport: 'running', typeName: 'Carrera', title, description: null, coachComments: null,
    athleteComments: null, planned: { duration: 3900, distance: null, tss: 70, if: null }, actual: null,
    completed: false, hasPlan: true,
  } satisfies PlannedWorkout,
  activity: null, status, compliance: null,
})
const custom: CustomWorkout = { id: 'c1', date: '2026-12-01', sport: 'running', title: 'Mi rodaje', durationMin: 40, distanceKm: 8, description: '' }
const proposal: AiProposal = {
  weekStart: '2026-11-30', createdAt: 'x', explanation: '',
  workouts: [
    { date: '2026-11-30', type: 'descanso', title: 'Descanso', description: '', durationMin: null, distanceKm: null, tss: null },
    { date: '2026-12-01', type: 'series', title: 'Series', description: '', durationMin: 60, distanceKm: null, tss: null },
    { date: '2026-12-02', type: 'rodaje', title: 'Rodaje suave', description: '', durationMin: 45, distanceKm: null, tss: 40 },
  ],
}

describe('sessionsForDay', () => {
  it('manda lo del entrenador', () => {
    const r = sessionsForDay('2026-12-02', [coachItem('2026-12-02', 'Tempo', 'done')], [custom], proposal, new Set())
    expect(r).toEqual([{ key: 'coach-1', title: 'Tempo', detail: '1h 05m · 70 TSS', minutes: 65, done: true, source: 'coach' }])
  })
  it('sin entrenador ese día: tus entrenos antes que la propuesta de la IA', () => {
    const r = sessionsForDay('2026-12-01', [coachItem('2026-12-02', 'Tempo')], [custom], proposal, new Set(['2026-12-01']))
    expect(r.map(s => [s.source, s.title, s.done])).toEqual([['custom', 'Mi rodaje', true]])
  })
  it('si no hay nada más, la propuesta de la IA (sin los descansos)', () => {
    expect(sessionsForDay('2026-12-02', [], [], proposal, new Set())[0]).toMatchObject({ source: 'ia', title: 'Rodaje suave', detail: '45:00 · 40 TSS' })
    expect(sessionsForDay('2026-11-30', [], [], proposal, new Set())).toEqual([])
  })
})

describe('clockTime', () => {
  it('formato de cronómetro', () => {
    expect(clockTime(3900)).toBe('1:05:00')
    expect(clockTime(2700)).toBe('45:00')
    expect(clockTime(59)).toBe('0:59')
  })
})

describe('daysUntil', () => {
  it('cuenta días de calendario, también al cambiar de mes y de hora', () => {
    expect(daysUntil('2026-12-06', '2026-11-25')).toBe(11)
    expect(daysUntil('2026-11-25', '2026-11-25')).toBe(0)
    expect(daysUntil('2027-03-29', '2027-03-27')).toBe(2)
  })
})
