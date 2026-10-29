import { useCallback, useEffect, useRef, useState } from 'react'
import { Upload } from 'lucide-react'
import { useActivityStore } from '../stores/activityStore'
import { useSyncStore } from '../stores/syncStore'

type Row = { file: string; status: 'subiendo' | 'saved' | 'exists' | 'invalid'; detail?: string }
type Listing = { files: { name: string; size: number }[]; demo: boolean } | null | 'sin-servidor'

const STATUS_LABEL: Record<Row['status'], string> = {
  subiendo: 'Subiendo…', saved: 'Subido', exists: 'Ya estaba', invalid: 'No válido',
}
const STATUS_COLOR: Record<Row['status'], string> = {
  subiendo: 'text-slate-400', saved: 'text-accent', exists: 'text-slate-400', invalid: 'text-red-300',
}

/**
 * Sube ficheros .fit a fetch/fit/ (ruta /api/fit) y los procesa. Si tus datos vienen de la cuenta de Suunto,
 * se suman a ellos sin repetir sesiones; si no, se usan solos (Ruta B).
 */
export default function FitImport() {
  const activities = useActivityStore(s => s.activities)
  const syncing = useSyncStore(s => s.status?.running ?? false)
  const startSync = useSyncStore(s => s.start)
  const [listing, setListing] = useState<Listing>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [over, setOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const fromCloud = activities.some(a => a.suuntoKey)
  const fitCount = activities.filter(a => a.sourceFile).length

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/fit', { cache: 'no-store' })
      setListing(res.ok ? await res.json() : 'sin-servidor')
    } catch {
      setListing('sin-servidor')
    }
  }, [])
  useEffect(() => { void refresh() }, [refresh])

  async function upload(files: File[]) {
    const fits = files.filter(f => /\.fit$/i.test(f.name))
    const skipped = files.filter(f => !/\.fit$/i.test(f.name))
    setRows(r => [
      ...skipped.map(f => ({ file: f.name, status: 'invalid' as const, detail: 'No acaba en .fit' })),
      ...fits.map(f => ({ file: f.name, status: 'subiendo' as const })),
      ...r,
    ])
    for (const f of fits) {   // de uno en uno: el servidor compara cada uno con los que ya hay
      let row: Row
      try {
        const res = await fetch(`/api/fit?name=${encodeURIComponent(f.name)}`, { method: 'PUT', body: f })
        const body = await res.json() as { status: Row['status']; name?: string; error?: string }
        row = { file: f.name, status: body.status, detail: body.status === 'invalid' ? body.error : body.name !== f.name ? `como ${body.name}` : undefined }
      } catch {
        row = { file: f.name, status: 'invalid', detail: 'Sin conexión con el servidor de la app' }
      }
      setRows(r => r.map(x => (x.file === f.name && x.status === 'subiendo' ? row : x)))
    }
    void refresh()
  }

  const newOnes = rows.filter(r => r.status === 'saved').length
  const info = listing && listing !== 'sin-servidor' ? listing : null   // lo que dice el servidor, si responde
  const disabled = listing === 'sin-servidor' || !!info?.demo

  return (
    <div className="page">
      <h1 className="text-xl font-semibold text-slate-100">Importar FIT</h1>
      <p className="text-sm text-slate-500 mt-0.5 mb-6 max-w-3xl">
        Sube los ficheros <code>.fit</code> que exportes de la app de Suunto (o de otro reloj). Se guardan en
        <code> fetch/fit/</code> de tu ordenador y, al procesarlos,{' '}
        {fromCloud
          ? 'se suman a tus actividades de la cuenta de Suunto: las sesiones que ya estén allí no se repiten.'
          : 'pasan a ser tus actividades (Ruta B, sin cuenta de Suunto).'}
      </p>

      {listing === 'sin-servidor' && (
        <div className="g-cell border border-line mb-6 text-sm text-slate-300">
          Abre la app con <code className="text-slate-100">npm run dev</code>: la subida la hace ese servidor.
        </div>
      )}
      {info?.demo && (
        <div className="g-cell border border-line mb-6 text-sm text-slate-300">En la demo no se suben ficheros.</div>
      )}

      <div className="g-grid">
        <div className="g-cell col-span-12 lg:col-span-7 space-y-3">
          <div className="g-label">1 · Subir ficheros</div>
          <button
            type="button"
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
            onDragOver={e => { e.preventDefault(); if (!disabled) setOver(true) }}
            onDragLeave={() => setOver(false)}
            onDrop={e => { e.preventDefault(); setOver(false); if (!disabled) void upload([...e.dataTransfer.files]) }}
            className={`w-full border-2 border-dashed px-4 py-10 text-center transition-colors disabled:opacity-40 ${over ? 'border-accent bg-accent/5' : 'border-slate-600 hover:border-slate-400'}`}
          >
            <Upload size={28} strokeWidth={1.5} className="mx-auto text-slate-400" aria-hidden />
            <div className="text-sm text-slate-200 mt-2">Arrastra aquí los ficheros .fit o pulsa para elegirlos</div>
            <div className="text-xs text-slate-500 mt-1">Varios a la vez · hasta 20 MB cada uno · los repetidos no se duplican</div>
          </button>
          <input
            ref={inputRef} type="file" accept=".fit,.FIT" multiple className="hidden"
            onChange={e => { const fs = [...(e.target.files ?? [])]; e.target.value = ''; if (fs.length) void upload(fs) }}
          />
          {rows.length > 0 && (
            <div className="divide-y divide-line border border-line max-h-72 overflow-y-auto">
              {rows.map((r, i) => (
                <div key={`${r.file}-${i}`} className="flex items-center gap-3 px-3 py-1.5 text-sm">
                  <span className="flex-1 min-w-0 truncate text-slate-200">{r.file}</span>
                  {r.detail && <span className="text-xs text-slate-500 truncate">{r.detail}</span>}
                  <span className={`text-xs shrink-0 ${STATUS_COLOR[r.status]}`}>{STATUS_LABEL[r.status]}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="g-cell col-span-12 lg:col-span-5 space-y-3">
          <div className="g-label">2 · Procesarlos</div>
          <p className="text-sm text-slate-400">
            {fromCloud
              ? 'Lanza la actualización normal (Suunto, TrainingPeaks y validación), que ahora también lee los ficheros FIT.'
              : 'Lee todos los ficheros FIT de la carpeta y valida los datos.'}
            {' '}Sigue el progreso en la barra de arriba.
          </p>
          <button
            onClick={() => void startSync(fromCloud ? 'normal' : 'fit')}
            disabled={disabled || syncing || info?.files.length === 0}
            className="px-3 py-1.5 text-sm font-medium bg-accent text-black hover:brightness-110 disabled:opacity-40"
          >
            {syncing ? 'Procesando…' : newOnes ? `Procesar (${newOnes} nuevos)` : 'Procesar los ficheros'}
          </button>
          <div className="text-xs text-slate-500 space-y-1">
            <div>En la carpeta: {info ? `${info.files.length} ficheros FIT` : '—'}</div>
            <div>En la app: {fitCount} actividades salen de ficheros FIT (marcadas «FIT» en Actividades).</div>
          </div>
          {info && info.files.length > 0 && (
            <details className="text-xs text-slate-500">
              <summary className="cursor-pointer hover:text-white">Ver los ficheros</summary>
              <ul className="mt-2 max-h-48 overflow-y-auto space-y-0.5">
                {info.files.map(f => <li key={f.name} className="truncate">{f.name} · {Math.round(f.size / 1024)} KB</li>)}
              </ul>
            </details>
          )}
        </div>
      </div>
    </div>
  )
}
