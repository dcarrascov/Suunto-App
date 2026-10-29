import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { CustomWorkout } from '../utils/customWorkouts'

// Entrenos propios del Calendario: solo en este navegador (localStorage), nunca en TrainingPeaks.

interface CustomWorkoutState {
  workouts: CustomWorkout[]
  addWorkout: (w: Omit<CustomWorkout, 'id'>) => void
  updateWorkout: (id: string, w: Omit<CustomWorkout, 'id'>) => void
  deleteWorkout: (id: string) => void
  /** Copia (o vuelve a copiar, sin duplicar) las sesiones de una propuesta de la IA. */
  replaceProposal: (key: string, list: Omit<CustomWorkout, 'id'>[]) => void
  /** Quita del Calendario todo lo que vino de esa propuesta. */
  removeProposal: (key: string) => void
}

const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

export const useCustomWorkoutStore = create<CustomWorkoutState>()(
  persist(
    (set) => ({
      workouts: [],
      addWorkout: (w) => set(s => ({ workouts: [...s.workouts, { ...w, id: newId() }] })),
      // se mezcla con lo que había: al editar un entreno de la IA no pierde su etiqueta
      updateWorkout: (id, w) => set(s => ({ workouts: s.workouts.map(x => (x.id === id ? { ...x, ...w, id } : x)) })),
      deleteWorkout: (id) => set(s => ({ workouts: s.workouts.filter(x => x.id !== id) })),
      replaceProposal: (key, list) => set(s => ({
        workouts: [...s.workouts.filter(x => x.proposalKey !== key), ...list.map(w => ({ ...w, id: newId() }))],
      })),
      removeProposal: (key) => set(s => ({ workouts: s.workouts.filter(x => x.proposalKey !== key) })),
    }),
    { name: 'suunto-entrenos' },
  ),
)
