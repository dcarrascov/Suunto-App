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

export function daysAgo(isoDate: string): number {
  return Math.floor((Date.now() - new Date(isoDate).getTime()) / 86_400_000)
}

export function isoToday(): string {
  return new Date().toISOString().slice(0, 10)
}

export function isoDateOffset(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}
