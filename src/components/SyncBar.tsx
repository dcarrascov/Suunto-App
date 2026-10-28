import { useEffect } from 'react'
import { Flag, X } from 'lucide-react'
import { useSyncStore, type SyncStatus } from '../stores/syncStore'

const STEP_LABEL: Record<SyncStatus['step'], string> = {
  inicio: 'Arrancando',
  suunto: 'Suunto',
  trainingpeaks: 'TrainingPeaks',
  validacion: 'Validando los datos',
  fin: 'Terminado',
}

/** Corredor plano en dos posturas que se alternan (clases .runner-a / .runner-b de index.css). */
function Runner({ moving }: { moving: boolean }) {
  return (
    <svg width="22" height="24" viewBox="0 0 22 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="13" cy="3.5" r="2.4" fill="currentColor" stroke="none" />
      <path d="M12 7 L10 14" />
      <g className={moving ? 'runner-a' : ''}>
        <path d="M11.5 8.5 L15.5 11 L18 9" />
        <path d="M11.5 8.5 L7.5 10 L5.5 13" />
        <path d="M10 14 L14 17.5 L13 22" />
        <path d="M10 14 L6.5 18 L3 18" />
      </g>
      {moving && (
        <g className="runner-b">
          <path d="M11.5 8.5 L8 11 L6 9.5" />
          <path d="M11.5 8.5 L14.5 11 L16 14" />
          <path d="M10 14 L7.5 18 L8.5 22" />
          <path d="M10 14 L14.5 16.5 L17 19.5" />
        </g>
      )}
    </svg>
  )
}

/** Barra arriba del todo (ocupa su sitio, no tapa nada) mientras se actualizan los datos: el corredor avanza hasta la meta. */
export default function SyncBar() {
  const status = useSyncStore(s => s.status)
  const resume = useSyncStore(s => s.resume)
  const dismiss = useSyncStore(s => s.dismiss)
  useEffect(() => { void resume() }, [resume])
  if (!status) return null

  const failed = status.ok === false
  const pct = Math.max(0, Math.min(100, status.percent))
  const detail = status.step !== 'suunto' ? ''
    : status.total ? ` · ${status.done}/${status.total} actividades` : ' · descargando la lista de entrenamientos'
  const message = failed
    ? status.error
    : status.ok
      ? status.planFailed
        ? `Suunto actualizado en ${status.seconds} s; TrainingPeaks ha fallado (¿cookie caducada?).`
        : `Actualizado en ${status.seconds} s${status.planSkipped ? ' (sin TrainingPeaks: no hay cookie en .env)' : ''}.`
      : `${STEP_LABEL[status.step]}${detail}`
  const color = failed ? 'text-red-400' : status.ok && status.planFailed ? 'text-amber-300' : 'text-accent'
  const lineColor = failed ? 'bg-red-400' : status.ok && status.planFailed ? 'bg-amber-300' : 'bg-accent'

  return (
    <div className="sticky top-0 z-[1100] bg-[#0f0f11] border-b border-line px-4 pt-1.5 pb-1" role="status" aria-live="polite">
      <div className="flex items-end gap-2">
        {/* Pista: el corredor recorre de 0 a 100 % y la meta está justo después */}
        <div className="relative flex-1 h-7">
          <div className="absolute inset-x-0 bottom-1 h-px bg-slate-700" />
          <div className={`absolute left-0 bottom-1 h-px ${lineColor} transition-[width] duration-700 ease-out`} style={{ width: `${pct}%` }} />
          <div
            className={`absolute bottom-1 -translate-x-full transition-[left] duration-700 ease-out ${color}`}
            style={{ left: `max(22px, ${pct}%)` }}   // al principio, que no se salga por la izquierda
          >
            <Runner moving={status.running} />
          </div>
        </div>
        <Flag size={20} strokeWidth={1.75} className={`mb-1 shrink-0 ${status.ok ? color : 'text-slate-400'}`} aria-label="Meta" />
        {!status.running && (
          <button onClick={dismiss} className="mb-1 text-slate-500 hover:text-white" aria-label="Cerrar">
            <X size={16} />
          </button>
        )}
      </div>
      <div className="flex justify-between text-[11px] leading-tight">
        <span className={failed ? 'text-red-300' : 'text-slate-400'}>{message}</span>
        {!failed && <span className="text-slate-500 tabular-nums">{Math.round(pct)} %</span>}
      </div>
    </div>
  )
}
