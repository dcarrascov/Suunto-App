import { useState } from 'react'
import { useAiStore, type FreeGoal, type FreeGoalDistance } from '../stores/aiStore'
import { freePhase, freeWeekPrompt, GOAL_LABEL, weeksToRace } from '../utils/aiPrompt'
import type { AthleteData } from '../utils/aiPrompt'
import { parseProposal } from '../utils/aiProposal'
import { localWeekStart } from '../utils/calculations'
import { parseLocalDate, toLocalISODate } from '../utils/date'
import { freeWeekOptions, goalForKm, weekLabel } from '../utils/freePlan'
import { askGemini } from '../utils/gemini'
import { eventLabel, upcomingEvents } from '../utils/races'

const SELECT = 'bg-slate-800 border border-slate-700 text-sm text-slate-200 px-2 py-1.5'
const PRIMARY = 'bg-accent text-black text-sm font-medium px-3 py-1.5 hover:brightness-110 disabled:opacity-40 disabled:hover:brightness-100'
const WEEKDAYS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']
interface Props {
  data: AthleteData
  enabled: boolean               // IA configurada y nada más en marcha
}

/** Modo «sin entrenador»: objetivo, disponibilidad y una semana cada vez, a partir de tus datos o de tu nivel. */
export default function FreePlanner({ data, enabled }: Props) {
  const { freeGoal: goal, setFreeGoal, freeProposals, saveFreeProposal } = useAiStore()
  const [chosenWeek, setWeek] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const today = data.today ?? toLocalISODate(new Date())
  const thisWeek = localWeekStart(parseLocalDate(today))
  const hasData = data.activities.some(a => a.sport === 'running')
  const races = upcomingEvents(data.events, today)
  const options = freeWeekOptions(goal, thisWeek)
  const week = chosenWeek && options.includes(chosenWeek) ? chosenWeek : options.find(w => !freeProposals[w]) ?? options[0]
  const previous = Object.values(freeProposals)
  const before = previous.filter(p => p.weekStart < week).length
  const raceInPast = goal.distance !== 'none' && goal.raceDate != null && goal.raceDate < today

  async function generate() {
    if (freeProposals[week] && !window.confirm(`Ya hay una semana sin entrenador para el ${weekLabel(week)}. ¿Sustituirla?`)) return
    setBusy(true)
    setError(null)
    try {
      const answer = await askGemini(freeWeekPrompt(data, week, goal, previous), true)
      const r = parseProposal(answer.text, week)
      if (!r.ok) throw new Error(`No he podido leer la respuesta de la IA (${answer.model}): ${r.error} Vuelve a generarla.`)
      saveFreeProposal({ ...r.proposal, model: answer.model, mode: 'free' })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error inesperado.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-400">
        {hasData
          ? 'La IA mira tus últimas semanas del reloj (volumen, tiradas, ritmos, marcas y forma) y te propone cada semana para mejorar hacia tu objetivo.'
          : 'No hay actividades del reloj: dime tu nivel y la IA propone un plan estándar para tu objetivo.'}
        {' '}Se genera semana a semana y cada una tiene en cuenta las anteriores del plan.
      </p>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {races.length > 0 && (
          <label className="block text-xs text-slate-400 sm:col-span-2 xl:col-span-4">Carrera de tu calendario (opcional)
            <select
              className={`${SELECT} w-full mt-1`}
              value={races.find(e => e.name === goal.raceName && e.date === goal.raceDate)?.id ?? ''}
              onChange={e => {
                const ev = races.find(x => String(x.id) === e.target.value)
                setFreeGoal(ev ? { distance: goalForKm(ev.distanceKm), raceDate: ev.date, raceName: ev.name } : { raceName: null })
              }}
            >
              <option value="">— elegir a mano —</option>
              {races.map(e => <option key={e.id} value={e.id}>{e.date} · {eventLabel(e)}</option>)}
            </select>
          </label>
        )}
        <label className="block text-xs text-slate-400">Objetivo
          <select className={`${SELECT} w-full mt-1`} value={goal.distance}
            onChange={e => setFreeGoal({ distance: e.target.value as FreeGoalDistance, raceName: null })}>
            {(Object.keys(GOAL_LABEL) as FreeGoalDistance[]).map(k => (
              <option key={k} value={k}>{k === 'none' ? 'Sin objetivo (mejorar la forma)' : GOAL_LABEL[k]}</option>
            ))}
          </select>
        </label>
        {goal.distance !== 'none' && (
          <label className="block text-xs text-slate-400">Fecha de la carrera (opcional)
            <input type="date" className={`${SELECT} w-full mt-1`} value={goal.raceDate ?? ''} min={today}
              onChange={e => setFreeGoal({ raceDate: e.target.value || null, raceName: null })} />
          </label>
        )}
        <label className="block text-xs text-slate-400">Días por semana
          <select className={`${SELECT} w-full mt-1`} value={goal.daysPerWeek} onChange={e => setFreeGoal({ daysPerWeek: Number(e.target.value) })}>
            {[3, 4, 5, 6, 7].map(n => <option key={n} value={n}>{n} días</option>)}
          </select>
        </label>
        <label className="block text-xs text-slate-400">Tirada larga
          <select className={`${SELECT} w-full mt-1`} value={goal.longRunDay ?? ''}
            onChange={e => setFreeGoal({ longRunDay: e.target.value === '' ? null : Number(e.target.value) })}>
            <option value="">Que elija la IA</option>
            {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
          </select>
        </label>
        {!hasData && (
          <>
            <label className="block text-xs text-slate-400">Tu nivel
              <select className={`${SELECT} w-full mt-1`} value={goal.level ?? ''}
                onChange={e => setFreeGoal({ level: (e.target.value || null) as FreeGoal['level'] })}>
                <option value="">Elige…</option>
                <option value="nuevo">Empiezo a correr</option>
                <option value="algo">Corro algo, sin constancia</option>
                <option value="habitual">Corro habitualmente</option>
              </select>
            </label>
            <label className="block text-xs text-slate-400">Horas de carrera a la semana (aprox.)
              <input inputMode="decimal" className={`${SELECT} w-full mt-1`} value={goal.hoursPerWeek ?? ''} placeholder="2"
                onChange={e => {
                  const n = Number(e.target.value.replace(',', '.'))
                  setFreeGoal({ hoursPerWeek: e.target.value.trim() && Number.isFinite(n) && n > 0 ? n : null })
                }} />
            </label>
          </>
        )}
      </div>

      {raceInPast && <div className="text-xs text-amber-300">La fecha de la carrera ya ha pasado: cambia la fecha o el objetivo.</div>}

      <div className="flex flex-wrap items-center gap-3 pt-1">
        <select value={week} onChange={e => setWeek(e.target.value)} className={SELECT}>
          {options.map(w => (
            <option key={w} value={w}>
              {weekLabel(w)}{w === thisWeek ? ' (esta semana)' : ''}{weeksToRace(w, goal.raceDate) === 0 && goal.distance !== 'none' ? ' · carrera' : ''}{freeProposals[w] ? ' · ya generada' : ''}
            </option>
          ))}
        </select>
        <button onClick={generate} disabled={!enabled || busy || raceInPast || (!hasData && !goal.level)} className={PRIMARY}>Generar semana</button>
        {busy && <span className="text-xs text-slate-400 animate-pulse">Generando la semana…</span>}
        {error && <span className="text-xs text-red-300">{error}</span>}
      </div>
      <div className="text-xs text-slate-500">
        Fase: {freePhase(goal, week)}.
        {before > 0 ? ` Se tienen en cuenta las ${Math.min(before, 3)} semanas anteriores ya generadas.` : ' Es la primera semana del plan.'}
        {!hasData && !goal.level && ' Elige tu nivel para poder generar.'}
      </div>
    </div>
  )
}
