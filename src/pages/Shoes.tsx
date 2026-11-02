import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useActivityStore } from '../stores/activityStore'
import { useShoeStore } from '../stores/shoeStore'
import { toLocalISODate, parseLocalDate } from '../utils/date'
import { DEFAULT_LIMIT_KM, defaultShoeOn, shoeUsage, wearColor, type Shoe, type ShoeUsage } from '../utils/shoes'

const FIELD = 'w-full bg-[#0f0f11] border border-slate-700 px-2.5 py-1.5 text-sm text-slate-100 focus:outline-none focus:border-accent'
const PRIMARY = 'px-3 py-1.5 text-sm font-medium bg-accent text-black hover:brightness-110 disabled:opacity-40'
const SECONDARY = 'px-3 py-1.5 text-xs text-slate-300 border border-slate-600 hover:border-slate-400'
const DANGER = 'px-3 py-1.5 text-xs text-slate-300 border border-slate-600 hover:border-red-400 hover:text-red-300'
interface Form {
  name: string
  tagIds: string[]
  newTag: string
  startKm: string
  limitKm: string
}

const fmtKm = (v: number) => Math.round(v).toLocaleString('es-ES')
const fmtDate = (iso: string) => parseLocalDate(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })

function emptyForm(): Form {
  return { name: '', tagIds: ['rodaje'], newTag: '', startKm: '0', limitKm: String(DEFAULT_LIMIT_KM) }
}

export default function Shoes() {
  const activities = useActivityStore(s => s.activities)
  const st = useShoeStore()
  const today = toLocalISODate(new Date())
  const [form, setForm] = useState<Form>(emptyForm)
  const [editing, setEditing] = useState<string | null>(null)   // id del par que se edita; null = nuevo
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)

  const usage = useMemo(
    () => shoeUsage(activities, { shoes: st.shoes, tags: st.tags, defaults: st.defaults, assignments: st.assignments }),
    [activities, st.shoes, st.tags, st.defaults, st.assignments],
  )
  const current = defaultShoeOn(st, today)
  const active = usage.filter(u => u.shoe.retiredDate == null).sort((a, b) => b.ratio - a.ratio)
  const retired = usage.filter(u => u.shoe.retiredDate != null)
  const tagName = (id: string) => st.tags.find(t => t.id === id)?.name ?? 'Sin etiqueta'
  const usedTags = new Set(st.shoes.flatMap(s => s.tagIds))

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm(f => ({ ...f, [k]: v }))
  const toggleTag = (id: string) =>
    setForm(f => ({ ...f, tagIds: f.tagIds.includes(id) ? f.tagIds.filter(x => x !== id) : [...f.tagIds, id] }))

  function createTag() {
    if (!form.newTag.trim()) return
    const id = st.addTag(form.newTag)
    setForm(f => ({ ...f, newTag: '', tagIds: f.tagIds.includes(id) ? f.tagIds : [...f.tagIds, id] }))
  }

  function openNew() {
    setEditing(null)
    setForm(emptyForm())
    setError(null)
    setShowForm(true)
  }

  function openEdit(s: Shoe) {
    setEditing(s.id)
    setForm({ name: s.name, tagIds: s.tagIds, newTag: '', startKm: String(s.startKm), limitKm: String(s.limitKm) })
    setError(null)
    setShowForm(true)
  }

  function save(e: React.FormEvent) {
    e.preventDefault()
    const name = form.name.trim()
    const startKm = Number(form.startKm.replace(',', '.') || 0)
    const limitKm = Number(form.limitKm.replace(',', '.'))
    if (!name) return setError('Ponle un nombre (p. ej. la marca y el modelo).')
    if (!Number.isFinite(startKm) || startKm < 0) return setError('Los km de partida deben ser 0 o más.')
    if (!Number.isFinite(limitKm) || limitKm <= 0) return setError('El límite debe ser un número de km mayor que 0.')
    // una etiqueta escrita y sin añadir también cuenta
    const tagIds = form.newTag.trim() ? [...new Set([...form.tagIds, st.addTag(form.newTag)])] : form.tagIds
    const data = { name, tagIds, startKm, limitKm }
    if (editing) st.updateShoe(editing, data)
    else st.addShoe(data)
    setShowForm(false)
  }

  function ShoeCard({ u }: { u: ShoeUsage }) {
    const s = u.shoe
    const isDefault = current?.id === s.id
    return (
      <div className="g-cell col-span-12 md:col-span-6 xl:col-span-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-base font-semibold text-slate-100">{s.name}</div>
            <div className="flex flex-wrap items-center gap-1.5 mt-1">
              {s.tagIds.map(id => (
                <span key={id} className="text-[10px] font-semibold border border-slate-500 text-slate-300 px-1.5 py-0.5">{tagName(id).toUpperCase()}</span>
              ))}
              {isDefault && <span className="text-[10px] font-semibold bg-accent text-black px-1.5 py-0.5">POR DEFECTO</span>}
              {s.retiredDate && <span className="text-[10px] text-slate-500">retiradas el {fmtDate(s.retiredDate)}</span>}
            </div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-semibold" style={{ color: wearColor(u.ratio) }}>{fmtKm(u.km)}</div>
            <div className="text-[11px] text-slate-500">de {fmtKm(s.limitKm)} km</div>
          </div>
        </div>
        <div className="h-1.5 bg-slate-800">
          <div className="h-full" style={{ width: `${Math.min(100, u.ratio * 100)}%`, background: wearColor(u.ratio) }} />
        </div>
        <div className="text-xs text-slate-500">
          {u.runs} salidas{s.startKm ? ` (con ${fmtKm(s.startKm)} km previos)` : ''}
          {u.lastRun && ` · última el ${fmtDate(u.lastRun)}`}
          {u.ratio >= 1 && <span className="text-red-300"> · han pasado su límite</span>}
        </div>
        <div className="flex flex-wrap gap-2">
          {!s.retiredDate && !isDefault && <button className={SECONDARY} onClick={() => st.setDefault(s.id)}>Usar por defecto</button>}
          <button className={SECONDARY} onClick={() => openEdit(s)}>Editar</button>
          {s.retiredDate
            ? <button className={SECONDARY} onClick={() => st.updateShoe(s.id, { retiredDate: null })}>Volver a usar</button>
            : <button className={SECONDARY} onClick={() => { if (window.confirm(`¿Retirar «${s.name}»? Sus km se conservan; desde mañana no reciben carreras.`)) st.updateShoe(s.id, { retiredDate: today }) }}>Retirar</button>}
          <button className={DANGER} onClick={() => { if (window.confirm(`¿Borrar «${s.name}» y todo su historial de km?`)) st.deleteShoe(s.id) }}>Borrar</button>
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold text-slate-100">Zapatillas</h1>
        <button className={PRIMARY} onClick={openNew}>Añadir zapatillas</button>
      </div>
      <p className="text-sm text-slate-500 mt-0.5 mb-6 max-w-3xl">
        Cada carrera suma sus km al par <span className="text-slate-300">por defecto</span> de ese día. Si un día usas otras
        (por ejemplo, las de competición), cámbialas en el Detalle de la actividad. Se guarda solo en este navegador.
      </p>

      {showForm && (
        <form onSubmit={save} className="g-cell border border-slate-700 mb-6 space-y-3">
          <div className="g-label">{editing ? 'Editar zapatillas' : 'Nuevas zapatillas'}</div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <label className="block text-xs text-slate-400">Nombre
              <input autoFocus className={`${FIELD} mt-1`} value={form.name} onChange={e => set('name', e.target.value)} placeholder="Marca y modelo" />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs text-slate-400">Km previos
                <input inputMode="decimal" className={`${FIELD} mt-1`} value={form.startKm} onChange={e => set('startKm', e.target.value)} />
              </label>
              <label className="block text-xs text-slate-400">Límite (km)
                <input inputMode="decimal" className={`${FIELD} mt-1`} value={form.limitKm} onChange={e => set('limitKm', e.target.value)} />
              </label>
            </div>
          </div>
          <div className="space-y-2">
            <div className="text-xs text-slate-400">Etiquetas (puedes marcar varias)</div>
            <div className="flex flex-wrap gap-2">
              {st.tags.map(t => {
                const on = form.tagIds.includes(t.id)
                return (
                  <button
                    key={t.id} type="button" onClick={() => toggleTag(t.id)} aria-pressed={on}
                    className={`text-xs px-2 py-1 border ${on ? 'bg-accent text-black border-accent' : 'border-slate-600 text-slate-300 hover:border-slate-400'}`}
                  >
                    {t.name}
                  </button>
                )
              })}
            </div>
            <div className="flex gap-2 max-w-sm">
              <input
                className={FIELD} value={form.newTag} onChange={e => set('newTag', e.target.value)} placeholder="Etiqueta nueva: Trail, Pista…"
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); createTag() } }}
              />
              <button type="button" className={SECONDARY} onClick={createTag} disabled={!form.newTag.trim()}>Crear</button>
            </div>
          </div>
          {error && <p className="text-sm text-red-300">{error}</p>}
          <div className="flex gap-2">
            <button type="submit" className={PRIMARY}>Guardar</button>
            <button type="button" className={SECONDARY} onClick={() => setShowForm(false)}>Cancelar</button>
          </div>
          {!editing && st.shoes.length === 0 && (
            <p className="text-xs text-slate-500">El primer par queda como el de por defecto desde hoy; las carreras de antes puedes asignárselas en su Detalle.</p>
          )}
        </form>
      )}

      {st.shoes.length === 0 && !showForm && (
        <div className="text-sm text-slate-500">Aún no has añadido zapatillas.</div>
      )}

      {active.length > 0 && <div className="g-grid mb-6">{active.map(u => <ShoeCard key={u.shoe.id} u={u} />)}</div>}

      {retired.length > 0 && (
        <details className="mb-6">
          <summary className="text-xs text-slate-400 cursor-pointer hover:text-white mb-2">Retiradas ({retired.length})</summary>
          <div className="g-grid">{retired.map(u => <ShoeCard key={u.shoe.id} u={u} />)}</div>
        </details>
      )}

      <div className="g-cell border border-line space-y-2">
        <div className="g-label">Etiquetas</div>
        <div className="flex flex-wrap gap-2">
          {st.tags.map(t => (
            <span key={t.id} className="inline-flex items-center gap-1.5 text-xs border border-slate-600 text-slate-300 px-2 py-1">
              {t.name}
              {!usedTags.has(t.id) && (
                <button onClick={() => st.deleteTag(t.id)} className="text-slate-500 hover:text-red-300" aria-label={`Borrar la etiqueta ${t.name}`}>×</button>
              )}
            </span>
          ))}
        </div>
        <p className="text-xs text-slate-500">Crea etiquetas nuevas al añadir o editar unas zapatillas; cada par puede tener varias. Solo se pueden borrar las que no usa ningún par.</p>
      </div>

      {st.shoes.length > 0 && (
        <p className="text-xs text-slate-500 mt-4">
          ¿Un día con otras zapatillas? Ábrelo en <Link to="/activities" className="text-accent">Actividades</Link> y cámbialas en su Detalle.
        </p>
      )}
    </div>
  )
}
