import { Link } from 'react-router-dom'
import { NONE, useShoeStore } from '../stores/shoeStore'
import type { ActivitySummary } from '../types/suunto'
import { defaultShoeOn } from '../utils/shoes'

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
  const tagName = (id: string) => st.tags.find(t => t.id === id)?.name ?? ''
  // las que estaban en uso ese día, y la elegida aunque ya no lo estuviera
  const options = st.shoes.filter(s => (date >= s.startDate && (s.retiredDate == null || date <= s.retiredDate)) || s.id === chosen)

  return (
    <label className="flex items-center gap-2 text-xs text-slate-500">
      Zapatillas
      <select
        value={chosen}
        onChange={e => st.assign(act.id, e.target.value || null)}
        className="bg-slate-800 border border-slate-700 text-xs text-slate-200 px-2 py-1.5"
      >
        <option value="">{byDefault ? `Por defecto: ${byDefault.name} (${tagName(byDefault.tagId)})` : 'Por defecto: ninguna'}</option>
        {options.map(s => <option key={s.id} value={s.id}>{tagName(s.tagId)} · {s.name}</option>)}
        <option value={NONE}>Sin zapatillas</option>
      </select>
    </label>
  )
}
