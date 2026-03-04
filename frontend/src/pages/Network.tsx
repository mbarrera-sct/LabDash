import { useCallback, useEffect, useRef, useState } from 'react'
import {
    ReactFlow, Background, Controls, MiniMap,
    addEdge, useNodesState, useEdgesState,
    Connection, Edge, Node, BackgroundVariant,
    MarkerType, Panel,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { api } from '../api'
import InfraNode from '../components/InfraNode'

interface Props { onToast: (t: 'success' | 'error', m: string) => void }

const nodeTypes = { infra: InfraNode }

const NODE_TEMPLATES = [
    { type: 'router', icon: 'fa-shield-halved', label: 'Router / Firewall', color: '#fc8181' },
    { type: 'switch', icon: 'fa-sitemap', label: 'Switch', color: '#68d391' },
    { type: 'server', icon: 'fa-cubes', label: 'Servidor / PVE', color: '#63b3ed' },
    { type: 'vm', icon: 'fa-display', label: 'VM / LXC', color: '#63b3ed' },
    { type: 'nas', icon: 'fa-database', label: 'NAS / Storage', color: '#b794f4' },
    { type: 'wan', icon: 'fa-tower-broadcast', label: 'WAN / ISP', color: '#68d391' },
    { type: 'k8s', icon: 'fa-dharmachakra', label: 'Kubernetes', color: '#68d391' },
    { type: 'wifi', icon: 'fa-wifi', label: 'WiFi AP', color: '#63b3ed' },
    { type: 'generic', icon: 'fa-circle-nodes', label: 'Genérico', color: '#718096' },
]

let _nid = 0
const uid = () => `n${++_nid}`

export default function Network({ onToast }: Props) {
    const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
    const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
    const [editMode, setEditMode] = useState(false)
    const [saving, setSaving] = useState(false)
    const [showAddNode, setShowAddNode] = useState(false)
    const [showTemplates, setShowTemplates] = useState(false)
    const [templates, setTemplates] = useState<{ id: string; name: string; description: string }[]>([])
    const [loadingTpl, setLoadingTpl] = useState(false)
    const [newNode, setNewNode] = useState({ name: '', ip: '', type: 'server' })
    const rfWrapper = useRef<HTMLDivElement>(null)

    // Load saved diagram
    useEffect(() => {
        api.getDiagram().then((d: any) => {
            if (d.nodes?.length) {
                setNodes(d.nodes)
                _nid = d.nodes.reduce((max: number, n: any) => {
                    const num = parseInt(n.id.replace('n', ''), 10)
                    return isNaN(num) ? max : Math.max(max, num)
                }, 0)
            }
            if (d.edges?.length) setEdges(d.edges)
        }).catch(() => { })
    }, [setNodes, setEdges])

    // Load template list once
    useEffect(() => {
        api.listTemplates().then(setTemplates).catch(() => { })
    }, [])

    const onConnect = useCallback(
        (params: Connection) => setEdges(eds => addEdge({
            ...params,
            animated: true,
            style: { stroke: 'var(--accent)', strokeWidth: 2 },
            markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--accent)' },
        }, eds)),
        [setEdges]
    )

    const handleSave = async () => {
        setSaving(true)
        try {
            await api.saveDiagram({ nodes, edges })
            onToast('success', '✓ Diagrama guardado')
        } catch {
            onToast('error', 'Error al guardar el diagrama')
        } finally { setSaving(false) }
    }

    const handleLoadTemplate = async (id: string) => {
        if (!confirm('¿Cargar este template? Reemplazará el diagrama actual (no guardado).')) return
        setLoadingTpl(true)
        try {
            const d = await api.loadTemplate(id)
            setNodes((d.nodes as Node[]) || [])
            setEdges((d.edges as Edge[]) || [])
            setShowTemplates(false)
            onToast('success', '✓ Template cargado — guárdalo cuando estés listo')
        } catch {
            onToast('error', 'Error cargando template')
        } finally { setLoadingTpl(false) }
    }

    const handleAddNode = () => {
        if (!newNode.name) return
        const tpl = NODE_TEMPLATES.find(t => t.type === newNode.type) ?? NODE_TEMPLATES[2]
        const node: Node = {
            id: uid(),
            type: 'infra',
            position: { x: 200 + Math.random() * 300, y: 200 + Math.random() * 200 },
            data: { label: newNode.name, ip: newNode.ip, ntype: newNode.type, icon: tpl.icon, color: tpl.color },
        }
        setNodes(ns => [...ns, node])
        setNewNode({ name: '', ip: '', type: 'server' })
        setShowAddNode(false)
    }

    const handleDeleteSelected = () => {
        setNodes(ns => ns.filter(n => !n.selected))
        setEdges(es => es.filter(e => !e.selected))
    }

    const handleExport = () => {
        const data = JSON.stringify({ nodes, edges }, null, 2)
        const blob = new Blob([data], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `labdash-network-${new Date().toISOString().slice(0, 10)}.json`
        a.click()
        URL.revokeObjectURL(url)
        onToast('success', '✓ Diagrama exportado como JSON')
    }

    return (
        <div
            style={{ position: 'relative', height: 'calc(100vh - 100px)', borderRadius: 16, overflow: 'hidden', border: '1px solid var(--border)' }}
            ref={rfWrapper}
        >
            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                nodeTypes={nodeTypes}
                nodesDraggable={editMode}
                nodesConnectable={editMode}
                elementsSelectable={editMode}
                fitView
                defaultEdgeOptions={{
                    animated: true,
                    style: { stroke: 'var(--accent)', strokeWidth: 2 },
                    markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--accent)' },
                }}
            >
                <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="rgba(99,179,237,0.15)" />
                <Controls />
                <MiniMap
                    nodeColor={(n) => (n.data as any)?.color ?? '#63b3ed'}
                    style={{ background: 'var(--bg2)' }}
                />

                {/* ── Left toolbar ── */}
                <Panel position="top-left">
                    <div className="diagram-toolbar">
                        {/* View / Edit toggle */}
                        <button
                            className={`btn ${editMode ? 'btn-primary' : 'btn-secondary'}`}
                            onClick={() => { setEditMode(e => !e); setShowAddNode(false); setShowTemplates(false) }}
                        >
                            <i className={`fa-solid ${editMode ? 'fa-pen-to-square' : 'fa-eye'}`} />
                            {editMode ? 'Editando' : 'Ver'}
                        </button>

                        {/* Templates button (always visible) */}
                        <button
                            className={`btn ${showTemplates ? 'btn-primary' : 'btn-secondary'}`}
                            onClick={() => { setShowTemplates(s => !s); setShowAddNode(false) }}
                            title="Cargar template de topología"
                        >
                            <i className="fa-solid fa-layer-group" />
                            Templates
                        </button>

                        {/* Export button (always visible) */}
                        <button
                            className="btn btn-secondary"
                            onClick={handleExport}
                            title="Exportar diagrama como JSON"
                            disabled={nodes.length === 0}
                        >
                            <i className="fa-solid fa-file-export" />
                            Exportar
                        </button>

                        {editMode && <>
                            <button className="btn btn-secondary" onClick={() => { setShowAddNode(s => !s); setShowTemplates(false) }}>
                                <i className="fa-solid fa-plus" /> Nodo
                            </button>
                            <button className="btn btn-danger" onClick={handleDeleteSelected}>
                                <i className="fa-solid fa-trash" /> Borrar sel.
                            </button>
                            <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                                <i className={`fa-solid ${saving ? 'fa-spinner fa-spin' : 'fa-floppy-disk'}`} />
                                {saving ? 'Guardando…' : 'Guardar'}
                            </button>
                        </>}
                    </div>
                </Panel>

                {/* ── Templates panel ── */}
                {showTemplates && (
                    <Panel position="top-right">
                        <div className="diagram-node-panel" style={{ minWidth: 300 }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                                <h4 style={{ margin: 0 }}>
                                    <i className="fa-solid fa-layer-group" style={{ marginRight: 8, color: 'var(--accent5)' }} />
                                    Templates de topología
                                </h4>
                                <button
                                    className="btn btn-secondary"
                                    style={{ padding: '3px 8px', fontSize: 11 }}
                                    onClick={() => setShowTemplates(false)}
                                >
                                    <i className="fa-solid fa-xmark" />
                                </button>
                            </div>

                            {templates.length === 0 ? (
                                <p style={{ color: 'var(--muted)', fontSize: 12 }}>No hay templates disponibles</p>
                            ) : (
                                templates.map(t => (
                                    <div key={t.id} style={{
                                        background: 'rgba(255,255,255,0.03)',
                                        border: '1px solid var(--border)',
                                        borderRadius: 10,
                                        padding: '12px 14px',
                                        marginBottom: 10,
                                    }}>
                                        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
                                            <i className="fa-solid fa-network-wired" style={{ marginRight: 7, color: 'var(--accent)' }} />
                                            {t.name}
                                        </div>
                                        <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 10, lineHeight: 1.5 }}>
                                            {t.description}
                                        </div>
                                        <button
                                            className="btn btn-primary"
                                            style={{ width: '100%', justifyContent: 'center' }}
                                            onClick={() => handleLoadTemplate(t.id)}
                                            disabled={loadingTpl}
                                        >
                                            {loadingTpl
                                                ? <><i className="fa-solid fa-spinner fa-spin" /> Cargando…</>
                                                : <><i className="fa-solid fa-download" /> Cargar este template</>
                                            }
                                        </button>
                                    </div>
                                ))
                            )}

                            <div style={{ marginTop: 10, padding: '10px 12px', background: 'rgba(99,179,237,0.07)', borderRadius: 8, fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>
                                <i className="fa-solid fa-circle-info" style={{ marginRight: 6, color: 'var(--accent)' }} />
                                Cargar reemplaza el diagrama actual. Guarda antes si tienes cambios.
                            </div>
                        </div>
                    </Panel>
                )}

                {/* ── Add node panel ── */}
                {editMode && showAddNode && (
                    <Panel position="top-right">
                        <div className="diagram-node-panel">
                            <h4>Nuevo nodo</h4>

                            <div className="form-group" style={{ marginBottom: 10 }}>
                                <label>Tipo</label>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                                    {NODE_TEMPLATES.map(t => (
                                        <button
                                            key={t.type}
                                            onClick={() => setNewNode(n => ({ ...n, type: t.type }))}
                                            style={{
                                                padding: '4px 10px',
                                                borderRadius: 8,
                                                fontSize: 11,
                                                cursor: 'pointer',
                                                border: `1px solid ${newNode.type === t.type ? t.color : 'var(--border)'}`,
                                                background: newNode.type === t.type ? `${t.color}22` : 'transparent',
                                                color: newNode.type === t.type ? t.color : 'var(--muted)',
                                                transition: 'all .15s',
                                            }}
                                        >
                                            <i className={`fa-solid ${t.icon}`} style={{ marginRight: 4 }} />
                                            {t.label.split('/')[0].trim()}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="form-group" style={{ marginBottom: 10 }}>
                                <label>Nombre</label>
                                <input
                                    value={newNode.name}
                                    onChange={e => setNewNode(n => ({ ...n, name: e.target.value }))}
                                    placeholder="ej. OPNsense"
                                    onKeyDown={e => e.key === 'Enter' && handleAddNode()}
                                />
                            </div>
                            <div className="form-group" style={{ marginBottom: 14 }}>
                                <label>IP / Info</label>
                                <input
                                    value={newNode.ip}
                                    onChange={e => setNewNode(n => ({ ...n, ip: e.target.value }))}
                                    placeholder="192.168.1.1"
                                />
                            </div>
                            <div style={{ display: 'flex', gap: 8 }}>
                                <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleAddNode}>
                                    <i className="fa-solid fa-plus" /> Añadir
                                </button>
                                <button className="btn btn-secondary" onClick={() => setShowAddNode(false)}>
                                    <i className="fa-solid fa-xmark" />
                                </button>
                            </div>
                        </div>
                    </Panel>
                )}

                {/* ── Empty hint ── */}
                {nodes.length === 0 && (
                    <Panel position="bottom-center">
                        <div style={{
                            background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 12,
                            padding: '12px 24px', color: 'var(--muted)', fontSize: 13, textAlign: 'center',
                        }}>
                            <i className="fa-solid fa-layer-group" style={{ marginRight: 8, color: 'var(--accent5)' }} />
                            Carga el template <strong style={{ color: 'var(--text)' }}>MXHOME</strong> o activa{' '}
                            <strong style={{ color: 'var(--text)' }}>modo Edición</strong> para construir tu propia topología
                        </div>
                    </Panel>
                )}
            </ReactFlow>
        </div>
    )
}
