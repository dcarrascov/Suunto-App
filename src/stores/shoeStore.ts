import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DEFAULT_TAGS, NONE, migrateShoes, withDefault, type Shoe, type ShoeData } from '../utils/shoes'
import { toLocalISODate } from '../utils/date'

// Zapatillas: solo en este navegador (localStorage `suunto-zapatillas`); entra en la copia de seguridad.

interface ShoeState extends ShoeData {
  addShoe: (s: Omit<Shoe, 'id' | 'retiredDate'>) => void
  updateShoe: (id: string, s: Partial<Omit<Shoe, 'id'>>) => void
  deleteShoe: (id: string) => void
  setDefault: (id: string) => void
  /** Par de una actividad: un id, NONE (sin zapatillas) o null (volver al por defecto). */
  assign: (activityId: number, shoeId: string | null) => void
  addTag: (name: string) => string
  deleteTag: (id: string) => void
}

const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
const today = () => toLocalISODate(new Date())
const slug = (name: string) => name.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-')

export const useShoeStore = create<ShoeState>()(
  persist(
    (set, get) => ({
      shoes: [],
      tags: DEFAULT_TAGS,
      defaults: [],
      assignments: {},
      addShoe: (s) => {
        const shoe: Shoe = { ...s, id: newId(), retiredDate: null }
        // el primer par pasa a ser el de por defecto desde hoy
        set(st => ({ shoes: [...st.shoes, shoe], defaults: st.defaults.length ? st.defaults : withDefault([], shoe.id, today()) }))
      },
      updateShoe: (id, s) => set(st => ({ shoes: st.shoes.map(x => (x.id === id ? { ...x, ...s } : x)) })),
      deleteShoe: (id) => set(st => ({
        shoes: st.shoes.filter(x => x.id !== id),
        defaults: st.defaults.filter(d => d.shoeId !== id),
        assignments: Object.fromEntries(Object.entries(st.assignments).filter(([, v]) => v !== id)),
      })),
      setDefault: (id) => {
        if (get().shoes.some(s => s.id === id)) set(st => ({ defaults: withDefault(st.defaults, id, today()) }))
      },
      assign: (activityId, shoeId) => set(st => {
        const next = { ...st.assignments }
        if (shoeId == null) delete next[String(activityId)]
        else next[String(activityId)] = shoeId
        return { assignments: next }
      }),
      addTag: (name) => {
        const clean = name.trim()
        const existing = get().tags.find(t => t.name.toLowerCase() === clean.toLowerCase())
        if (existing) return existing.id
        const id = `${slug(clean) || 'etiqueta'}-${Math.random().toString(36).slice(2, 5)}`
        set(st => ({ tags: [...st.tags, { id, name: clean }] }))
        return id
      },
      deleteTag: (id) => set(st => (st.shoes.some(s => s.tagIds.includes(id)) ? st : { tags: st.tags.filter(t => t.id !== id) })),
    }),
    {
      name: 'suunto-zapatillas',
      // v1: varias etiquetas por par (antes `tagId`) y sin fecha de estreno
      version: 1,
      migrate: (old) => {
        const s = (old ?? {}) as Partial<ShoeData>
        return { ...s, shoes: migrateShoes(s.shoes ?? []) } as ShoeState
      },
    },
  ),
)

export { NONE }
