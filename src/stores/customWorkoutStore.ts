import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { CustomWorkout } from '../utils/customWorkouts'

// Entrenos propios del Calendario: solo en este navegador (localStorage), nunca en TrainingPeaks.

interface CustomWorkoutState {
  workouts: CustomWorkout[]
  addWorkout: (w: Omit<CustomWorkout, 'id'>) => void
  updateWorkout: (id: string, w: Omit<CustomWorkout, 'id'>) => void
  deleteWorkout: (id: string) => void
}

export const useCustomWorkoutStore = create<CustomWorkoutState>()(
  persist(
    (set) => ({
      workouts: [],
      addWorkout: (w) => set(s => ({ workouts: [...s.workouts, { ...w, id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}` }] })),
      updateWorkout: (id, w) => set(s => ({ workouts: s.workouts.map(x => (x.id === id ? { ...w, id } : x)) })),
      deleteWorkout: (id) => set(s => ({ workouts: s.workouts.filter(x => x.id !== id) })),
    }),
    { name: 'suunto-entrenos' },
  ),
)
