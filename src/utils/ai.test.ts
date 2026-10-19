import { describe, expect, it } from 'vitest'
import type { ActivitySummary, PlannedWorkout } from '../types/suunto'
import { DEFAULT_SETTINGS } from '../types/suunto'
import { coachStats, sessionType } from './coach'
import { coachProfilePrompt, questionPrompt, weekPrompt } from './aiPrompt'
import type { AthleteData } from './aiPrompt'
import { compareWeek, parseProposal } from './aiProposal'

function workout(over: Partial<PlannedWorkout>): PlannedWorkout {
  return {
    id: 1, date: '2026-10-12', sport: 'running', typeName: 'Carrera', title: "RODAJE 45'",
    description: 'OBJETIVO: base aeróbica.', coachComments: null, athleteComments: null,
    planned: { duration: 2700, distance: 9, tss: 50, if: null }, actual: null, completed: true, hasPlan: true,
    ...over,
  }
}

function act(over: Partial<ActivitySummary>): ActivitySummary {
  return {
    id: 1, title: 'Carrera', sport: 'running', startTime: '2026-10-12T08:00:00',
    distance: 9, duration: 2700, movingTime: 2700, elevationGain: 0, avgHR: 160, maxHR: 175,
    calories: 0, tss: 50, avgPace: 300, avgSpeed: 12, avgPower: null, normalizedPower: null,
    avgCadence: null, vo2max: null, aerobicTE: null, anaerobicTE: null,
    ...over,
  }
}

describe('sessionType', () => {
  it('clasifica los títulos del entrenador', () => {
    const t = (title: string, sport: PlannedWorkout['sport'] = 'running') => sessionType({ title, sport })
    expect(t("RODAJE 45'")).toBe('rodaje')
    expect(t("RODAJE PROGRESIVO 50'")).toBe('progresivo')
    expect(t('RECTAS 5x20"')).toBe('rectas')
    expect(t('SERIES LT2 4x6\' R2\'')).toBe('series')
    expect(t('SERIES ENTRE UMBRALES 3x10\'')).toBe('series')
    expect(t('SERIES EN CUESTA 8×150m')).toBe('cuestas')
    expect(t("CAMBIOS 3'-2'-1' x 3")).toBe('cambios')
    expect(t('ACTIVACIÓN PRECOMPETICIÓN')).toBe('activacion')
    expect(t('SERIES PRECOMPETICION: 5X300 3x1000')).toBe('series')
    expect(t('FUERZA PIERNAS', 'strength')).toBe('fuerza')
    expect(t('CORE')).toBe('fuerza')
    expect(t('NATACIÓN LIBRE', 'swimming')).toBe('natacion')
    expect(t('Descanso', 'rest')).toBe('descanso')
  })
})

describe('coachStats', () => {
  it('cuenta por día de la semana y saca los días antes de cada carrera', () => {
    const ws = [
      workout({ id: 1, date: '2026-10-12', title: "RODAJE 45'" }),                      // lunes
      workout({ id: 2, date: '2026-10-14', title: 'SERIES LT2 4x6\'' }),                // miércoles
      workout({ id: 3, date: '2026-10-17', title: 'ACTIVACIÓN PRECOMPETICIÓN' }),        // sábado → carrera el domingo
    ]
    const s = coachStats(ws)
    expect(s.weeks).toBe(1)
    expect(s.avgSessions).toBe(3)
    expect(s.byWeekday[0]).toEqual({ rodaje: 1 })
    expect(s.byWeekday[2]).toEqual({ series: 1 })
    expect(s.preRace[0].date).toBe('2026-10-18')
    expect(s.preRace[0].days.at(-1)).toEqual({ offset: -1, types: ['activacion'] })
  })
})

describe('textos para Gemini', () => {
  const data = (): AthleteData => ({
    activities: [act({ id: 1, startTime: '2026-10-05T08:00:00' }), act({ id: 2, startTime: '2026-10-13T08:00:00', distance: 12 })],
    stats: null,
    workouts: [
      workout({ id: 1, date: '2026-10-05', title: "RODAJE 40'" }),
      workout({ id: 2, date: '2026-10-13', title: 'SERIES SECRETAS 7x700' }),   // semana objetivo de la prueba
      workout({ id: 3, date: '2026-10-21', title: 'TIRADA FUTURA 90\'' }),       // posterior
    ],
    settings: DEFAULT_SETTINGS,
    history: [{ date: '2026-10-16', ctl: 40, atl: 30, tsb: 10, tss: 0 }],
    projection: [],
    today: '2026-10-17',
  })

  it('la semana de prueba no contiene el plan de esa semana ni posterior, ni actividades de esa semana', () => {
    const p = weekPrompt(data(), '2026-10-12', 'PERFIL SECRETO')
    expect(p).toContain("RODAJE 40'")             // la semana anterior sí, como ejemplo
    expect(p).not.toContain('SERIES SECRETAS')    // la de la semana pedida, no
    expect(p).not.toContain('TIRADA FUTURA')
    expect(p).not.toContain('PERFIL SECRETO')     // el perfil se hizo con todas las semanas: fuera en pruebas
    expect(p).not.toContain('12,0 km')            // la actividad del martes de esa semana, tampoco
  })
  it('una semana futura usa el perfil pero tampoco ve el plan de esa semana', () => {
    const p = weekPrompt(data(), '2026-10-19', 'PERFIL GUARDADO')
    expect(p).toContain('PERFIL GUARDADO')
    expect(p).toContain('SERIES SECRETAS')        // es anterior a la semana pedida
    expect(p).not.toContain('TIRADA FUTURA')
  })
  it('nunca incluye rutas GPS y sí avisa del pulso poco fiable', () => {
    const q = questionPrompt(data(), '¿Cómo voy?')
    expect(q).not.toMatch(/gpxCoords|routePace|\[\s*-?\d+\.\d{4,},/)
    expect(q).toContain('pulso es de muñeca')
    expect(q).toContain('¿Cómo voy?')
  })
  it('el análisis del entrenador lleva sus descripciones literales', () => {
    expect(coachProfilePrompt(data().workouts)).toContain('OBJETIVO: base aeróbica.')
  })
})

describe('parseProposal', () => {
  const answer = (entrenos: string) => `Aquí tienes:\n\`\`\`json\n{"semana":"2026-10-19","explicacion":"Semana tipo.","entrenos":[${entrenos}]}\n\`\`\`\nSuerte.`
  it('lee el bloque json con texto alrededor y comas decimales', () => {
    const r = parseProposal(answer(
      '{"fecha":"2026-10-19","tipo":"rodaje","titulo":"RODAJE 45\'","descripcion":"OBJETIVO: x","duracion_min":45,"distancia_km":"9,5","tss":50},' +
      '{"fecha":"2026-10-20","tipo":"inventado","titulo":"RECTAS 6x20\\"","duracion_min":"40"}',
    ), '2026-10-19')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.proposal.workouts[0]).toMatchObject({ type: 'rodaje', distanceKm: 9.5, durationMin: 45, tss: 50 })
    expect(r.proposal.workouts[1]).toMatchObject({ type: 'rectas', durationMin: 40, distanceKm: null })  // tipo deducido del título
    expect(r.proposal.explanation).toBe('Semana tipo.')
  })
  it('rechaza fechas fuera de la semana, JSON roto o sin entrenos', () => {
    expect(parseProposal(answer('{"fecha":"2026-10-30","titulo":"X"}'), '2026-10-19').ok).toBe(false)
    expect(parseProposal('```json\n{"entrenos": [ \n```', '2026-10-19').ok).toBe(false)
    expect(parseProposal('no hay nada', '2026-10-19').ok).toBe(false)
    expect(parseProposal(answer(''), '2026-10-19').ok).toBe(false)
  })
})

describe('compareWeek', () => {
  const coach = [
    workout({ id: 1, date: '2026-10-19', title: "RODAJE 45'", planned: { duration: 2700, distance: 9, tss: 50, if: null } }),
    workout({ id: 2, date: '2026-10-21', title: 'SERIES LT2 4x6\'', planned: { duration: 3600, distance: 12, tss: 80, if: null } }),
  ]
  it('100 % si coinciden días, familias y volumen; los días vacíos cuentan como descanso', () => {
    const same = parseProposal('{"entrenos":[' +
      '{"fecha":"2026-10-19","tipo":"progresivo","titulo":"RODAJE PROGRESIVO","duracion_min":45,"distancia_km":9},' +
      '{"fecha":"2026-10-21","tipo":"cuestas","titulo":"CUESTAS","duracion_min":60,"distancia_km":12}]}', '2026-10-19')
    if (!same.ok) throw new Error(same.error)
    const c = compareWeek(same.proposal, coach)
    expect(c.typeScore).toBe(1)        // progresivo ≈ rodaje (suave), cuestas ≈ series (calidad)
    expect(c.total).toBe(100)
  })
  it('baja si cambia el día de la calidad y el volumen', () => {
    const other = parseProposal('{"entrenos":[' +
      '{"fecha":"2026-10-19","tipo":"rodaje","titulo":"RODAJE","duracion_min":45,"distancia_km":9},' +
      '{"fecha":"2026-10-22","tipo":"series","titulo":"SERIES","duracion_min":90,"distancia_km":18}]}', '2026-10-19')
    if (!other.ok) throw new Error(other.error)
    const c = compareWeek(other.proposal, coach)
    expect(c.days[2].score).toBe(0)    // miércoles: calidad frente a descanso
    expect(c.days[3].score).toBe(0)    // jueves: descanso frente a calidad
    expect(c.typeScore).toBeCloseTo(5 / 7, 5)
    expect(c.total).toBeLessThan(75)
  })
})
