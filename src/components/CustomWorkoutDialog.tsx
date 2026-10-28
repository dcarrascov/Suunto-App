import { useEffect, useState } from 'react'
import type { Sport } from '../types/suunto'
import { parseCustomWorkout, type CustomWorkout, type CustomWorkoutForm } from '../utils/customWorkouts'
import { parseLocalDate } from '../utils/date'

const SPORTS: { value: Sport; label: string }[] = [
  { value: 'running', label: 'Carrera' },
  { value: 'cycling', label: 'Bici' },
  { value: 'swimming', label: 'Natación' },
  { value: 'other', label: 'Otro (fuerza, movilidad…)' },
]

const field = 'w-full bg-[#0f0f11] border border-slate-700 px-2.5 py-1.5 text-sm text-slate-100 focus:outline-none focus:border-accent'

interface Props {
  initial: CustomWorkoutForm
  editing: boolean
  onSave: (w: Omit<CustomWorkout, 'id'>) => void
  onDelete?: () => void
  onClose: () => void
}

/** Ventana para crear o editar un entreno propio del Calendario. */
export default function CustomWorkoutDialog({ initial, editing, onSave, onDelete, onClose }: Props) {
  const [form, setForm] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const set = <K extends keyof CustomWorkoutForm>(k: K, v: CustomWorkoutForm[K]) => setForm(f => ({ ...f, [k]: v }))

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const r = parseCustomWorkout(form)
    if (!r.ok) { setError(r.error); return }
    onSave(r.workout)
  }

  const dayLabel = /^\d{4}-\d{2}-\d{2}$/.test(form.date)
    ? parseLocalDate(form.date).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })
    : ''

  return (
    <div className="fixed inset-0 z-[1000] bg-black/70 flex items-center justify-center p-4" onMouseDown={onClose}>
      <form
        onSubmit={submit}
        onMouseDown={e => e.stopPropagation()}
        className="w-full max-w-md bg-[#151518] border border-slate-700 p-5 space-y-3"
        role="dialog"
        aria-label={editing ? 'Editar entreno propio' : 'Nuevo entreno propio'}
      >
        <div>
          <div className="g-label">{editing ? 'Editar entreno propio' : 'Nuevo entreno propio'}</div>
          <div className="text-sm text-slate-400 first-letter:uppercase mt-0.5">{dayLabel}</div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block text-xs text-slate-400">Fecha
            <input type="date" className={`${field} mt-1`} value={form.date} onChange={e => set('date', e.target.value)} />
          </label>
          <label className="block text-xs text-slate-400">Deporte
            <select className={`${field} mt-1`} value={form.sport} onChange={e => set('sport', e.target.value as Sport)}>
              {SPORTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </label>
        </div>
        <label className="block text-xs text-slate-400">Título
          <input autoFocus className={`${field} mt-1`} value={form.title} onChange={e => set('title', e.target.value)} placeholder="Rodaje suave" />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-xs text-slate-400">Duración (min)
            <input inputMode="numeric" className={`${field} mt-1`} value={form.durationMin} onChange={e => set('durationMin', e.target.value)} placeholder="45" />
          </label>
          <label className="block text-xs text-slate-400">Distancia (km, opcional)
            <input inputMode="decimal" className={`${field} mt-1`} value={form.distanceKm} onChange={e => set('distanceKm', e.target.value)} placeholder="8,5" />
          </label>
        </div>
        <label className="block text-xs text-slate-400">Descripción (opcional)
          <textarea rows={3} className={`${field} mt-1 resize-y`} value={form.description} onChange={e => set('description', e.target.value)} />
        </label>

        {error && <p className="text-sm text-red-300">{error}</p>}

        <div className="flex items-center gap-2 pt-1">
          {onDelete && (
            <button type="button" onClick={onDelete} className="px-3 py-1.5 text-sm text-slate-300 border border-slate-600 hover:border-red-400 hover:text-red-300">
              Eliminar
            </button>
          )}
          <button type="button" onClick={onClose} className="ml-auto px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-700">Cancelar</button>
          <button type="submit" className="px-3 py-1.5 text-sm font-medium bg-accent text-black">Guardar</button>
        </div>
        <p className="text-[11px] text-slate-600">Se guarda solo en este navegador. No se envía a TrainingPeaks.</p>
      </form>
    </div>
  )
}
