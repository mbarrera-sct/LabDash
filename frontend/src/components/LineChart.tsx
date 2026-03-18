import { memo, useState, useRef } from 'react'

interface Props {
    data: number[]
    color?: string
    label?: string
    unit?: string          // e.g. '%', ' ms', ' KB/s'
    width?: number         // coordinate space width (default 400)
    height?: number        // fixed rendered height in px
    fillOpacity?: number
    timeLabel?: string     // override left x-axis label (e.g. '−30d')
    midLabel?: string      // override mid x-axis label
}

function LineChartInner({ data, color = '#63b3ed', label, unit = '', width = 400, height = 100, fillOpacity = 0.15, timeLabel, midLabel }: Props) {
    const [hover, setHover] = useState<{ x: number; y: number; val: number } | null>(null)
    const svgRef = useRef<SVGSVGElement>(null)

    if (!data || data.length < 2) {
        return (
            <div style={{ width: '100%', height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontSize: 11, background: 'rgba(255,255,255,0.02)', borderRadius: 8 }}>
                Sin datos
            </div>
        )
    }

    const pad = { top: 12, right: 8, bottom: 20, left: 36 }
    const W = width  - pad.left - pad.right
    const H = height - pad.top  - pad.bottom

    const min = Math.min(...data)
    const max = Math.max(...data)
    const range = max - min || 1

    const px = (i: number) => (i / (data.length - 1)) * W
    const py = (v: number) => H - ((v - min) / range) * H

    const pts = data.map((v, i) => ({ x: px(i), y: py(v), v }))
    const linePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
    const fillPath = `M ${pts[0].x.toFixed(1)},${H} ${pts.map(p => `L ${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')} L ${pts[pts.length-1].x.toFixed(1)},${H} Z`

    // Y-axis ticks
    const yTicks = [0, 0.25, 0.5, 0.75, 1].map(t => ({
        y: H * (1 - t),
        val: min + range * t,
    }))

    // X-axis ticks
    const xTicks = [0, Math.floor(data.length / 2), data.length - 1].map(i => ({
        x: px(i),
        label: i === 0 ? (timeLabel ?? '−2h') : i === data.length - 1 ? 'ahora' : (midLabel ?? '−1h'),
    }))

    const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
        if (!svgRef.current) return
        const rect = svgRef.current.getBoundingClientRect()
        // Scale mouse coords from rendered px → viewBox coords
        const scale = width / rect.width
        const relX = (e.clientX - rect.left) * scale - pad.left
        const idx = Math.round((relX / W) * (data.length - 1))
        if (idx >= 0 && idx < data.length) {
            setHover({ x: pts[idx].x, y: pts[idx].y, val: data[idx] })
        }
    }

    return (
        <div style={{ position: 'relative', userSelect: 'none', width: '100%', overflow: 'hidden' }}>
            {label && (
                <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {label}
                </div>
            )}
            <svg
                ref={svgRef}
                viewBox={`0 0 ${width} ${height}`}
                width="100%"
                height={height}
                onMouseMove={handleMouseMove}
                onMouseLeave={() => setHover(null)}
                style={{ display: 'block', cursor: 'crosshair' }}
            >
                <g transform={`translate(${pad.left},${pad.top})`}>
                    {/* Grid lines */}
                    {yTicks.map((t, i) => (
                        <g key={i}>
                            <line x1={0} y1={t.y.toFixed(1)} x2={W} y2={t.y.toFixed(1)}
                                stroke="rgba(255,255,255,0.05)" strokeWidth={1} />
                            <text x={-4} y={t.y + 3.5} textAnchor="end"
                                style={{ fill: 'var(--muted)', fontSize: 9, fontFamily: 'JetBrains Mono, monospace' }}>
                                {t.val % 1 === 0 ? t.val.toFixed(0) : t.val.toFixed(1)}{unit}
                            </text>
                        </g>
                    ))}

                    {/* X-axis labels */}
                    {xTicks.map((t, i) => (
                        <text key={i} x={t.x} y={H + 14} textAnchor="middle"
                            style={{ fill: 'var(--muted)', fontSize: 9, fontFamily: 'JetBrains Mono, monospace' }}>
                            {t.label}
                        </text>
                    ))}

                    {/* Fill */}
                    <path d={fillPath} fill={color} fillOpacity={fillOpacity} />

                    {/* Line */}
                    <path d={linePath} stroke={color} strokeWidth={1.5} fill="none"
                        strokeLinecap="round" strokeLinejoin="round" />

                    {/* Hover */}
                    {hover && (
                        <>
                            <line x1={hover.x} y1={0} x2={hover.x} y2={H}
                                stroke={color} strokeWidth={1} strokeDasharray="3,3" opacity={0.6} />
                            <circle cx={hover.x} cy={hover.y} r={3.5} fill={color} />
                            <rect x={hover.x - 28} y={hover.y - 22} width={56} height={16} rx={4}
                                fill="rgba(15,22,40,0.92)" stroke={color} strokeWidth={0.5} />
                            <text x={hover.x} y={hover.y - 11} textAnchor="middle"
                                style={{ fill: color, fontSize: 9.5, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700 }}>
                                {hover.val % 1 === 0 ? hover.val.toFixed(0) : hover.val.toFixed(1)}{unit}
                            </text>
                        </>
                    )}
                </g>
            </svg>
        </div>
    )
}

export const LineChart = memo(LineChartInner)
