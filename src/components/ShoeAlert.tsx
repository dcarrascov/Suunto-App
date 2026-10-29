import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useActivityStore } from '../stores/activityStore'
import { useShoeStore } from '../stores/shoeStore'
import { shoesToWarn, shoeUsage } from '../utils/shoes'

/** Aviso en el Resumen cuando unas zapatillas en uso pasan del 90 % de su límite de km. */
export default function ShoeAlert() {
  const activities = useActivityStore(s => s.activities)
  const { shoes, tags, defaults, assignments } = useShoeStore()
  const warn = useMemo(
    () => shoesToWarn(shoeUsage(activities, { shoes, tags, defaults, assignments })),
    [activities, shoes, tags, defaults, assignments],
  )
  if (warn.length === 0) return null
  return (
    <div className="border border-orange-700/50 bg-orange-500/5 px-4 py-3 mb-6 flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className="g-label text-orange-300">Zapatillas</span>
      {warn.map(u => (
        <span key={u.shoe.id} className="text-sm text-slate-200">
          {u.shoe.name}: {Math.round(u.km)} de {u.shoe.limitKm} km{u.ratio >= 1 ? ' (pasado el límite)' : ''}
        </span>
      ))}
      <Link to="/shoes" className="ml-auto text-xs text-slate-500 hover:text-white">Ver →</Link>
    </div>
  )
}
