import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { SessionType } from '../utils/coach'

// Lo que se trae de vuelta de Gemini (opción A: copiar y pegar, sin API).
// Se guarda solo en este navegador (localStorage); nunca se envía a TrainingPeaks.

export interface AiWorkout {
  date: string               // YYYY-MM-DD
  type: SessionType
  title: string
  description: string
  durationMin: number | null
  distanceKm: number | null
  tss: number | null
}

export interface AiProposal {
  weekStart: string          // lunes de la semana propuesta
  createdAt: string          // ISO local
  explanation: string
  model?: string             // modelo de Gemini que la generó
  workouts: AiWorkout[]
}

interface AiState {
  profile: { text: string; savedAt: string; model?: string } | null   // perfil del entrenador escrito por Gemini
  proposals: Record<string, AiProposal>                // por lunes de la semana
  saveProfile: (text: string, model?: string) => void
  clearProfile: () => void
  saveProposal: (p: AiProposal) => void
  deleteProposal: (weekStart: string) => void
}

export const useAiStore = create<AiState>()(
  persist(
    (set) => ({
      profile: null,
      proposals: {},
      saveProfile: (text, model) => set({ profile: { text: text.trim(), savedAt: new Date().toLocaleString('es-ES'), model } }),
      clearProfile: () => set({ profile: null }),
      saveProposal: (p) => set(s => ({ proposals: { ...s.proposals, [p.weekStart]: p } })),
      deleteProposal: (weekStart) => set(s => {
        const rest = { ...s.proposals }
        delete rest[weekStart]
        return { proposals: rest }
      }),
    }),
    { name: 'suunto-ai' },
  ),
)
