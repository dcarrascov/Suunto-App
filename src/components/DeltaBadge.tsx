interface Props {
  value: number
  unit?: string
  decimals?: number
}

export default function DeltaBadge({ value, unit = '', decimals = 1 }: Props) {
  if (Math.abs(value) < 0.5) return <span className="text-xs text-slate-500">= igual</span>

  const up = value > 0
  const formatted = Math.abs(value).toFixed(value % 1 === 0 ? 0 : decimals)

  return (
    <span className={`text-xs font-medium ${up ? 'text-emerald-400' : 'text-rose-400'}`}>
      {up ? '↑' : '↓'} {formatted}{unit}
    </span>
  )
}
