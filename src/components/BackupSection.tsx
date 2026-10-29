import { useRef, useState } from 'react'
import { backupFileName, BACKUP_KEYS, makeBackup, readBackup, restoreBackup } from '../utils/backup'

/** Ajustes → exportar e importar lo que la app guarda en este navegador. */
export default function BackupSection() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  function exportBackup() {
    const backup = makeBackup(localStorage)
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = backupFileName()
    a.click()
    URL.revokeObjectURL(url)
    setMessage({ ok: true, text: `Copia descargada (${Object.keys(backup.data).length} apartados).` })
  }

  async function importBackup(file: File) {
    const r = readBackup(await file.text())
    if (!r.ok) {
      setMessage({ ok: false, text: r.error })
      return
    }
    const when = r.backup.createdAt ? new Date(r.backup.createdAt).toLocaleString('es-ES') : 'fecha desconocida'
    const ok = window.confirm(
      `Copia del ${when}:\n- ${r.summary.join('\n- ')}\n\n¿Sustituir lo que hay ahora en este navegador por esto? No se puede deshacer.`,
    )
    if (!ok) return
    restoreBackup(r.backup, localStorage)
    window.location.reload()   // las tiendas vuelven a leer lo guardado
  }

  return (
    <div className="space-y-3">
      <div className="g-label">Copia de seguridad</div>
      <p className="text-xs text-slate-500">
        Lo que guardas en la app vive solo en este navegador: {Object.values(BACKUP_KEYS).join('; ').toLowerCase()}.
        Si borras los datos del navegador o cambias de ordenador, se pierde. Descarga una copia de vez en cuando.
      </p>
      <div className="flex flex-wrap gap-2">
        <button onClick={exportBackup} className="px-3 py-1.5 text-sm font-medium bg-accent text-black hover:brightness-110">
          Exportar copia
        </button>
        <button onClick={() => fileRef.current?.click()} className="px-3 py-1.5 text-sm text-slate-200 border border-slate-600 hover:border-slate-400">
          Importar copia…
        </button>
        <input
          ref={fileRef} type="file" accept="application/json,.json" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importBackup(f) }}
        />
      </div>
      {message && <p className={`text-xs ${message.ok ? 'text-slate-400' : 'text-red-300'}`}>{message.text}</p>}
      <p className="text-xs text-slate-600">
        No incluye claves (la de la IA y la cookie siguen en .env), pero sí tus datos: guárdala tú y no la subas a GitHub.
      </p>
    </div>
  )
}
