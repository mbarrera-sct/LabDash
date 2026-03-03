import { Handle, Position } from '@xyflow/react'

interface Data {
    label: string
    ip?: string
    ntype: string
    icon: string
    color: string
    status?: 'ok' | 'warn' | 'error'
}

export default function InfraNode({ data, selected }: { data: Data; selected?: boolean }) {
    const borderColor = selected
        ? '#63b3ed'
        : data.status === 'error' ? '#fc8181'
            : data.status === 'warn' ? '#fbd38d'
                : `${data.color}55`

    return (
        <div style={{
            background: 'rgba(15,22,40,0.95)',
            border: `1px solid ${borderColor}`,
            borderRadius: 12,
            padding: '10px 14px',
            minWidth: 110,
            textAlign: 'center',
            backdropFilter: 'blur(8px)',
            boxShadow: selected ? `0 0 16px ${data.color}55` : 'none',
            transition: 'all .2s',
        }}>
            <Handle type="target" position={Position.Top} style={{ opacity: 0.6 }} />
            <Handle type="target" position={Position.Left} style={{ opacity: 0.6 }} />

            <i
                className={`fa-solid ${data.icon}`}
                style={{ fontSize: 24, color: data.color, marginBottom: 6, display: 'block' }}
            />
            <div style={{ fontSize: 11, fontWeight: 600, color: '#e2e8f0', marginBottom: 2 }}>
                {data.label}
            </div>
            {data.ip && (
                <div style={{ fontSize: 10, color: '#718096', fontFamily: 'JetBrains Mono, monospace' }}>
                    {data.ip}
                </div>
            )}
            {data.status && (
                <div style={{ marginTop: 6 }}>
                    <span style={{
                        fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 8,
                        background: data.status === 'ok' ? 'rgba(104,211,145,.15)' : data.status === 'warn' ? 'rgba(251,211,141,.15)' : 'rgba(252,129,129,.15)',
                        color: data.status === 'ok' ? '#68d391' : data.status === 'warn' ? '#fbd38d' : '#fc8181',
                    }}>
                        {data.status.toUpperCase()}
                    </span>
                </div>
            )}

            <Handle type="source" position={Position.Bottom} style={{ opacity: 0.6 }} />
            <Handle type="source" position={Position.Right} style={{ opacity: 0.6 }} />
        </div>
    )
}
