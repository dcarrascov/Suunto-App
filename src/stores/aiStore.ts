import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { SessionType } from '../utils/coach'

// Lo que devuelve Gemini: perfil del entrenador, semanas propuestas y el objetivo del modo «sin entrenador».
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
  mode?: 'coach' | 'free'    // coach (o sin valor) = como tu entrenador · free = sin entrenador
  workouts: AiWorkout[]
}

export type FreeGoalDistance = '5k' | '10k' | '21k' | '42k' | 'none'

/** Objetivo y disponibilidad para el modo «sin entrenador». */
export interface FreeGoal {
  distance: FreeGoalDistance
  raceDate: string | null    // YYYY-MM-DD; null = sin fecha
  raceName: string | null    // si viene de una competición del calendario
  daysPerWeek: number        // 3..7
  longRunDay: number | null  // 0 = lunes … 6 = domingo; null = que elija la IA
  level: 'nuevo' | 'algo' | 'habitual' | null      // solo si no hay actividades
  hoursPerWeek: number | null                      // solo si no hay actividades
}

export const DEFAULT_FREE_GOAL: FreeGoal = {
  distance: 'none', raceDate: null, raceName: null, daysPerWeek: 4, longRunDay: 6, level: null, hoursPerWeek: null,
}

interface AiState {
  profile: { text: string; savedAt: string; model?: string } | null   // perfil del entrenador escrito por Gemini
  proposals: Record<string, AiProposal>                // como tu entrenador, por lunes de la semana
  freeProposals: Record<string, AiProposal>            // sin entrenador, por lunes de la semana
  freeGoal: FreeGoal
  reviews: Record<string, WeekReview>                  // revisión de la semana hecha, por lunes
  saveProfile: (text: string, model?: string) => void
  clearProfile: () => void
  saveProposal: (p: AiProposal) => void
  deleteProposal: (weekStart: string) => void
  saveFreeProposal: (p: AiProposal) => void
  deleteFreeProposal: (weekStart: string) => void
  setFreeGoal: (g: Partial<FreeGoal>) => void
  saveReview: (weekStart: string, r: WeekReview) => void
  deleteReview: (weekStart: string) => void
}

export interface WeekReview {
  text: string
  savedAt: string
  model?: string
}

export const useAiStore = create<AiState>()(
  persist(
    (set) => ({
      profile: null,
      proposals: {},
      freeProposals: {},
      freeGoal: DEFAULT_FREE_GOAL,
      reviews: {},
      saveProfile: (text, model) => set({ profile: { text: text.trim(), savedAt: new Date().toLocaleString('es-ES'), model } }),
      clearProfile: () => set({ profile: null }),
      saveProposal: (p) => set(s => ({ proposals: { ...s.proposals, [p.weekStart]: p } })),
      deleteProposal: (weekStart) => set(s => {
        const rest = { ...s.proposals }
        delete rest[weekStart]
        return { proposals: rest }
      }),
      saveFreeProposal: (p) => set(s => ({ freeProposals: { ...s.freeProposals, [p.weekStart]: { ...p, mode: 'free' } } })),
      deleteFreeProposal: (weekStart) => set(s => {
        const rest = { ...s.freeProposals }
        delete rest[weekStart]
        return { freeProposals: rest }
      }),
      setFreeGoal: (g) => set(s => ({ freeGoal: { ...s.freeGoal, ...g } })),
      saveReview: (weekStart, r) => set(s => ({ reviews: { ...s.reviews, [weekStart]: r } })),
      deleteReview: (weekStart) => set(s => {
        const rest = { ...s.reviews }
        delete rest[weekStart]
        return { reviews: rest }
      }),
    }),
    {
      name: 'suunto-ai',
      // lo guardado con versiones anteriores no tiene el modo «sin entrenador»
      merge: (saved, current) => {
        const s = (saved ?? {}) as Partial<AiState>
        return { ...current, ...s, freeProposals: s.freeProposals ?? {}, reviews: s.reviews ?? {}, freeGoal: { ...DEFAULT_FREE_GOAL, ...s.freeGoal } }
      },
    },
  ),
)
