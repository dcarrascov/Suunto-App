import { describe, expect, it } from 'vitest'
import { applyLine, finish, IDLE, updateCommand, withListProgress, type SyncState } from './sync.ts'

const run = (lines: string[], from: SyncState = { ...IDLE, running: true, startedAt: 0 }) => lines.reduce<SyncState>((s, l) => applyLine(s, l), from)

describe('progreso de actualizar.ps1', () => {
  it('mientras llega la lista avanza por tiempo, sin pasar del 40 %', () => {
    const s = run(['== Suunto =='])
    expect(withListProgress(s, 0).percent).toBe(2)
    expect(withListProgress(s, 20_000).percent).toBeCloseTo(2 + 38 * (1 - Math.exp(-1)))
    expect(withListProgress(s, 600_000).percent).toBeLessThan(40)
    expect(withListProgress(run(['  [1/10] x'], s), 600_000).percent).toBe(44)   // con contador ya no cuenta el tiempo
  })
  it('las actividades llevan del 40 al 80 %', () => {
    const s = run(['', '== Suunto ==', 'Leyendo la lista de entrenamientos de Suunto...', '  [730/1460] 123 — ya guardada, la salto'])
    expect(s).toMatchObject({ step: 'suunto', done: 730, total: 1460, percent: 60 })
    expect(run(['  [1460/1460] 9 (Rodaje)...'], s).percent).toBe(80)
  })
  it('TrainingPeaks y validación tienen su tramo, y el porcentaje nunca retrocede', () => {
    const s = run(['== Suunto ==', '  [1/1] 1 — ya guardada', '== TrainingPeaks ==', '  [3/10] no es de Suunto'])
    expect(s).toMatchObject({ step: 'trainingpeaks', percent: 80, planSkipped: false })
    expect(run(['== Validación =='], s)).toMatchObject({ step: 'validacion', percent: 95 })
  })
  it('detecta TrainingPeaks omitido y fallido', () => {
    expect(run(['== TrainingPeaks (omitido: no hay TP_AUTH_COOKIE en .env; ver GUIA_TRAININGPEAKS.md) ==']).planSkipped).toBe(true)
    expect(run(['== TrainingPeaks ==', 'TrainingPeaks ha fallado (¿cookie caducada?). Sigo con lo demás.']).planFailed).toBe(true)
  })
  it('al terminar: 100 % con código 0; con error, el motivo según el paso', () => {
    const s = run(['== Suunto ==', '== TrainingPeaks ==', '== Validación =='])
    expect(finish(s, 0, 42_000)).toMatchObject({ running: false, ok: true, percent: 100, step: 'fin', seconds: 42 })
    expect(finish(s, 1, 1000).error).toContain('validación')
    expect(finish(run(['== Suunto ==']), 1, 1000).error).toContain('Suunto')
  })
  it('en Windows lanza actualizar.ps1 con PowerShell; en Mac/Linux, actualizar.sh con bash', () => {
    expect(updateCommand('win32', 'C:/app')).toMatchObject({ cmd: 'powershell.exe' })
    expect(updateCommand('win32', 'C:/app').args.at(-1)).toMatch(/actualizar\.ps1$/)
    expect(updateCommand('darwin', '/app')).toMatchObject({ cmd: 'bash' })
    expect(updateCommand('linux', '/app').args[0]).toMatch(/actualizar\.sh$/)
  })
})
