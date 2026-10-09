interface Props {
  tsb: number
}

export default function FormBadge({ tsb }: Props) {
  if (tsb > 10)  return <Badge color="emerald" label="😴 Descansado" />
  if (tsb > -5)  return <Badge color="blue"    label="✅ Forma óptima" />
  if (tsb > -15) return <Badge color="amber"   label="💪 Entrenando fuerte" />
  if (tsb > -25) return <Badge color="orange"  label="😓 Acumulando fatiga" />
  return               <Badge color="rose"    label="🔴 Descansa ya" />
}

const PALETTE: Record<string, { border: string; bg: string; text: string }> = {
  emerald: { border: '#22c55e40', bg: '#22c55e15', text: '#86efac' },
  blue:    { border: '#3b82f640', bg: '#3b82f615', text: '#93c5fd' },
  amber:   { border: '#f59e0b40', bg: '#f59e0b15', text: '#fcd34d' },
  orange:  { border: '#f97316 40', bg: '#f9731615', text: '#fdba74' },
  rose:    { border: '#f4363640', bg: '#f4363615', text: '#fca5a5' },
}

function Badge({ color, label }: { color: string; label: string }) {
  const p = PALETTE[color]
  return (
    <span
      className="px-2.5 py-1 rounded-full text-xs font-bold border"
      style={{ borderColor: p.border, background: p.bg, color: p.text }}
    >
      {label}
    </span>
  )
}
