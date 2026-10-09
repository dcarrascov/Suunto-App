import { useEffect, useRef } from 'react'

interface Props {
  coords: [number, number][]
  sport?: string
  height?: number
}

const SPORT_COLORS: Record<string, string> = {
  running: '#ef4444',
  cycling: '#f97316',
  swimming: '#3b82f6',
  other: '#8b5cf6',
}

export default function ActivityMap({ coords, sport = 'other', height = 320 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)

  useEffect(() => {
    if (!containerRef.current || coords.length === 0) return

    // Lazy import Leaflet to avoid SSR issues
    import('leaflet').then((L) => {
      // Avoid re-initializing if map already exists
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
      }

      const map = L.map(containerRef.current!, {
        zoomControl: true,
        scrollWheelZoom: false,
        attributionControl: false,
      })

      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap contributors',
      }).addTo(map)

      const color = SPORT_COLORS[sport] ?? '#3b82f6'
      const polyline = L.polyline(coords, { color, weight: 3, opacity: 0.9 })
      polyline.addTo(map)
      map.fitBounds(polyline.getBounds(), { padding: [16, 16] })

      // Start/end markers
      if (coords.length > 0) {
        L.circleMarker(coords[0], { radius: 6, color: '#22c55e', fillColor: '#22c55e', fillOpacity: 1, weight: 2 }).addTo(map)
        L.circleMarker(coords[coords.length - 1], { radius: 6, color: '#ef4444', fillColor: '#ef4444', fillOpacity: 1, weight: 2 }).addTo(map)
      }

      mapRef.current = map
    })

    return () => {
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
      }
    }
  }, [coords, sport])

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

  return (
    <div
      ref={containerRef}
      className="rounded-xl overflow-hidden border border-slate-700/50"
      style={{ height }}
    />
  )
}
