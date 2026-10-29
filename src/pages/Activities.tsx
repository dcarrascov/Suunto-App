import { useState, useMemo } from 'react'
import { useActivityStore } from '../stores/activityStore'
import type { ActivitySummary, Sport } from '../types/suunto'
import ActivityCard from '../components/ActivityCard'

const SPORTS: { value: Sport | 'all'; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'running', label: 'Carrera' },
  { value: 'cycling', label: 'Bici' },
  { value: 'swimming', label: 'Natación' },
  { value: 'other', label: 'Otro' },
]

// Rangos de distancia [mín, máx) en km
const DISTANCES: { value: string; label: string; min: number; max: number }[] = [
  { value: 'all', label: 'Cualquier distancia', min: 0, max: Infinity },
  { value: '0-5', label: 'Menos de 5 km', min: 0, max: 5 },
  { value: '5-10', label: '5 – 10 km', min: 5, max: 10 },
  { value: '10-15', label: '10 – 15 km', min: 10, max: 15 },
  { value: '15-21', label: '15 – 21 km', min: 15, max: 21 },
  { value: '21+', label: 'Más de 21 km', min: 21, max: Infinity },
]

type SortKey = 'date' | 'distance' | 'duration' | 'pace'

const SORTS: { value: SortKey; label: string }[] = [
  { value: 'date', label: 'Fecha' },
  { value: 'distance', label: 'Distancia' },
  { value: 'duration', label: 'Duración' },
  { value: 'pace', label: 'Ritmo' },
]

// Valor por el que se ordena; en ritmo, "mayor" = más rápido (las que no tienen ritmo van al final)
function sortValue(a: ActivitySummary, key: SortKey): number | string {
  if (key === 'date') return a.startTime
  if (key === 'distance') return a.distance
  if (key === 'duration') return a.duration
  return a.avgPace ? -a.avgPace : -Infinity
}

const INPUT = 'bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-300'

export default function Activities() {
  const activities = useActivityStore(s => s.activities)
  const [sportFilter, setSportFilter] = useState<Sport | 'all'>('all')
  const [query, setQuery] = useState('')
  const [distance, setDistance] = useState('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [sort, setSort] = useState<SortKey>('date')
  const [desc, setDesc] = useState(true)
  const [page, setPage] = useState(0)

  const PAGE_SIZE = 20

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const range = DISTANCES.find(d => d.value === distance) ?? DISTANCES[0]
    const list = activities.filter(a => {
      if (sportFilter !== 'all' && a.sport !== sportFilter) return false
      if (q && !a.title.toLowerCase().includes(q)) return false
      if (a.distance < range.min || a.distance >= range.max) return false
      const day = a.startTime.slice(0, 10)  // fechas en hora local, comparables como texto
      if (from && day < from) return false
      if (to && day > to) return false
      return true
    })
    const dir = desc ? -1 : 1
    return list.sort((a, b) => {
      const va = sortValue(a, sort)
      const vb = sortValue(b, sort)
      return va < vb ? -dir : va > vb ? dir : 0
    })
  }, [activities, sportFilter, query, distance, from, to, sort, desc])

  const paginated = filtered.slice(0, (page + 1) * PAGE_SIZE)
  const hasMore = paginated.length < filtered.length
  const hasFilters = query || distance !== 'all' || from || to || sportFilter !== 'all'

  // Cualquier cambio de filtro vuelve a la primera página
  function change<T>(setter: (v: T) => void) {
    return (v: T) => { setter(v); setPage(0) }
  }

  return (
    <div className="page">
      <h1 className="text-xl font-bold text-slate-100 mb-4">Actividades</h1>

      {/* Filters */}
      <div className="space-y-3 mb-6">
        <div className="flex gap-3 flex-wrap">
          <div className="flex flex-wrap bg-slate-800 rounded-lg p-0.5 gap-0.5">
            {SPORTS.map(({ value, label }) => (
              <button
                key={value}
                onClick={() => change(setSportFilter)(value)}
                className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
                  sportFilter === value
                    ? 'bg-accent text-black font-medium'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <input
            type="search"
            value={query}
            onChange={e => change(setQuery)(e.target.value)}
            placeholder="Buscar por título…"
            className={`${INPUT} flex-1 min-w-40`}
          />
        </div>

        <div className="flex gap-3 flex-wrap items-center">
          <select value={distance} onChange={e => change(setDistance)(e.target.value)} className={INPUT}>
            {DISTANCES.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
          </select>

          <label className="flex items-center gap-2 text-sm text-slate-500">
            Desde
            <input type="date" value={from} onChange={e => change(setFrom)(e.target.value)} className={INPUT} />
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-500">
            Hasta
            <input type="date" value={to} onChange={e => change(setTo)(e.target.value)} className={INPUT} />
          </label>

          <label className="flex items-center gap-2 text-sm text-slate-500">
            Ordenar
            <select value={sort} onChange={e => change(setSort)(e.target.value as SortKey)} className={INPUT}>
              {SORTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </label>
          <button
            onClick={() => change(setDesc)(!desc)}
            className={`${INPUT} hover:text-slate-100`}
            title={desc ? 'De mayor a menor' : 'De menor a mayor'}
          >
            {desc ? '↓' : '↑'} {sort === 'date' ? (desc ? 'Recientes' : 'Antiguas') : sort === 'pace' ? (desc ? 'Más rápidas' : 'Más lentas') : (desc ? 'Mayor' : 'Menor')}
          </button>

          {hasFilters && (
            <button
              onClick={() => {
                setSportFilter('all'); setQuery(''); setDistance('all'); setFrom(''); setTo(''); setPage(0)
              }}
              className="text-sm text-blue-400 hover:text-blue-300"
            >
              Quitar filtros
            </button>
          )}

          <div className="text-sm text-slate-500 ml-auto">
            {filtered.length} actividades
          </div>
        </div>
      </div>

      {/* List */}
      <div className="space-y-3">
        {paginated.map(a => (
          <ActivityCard key={a.id} activity={a} />
        ))}
      </div>

      {hasMore && (
        <button
          onClick={() => setPage(p => p + 1)}
          className="mt-6 w-full py-3 rounded-xl border border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors text-sm"
        >
          Cargar más ({filtered.length - paginated.length} restantes)
        </button>
      )}

      {filtered.length === 0 && (
        <div className="text-center py-16 text-slate-500">
          No hay actividades con estos filtros.
        </div>
      )}
    </div>
  )
}
