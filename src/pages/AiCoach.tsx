import { useEffect, useMemo, useState } from 'react'
import { useActivityStore } from '../stores/activityStore'
import { useAiStore } from '../stores/aiStore'
import { useFitnessProjection } from '../hooks/useFitnessProjection'
import AiProposalView from '../components/AiProposalView'
import { coachProfilePrompt, isBacktestWeek, questionPrompt, weekPrompt } from '../utils/aiPrompt'
import type { AthleteData } from '../utils/aiPrompt'
import { coachHasWeek, parseProposal } from '../utils/aiProposal'
import { localWeekStart } from '../utils/calculations'
import { parseLocalDate, toLocalISODate } from '../utils/date'
import { askGemini, geminiStatus } from '../utils/gemini'
import type { GeminiStatus } from '../utils/gemini'

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

const TEXTAREA = 'w-full bg-slate-900 border border-slate-700 text-sm text-slate-200 p-3 placeholder:text-slate-600'
const PRIMARY = 'bg-accent text-black text-sm font-medium px-3 py-1.5 hover:brightness-110 disabled:opacity-40 disabled:hover:brightness-100'
const SECONDARY = 'border border-slate-600 text-sm text-slate-200 px-3 py-1.5 hover:border-slate-400 disabled:opacity-40'

function Working({ text }: { text: string }) {
  return <span className="text-xs text-slate-400 animate-pulse">{text}</span>
}

/** Aviso cuando no se puede usar Gemini: sin servidor o sin clave. */
function SetupNotice({ status }: { status: GeminiStatus | null | undefined }) {
  if (status === undefined) return null
  if (status === null) {
    return (
      <div className="g-cell border border-line mb-6 text-sm text-slate-300">
        <div className="g-label mb-2">Gemini no disponible</div>
        Abre la app con <code className="text-slate-100">npm run dev</code>: la conexión con Gemini la hace ese servidor.
      </div>
    )
  }
  if (status.configured) return null
  return (
    <div className="g-cell border border-amber-800/60 mb-6 text-sm text-slate-300 space-y-2">
      <div className="g-label">Falta tu clave de Gemini</div>
      <p>
        Crea una clave gratis en <span className="text-slate-100">Google AI Studio</span> y añádela al fichero
        <code className="text-slate-100"> .env</code> de la carpeta del proyecto (nunca en <code>.env.example</code>):
      </p>
      <pre className="bg-slate-900 px-3 py-2 text-xs text-slate-200">GEMINI_API_KEY=pega_aquí_tu_clave</pre>
      <p className="text-xs text-slate-500">
        No hace falta reiniciar: la app la lee al momento. Es como una contraseña: no la compartas.
      </p>
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

  const [status, setStatus] = useState<GeminiStatus | null | undefined>(undefined)
  const [question, setQuestion] = useState('')
  const [answers, setAnswers] = useState<{ q: string; a: string; model: string; fellBack: boolean }[]>([])
  const [busy, setBusy] = useState<null | 'question' | 'profile' | 'week'>(null)
  const [error, setError] = useState<{ where: 'question' | 'profile' | 'week'; text: string } | null>(null)

  useEffect(() => {
    let alive = true
    const check = () => geminiStatus().then(s => { if (alive) setStatus(s) })
    check()
    // si falta la clave, se vuelve a mirar cada pocos segundos: al guardarla en .env la página se activa sola
    const timer = setInterval(() => { if (!status?.configured) check() }, 5000)
    return () => { alive = false; clearInterval(timer) }
  }, [status?.configured])

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
    () => ({ activities, stats, workouts, events: plan?.events ?? [], settings, history, projection, today }),
    [activities, stats, workouts, plan, settings, history, projection, today],
  )
  const savedProposals = Object.values(proposals).sort((a, b) => b.weekStart.localeCompare(a.weekStart))
  const backtest = isBacktestWeek(week, today)
  const ready = !!status?.configured && busy === null

  async function run<T>(where: 'question' | 'profile' | 'week', task: () => Promise<T>): Promise<T | undefined> {
    setBusy(where)
    setError(null)
    try {
      return await task()
    } catch (e) {
      setError({ where, text: e instanceof Error ? e.message : 'Error inesperado.' })
      return undefined
    } finally {
      setBusy(null)
    }
  }

  async function ask() {
    const q = question.trim()
    const r = await run('question', () => askGemini(questionPrompt(data, q)))
    if (r) {
      setAnswers(list => [{ q, a: r.text, model: r.model, fellBack: r.fellBack }, ...list])
      setQuestion('')
    }
  }

  async function analyzeCoach() {
    const r = await run('profile', () => askGemini(coachProfilePrompt(workouts, plan?.events ?? [])))
    if (r) saveProfile(r.text, r.model)
  }

  async function generateWeek() {
    if (proposals[week] && !window.confirm(`Ya hay una propuesta para la semana del ${weekLabel(week)}. ¿Sustituirla por una nueva?`)) return
    await run('week', async () => {
      const answer = await askGemini(weekPrompt(data, week, profile?.text ?? null), true)
      const r = parseProposal(answer.text, week)
      if (!r.ok) throw new Error(`No he podido leer la respuesta de Gemini (${answer.model}): ${r.error} Vuelve a generarla.`)
      saveProposal({ ...r.proposal, model: answer.model })
    })
  }

  function removeProposal(weekStart: string) {
    if (window.confirm(`¿Borrar la propuesta de la IA de la semana del ${weekLabel(weekStart)}?`)) deleteProposal(weekStart)
  }

  if (activities.length === 0) {
    return <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">Sin datos. Ejecuta primero .\actualizar.ps1</div>
  }

  return (
    <div className="flex-1 p-4 md:px-10 md:py-8 overflow-y-auto">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold text-slate-100">Entrenador IA</h1>
        {status?.configured && (
          <span className="text-xs text-slate-500" title={status.fallbacks?.length ? `Si falla varias veces: ${status.fallbacks.join(', ')}` : undefined}>
            Conectado a Gemini · {status.model}
          </span>
        )}
      </div>
      <p className="text-sm text-slate-500 mt-0.5 mb-4 max-w-3xl">
        Pregunta sobre tu entrenamiento y genera semanas al estilo de tu entrenador. Lo que propone la IA se queda en
        esta app: nunca se envía a TrainingPeaks.
      </p>
      <div className="text-xs text-slate-500 border-l-2 border-slate-600 pl-3 mb-6 max-w-3xl space-y-1">
        <p>La IA imita a tu entrenador, no lo sustituye: él decide con cosas que no están en los datos. Úsalo como referencia.</p>
        <p>A Gemini se envían tus datos de entrenamiento resumidos y las sesiones de tu entrenador, nunca rutas GPS.</p>
      </div>

      <SetupNotice status={status} />

      <div className="g-grid">
        {/* 1 · Preguntar */}
        <div className="g-cell col-span-12 xl:col-span-6 space-y-3">
          <div className="g-label">1 · Preguntar sobre tu entrenamiento</div>
          <textarea
            value={question}
            onChange={e => setQuestion(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && ready && question.trim()) ask() }}
            rows={3}
            placeholder="Ej.: ¿Cómo llego a la carrera del domingo? ¿Estoy haciendo demasiado volumen? ¿Qué ritmo debería llevar en un 10 km?"
            className={TEXTAREA}
          />
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={ask} disabled={!ready || !question.trim()} className={PRIMARY}>Preguntar</button>
            <span className="text-xs text-slate-600">Ctrl + Intro</span>
            {busy === 'question' && <Working text="Gemini está pensando… (si está saturado, la app reintenta sola)" />}
            {error?.where === 'question' && <span className="text-xs text-red-300">{error.text}</span>}
          </div>
          {answers.map((x, i) => (
            <div key={i} className="border-t border-line pt-3">
              <div className="text-xs text-slate-500 mb-1">
                {x.q}
                {x.fellBack && <span className="text-amber-300/80"> · respondió {x.model} (el principal estaba saturado)</span>}
              </div>
              <div className="text-sm text-slate-200 whitespace-pre-line leading-relaxed">{x.a}</div>
            </div>
          ))}
        </div>

        {/* 2 · Perfil del entrenador */}
        <div className="g-cell col-span-12 xl:col-span-6 space-y-3">
          <div className="g-label">2 · Perfil de tu entrenador</div>
          {workouts.length === 0 ? (
            <div className="text-sm text-slate-500">Hace falta el plan de TrainingPeaks (.\actualizar.ps1 con la cookie).</div>
          ) : (
            <>
              <p className="text-sm text-slate-400">
                Gemini analiza todas las sesiones de tu entrenador ({workouts.filter(w => w.hasPlan).length}) con sus descripciones
                y escribe cómo planifica. Se usa al generar semanas. Repítelo de vez en cuando para que tenga en cuenta las nuevas.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <button onClick={analyzeCoach} disabled={!ready} className={profile ? SECONDARY : PRIMARY}>
                  {profile ? 'Volver a analizar' : 'Analizar a mi entrenador'}
                </button>
                {busy === 'profile' && <Working text="Analizando sus sesiones (puede tardar un minuto)…" />}
                {error?.where === 'profile' && <span className="text-xs text-red-300">{error.text}</span>}
              </div>
              {profile && (
                <details className="text-sm text-slate-300">
                  <summary className="text-xs text-slate-500 cursor-pointer hover:text-white">
                    Perfil guardado el {profile.savedAt}{profile.model ? ` con ${profile.model}` : ''} · ver
                  </summary>
                  <p className="mt-2 whitespace-pre-line leading-relaxed">{profile.text}</p>
                  <button
                    onClick={() => { if (window.confirm('¿Borrar el perfil del entrenador?')) clearProfile() }}
                    className="mt-2 text-xs text-slate-500 hover:text-red-300"
                  >
                    Borrar perfil
                  </button>
                </details>
              )}
            </>
          )}
        </div>

        {/* 3 · Generar semana */}
        <div className="g-cell col-span-12 space-y-3">
          <div className="g-label">3 · Generar una semana como tu entrenador</div>
          {workouts.length === 0 ? (
            <div className="text-sm text-slate-500">Hace falta el plan de TrainingPeaks para que la IA aprenda su estilo.</div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <select value={week} onChange={e => setWeek(e.target.value)}
                  className="bg-slate-800 border border-slate-700 text-sm text-slate-200 px-2 py-1.5">
                  {weekOptions.map(w => (
                    <option key={w} value={w}>
                      {weekLabel(w)}{w === thisWeek ? ' (esta semana)' : ''}{isBacktestWeek(w, today) ? ' · prueba' : ''}{proposals[w] ? ' · ya tiene propuesta' : ''}
                    </option>
                  ))}
                </select>
                <button onClick={generateWeek} disabled={!ready} className={PRIMARY}>Generar semana</button>
                {busy === 'week' && <Working text="Generando la semana…" />}
                {error?.where === 'week' && <span className="text-xs text-red-300">{error.text}</span>}
              </div>
              <div className="text-xs text-slate-500">
                {backtest
                  ? 'Semana de prueba: solo se usan datos anteriores a ella y no el perfil guardado, para comparar de forma justa con lo que planificó tu entrenador.'
                  : profile
                    ? 'Se usa el perfil guardado de tu entrenador.'
                    : 'Sin perfil guardado se usan las estadísticas del entrenador; con perfil sale más parecido (paso 2).'}
              </div>
            </>
          )}
        </div>
      </div>

      {savedProposals.length > 0 && (
        <div className="mt-8 space-y-4">
          <div className="g-label">Semanas generadas</div>
          {savedProposals.map(p => (
            <AiProposalView key={p.weekStart} proposal={p} onDelete={() => removeProposal(p.weekStart)} />
          ))}
        </div>
      )}
    </div>
  )
}
