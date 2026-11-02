import { Link } from 'react-router-dom'
import { NONE, useShoeStore } from '../stores/shoeStore'
import type { ActivitySummary } from '../types/suunto'
import { defaultShoeOn, isRetiredOn, tagNames } from '../utils/shoes'

/** Zapatillas de una actividad en el Detalle: las de por defecto de ese día o las que elijas (p. ej. competición). */
export default function ShoePicker({ act }: { act: ActivitySummary }) {
  const st = useShoeStore()
  if (act.sport !== 'running') return null
  if (st.shoes.length === 0) {
    return <Link to="/shoes" className="text-xs text-slate-500 hover:text-white">Añadir zapatillas</Link>
  }
  const date = act.startTime.slice(0, 10)
  const chosen = st.assignments[String(act.id)] ?? ''
  const byDefault = defaultShoeOn(st, date)
  const label = (s: (typeof st.shoes)[number]) => {
    const tags = tagNames(s, st.tags)
    return tags ? `${s.name} (${tags})` : s.name
  }
  // todas: primero las que seguían en uso ese día; las retiradas antes, aparte
  const inUse = st.shoes.filter(s => !isRetiredOn(s, date))
  const retired = st.shoes.filter(s => isRetiredOn(s, date))

  return (
    <label className="flex items-center gap-2 text-xs text-slate-500">
      Zapatillas
      <select
        value={chosen}
        onChange={e => st.assign(act.id, e.target.value || null)}
        className="bg-slate-800 border border-slate-700 text-xs text-slate-200 px-2 py-1.5"
      >
        <option value="">{byDefault ? `Por defecto: ${label(byDefault)}` : 'Por defecto: ninguna'}</option>
        {inUse.map(s => <option key={s.id} value={s.id}>{label(s)}</option>)}
        {retired.length > 0 && (
          <optgroup label="Retiradas">
            {retired.map(s => <option key={s.id} value={s.id}>{label(s)}</option>)}
          </optgroup>
        )}
        <option value={NONE}>Sin zapatillas</option>
      </select>
    </label>
  )
}
