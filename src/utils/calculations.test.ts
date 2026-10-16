import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ActivitySummary, UserSettings } from '../types/suunto'
import { DEFAULT_SETTINGS } from '../types/suunto'
import {
  aggregateByWeek, calculateFitnessHistory, computePRs, estimateTSS, estimateThresholdPace,
  intensitySplit, localWeekStart, lthrFor, monthlyKm, paceZoneFor, paceZoneRanges, predictRaces,
  riegel, weeklyVo2max, yearTotals, zoneSecondsFor,
} from './calculations'

// Actividad mínima válida; cada test cambia lo que necesita
function act(over: Partial<ActivitySummary> = {}): ActivitySummary {
  return {
    id: 1, title: 'Carrera', sport: 'running', startTime: '2026-05-10T09:00:00',
    distance: 10, duration: 3000, movingTime: 3000, elevationGain: 50,
    avgHR: 150, maxHR: 170, calories: 600, tss: null, avgPace: 300, avgSpeed: 12,
    avgPower: null, normalizedPower: null, avgCadence: 180, vo2max: null,
    aerobicTE: null, anaerobicTE: null,
    ...over,
  }
}

const settings: UserSettings = { ...DEFAULT_SETTINGS, maxHR: 190, lthrRunning: 170 }

afterEach(() => { vi.useRealTimers() })

// ─── Semanas en hora local ───────────────────────────────────────────────────

describe('localWeekStart', () => {
  it('el domingo por la noche sigue siendo la semana que empezó el lunes anterior', () => {
    expect(localWeekStart(new Date(2026, 9, 18, 23, 30))).toBe('2026-10-12')
  })
  it('el lunes de madrugada ya es la semana nueva', () => {
    expect(localWeekStart(new Date(2026, 9, 19, 0, 10))).toBe('2026-10-19')
  })
  it('cruza el cambio de año', () => {
    expect(localWeekStart(new Date(2026, 0, 1, 12))).toBe('2025-12-29')
  })
})

describe('aggregateByWeek', () => {
  it('agrupa por semana local y suma distancia y deporte', () => {
    const weeks = aggregateByWeek([
      act({ id: 1, startTime: '2026-10-12T07:00:00', distance: 10, tss: 50 }),
      act({ id: 2, startTime: '2026-10-18T23:30:00', distance: 5, tss: 30 }),
      act({ id: 3, startTime: '2026-10-19T00:10:00', distance: 8, tss: 40 }),
    ], settings)
    expect(weeks.map(w => w.weekStart)).toEqual(['2026-10-12', '2026-10-19'])
    expect(weeks[0].totalDistance).toBe(15)
    expect(weeks[0].totalTSS).toBe(80)
    expect(weeks[0].byType.running.count).toBe(2)
  })
})

// ─── TSS ─────────────────────────────────────────────────────────────────────

describe('estimateTSS', () => {
  it('usa el TSS de Suunto si existe', () => {
    expect(estimateTSS(act({ tss: 87 }), settings)).toBe(87)
  })
  it('sin pulso asume ~30 TSS por hora (nunca negativo)', () => {
    expect(estimateTSS(act({ avgHR: 0, movingTime: 7200 }), settings)).toBe(60)
  })
  it('1 h justo en el umbral de carrera = 100 TSS', () => {
    expect(estimateTSS(act({ avgHR: 170, movingTime: 3600 }), settings)).toBe(100)
  })
  it('en bici el umbral por defecto es 5 bpm menor que corriendo', () => {
    expect(lthrFor('cycling', settings)).toBe(165)
    expect(estimateTSS(act({ sport: 'cycling', avgHR: 165, movingTime: 3600 }), settings)).toBe(100)
  })
  it('respeta el umbral fijado a mano', () => {
    const s = { ...settings, lthrSwimming: 150 }
    expect(lthrFor('swimming', s)).toBe(150)
    expect(lthrFor('swimming', settings)).toBe(160)
    expect(lthrFor('other', settings)).toBe(170)
  })
})

describe('calculateFitnessHistory', () => {
  it('rellena los días sin actividad hasta hoy y aplica la EMA', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 3, 12))
    const points = calculateFitnessHistory([act({ startTime: '2026-10-01T08:00:00', tss: 43 })], settings)
    expect(points.map(p => p.date)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03'])
    expect(points[0].ctl).toBe(2)       // 43 · 2/43
    expect(points[0].atl).toBe(10.8)    // 43 · 2/8 = 10.75
    expect(points[1].tss).toBe(0)
  })
})

// ─── Récords y predicción ────────────────────────────────────────────────────

describe('computePRs', () => {
  it('usa el mejor tramo, no el ritmo medio de la actividad', () => {
    const prs = computePRs([
      // ritmo medio flojo, pero con un 5 km muy rápido dentro
      act({ id: 1, distance: 15, avgPace: 330, bestEfforts: { '1000': 200, '5000': 1050 }, bestEffortsSource: 'samples' }),
      act({ id: 2, distance: 5.1, avgPace: 215, bestEfforts: { '5000': 1080 }, bestEffortsSource: 'laps' }),
    ])
    const five = prs.running.find(p => p.label === '5 km')!
    expect(five.activityId).toBe(1)
    expect(five.duration).toBe(1050)
    expect(five.pace).toBe(210)
    expect(five.approx).toBe(false)
    expect(prs.running.find(p => p.label === '10 km')).toBeUndefined()
  })
  it('marca como aproximado lo calculado con parciales', () => {
    const prs = computePRs([act({ bestEfforts: { '1000': 210 }, bestEffortsSource: 'laps' })])
    expect(prs.running[0].approx).toBe(true)
  })
})

describe('riegel', () => {
  it('misma distancia = mismo tiempo; el doble de distancia algo más del doble de tiempo', () => {
    expect(riegel(1200, 5, 5)).toBe(1200)
    expect(riegel(1200, 5, 10)).toBeCloseTo(1200 * 2 ** 1.06, 6)
  })
})

describe('predictRaces', () => {
  const recent = [
    act({ id: 1, startTime: '2026-09-01T08:00:00', bestEfforts: { '1000': 180, '5000': 1050, '10000': 2200 } }),
    act({ id: 2, startTime: '2025-01-01T08:00:00', bestEfforts: { '10000': 2000 } }),  // antiguo: no cuenta
  ]
  it('usa solo tramos desde la fecha indicada y el de distancia más parecida', () => {
    const p = predictRaces(recent, '2026-07-01')
    const byLabel = Object.fromEntries(p.map(x => [x.label, x]))
    expect(byLabel['5 km'].seconds).toBe(1050)            // tu propio 5 km
    expect(byLabel['10 km'].seconds).toBe(2200)
    expect(byLabel['Media maratón'].fromLabel).toBe('10 km')
    expect(byLabel['Media maratón'].seconds).toBe(Math.round(riegel(2200, 10, 21.097)))
  })
  it('sin tramos recientes no predice nada', () => {
    expect(predictRaces(recent, '2027-01-01')).toEqual([])
  })
})

describe('estimateThresholdPace', () => {
  it('es el ritmo que daría 60 minutos según Riegel', () => {
    const pace = estimateThresholdPace([act({ bestEfforts: { '10000': 2400 } })], '2026-01-01')!
    // con ese ritmo se tardarían ~3600 s en la distancia correspondiente
    const km = 3600 / pace
    expect(riegel(2400, 10, km)).toBeGreaterThan(3550)
    expect(riegel(2400, 10, km)).toBeLessThan(3650)
    expect(pace).toBeGreaterThan(240)  // más lento que el ritmo de 10 km (4:00)
  })
})

// ─── Zonas de ritmo ──────────────────────────────────────────────────────────

describe('paceZoneFor', () => {
  const T = 240  // umbral 4:00 /km
  it('clasifica por % del ritmo umbral', () => {
    expect(paceZoneFor(230, T)?.zone).toBe(5)   // más rápido que el umbral
    expect(paceZoneFor(240, T)?.zone).toBe(4)   // justo el umbral
    expect(paceZoneFor(260, T)?.zone).toBe(3)   // 108 %
    expect(paceZoneFor(290, T)?.zone).toBe(2)   // 121 %
    expect(paceZoneFor(320, T)?.zone).toBe(1)   // 133 %
  })
  it('sin ritmo no hay zona', () => {
    expect(paceZoneFor(null, T)).toBeNull()
  })
  it('los rangos son contiguos', () => {
    const r = paceZoneRanges(T)
    expect(r[0].slow).toBeNull()
    expect(r[4].fast).toBeNull()
    for (let i = 0; i < 4; i++) expect(r[i].fast).toBe(r[i + 1].slow)
  })
})

// ─── 80/20 ───────────────────────────────────────────────────────────────────

describe('zoneSecondsFor / intensitySplit', () => {
  it('prefiere las zonas del reloj', () => {
    const z = zoneSecondsFor(act({ hrZoneSeconds: [100, 200, 300, 400, 500] }), 190)
    expect(z).toEqual({ seconds: [100, 200, 300, 400, 500], real: true })
  })
  it('sin zonas del reloj mete toda la actividad en la zona de la FC media', () => {
    const z = zoneSecondsFor(act({ avgHR: 120, duration: 1800 }), 190)  // 63 % → Z2
    expect(z.real).toBe(false)
    expect(z.seconds).toEqual([0, 1800, 0, 0, 0])
  })
  it('reparte en suave / medio / intenso', () => {
    const split = intensitySplit([
      act({ hrZoneSeconds: [600, 2400, 300, 200, 100] }),
      act({ hrZoneSeconds: [0, 0, 0, 0, 0], avgHR: 0 }),
    ], 190)
    expect(split).toEqual({ low: 3000, mid: 300, high: 300 })
  })
})

// ─── Totales ─────────────────────────────────────────────────────────────────

describe('yearTotals / monthlyKm', () => {
  const list = [
    act({ id: 1, startTime: '2025-03-01T08:00:00', distance: 10 }),
    act({ id: 2, startTime: '2025-11-01T08:00:00', distance: 20 }),
    act({ id: 3, startTime: '2026-03-15T08:00:00', distance: 12 }),
  ]
  it('compara el año hasta el mismo día', () => {
    const t = yearTotals(list, 2025, new Date(2026, 5, 1))
    expect(t.full.km).toBe(30)
    expect(t.toDate.km).toBe(10)   // el de noviembre aún no cuenta a 1 de junio
    expect(t.toDate.runs).toBe(1)
  })
  it('km por mes', () => {
    const km = monthlyKm(list, 2025)
    expect(km).toHaveLength(12)
    expect(km[2]).toBe(10)
    expect(km[10]).toBe(20)
  })
})

describe('weeklyVo2max', () => {
  const history = [
    { date: '2026-10-05', value: 60 },
    { date: '2026-10-07', value: 62 },
    { date: '2026-10-13', value: 64 },
  ]
  it('media de la semana actual', () => {
    const v = weeklyVo2max(history, new Date(2026, 9, 14))!
    expect(v.value).toBe(64)
    expect(v.isCurrent).toBe(true)
  })
  it('si esta semana no hay mediciones, la última semana que las tuvo', () => {
    const v = weeklyVo2max(history.slice(0, 2), new Date(2026, 9, 14))!
    expect(v.weekStart).toBe('2026-10-05')
    expect(v.value).toBe(61)
    expect(v.isCurrent).toBe(false)
  })
})
