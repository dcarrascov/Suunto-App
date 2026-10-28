import { describe, expect, it } from 'vitest'
import { customByDate, customSummary, EMPTY_FORM, parseCustomWorkout, toForm, type CustomWorkout } from './customWorkouts'

const form = (over = {}) => ({ ...EMPTY_FORM, date: '2026-10-29', title: 'Rodaje suave', durationMin: '45', ...over })

describe('entrenos propios', () => {
  it('lee el formulario: recorta textos, acepta coma decimal y deja vacíos como null', () => {
    const r = parseCustomWorkout(form({ title: '  Rodaje  ', distanceKm: '8,456', description: ' fácil ' }))
    expect(r).toEqual({ ok: true, workout: { date: '2026-10-29', sport: 'running', title: 'Rodaje', durationMin: 45, distanceKm: 8.46, description: 'fácil' } })
    const sinNada = parseCustomWorkout(form({ durationMin: '' }))
    expect(sinNada.ok && sinNada.workout).toMatchObject({ durationMin: null, distanceKm: null })
  })
  it('rechaza título vacío, fecha mala y números no válidos', () => {
    expect(parseCustomWorkout(form({ title: '  ' }))).toEqual({ ok: false, error: 'Ponle un título.' })
    expect(parseCustomWorkout(form({ date: '' })).ok).toBe(false)
    expect(parseCustomWorkout(form({ durationMin: 'abc' })).ok).toBe(false)
    expect(parseCustomWorkout(form({ distanceKm: '0' })).ok).toBe(false)
  })
  it('al editar, el formulario parte de lo guardado y vuelve a dar lo mismo', () => {
    const w: CustomWorkout = { id: 'a', date: '2026-10-30', sport: 'cycling', title: 'Bici', durationMin: 90, distanceKm: 40.5, description: '' }
    const f = toForm(w)
    expect(f.distanceKm).toBe('40,5')
    const r = parseCustomWorkout(f)
    expect(r.ok && r.workout).toEqual({ date: w.date, sport: w.sport, title: w.title, durationMin: 90, distanceKm: 40.5, description: '' })
  })
  it('agrupa por día y resume duración y distancia', () => {
    const a: CustomWorkout = { id: 'a', date: '2026-10-29', sport: 'running', title: 'A', durationMin: 45, distanceKm: 10, description: '' }
    const b = { ...a, id: 'b', durationMin: null }
    expect(customByDate([a, b]).get('2026-10-29')?.map(w => w.id)).toEqual(['a', 'b'])
    expect(customSummary(a)).toBe('45 min · 10 km')
    expect(customSummary(b)).toBe('10 km')
  })
})
