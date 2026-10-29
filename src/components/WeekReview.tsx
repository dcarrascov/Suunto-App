import { useState } from 'react'
import { useActivityStore } from '../stores/activityStore'
import { useAiStore } from '../stores/aiStore'
import { useCustomWorkoutStore } from '../stores/customWorkoutStore'
import { useFitnessProjection } from '../hooks/useFitnessProjection'
import { plannedForWeek, weekReviewPrompt } from '../utils/aiPrompt'
import { toLocalISODate } from '../utils/date'
import { askGemini } from '../utils/gemini'

/** Quita el Markdown que a veces pone Gemini (negritas y títulos) para mostrarlo como texto. */
const plainText = (t: string) => t.replace(/\*\*(.+?)\*\*/g, '$1').replace(/^#{1,6}\s*/gm, '').replace(/^\s*[*-]\s+/gm, '• ')

/** Plan → «Revisión IA» de una semana empezada o pasada: lo planificado frente a lo hecho, con consejos. */
export default function WeekReview({ weekStart }: { weekStart: string }) {
  const activities = useActivityStore(s => s.activities)
  const stats = useActivityStore(s => s.stats)
  const plan = useActivityStore(s => s.plan)
  const settings = useActivityStore(s => s.settings)
  const { history, projection } = useFitnessProjection()
  const { reviews, saveReview, deleteReview, proposals, freeProposals } = useAiStore()
  const custom = useCustomWorkoutStore(s => s.workouts)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const today = toLocalISODate(new Date())
  if (weekStart > today) return null   // aún no ha empezado
  const review = reviews[weekStart]

  async function generate() {
    if (review && !window.confirm('¿Sustituir la revisión guardada por una nueva?')) return
    setBusy(true)
    setError(null)
    try {
      // propuestas de la IA: primero la del modo «como tu entrenador», luego la de «sin entrenador»
      const ia = [proposals[weekStart], freeProposals[weekStart]].filter(Boolean)
      const planned = plannedForWeek(weekStart, plan?.workouts ?? [], ia, custom)
      const data = { activities, stats, workouts: plan?.workouts ?? [], events: plan?.events ?? [], settings, history, projection, today }
      const r = await askGemini(weekReviewPrompt(data, weekStart, planned))
      saveReview(weekStart, { text: r.text.trim(), savedAt: new Date().toLocaleString('es-ES'), model: r.model })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error inesperado.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="border border-slate-700 bg-[#121214] p-4 mb-6 space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="g-label">Revisión IA de la semana</span>
        <button onClick={generate} disabled={busy}
          className={`px-3 py-1.5 text-xs ${review ? 'border border-slate-600 text-slate-300 hover:border-slate-400' : 'bg-accent text-black font-medium hover:brightness-110'} disabled:opacity-40`}>
          {review ? 'Volver a revisar' : 'Revisar con IA'}
        </button>
        {busy && <span className="text-xs text-slate-400 animate-pulse">Gemini está revisando la semana…</span>}
        {error && <span className="text-xs text-red-300">{error}</span>}
      </div>
      {review ? (
        <>
          <div className="text-sm text-slate-200 whitespace-pre-line leading-relaxed">{plainText(review.text)}</div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
            <span>Guardada el {review.savedAt}{review.model ? ` con ${review.model}` : ''}</span>
            <button onClick={() => { if (window.confirm('¿Borrar la revisión de esta semana?')) deleteReview(weekStart) }}
              className="hover:text-red-300">Borrar</button>
          </div>
        </>
      ) : (
        <p className="text-xs text-slate-500">
          Compara lo planificado (tu entrenador, la IA o tus entrenos propios) con lo que hiciste y te da consejos para la
          siguiente. Gasta una petición de Gemini.
        </p>
      )}
    </div>
  )
}
