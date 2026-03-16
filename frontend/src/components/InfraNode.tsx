import { Handle, Position } from '@xyflow/react'
import { fmtKbps } from '../utils/fmt'

interface Data {
    label: string
    ip?: string
    ntype: string
    icon: string
    color: string
    status?: 'online' | 'offline' | 'unknown'
    in_kbps?: number
    out_kbps?: number
}


export default function InfraNode({ data, selected }: { data: Data; selected?: boolean }) {
    const statusColor =
        data.status === 'online'  ? '#68d391' :
        data.status === 'offline' ? '#fc8181' : '#718096'

    const borderColor = selected
        ? '#63b3ed'
        : data.status === 'offline' ? 'rgba(252,129,129,0.5)'
        : `${data.color}44`

    const showTraffic = data.in_kbps !== undefined || data.out_kbps !== undefined

    return (
        <div style={{
            background: 'rgba(10,14,26,0.96)',
            border: `1px solid ${borderColor}`,
            borderRadius: 14,
            padding: '10px 14px',
            minWidth: 120,
            textAlign: 'center',
            backdropFilter: 'blur(12px)',
            boxShadow: selected
                ? `0 0 20px ${data.color}44, 0 4px 20px rgba(0,0,0,0.5)`
                : '0 2px 12px rgba(0,0,0,0.4)',
            transition: 'all .2s',
            position: 'relative',
        }}>
            {/* Status dot */}
            {data.status && (
                <span style={{
                    position: 'absolute', top: 7, right: 9,
                    width: 7, height: 7, borderRadius: '50%',
                    background: statusColor,
                    boxShadow: `0 0 6px ${statusColor}`,
                    animation: data.status === 'online' ? 'pulse 2s infinite' : 'none',
                    display: 'inline-block',
                }} />
            )}

            <Handle type="target" position={Position.Top}    style={{ opacity: 0.5, top: -5 }} />
            <Handle type="target" position={Position.Left}   style={{ opacity: 0.5, left: -5 }} />
            <Handle type="source" position={Position.Bottom} style={{ opacity: 0.5, bottom: -5 }} />
            <Handle type="source" position={Position.Right}  style={{ opacity: 0.5, right: -5 }} />

            <i
                className={`fa-solid ${data.icon}`}
                style={{
                    fontSize: 22, color: data.color,
                    marginBottom: 6, display: 'block',
                    filter: `drop-shadow(0 0 6px ${data.color}66)`,
                }}
            />
            <div style={{ fontSize: 11, fontWeight: 600, color: '#e2e8f0', marginBottom: 2, lineHeight: 1.3 }}>
                {data.label}
            </div>
            {data.ip && (
                <div style={{
                    fontSize: 9.5, color: '#4a5568',
                    fontFamily: 'JetBrains Mono, monospace',
                    marginTop: 1,
                }}>
                    {data.ip}
                </div>
            )}
            {showTraffic && (
                <div style={{
                    marginTop: 6, paddingTop: 5,
                    borderTop: '1px solid rgba(255,255,255,0.06)',
                    display: 'flex', flexDirection: 'column', gap: 2,
                }}>
                    <div style={{ fontSize: 9, color: '#68d391', fontFamily: 'JetBrains Mono, monospace', display: 'flex', justifyContent: 'space-between' }}>
                        <span>↑</span><span>{fmtKbps(data.out_kbps ?? 0)}</span>
                    </div>
                    <div style={{ fontSize: 9, color: '#63b3ed', fontFamily: 'JetBrains Mono, monospace', display: 'flex', justifyContent: 'space-between' }}>
                        <span>↓</span><span>{fmtKbps(data.in_kbps ?? 0)}</span>
                    </div>
                </div>
            )}
        </div>
    )
}
