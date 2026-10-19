import { useMemo, useState } from 'react'
import { useActivityStore } from '../stores/activityStore'
import { useAiStore } from '../stores/aiStore'
import { useFitnessProjection } from '../hooks/useFitnessProjection'
import AiProposalView from '../components/AiProposalView'
import { coachProfilePrompt, isBacktestWeek, questionPrompt, weekPrompt } from '../utils/aiPrompt'
import type { AthleteData } from '../utils/aiPrompt'
import { coachHasWeek, parseProposal } from '../utils/aiProposal'
import { localWeekStart } from '../utils/calculations'
import { parseLocalDate, toLocalISODate } from '../utils/date'

const GEMINI_URL = 'https://gemini.google.com/app'

function shiftWeek(weekStart: string, n: number): string {
  const d = parseLocalDate(weekStart)
  return toLocalISODate(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7 * n))
}

function weekLabel(weekStart: string): string {
  const d = parseLocalDate(weekStart)
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 6)
  const f = (x: Date) => x.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })
  return `${f(d)} – ${f(end)}`
}

/** Botón que copia el texto; si el navegador no deja usar el portapapeles, lo muestra para copiarlo a mano. */
function CopyButton({ build, label }: { build: () => string; label: string }) {
  const [state, setState] = useState<'idle' | 'ok' | 'manual'>('idle')
  const [text, setText] = useState('')
  async function copy() {
    const t = build()
    setText(t)
    try {
      await navigator.clipboard.writeText(t)
      setState('ok')
      setTimeout(() => setState('idle'), 4000)
    } catch {
      setState('manual')
    }
  }
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={copy} className="bg-accent text-black text-sm font-medium px-3 py-1.5 hover:brightness-110">
          {label}
        </button>
        <a href={GEMINI_URL} target="_blank" rel="noopener noreferrer" className="text-sm text-slate-400 hover:text-white">
          Abrir Gemini ↗
        </a>
        {state === 'ok' && (
          <span className="text-xs text-accent">Copiado ({Math.round(text.length / 1000)} mil caracteres). Pégalo en Gemini.</span>
        )}
      </div>
      {state === 'manual' && (
        <div className="mt-2">
          <div className="text-xs text-slate-500 mb-1">No se pudo copiar solo: selecciona el texto (Ctrl+A) y cópialo (Ctrl+C).</div>
          <textarea readOnly value={text} rows={6} className="w-full bg-slate-900 border border-slate-700 text-xs text-slate-300 p-2 font-mono"
            onFocus={e => e.currentTarget.select()} />
        </div>
      )}
    </div>
  )
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 text-sm text-slate-400">
      <span className="shrink-0 w-5 h-5 flex items-center justify-center border border-slate-600 text-[11px] text-slate-300">{n}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

export default function AiCoach() {
  const activities = useActivityStore(s => s.activities)
  const stats = useActivityStore(s => s.stats)
  const plan = useActivityStore(s => s.plan)
  const settings = useActivityStore(s => s.settings)
  const { history, projection } = useFitnessProjection()
  const { profile, proposals, saveProfile, clearProfile, saveProposal, deleteProposal } = useAiStore()

  const [question, setQuestion] = useState('')
  const [profileDraft, setProfileDraft] = useState('')
  const [answer, setAnswer] = useState('')
  const [answerError, setAnswerError] = useState<string | null>(null)

  const thisWeek = localWeekStart(new Date())
  const today = toLocalISODate(new Date())
  const workouts = useMemo(() => plan?.workouts ?? [], [plan])
  // Semana por defecto: la primera que el entrenador aún no ha planificado
  const defaultWeek = [0, 1, 2, 3].map(n => shiftWeek(thisWeek, n)).find(w => !coachHasWeek(workouts, w)) ?? shiftWeek(thisWeek, 1)
  // Lo que elija el usuario; si no ha elegido, la semana por defecto (se recalcula cuando se carga el plan)
  const [chosenWeek, setWeek] = useState<string | null>(null)
  const week = chosenWeek ?? defaultWeek
  const weekOptions = [-4, -3, -2, -1, 0, 1, 2, 3].map(n => shiftWeek(thisWeek, n))

  const data: AthleteData = useMemo(
    () => ({ activities, stats, workouts, settings, history, projection, today }),
    [activities, stats, workouts, settings, history, projection, today],
  )
  const savedProposals = Object.values(proposals).sort((a, b) => b.weekStart.localeCompare(a.weekStart))
  const backtest = isBacktestWeek(week, today)

  function importAnswer() {
    const r = parseProposal(answer, week)
    if (!r.ok) {
      setAnswerError(r.error)
      return
    }
    saveProposal(r.proposal)
    setAnswer('')
    setAnswerError(null)
  }

  if (activities.length === 0) {
    return <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">Sin datos. Ejecuta primero .\actualizar.ps1</div>
  }

  return (
    <div className="flex-1 p-4 md:px-10 md:py-8 overflow-y-auto">
      <h1 className="text-xl font-semibold text-slate-100">Entrenador IA</h1>
      <p className="text-sm text-slate-500 mt-0.5 mb-4 max-w-3xl">
        La app prepara el texto con tus datos y tú lo pegas en Gemini (sin coste, con tu suscripción).
        Lo que propone la IA se queda en esta app: nunca se envía a TrainingPeaks.
      </p>
      <div className="text-xs text-slate-500 border-l-2 border-slate-600 pl-3 mb-6 max-w-3xl space-y-1">
        <p>La IA imita a tu entrenador, no lo sustituye: él decide con cosas que no están en los datos. Úsalo como referencia.</p>
        <p>Lo que copias incluye tus datos de entrenamiento resumidos y las sesiones de tu entrenador, pero nunca rutas GPS.</p>
      </div>

      <div className="g-grid">
        {/* 1 · Preguntar */}
        <div className="g-cell col-span-12 xl:col-span-6 space-y-3">
          <div className="g-label">1 · Preguntar sobre tu entrenamiento</div>
          <textarea
            value={question}
            onChange={e => setQuestion(e.target.value)}
            rows={4}
            placeholder="Ej.: ¿Cómo llego a la carrera del domingo? ¿Estoy haciendo demasiado volumen? ¿Qué ritmo debería llevar en un 10 km?"
            className="w-full bg-slate-900 border border-slate-700 text-sm text-slate-200 p-3 placeholder:text-slate-600"
          />
          {question.trim()
            ? <CopyButton label="Copiar pregunta con mis datos" build={() => questionPrompt(data, question)} />
            : <div className="text-xs text-slate-600">Escribe una pregunta para copiarla junto con tus datos.</div>}
        </div>

        {/* 2 · Perfil del entrenador */}
        <div className="g-cell col-span-12 xl:col-span-6 space-y-3">
          <div className="g-label">2 · Perfil de tu entrenador</div>
          {workouts.length === 0 ? (
            <div className="text-sm text-slate-500">Hace falta el plan de TrainingPeaks (.\actualizar.ps1 con la cookie).</div>
          ) : (
            <>
              <Step n={1}>Copia el análisis (todas sus sesiones con las descripciones) y pégalo en Gemini.</Step>
              <CopyButton label="Copiar análisis del entrenador" build={() => coachProfilePrompt(workouts)} />
              <Step n={2}>
                Pega aquí el perfil que te devuelva Gemini y guárdalo. Se usará al proponer semanas.
                Consejo: crea también un <span className="text-slate-300">Gem</span> en Gemini con ese perfil.
              </Step>
              <textarea
                value={profileDraft}
                onChange={e => setProfileDraft(e.target.value)}
                rows={4}
                placeholder="Pega aquí el perfil del entrenador…"
                className="w-full bg-slate-900 border border-slate-700 text-sm text-slate-200 p-3 placeholder:text-slate-600"
              />
              <div className="flex flex-wrap items-center gap-3">
                <button
                  disabled={!profileDraft.trim()}
                  onClick={() => { saveProfile(profileDraft); setProfileDraft('') }}
                  className="border border-slate-600 text-sm text-slate-200 px-3 py-1.5 hover:border-slate-400 disabled:opacity-40"
                >
                  Guardar perfil
                </button>
                {profile && (
                  <span className="text-xs text-slate-500">
                    Perfil guardado el {profile.savedAt} ({Math.round(profile.text.length / 100) / 10} mil caracteres) ·{' '}
                    <button onClick={clearProfile} className="hover:text-red-300">borrar</button>
                  </span>
                )}
              </div>
              {profile && (
                <details className="text-sm text-slate-300">
                  <summary className="text-xs text-slate-500 cursor-pointer hover:text-white">Ver perfil guardado</summary>
                  <p className="mt-2 whitespace-pre-line leading-relaxed">{profile.text}</p>
                </details>
              )}
            </>
          )}
        </div>

        {/* 3 · Proponer semana */}
        <div className="g-cell col-span-12 space-y-3">
          <div className="g-label">3 · Proponer una semana como tu entrenador</div>
          {workouts.length === 0 ? (
            <div className="text-sm text-slate-500">Hace falta el plan de TrainingPeaks para que la IA aprenda su estilo.</div>
          ) : (
            <>
              <Step n={1}>
                Elige la semana:{' '}
                <select value={week} onChange={e => setWeek(e.target.value)}
                  className="bg-slate-800 border border-slate-700 text-sm text-slate-200 px-2 py-1 ml-1">
                  {weekOptions.map(w => (
                    <option key={w} value={w}>
                      {weekLabel(w)}{w === thisWeek ? ' (esta semana)' : ''}{isBacktestWeek(w, today) ? ' · prueba' : ''}{proposals[w] ? ' · ya tiene propuesta' : ''}
                    </option>
                  ))}
                </select>
                {backtest ? (
                  <div className="text-xs text-slate-500 mt-1">
                    Semana de prueba: solo se usan datos anteriores a ella y no el perfil guardado, para comparar de forma justa
                    con lo que planificó tu entrenador.
                  </div>
                ) : !profile ? (
                  <div className="text-xs text-slate-500 mt-1">Sin perfil guardado se usan las estadísticas del entrenador; con perfil sale más parecido.</div>
                ) : null}
              </Step>
              <Step n={2}>Copia el texto y pégalo en Gemini.</Step>
              <CopyButton key={week} label="Copiar propuesta de semana" build={() => weekPrompt(data, week, profile?.text ?? null)} />
              <Step n={3}>Pega aquí la respuesta completa de Gemini (el bloque JSON) y guárdala.</Step>
              <textarea
                value={answer}
                onChange={e => { setAnswer(e.target.value); setAnswerError(null) }}
                rows={5}
                placeholder='Pega aquí la respuesta de Gemini: ```json { "semana": … } ```'
                className="w-full bg-slate-900 border border-slate-700 text-xs font-mono text-slate-200 p-3 placeholder:text-slate-600"
              />
              <div className="flex flex-wrap items-center gap-3">
                <button
                  disabled={!answer.trim()}
                  onClick={importAnswer}
                  className="border border-slate-600 text-sm text-slate-200 px-3 py-1.5 hover:border-slate-400 disabled:opacity-40"
                >
                  Guardar propuesta de la semana del {weekLabel(week)}
                </button>
                {answerError && <span className="text-xs text-red-300">{answerError}</span>}
              </div>
            </>
          )}
        </div>
      </div>

      {savedProposals.length > 0 && (
        <div className="mt-8 space-y-4">
          <div className="g-label">Propuestas guardadas</div>
          {savedProposals.map(p => (
            <AiProposalView key={p.weekStart} proposal={p} onDelete={() => deleteProposal(p.weekStart)} />
          ))}
        </div>
      )}
    </div>
  )
}
