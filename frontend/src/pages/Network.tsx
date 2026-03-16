import { useCallback, useEffect, useRef, useState } from 'react'
import {
    ReactFlow, Background, Controls, MiniMap,
    addEdge, useNodesState, useEdgesState,
    Connection, Edge, Node, BackgroundVariant,
    MarkerType, Panel, NodeMouseHandler,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { api } from '../api'
import InfraNode from '../components/InfraNode'
import { NODE_TEMPLATES } from '../constants/nodeTypes'

interface Props { onToast: (t: 'success' | 'error', m: string) => void }

const nodeTypes = { infra: InfraNode }

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
    // Inline node editing
    const [editingNodeId, setEditingNodeId] = useState<string | null>(null)
    const [editingLabel, setEditingLabel] = useState('')
    const [editingIp, setEditingIp] = useState('')
    const rfWrapper = useRef<HTMLDivElement>(null)

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
        }).catch(() => {})
    }, [setNodes, setEdges])

    useEffect(() => {
        api.listTemplates().then(setTemplates).catch(() => {})
    }, [])

    // Keyboard: Delete/Backspace deletes selected elements in edit mode
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (!editMode) return
            if ((e.key === 'Delete' || e.key === 'Backspace') && e.target === document.body) {
                handleDeleteSelected()
            }
            if (e.key === 'Escape') {
                setEditingNodeId(null)
                setShowAddNode(false)
            }
        }
        window.addEventListener('keydown', handler)
        return () => window.removeEventListener('keydown', handler)
    }, [editMode, nodes, edges])

    const onConnect = useCallback(
        (params: Connection) => setEdges(eds => addEdge({
            ...params,
            animated: true,
            style: { stroke: 'var(--accent)', strokeWidth: 2 },
            markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--accent)' },
        }, eds)),
        [setEdges]
    )

    // Double-click on node opens inline editor
    const onNodeDoubleClick: NodeMouseHandler = useCallback((_e, node) => {
        if (!editMode) return
        setEditingNodeId(node.id)
        setEditingLabel((node.data as any).label ?? '')
        setEditingIp((node.data as any).ip ?? '')
        setShowAddNode(false)
    }, [editMode])

    const handleSaveNodeEdit = () => {
        if (!editingNodeId) return
        setNodes(ns => ns.map(n =>
            n.id === editingNodeId
                ? { ...n, data: { ...n.data, label: editingLabel, ip: editingIp } }
                : n
        ))
        setEditingNodeId(null)
    }

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
        const tpl = NODE_TEMPLATES.find(t => t.type === newNode.type) ?? NODE_TEMPLATES[0]
        const node: Node = {
            id: uid(),
            type: 'infra',
            position: { x: 200 + Math.random() * 400, y: 150 + Math.random() * 300 },
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
        const a = document.createElement('a'); a.href = url
        a.download = `labdash-network-${new Date().toISOString().slice(0, 10)}.json`
        a.click(); URL.revokeObjectURL(url)
        onToast('success', '✓ Diagrama exportado')
    }

    // Close panels when switching modes
    const toggleEditMode = () => {
        setEditMode(e => !e)
        setShowAddNode(false)
        setShowTemplates(false)
        setEditingNodeId(null)
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
                onNodeDoubleClick={onNodeDoubleClick}
                nodeTypes={nodeTypes}
                nodesDraggable={editMode}
                nodesConnectable={editMode}
                elementsSelectable={true}
                deleteKeyCode={editMode ? ['Delete', 'Backspace'] : null}
                fitView
                defaultEdgeOptions={{
                    animated: true,
                    style: { stroke: 'var(--accent)', strokeWidth: 2 },
                    markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--accent)' },
                }}
            >
                <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="rgba(99,179,237,0.12)" />
                <Controls style={{ background: 'var(--bg2)', border: '1px solid var(--border)' }} />
                <MiniMap
                    nodeColor={(n) => (n.data as any)?.color ?? '#63b3ed'}
                    style={{ background: 'var(--bg2)', border: '1px solid var(--border)' }}
                />

                {/* ── Top toolbar ── */}
                <Panel position="top-left">
                    <div className="diagram-toolbar">
                        <button
                            className={`btn ${editMode ? 'btn-primary' : 'btn-secondary'}`}
                            onClick={toggleEditMode}
                            title={editMode ? 'Salir del modo edición' : 'Editar topología'}
                        >
                            <i className={`fa-solid ${editMode ? 'fa-pen-to-square' : 'fa-eye'}`} />
                            {editMode ? 'Editando' : 'Ver'}
                        </button>

                        <button
                            className={`btn ${showTemplates ? 'btn-primary' : 'btn-secondary'}`}
                            onClick={() => { setShowTemplates(s => !s); setShowAddNode(false) }}
                        >
                            <i className="fa-solid fa-layer-group" /> Templates
                        </button>

                        <button className="btn btn-secondary" onClick={handleExport} disabled={nodes.length === 0}>
                            <i className="fa-solid fa-file-export" /> Exportar
                        </button>

                        {editMode && <>
                            <button className="btn btn-secondary" onClick={() => { setShowAddNode(s => !s); setShowTemplates(false) }}>
                                <i className="fa-solid fa-plus" /> Nodo
                            </button>
                            <button className="btn btn-danger" onClick={handleDeleteSelected} title="Eliminar seleccionados (Del)">
                                <i className="fa-solid fa-trash" /> Borrar
                            </button>
                            <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                                <i className={`fa-solid ${saving ? 'fa-spinner fa-spin' : 'fa-floppy-disk'}`} />
                                {saving ? 'Guardando…' : 'Guardar'}
                            </button>
                        </>}

                        {editMode && (
                            <div style={{
                                fontSize: 10, color: 'var(--muted)',
                                padding: '4px 10px',
                                background: 'rgba(99,179,237,0.07)',
                                border: '1px solid rgba(99,179,237,0.15)',
                                borderRadius: 8,
                            }}>
                                <i className="fa-solid fa-circle-info" style={{ marginRight: 5 }} />
                                Doble clic = editar · Del = borrar sel.
                            </div>
                        )}
                    </div>
                </Panel>

                {/* ── Inline node editor ── */}
                {editingNodeId && editMode && (
                    <Panel position="top-right">
                        <div className="diagram-node-panel" style={{ minWidth: 260 }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                                <h4 style={{ margin: 0 }}>
                                    <i className="fa-solid fa-pen" style={{ marginRight: 8, color: 'var(--accent)' }} />
                                    Editar nodo
                                </h4>
                                <button className="btn btn-secondary" style={{ padding: '3px 8px', fontSize: 11 }}
                                    onClick={() => setEditingNodeId(null)}>
                                    <i className="fa-solid fa-xmark" />
                                </button>
                            </div>
                            <div className="form-group" style={{ marginBottom: 10 }}>
                                <label>Nombre</label>
                                <input value={editingLabel} onChange={e => setEditingLabel(e.target.value)}
                                    autoFocus onKeyDown={e => e.key === 'Enter' && handleSaveNodeEdit()} />
                            </div>
                            <div className="form-group" style={{ marginBottom: 14 }}>
                                <label>IP / Info</label>
                                <input value={editingIp} onChange={e => setEditingIp(e.target.value)}
                                    placeholder="192.168.1.1" onKeyDown={e => e.key === 'Enter' && handleSaveNodeEdit()} />
                            </div>
                            <div style={{ display: 'flex', gap: 8 }}>
                                <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleSaveNodeEdit}>
                                    <i className="fa-solid fa-check" /> Aplicar
                                </button>
                                <button className="btn btn-secondary" onClick={() => setEditingNodeId(null)}>
                                    <i className="fa-solid fa-xmark" />
                                </button>
                            </div>
                        </div>
                    </Panel>
                )}

                {/* ── Templates panel ── */}
                {showTemplates && !editingNodeId && (
                    <Panel position="top-right">
                        <div className="diagram-node-panel" style={{ minWidth: 300 }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                                <h4 style={{ margin: 0 }}>
                                    <i className="fa-solid fa-layer-group" style={{ marginRight: 8, color: 'var(--accent5)' }} />
                                    Templates de topología
                                </h4>
                                <button className="btn btn-secondary" style={{ padding: '3px 8px', fontSize: 11 }}
                                    onClick={() => setShowTemplates(false)}>
                                    <i className="fa-solid fa-xmark" />
                                </button>
                            </div>
                            {templates.length === 0 ? (
                                <p style={{ color: 'var(--muted)', fontSize: 12 }}>No hay templates disponibles</p>
                            ) : templates.map(t => (
                                <div key={t.id} style={{
                                    background: 'rgba(255,255,255,0.03)',
                                    border: '1px solid var(--border)', borderRadius: 10,
                                    padding: '12px 14px', marginBottom: 10,
                                }}>
                                    <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
                                        <i className="fa-solid fa-network-wired" style={{ marginRight: 7, color: 'var(--accent)' }} />
                                        {t.name}
                                    </div>
                                    <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 10, lineHeight: 1.5 }}>
                                        {t.description}
                                    </div>
                                    <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}
                                        onClick={() => handleLoadTemplate(t.id)} disabled={loadingTpl}>
                                        {loadingTpl
                                            ? <><i className="fa-solid fa-spinner fa-spin" /> Cargando…</>
                                            : <><i className="fa-solid fa-download" /> Cargar template</>}
                                    </button>
                                </div>
                            ))}
                            <div style={{ marginTop: 10, padding: '10px 12px', background: 'rgba(99,179,237,0.07)', borderRadius: 8, fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>
                                <i className="fa-solid fa-circle-info" style={{ marginRight: 6, color: 'var(--accent)' }} />
                                Cargar reemplaza el diagrama actual.
                            </div>
                        </div>
                    </Panel>
                )}

                {/* ── Add node panel ── */}
                {editMode && showAddNode && !editingNodeId && (
                    <Panel position="top-right">
                        <div className="diagram-node-panel">
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                                <h4 style={{ margin: 0 }}>
                                    <i className="fa-solid fa-plus" style={{ marginRight: 8, color: 'var(--accent2)' }} />
                                    Nuevo nodo
                                </h4>
                                <button className="btn btn-secondary" style={{ padding: '3px 8px', fontSize: 11 }}
                                    onClick={() => setShowAddNode(false)}>
                                    <i className="fa-solid fa-xmark" />
                                </button>
                            </div>

                            <div className="form-group" style={{ marginBottom: 10 }}>
                                <label>Tipo</label>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 4 }}>
                                    {NODE_TEMPLATES.map(t => (
                                        <button key={t.type}
                                            onClick={() => setNewNode(n => ({ ...n, type: t.type }))}
                                            style={{
                                                padding: '4px 9px', borderRadius: 8, fontSize: 10.5, cursor: 'pointer',
                                                border: `1px solid ${newNode.type === t.type ? t.color : 'var(--border)'}`,
                                                background: newNode.type === t.type ? `${t.color}22` : 'transparent',
                                                color: newNode.type === t.type ? t.color : 'var(--muted)',
                                                transition: 'all .15s',
                                            }}>
                                            <i className={`fa-solid ${t.icon}`} style={{ marginRight: 4 }} />
                                            {t.label.split('/')[0].trim()}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="form-group" style={{ marginBottom: 10 }}>
                                <label>Nombre</label>
                                <input value={newNode.name}
                                    onChange={e => setNewNode(n => ({ ...n, name: e.target.value }))}
                                    placeholder="ej. OPNsense" autoFocus
                                    onKeyDown={e => e.key === 'Enter' && handleAddNode()} />
                            </div>
                            <div className="form-group" style={{ marginBottom: 14 }}>
                                <label>IP / Info</label>
                                <input value={newNode.ip}
                                    onChange={e => setNewNode(n => ({ ...n, ip: e.target.value }))}
                                    placeholder="192.168.1.1"
                                    onKeyDown={e => e.key === 'Enter' && handleAddNode()} />
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

                {nodes.length === 0 && (
                    <Panel position="bottom-center">
                        <div style={{
                            background: 'var(--bg2)', border: '1px solid var(--border)',
                            borderRadius: 12, padding: '12px 24px',
                            color: 'var(--muted)', fontSize: 13, textAlign: 'center',
                        }}>
                            <i className="fa-solid fa-layer-group" style={{ marginRight: 8, color: 'var(--accent5)' }} />
                            Carga el template <strong style={{ color: 'var(--text)' }}>MXHOME</strong> o activa{' '}
                            <strong style={{ color: 'var(--text)' }}>modo Edición</strong> para construir tu topología
                        </div>
                    </Panel>
                )}
            </ReactFlow>
        </div>
    )
}
