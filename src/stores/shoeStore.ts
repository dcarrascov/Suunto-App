import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DEFAULT_TAGS, NONE, withDefault, type Shoe, type ShoeData } from '../utils/shoes'

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
        // el primer par pasa a ser el de por defecto
        set(st => ({ shoes: [...st.shoes, shoe], defaults: st.defaults.length ? st.defaults : withDefault([], shoe) }))
      },
      updateShoe: (id, s) => set(st => ({ shoes: st.shoes.map(x => (x.id === id ? { ...x, ...s } : x)) })),
      deleteShoe: (id) => set(st => ({
        shoes: st.shoes.filter(x => x.id !== id),
        defaults: st.defaults.filter(d => d.shoeId !== id),
        assignments: Object.fromEntries(Object.entries(st.assignments).filter(([, v]) => v !== id)),
      })),
      setDefault: (id) => {
        const shoe = get().shoes.find(s => s.id === id)
        if (shoe) set(st => ({ defaults: withDefault(st.defaults, shoe) }))
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
      deleteTag: (id) => set(st => (st.shoes.some(s => s.tagId === id) ? st : { tags: st.tags.filter(t => t.id !== id) })),
    }),
    { name: 'suunto-zapatillas' },
  ),
)

export { NONE }
