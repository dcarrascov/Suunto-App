import { useEffect, useState } from 'react'

interface AuthStatus {
  mode: 'none' | 'authelia'
  user: string | null
  logoutUrl: string | null
}

/** Ajustes → cómo está protegida la app. Solo informa: el modo se elige en el servidor (AUTH_MODE), nunca aquí. */
export default function AccessSection() {
  const [status, setStatus] = useState<AuthStatus | null>(null)

  useEffect(() => {
    fetch('/api/auth/status', { cache: 'no-store' })
      .then(r => (r.ok && r.headers.get('content-type')?.includes('json') ? r.json() as Promise<AuthStatus> : null))
      .then(setStatus)
      .catch(() => setStatus(null))
  }, [])

  return (
    <div className="space-y-3">
      <div className="g-label">Acceso</div>
      {!status && <p className="text-sm text-slate-400">Sin servidor: no se puede saber cómo está protegida.</p>}
      {status?.mode === 'none' && <p className="text-sm text-slate-300">Solo en este ordenador, sin login.</p>}
      {status?.mode === 'authelia' && (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-slate-300">
            Protegido con Authelia · has entrado como <span className="font-medium text-slate-100">{status.user}</span>
          </p>
          {status.logoutUrl && (
            <a href={status.logoutUrl} className="px-3 py-1.5 text-sm text-slate-200 border border-slate-600 hover:border-slate-400">
              Cerrar sesión
            </a>
          )}
        </div>
      )}
      <p className="text-xs text-slate-600">
        Se cambia en la configuración del servidor (AUTH_MODE), no aquí, para que nadie pueda quitar el login desde el navegador.
        Para publicarla en tu dominio, mira la guía de despliegue.
      </p>
    </div>
  )
}
