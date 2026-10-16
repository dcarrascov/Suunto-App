// Todas las fechas de la app son de hora LOCAL. No usar toISOString() para sacar
// el día: convierte a UTC y, de madrugada o de noche, devuelve el día equivocado.

/** Date -> YYYY-MM-DD en hora local. */
export function toLocalISODate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** YYYY-MM-DD (o ISO local con hora) -> Date a las 00:00 locales de ese día. */
export function parseLocalDate(isoDate: string): Date {
  const [y, m, d] = isoDate.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function startOfWeek(offsetWeeks = 0): Date {
  const d = new Date()
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff - offsetWeeks * 7)
  d.setHours(0, 0, 0, 0)
  return d
}

export function endOfWeek(offsetWeeks = 0): Date {
  const monday = startOfWeek(offsetWeeks)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  sunday.setHours(23, 59, 59, 999)
  return sunday
}

export function monthKey(isoDate: string): string {
  return isoDate.slice(0, 7)
}

/** Días de calendario desde esa fecha hasta hoy (ayer a las 23:00 = 1, aunque hayan pasado 9 h). */
export function daysAgo(isoDate: string, today: Date = new Date()): number {
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  return Math.round((t.getTime() - parseLocalDate(isoDate).getTime()) / 86_400_000)
}

export function isoToday(): string {
  return toLocalISODate(new Date())
}

export function isoDateOffset(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return toLocalISODate(d)
}
