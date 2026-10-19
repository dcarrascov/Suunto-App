import { useState } from 'react'
import { useActivityStore } from '../stores/activityStore'
import type { AiProposal } from '../stores/aiStore'
import { coachHasWeek, compareWeek } from '../utils/aiProposal'
import { SESSION_LABEL } from '../utils/coach'
import { formatDuration } from '../utils/formatters'
import { parseLocalDate } from '../utils/date'

const DAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
const FAMILY_LABEL: Record<string, string> = {
  suave: 'suave', calidad: 'calidad', rectas: 'rectas', activacion: 'activación',
  fuerza: 'fuerza', natacion: 'natación', descanso: 'descanso', otro: 'otro',
}

function dayLabel(iso: string): string {
  return parseLocalDate(iso).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'short' })
}

/** Propuesta de semana de la IA (marcada como tal) y, si ya existe, su parecido con la del entrenador. */
export default function AiProposalView({ proposal, onDelete }: { proposal: AiProposal; onDelete?: () => void }) {
  const plan = useActivityStore(s => s.plan)
  const [open, setOpen] = useState<string | null>(null)
  const workouts = plan?.workouts ?? []
  const comparable = coachHasWeek(workouts, proposal.weekStart)
  const cmp = comparable ? compareWeek(proposal, workouts) : null
  const totalMin = proposal.workouts.reduce((s, w) => s + (w.durationMin ?? 0), 0)
  const totalTss = proposal.workouts.reduce((s, w) => s + (w.tss ?? 0), 0)

  return (
    <div className="border border-dashed border-slate-600 bg-[#121214] p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold border border-slate-500 text-slate-300 px-1.5 py-0.5">PROPUESTA IA</span>
            <span className="text-sm text-slate-200">Semana del {parseLocalDate(proposal.weekStart).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}</span>
          </div>
          <div className="text-xs text-slate-500 mt-1">
            {formatDuration(totalMin * 60)} · {Math.round(totalTss)} TSS · generada el {proposal.createdAt} · no es el plan de tu entrenador
          </div>
        </div>
        {cmp ? (
          <div className="text-right">
            <div className="text-2xl font-semibold" style={{ color: cmp.total >= 75 ? '#c5f23c' : cmp.total >= 50 ? '#fbbf24' : '#f87171' }}>{cmp.total} %</div>
            <div className="text-[11px] text-slate-500">parecido con tu entrenador</div>
          </div>
        ) : (
          <div className="text-xs text-slate-500 max-w-48 text-right">Se comparará cuando tu entrenador planifique esta semana</div>
        )}
      </div>

      {proposal.explanation && <p className="text-sm text-slate-400 mt-3">{proposal.explanation}</p>}

      <div className="mt-3 divide-y divide-line border-t border-line">
        {proposal.workouts.map((w, i) => {
          const key = `${w.date}-${i}`
          return (
            <div key={key} className="py-2">
              <button className="w-full flex flex-wrap items-baseline gap-x-3 text-left" onClick={() => setOpen(open === key ? null : key)}>
                <span className="w-28 text-xs text-slate-500 first-letter:uppercase">{dayLabel(w.date)}</span>
                <span className="text-sm text-slate-100">{w.title}</span>
                <span className="text-xs text-slate-500">
                  {SESSION_LABEL[w.type]}
                  {w.durationMin ? ` · ${formatDuration(w.durationMin * 60)}` : ''}
                  {w.distanceKm ? ` · ${w.distanceKm.toString().replace('.', ',')} km` : ''}
                  {w.tss ? ` · ${Math.round(w.tss)} TSS` : ''}
                </span>
                {w.description && <span className="ml-auto text-xs text-slate-500">{open === key ? 'ocultar' : 'ver'}</span>}
              </button>
              {open === key && w.description && (
                <p className="mt-2 text-sm text-slate-300 whitespace-pre-line leading-relaxed">{w.description}</p>
              )}
            </div>
          )
        })}
      </div>

      {cmp && (
        <div className="mt-4">
          <div className="g-label mb-2">Día a día: entrenador / IA</div>
          <div className="grid grid-cols-7 gap-px bg-line border border-line text-center">
            {cmp.days.map(d => (
              <div key={d.weekday} className="bg-cell p-1.5">
                <div className="text-[10px] text-slate-500">{DAYS[d.weekday]}</div>
                <div className="text-[11px] text-slate-200 mt-1">{d.coach.map(f => FAMILY_LABEL[f]).join('+')}</div>
                <div className="text-[11px] text-slate-400">{d.ai.map(f => FAMILY_LABEL[f]).join('+')}</div>
                <div className="mt-1 h-1" style={{ background: d.score === 1 ? '#c5f23c' : d.score > 0 ? '#fbbf24' : '#3a3a40' }} />
              </div>
            ))}
          </div>
          <div className="text-xs text-slate-500 mt-2">
            Tipos de sesión {Math.round(cmp.typeScore * 100)} %
            {cmp.minutesScore != null && ` · tiempo ${Math.round(cmp.coachMinutes)} frente a ${Math.round(cmp.aiMinutes)} min (${Math.round(cmp.minutesScore * 100)} %)`}
            {cmp.tssScore != null && ` · carga ${Math.round(cmp.coachTss)} frente a ${Math.round(cmp.aiTss)} TSS (${Math.round(cmp.tssScore * 100)} %)`}
          </div>
        </div>
      )}

      {onDelete && (
        <button onClick={onDelete} className="mt-3 text-xs text-slate-500 hover:text-red-300">Borrar propuesta</button>
      )}
    </div>
  )
}
