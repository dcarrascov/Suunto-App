// Herramientas del MCP: cada una es una ruta de la API de la app (server/mcpApi.ts). Todas leen, salvo guardar y borrar
// propuestas de semana (que la app recibe al sincronizar).

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { apiGet, apiRequest, type ApiConfig } from './api.js'

const day = (what: string) => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha AAAA-MM-DD').describe(what)

type Args = Record<string, string | number | boolean | undefined>

export interface ToolDef {
  name: string
  title: string
  description: string
  input: z.ZodRawShape
  /** Ruta de la API y parámetros. */
  route: (a: Args) => [string, Args]
  /** Solo las propuestas escriben: PUT (guardar) o DELETE (borrar), con su cuerpo. */
  write?: { method: 'PUT' | 'DELETE'; body?: (a: Record<string, unknown>) => unknown; destructive?: boolean }
}

const SESSION_TYPES = ['rodaje', 'progresivo', 'rectas', 'series', 'cuestas', 'cambios', 'activacion', 'competicion', 'fuerza', 'natacion', 'descanso', 'otro'] as const
const MODE = z.enum(['como_entrenador', 'sin_entrenador'])

export const TOOLS: ToolDef[] = [
  {
    name: 'perfil_atleta',
    title: 'Perfil del atleta',
    description: 'Empieza por aquí. Ajustes del atleta (FC máxima, umbrales, ritmo umbral, zonas de FC y de ritmo), avisos para la IA (pulso poco fiable, sesiones grabadas por partes), totales de actividades, VO2max, si hay plan de TrainingPeaks, la próxima competición y la fecha de hoy.',
    input: {},
    route: () => ['perfil', {}],
  },
  {
    name: 'listar_actividades',
    title: 'Listar actividades',
    description: 'Actividades entre dos fechas (por defecto, los últimos 30 días), de la más reciente a la más antigua, con km, duración, ritmo, FC, TSS y VO2max. Para el detalle de una, ver_actividad con su id. Para periodos largos, mejor resumen_semanal.',
    input: {
      desde: day('Primer día. Por defecto, hace 30 días.').optional(),
      hasta: day('Último día. Por defecto, hoy.').optional(),
      deporte: z.enum(['carrera', 'bici', 'natacion', 'otro', 'todos']).describe('Por defecto, todos.').optional(),
      texto: z.string().max(80).describe('Texto que buscar en el título.').optional(),
      solo_competiciones: z.boolean().optional(),
      limite: z.number().int().min(1).max(200).describe('Por defecto 50.').optional(),
    },
    route: a => ['actividades', { desde: a.desde, hasta: a.hasta, deporte: a.deporte, texto: a.texto, competiciones: a.solo_competiciones, limite: a.limite }],
  },
  {
    name: 'ver_actividad',
    title: 'Ver una actividad',
    description: 'Detalle de una actividad: parciales (con zona de ritmo), zonas de FC, mejores tramos (y si son récord), ritmos máximos de 30 s a 5 min, desacoplamiento, cadencia y efecto de entrenamiento. No incluye la ruta GPS.',
    input: { id: z.coerce.number().int().positive().describe('Id de la actividad (de listar_actividades).') },
    route: a => [`actividades/${a.id}`, {}],
  },
  {
    name: 'resumen_semanal',
    title: 'Resumen por semanas',
    description: 'Por semana (de lunes a domingo): km de carrera, tiempo total, sesiones, tirada larga, TSS, reparto 80/20 por zonas de FC y rampa de km frente a la media de las 4 semanas anteriores.',
    input: {
      semanas: z.number().int().min(1).max(52).describe('Cuántas semanas (por defecto 12).').optional(),
      hasta: day('Un día de la última semana (por defecto, hoy).').optional(),
    },
    route: a => ['semanas', { semanas: a.semanas, hasta: a.hasta }],
  },
  {
    name: 'estado_de_forma',
    title: 'Estado de forma',
    description: 'Forma (CTL), fatiga (ATL) y frescura (TSB) de hoy, hace 7 y 28 días y su evolución semanal, más la previsión con el plan del entrenador hasta la próxima competición.',
    input: {
      dias: z.number().int().min(7).max(730).describe('Días de historia (por defecto 90).').optional(),
      proyectar: z.boolean().describe('Incluir la previsión con el plan (por defecto sí).').optional(),
    },
    route: a => ['forma', { dias: a.dias, proyectar: a.proyectar }],
  },
  {
    name: 'records_y_predicciones',
    title: 'Récords y predicciones',
    description: 'Mejores marcas por distancia (1 km, 5 km, 10 km, media y maratón; mejores tramos dentro de las carreras), predicción de tiempos con Riegel a partir de los últimos 90 días y ritmo umbral estimado frente al de los ajustes.',
    input: {},
    route: () => ['records', {}],
  },
  {
    name: 'distribucion_intensidad',
    title: 'Distribución de intensidad',
    description: 'Tiempo de carrera en cada zona de FC y reparto 80/20 (suave, medio, alto) de los últimos días.',
    input: { dias: z.number().int().min(7).max(365).describe('Días (por defecto 28).').optional() },
    route: a => ['intensidad', { dias: a.dias }],
  },
  {
    name: 'plan_entrenador',
    title: 'Plan del entrenador',
    description: 'Sesiones que planificó el entrenador en TrainingPeaks entre dos fechas (por defecto, esta semana y las 2 siguientes; para semanas pasadas, usa «desde»): tipo, título, descripción, duración, distancia y TSS planificados, si se hizo y el % de cumplimiento. Para conocer su estilo, mejor estilo_entrenador.',
    input: {
      desde: day('Primer día. Por defecto, el lunes de esta semana.').optional(),
      hasta: day('Último día. Por defecto, 3 semanas. Como mucho 120 días.').optional(),
      descripcion_completa: z.boolean().describe('Descripciones enteras (por defecto, recortadas a 300 caracteres).').optional(),
    },
    route: a => ['plan', { desde: a.desde, hasta: a.hasta, descripcion_completa: a.descripcion_completa }],
  },
  {
    name: 'estilo_entrenador',
    title: 'Estilo del entrenador',
    description: 'Cómo planifica el entrenador, en resumen: sesiones por tipo y por día de la semana, carga media semanal, qué pone los 7 días antes de cada competición y sus 2 últimas semanas como ejemplo. Úsalo antes de proponer una semana «como el entrenador».',
    input: { antes_de: day('Solo lo planificado antes de este día (por defecto, el lunes que viene).').optional() },
    route: a => ['estilo', { antes_de: a.antes_de }],
  },
  {
    name: 'competiciones',
    title: 'Competiciones',
    description: 'Próximas competiciones (nombre, prioridad, distancia, días que faltan, predicción y frescura prevista) y las pasadas con su resultado, la frescura con la que llegaste y la comparación con la anterior.',
    input: {
      pasadas: z.boolean().describe('Incluir las pasadas (por defecto sí).').optional(),
      futuras: z.boolean().describe('Incluir las próximas (por defecto sí).').optional(),
    },
    route: a => ['competiciones', { pasadas: a.pasadas, futuras: a.futuras }],
  },
  {
    name: 'comparar_semana',
    title: 'Comparar una semana',
    description: 'Lo que planificó el entrenador frente a lo que se hizo en una semana (de lunes a domingo), día a día, con totales de tiempo, TSS y % de cumplimiento.',
    input: { semana: day('Cualquier día de la semana.') },
    route: a => [`semana/${a.semana}`, {}],
  },
  {
    name: 'propuestas_guardadas',
    title: 'Propuestas guardadas',
    description: 'Semanas propuestas que ya están guardadas en la app (de Claude o del Entrenador IA de la app), para seguir un plan empezado en otra conversación.',
    input: { semana: day('Solo la semana de este día (por defecto, las 12 más recientes).').optional() },
    route: a => ['propuestas', { semana: a.semana }],
  },
  {
    name: 'guardar_propuesta_semana',
    title: 'Guardar una semana en la app',
    description: 'Guarda en la app una semana propuesta, solo cuando el usuario lo pida. Aparece en Entrenador IA y Plan como «Propuesta IA», desde donde puede pasarla al calendario. No se envía a TrainingPeaks. Planifica por tiempo (duracion_min en todas las sesiones salvo descanso).',
    input: {
      semana: day('Cualquier día de la semana (de lunes a domingo).'),
      modo: MODE.describe('como_entrenador (al estilo del entrenador) o sin_entrenador (plan propio hacia un objetivo).'),
      explicacion: z.string().max(3000).describe('Por qué esta semana: objetivo, carga y cómo encaja.'),
      sesiones: z.array(z.object({
        fecha: day('Día de la sesión, dentro de esa semana.'),
        tipo: z.enum(SESSION_TYPES),
        titulo: z.string().min(1).max(150),
        descripcion: z.string().max(2000).describe('Estructura: calentamiento, bloques con ritmo o zona, vuelta a la calma.').optional(),
        duracion_min: z.number().min(0).max(600).optional(),
        distancia_km: z.number().min(0).max(300).optional(),
        tss: z.number().min(0).max(1000).optional(),
      })).min(1).max(21),
      reemplazar: z.boolean().describe('Sustituir la que ya haya para esa semana y modo.').optional(),
    },
    route: a => [`propuestas/${a.semana}`, {}],
    write: { method: 'PUT', body: a => ({ modo: a.modo, explicacion: a.explicacion, sesiones: a.sesiones, reemplazar: a.reemplazar === true }) },
  },
  {
    name: 'borrar_propuesta',
    title: 'Borrar una semana guardada',
    description: 'Borra de la app una semana que guardó Claude (no las del Entrenador IA de la app ni el calendario). Solo si el usuario lo pide.',
    input: { semana: day('Cualquier día de la semana.'), modo: MODE },
    route: a => [`propuestas/${a.semana}`, { modo: a.modo }],
    write: { method: 'DELETE', destructive: true },
  },
]

/** Registra las herramientas en el servidor MCP. Los errores se devuelven como texto para que Claude los explique. */
export function registerTools(server: McpServer, cfg: ApiConfig): void {
  for (const t of TOOLS) {
    const annotations = t.write
      ? { readOnlyHint: false, destructiveHint: !!t.write.destructive, idempotentHint: true, openWorldHint: false }
      : { readOnlyHint: true, openWorldHint: false }
    server.registerTool(
      t.name,
      { title: t.title, description: t.description, inputSchema: t.input, annotations },
      async (args: Record<string, unknown>) => {
        try {
          const [path, query] = t.route(args as Args)   // ya validados por el SDK con el esquema de zod
          const data = t.write
            ? await apiRequest(cfg, t.write.method, path, query, t.write.body?.(args))
            : await apiGet(cfg, path, query)
          return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] }
        } catch (e) {
          return { content: [{ type: 'text' as const, text: e instanceof Error ? e.message : 'Error inesperado.' }], isError: true }
        }
      },
    )
  }
}
