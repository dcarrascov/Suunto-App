import { describe, expect, it } from 'vitest'
import type { ActivitySummary, PlannedWorkout } from '../types/suunto'
import { DEFAULT_SETTINGS } from '../types/suunto'
import { DEFAULT_FREE_GOAL, type AiProposal, type FreeGoal } from '../stores/aiStore'
import { freePhase, freeWeekPrompt, recentRunningLoad, weeksToRace } from './aiPrompt'
import type { AthleteData } from './aiPrompt'
import { freeWeekOptions, goalForKm } from './freePlan'
import { proposalKey, proposalToCustom } from './customWorkouts'

function act(over: Partial<ActivitySummary>): ActivitySummary {
  return {
    id: 1, title: 'Carrera', sport: 'running', startTime: '2026-10-12T08:00:00',
    distance: 9, duration: 2700, movingTime: 2700, elevationGain: 0, avgHR: 160, maxHR: 175,
    calories: 0, tss: 50, avgPace: 300, avgSpeed: 12, avgPower: null, normalizedPower: null,
    avgCadence: null, vo2max: null, aerobicTE: null, anaerobicTE: null,
    ...over,
  }
}

const coachWorkout: PlannedWorkout = {
  id: 9, date: '2026-10-20', sport: 'running', typeName: 'Carrera', title: 'SERIES SECRETAS DEL COACH',
  description: null, coachComments: null, athleteComments: null,
  planned: { duration: 3600, distance: null, tss: 70, if: null }, actual: null, completed: false, hasPlan: true,
}

const data = (activities: ActivitySummary[]): AthleteData => ({
  activities, stats: null, workouts: [coachWorkout], events: [], settings: DEFAULT_SETTINGS,
  history: [{ date: '2026-10-27', ctl: 40, atl: 35, tsb: 5, tss: 0 }], projection: [], today: '2026-10-29',
})

const goal = (over: Partial<FreeGoal> = {}): FreeGoal => ({ ...DEFAULT_FREE_GOAL, distance: '10k', raceDate: '2026-12-13', ...over })

describe('plan sin entrenador: fechas y fases', () => {
  it('semanas hasta la carrera y fase de cada una', () => {
    expect(weeksToRace('2026-11-02', '2026-12-13')).toBe(5)       // la carrera es el domingo de la semana del 7 dic
    expect(weeksToRace('2026-12-07', '2026-12-13')).toBe(0)
    expect(freePhase(goal(), '2026-12-07')).toBe('SEMANA DE LA CARRERA')
    expect(freePhase(goal(), '2026-11-30')).toContain('afinado')
    expect(freePhase(goal({ distance: '42k' }), '2026-11-23')).toContain('afinado')   // el maratón afina 3 semanas
    expect(freePhase(goal(), '2026-11-02')).toContain('específico')
    expect(freePhase(goal({ distance: 'none', raceDate: null }), '2026-11-02')).toContain('sin carrera')
  })
  it('semanas a elegir: hasta la de la carrera (máx. 16) o 8 sin carrera', () => {
    const w = freeWeekOptions(goal(), '2026-10-26')
    expect(w[0]).toBe('2026-10-26')
    expect(w.at(-1)).toBe('2026-12-07')
    expect(freeWeekOptions(goal({ raceDate: '2027-12-01' }), '2026-10-26')).toHaveLength(16)
    expect(freeWeekOptions(goal({ distance: 'none' }), '2026-10-26')).toHaveLength(8)
  })
  it('la distancia del objetivo sale de la de la competición', () => {
    expect([goalForKm(5), goalForKm(10), goalForKm(15), goalForKm(21.097), goalForKm(42.195), goalForKm(null)])
      .toEqual(['5k', '10k', '10k', '21k', '42k', '10k'])
  })
})

describe('plan sin entrenador: texto para Gemini', () => {
  const runs = [
    act({ id: 1, startTime: '2026-10-06T08:00:00', duration: 3000 }),
    act({ id: 2, startTime: '2026-10-13T08:00:00', duration: 3600 }),
    act({ id: 3, startTime: '2026-10-20T08:00:00', duration: 4200 }),
    act({ id: 4, startTime: '2026-10-27T08:00:00', duration: 4800 }),
  ]
  it('con datos: carga real reciente, zonas de ritmo, objetivo y reglas; nunca el plan del entrenador', () => {
    expect(recentRunningLoad(runs, '2026-11-02')).toEqual({ avgMin: 65, longestMin: 80, weeks: [50, 60, 70, 80] })
    const p = freeWeekPrompt(data(runs), '2026-11-02', goal({ daysPerWeek: 5, longRunDay: 6 }))
    expect(p).toContain('SIN entrenador')
    expect(p).toContain('Objetivo: 10 km, el dom 2026-12-13')
    expect(p).toContain('Exactamente 5 días con sesión')
    expect(p).toContain('tirada larga preferida el domingo')
    expect(p).toContain('media 65 min')
    expect(p).toContain('Zonas de ritmo')
    expect(p).toContain('el pulso, solo como referencia secundaria')
    expect(freeWeekPrompt({ ...data(runs), settings: { ...DEFAULT_SETTINGS, hrUnreliable: true } }, '2026-11-02', goal())).toContain('nunca por pulso')
    expect(p).not.toContain('SERIES SECRETAS DEL COACH')
  })
  it('sin datos: usa el nivel y pide RPE', () => {
    const p = freeWeekPrompt(data([]), '2026-11-02', goal({ level: 'nuevo', hoursPerWeek: 1.5 }))
    expect(p).toContain('sin datos de reloj')
    expect(p).toContain('empieza a correr')
    expect(p).toContain('unas 1.5 h a la semana')
    expect(p).toContain('RPE')
  })
  it('continúa la progresión desde la semana anterior del plan', () => {
    const prev: AiProposal = {
      weekStart: '2026-10-26', createdAt: '', explanation: '', mode: 'free',
      workouts: [
        { date: '2026-10-27', type: 'rodaje', title: "RODAJE 50'", description: '', durationMin: 50, distanceKm: null, tss: 40 },
        { date: '2026-11-01', type: 'rodaje', title: "TIRADA 70'", description: '', durationMin: 70, distanceKm: null, tss: 60 },
      ],
    }
    const p = freeWeekPrompt(data(runs), '2026-11-02', goal(), [prev])
    expect(p).toContain('### Semana del 2026-10-26 · 120 min')
    expect(p).toContain('120 min (la semana anterior de este plan)')
  })
  it('la semana de la carrera pide la competición ese día', () => {
    const p = freeWeekPrompt(data(runs), '2026-12-07', goal({ raceName: 'MEDIA DE SEVILLA', distance: '21k' }))
    expect(p).toContain('Fase de esta semana: SEMANA DE LA CARRERA')
    expect(p).toContain('"tipo": "competicion"')
    expect(p).toContain('«MEDIA DE SEVILLA»')
  })
})

describe('propuestas al Calendario', () => {
  const proposal: AiProposal = {
    weekStart: '2026-11-02', createdAt: '', explanation: '', mode: 'free',
    workouts: [
      { date: '2026-11-02', type: 'descanso', title: 'Descanso', description: '', durationMin: null, distanceKm: null, tss: null },
      { date: '2026-11-03', type: 'series', title: 'SERIES 6x1000', description: 'OBJETIVO: umbral', durationMin: 55.4, distanceKm: 10.456, tss: 70 },
      { date: '2026-11-05', type: 'fuerza', title: 'FUERZA', description: '', durationMin: 30, distanceKm: null, tss: 20 },
    ],
  }
  it('copia las sesiones (sin los descansos), con la etiqueta IA y la clave de la propuesta', () => {
    const list = proposalToCustom(proposal)
    expect(list).toHaveLength(2)
    expect(list[0]).toEqual({
      date: '2026-11-03', sport: 'running', title: 'SERIES 6x1000', durationMin: 55, distanceKm: 10.46,
      description: 'OBJETIVO: umbral', source: 'ia', proposalKey: 'free:2026-11-02',
    })
    expect(list[1].sport).toBe('other')
    expect(proposalKey({ weekStart: '2026-11-02' })).toBe('coach:2026-11-02')   // las antiguas, sin modo, son del entrenador
  })
})
