import { afterEach, describe, expect, it, vi } from 'vitest'
import { daysAgo, isoDateOffset, parseLocalDate, toLocalISODate } from './date'
import { formatRaceTime } from './formatters'

afterEach(() => { vi.useRealTimers() })

describe('fechas en hora local', () => {
  it('toLocalISODate no se va al día siguiente de noche (como haría toISOString)', () => {
    expect(toLocalISODate(new Date(2026, 9, 17, 23, 59))).toBe('2026-10-17')
    expect(toLocalISODate(new Date(2026, 9, 18, 0, 5))).toBe('2026-10-18')
  })
  it('parseLocalDate devuelve las 00:00 locales de ese día', () => {
    const d = parseLocalDate('2026-10-17T07:45:00')
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 9, 17, 0])
  })
  it('daysAgo cuenta días de calendario, no horas', () => {
    const now = new Date(2026, 9, 17, 8, 0)
    expect(daysAgo('2026-10-16T23:00:00', now)).toBe(1)
    expect(daysAgo('2026-10-17T07:00:00', now)).toBe(0)
  })
  it('isoDateOffset resta días desde hoy', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 2, 1, 10))
    expect(isoDateOffset(1)).toBe('2026-02-28')
  })
})

describe('formatRaceTime', () => {
  it('con segundos y horas cuando hace falta', () => {
    expect(formatRaceTime(1085)).toBe('18:05')
    expect(formatRaceTime(4847)).toBe('1:20:47')
    expect(formatRaceTime(3600)).toBe('1:00:00')
  })
})
