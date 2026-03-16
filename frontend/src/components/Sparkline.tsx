import { memo } from 'react'

interface Props {
    data: number[]
    width?: number
    height?: number
    color?: string
    fill?: boolean
    strokeWidth?: number
}

function SparklineInner({ data, width = 80, height = 28, color = '#68d391', fill = true, strokeWidth = 1.5 }: Props) {
    if (!data || data.length < 2) return null

    const min = Math.min(...data)
    const max = Math.max(...data)
    const range = max - min || 1
    const pad = 2

    const pts = data.map((v, i) => ({
        x: (i / (data.length - 1)) * (width - pad * 2) + pad,
        y: height - pad - ((v - min) / range) * (height - pad * 2),
    }))

    const linePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
    const fillPath = `M ${pts[0].x.toFixed(1)},${height} ${pts.map(p => `L ${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')} L ${pts[pts.length - 1].x.toFixed(1)},${height} Z`

    const last = pts[pts.length - 1]

    return (
        <svg width={width} height={height} style={{ overflow: 'visible', display: 'block' }}>
            {fill && (
                <path d={fillPath} fill={`${color}22`} />
            )}
            <path d={linePath} stroke={color} strokeWidth={strokeWidth} fill="none"
                strokeLinecap="round" strokeLinejoin="round" />
            {/* Last value dot */}
            <circle cx={last.x} cy={last.y} r={2.5} fill={color} />
        </svg>
    )
}

export const Sparkline = memo(SparklineInner)
