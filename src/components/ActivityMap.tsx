import { useEffect, useMemo, useRef, useState } from 'react'
import type * as Leaflet from 'leaflet'
import { formatPace } from '../utils/formatters'

interface Props {
  coords: [number, number][]
  pace?: (number | null)[] | null   // ritmo (s/km) de cada punto; activa "color por ritmo"
  totalKm?: number                  // distancia oficial: ajusta las marcas de km a lo que midió el reloj
  sport?: string
  height?: number
}

const SPORT_COLORS: Record<string, string> = {
  running: '#ef4444',
  cycling: '#f97316',
  swimming: '#3b82f6',
  other: '#8b5cf6',
}

// Mapas base gratuitos y sin clave. Atribución obligatoria según la licencia de cada proveedor.
const BASE_LAYERS = {
  Claro: {
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
  },
  'Gris claro': {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    attribution: '© Esri, HERE, Garmin, © OpenStreetMap',
    maxZoom: 16,
  },
  Oscuro: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    attribution: '© Esri, HERE, Garmin, © OpenStreetMap',
    maxZoom: 16,
  },
  Satélite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Imágenes © Esri, Maxar, Earthstar Geographics',
    maxZoom: 19,
  },
} as const
type BaseName = keyof typeof BASE_LAYERS
const LAYER_KEY = 'suunto-map-layer'

// Ritmo: de lento (azul) a rápido (rojo), en 5 tramos según los percentiles de la propia actividad
const PACE_COLORS = ['#3b82f6', '#22c55e', '#eab308', '#f97316', '#ef4444']

function readLayer(): BaseName {
  try {
    const v = localStorage.getItem(LAYER_KEY)
    if (v && v in BASE_LAYERS) return v as BaseName
  } catch { /* sin localStorage: mapa claro */ }
  return 'Claro'
}

function saveLayer(name: string) {
  try { localStorage.setItem(LAYER_KEY, name) } catch { /* no pasa nada */ }
}

function haversineKm(a: [number, number], b: [number, number]): number {
  const rad = Math.PI / 180
  const dLat = (b[0] - a[0]) * rad
  const dLon = (b[1] - a[1]) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Límites (s/km) de los 5 tramos de color: percentiles 20/40/60/80 del ritmo. Rápido = número menor. */
function paceBreaks(pace: (number | null)[]): number[] | null {
  const vals = pace.filter((v): v is number => v != null).sort((a, b) => a - b)
  if (vals.length < 10) return null
  const q = (p: number) => vals[Math.min(vals.length - 1, Math.floor(p * vals.length))]
  return [q(0.2), q(0.4), q(0.6), q(0.8)]
}

/** Tramo de color (0 = lento … 4 = rápido) de un ritmo. */
function paceBin(p: number, breaks: number[]): number {
  let i = 0
  while (i < breaks.length && p > breaks[i]) i++
  return 4 - i
}

export default function ActivityMap({ coords, pace, totalKm, sport = 'other', height = 320 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<Leaflet.Map | null>(null)
  const routeRef = useRef<Leaflet.LayerGroup | null>(null)
  const leafletRef = useRef<typeof Leaflet | null>(null)
  const [ready, setReady] = useState(false)
  const [expanded, setExpanded] = useState(false)

  const breaks = useMemo(() => (pace && pace.length === coords.length ? paceBreaks(pace) : null), [pace, coords])
  const [byPace, setByPace] = useState(true)
  const colorByPace = byPace && breaks != null

  // Mapa y capas base: se crean una vez por ruta
  useEffect(() => {
    if (!containerRef.current || coords.length === 0) return
    let cancelled = false

    import('leaflet').then((L) => {
      if (cancelled || !containerRef.current) return
      leafletRef.current = L
      const map = L.map(containerRef.current, {
        zoomControl: true,
        scrollWheelZoom: false,  // se activa al hacer clic, para no secuestrar el scroll de la página
        attributionControl: true,
      })
      map.attributionControl.setPrefix(false)

      const layers = Object.fromEntries(
        Object.entries(BASE_LAYERS).map(([name, cfg]) => [
          name,
          L.tileLayer(cfg.url, { attribution: cfg.attribution, maxZoom: 19, maxNativeZoom: cfg.maxZoom }),
        ]),
      ) as Record<BaseName, Leaflet.TileLayer>
      layers[readLayer()].addTo(map)
      L.control.layers(layers, undefined, { position: 'topright' }).addTo(map)
      map.on('baselayerchange', (e: Leaflet.LayersControlEvent) => saveLayer(e.name))

      map.on('click', () => map.scrollWheelZoom.enable())
      map.on('mouseout', () => map.scrollWheelZoom.disable())

      map.fitBounds(L.latLngBounds(coords), { padding: [24, 24] })
      routeRef.current = L.layerGroup().addTo(map)
      mapRef.current = map
      setReady(true)
    })

    return () => {
      cancelled = true
      setReady(false)
      mapRef.current?.remove()
      mapRef.current = null
      routeRef.current = null
    }
  }, [coords])

  // Trazado: se redibuja al cambiar entre color fijo y color por ritmo
  useEffect(() => {
    const L = leafletRef.current
    const group = routeRef.current
    if (!ready || !L || !group) return
    group.clearLayers()

    // Borde blanco debajo: hace visible la ruta sobre cualquier mapa
    L.polyline(coords, { color: '#ffffff', weight: 8, opacity: 0.85, lineJoin: 'round', lineCap: 'round' }).addTo(group)

    if (colorByPace && pace && breaks) {
      // Une los puntos seguidos del mismo color en una sola línea (menos capas, trazo más limpio)
      let start = 0
      const binAt = (i: number) => (pace[i] != null ? paceBin(pace[i]!, breaks) : null)
      let bin = binAt(0)
      for (let i = 1; i <= coords.length; i++) {
        const b = i < coords.length ? (binAt(i) ?? bin) : null
        if (i === coords.length || b !== bin) {
          const color = bin != null ? PACE_COLORS[bin] : '#a3a3a8'
          L.polyline(coords.slice(start, i + 1), { color, weight: 4.5, opacity: 1, lineJoin: 'round', lineCap: 'round' }).addTo(group)
          start = i
          bin = b
        }
      }
    } else {
      const color = SPORT_COLORS[sport] ?? '#3b82f6'
      L.polyline(coords, { color, weight: 4.5, opacity: 1, lineJoin: 'round', lineCap: 'round' }).addTo(group)
    }

    // Marcas de km (ajustadas a la distancia oficial: el GPS suele medir algo distinto)
    let gpsKm = 0
    const cum = [0]
    for (let i = 1; i < coords.length; i++) {
      gpsKm += haversineKm(coords[i - 1], coords[i])
      cum.push(gpsKm)
    }
    const scale = totalKm && gpsKm > 0 ? totalKm / gpsKm : 1
    const realKm = gpsKm * scale
    const every = realKm > 60 ? 10 : realKm > 25 ? 5 : 1
    for (let km = every, i = 0; km < realKm - every * 0.3; km += every) {
      while (i < cum.length - 1 && cum[i] * scale < km) i++
      L.marker(coords[i], {
        icon: L.divIcon({ className: 'km-marker', html: `<span>${km}</span>`, iconSize: [20, 20] }),
        interactive: false,
        keyboard: false,
      }).addTo(group)
    }

    // Salida y meta
    const end = coords[coords.length - 1]
    L.marker(end, {
      icon: L.divIcon({ className: 'route-pin route-pin--end', html: '<span>■</span>', iconSize: [26, 26] }),
      title: 'Meta',
    }).addTo(group)
    L.marker(coords[0], {
      icon: L.divIcon({ className: 'route-pin route-pin--start', html: '<span>▶</span>', iconSize: [26, 26] }),
      title: 'Salida',
      zIndexOffset: 1000,
    }).addTo(group)
  }, [ready, coords, pace, breaks, colorByPace, sport, totalKm])

  // Al ampliar, Leaflet necesita recalcular el tamaño
  useEffect(() => {
    const t = setTimeout(() => mapRef.current?.invalidateSize(), 50)
    return () => clearTimeout(t)
  }, [expanded])

  if (coords.length === 0) {
    return (
      <div
        className="rounded-xl bg-slate-800/60 border border-slate-700/50 flex items-center justify-center text-slate-500 text-sm"
        style={{ height }}
      >
        Sin datos GPS
      </div>
    )
  }

  const legendPace = (v: number) => formatPace(v).replace(' /km', '')

  return (
    <div>
      <div className="relative">
        <div
          ref={containerRef}
          className="rounded-xl overflow-hidden border border-slate-700/50"
          style={{ height: expanded ? '70vh' : height }}
        />
        <button
          onClick={() => setExpanded(e => !e)}
          className="absolute bottom-3 right-3 z-[500] bg-white/90 hover:bg-white text-slate-800 text-xs font-medium px-2.5 py-1.5 rounded-lg shadow"
        >
          {expanded ? 'Reducir' : 'Ampliar'}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-2 text-xs text-slate-500">
        {breaks ? (
          <>
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <input type="checkbox" checked={byPace} onChange={e => setByPace(e.target.checked)} className="accent-blue-500" />
              Color por ritmo
            </label>
            {colorByPace && (
              <div className="flex items-center gap-1.5">
                <span>Lento</span>
                {PACE_COLORS.map((c, i) => (
                  <span
                    key={c}
                    className="inline-block w-5 h-2 rounded-sm"
                    style={{ background: c }}
                    title={
                      i === 0 ? `más lento que ${legendPace(breaks[3])}`
                        : i === 4 ? `más rápido que ${legendPace(breaks[0])}`
                        : `${legendPace(breaks[4 - i - 1])} – ${legendPace(breaks[4 - i])}`
                    }
                  />
                ))}
                <span>Rápido</span>
                <span className="text-slate-600">({legendPace(breaks[3])} → {legendPace(breaks[0])} /km)</span>
              </div>
            )}
          </>
        ) : (
          <span className="text-slate-600">Ruta de baja resolución: sincroniza con --force para verla precisa y por ritmo.</span>
        )}
        <span className="ml-auto text-slate-600">Clic en el mapa para hacer zoom con la rueda</span>
      </div>
    </div>
  )
}
