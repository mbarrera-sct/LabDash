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
import { NODE_TEMPLATES, NODE_GROUPS, getNodeMeta } from '../constants/nodeTypes'

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
    const [editingNodeId, setEditingNodeId] = useState<string | null>(null)
    const [editingLabel, setEditingLabel] = useState('')
    const [editingIp, setEditingIp] = useState('')
    const [showArp, setShowArp] = useState(false)
    const [arpEntries, setArpEntries] = useState<any[]>([])
    const [arpLoading, setArpLoading] = useState(false)
    // selected node type per ARP IP
    const [arpTypes, setArpTypes] = useState<Record<string, string>>({})
    const [liveActive, setLiveActive] = useState(false)
    const [showWifi, setShowWifi] = useState(false)
    const [wifiClients, setWifiClients] = useState<any[]>([])
    const [wifiLoading, setWifiLoading] = useState(false)
    const [autoTopoLoading, setAutoTopoLoading] = useState(false)
    // ── Infra selector ──────────────────────────────────────────────────────────
    interface InfraItem { id: string; label: string; ip: string; ntype: string; icon: string; color: string; group: string; badge?: string }
    const [showInfra, setShowInfra] = useState(false)
    const [infraLoading, setInfraLoading] = useState(false)
    const [infraItems, setInfraItems] = useState<InfraItem[]>([])
    const [selectedInfra, setSelectedInfra] = useState<Set<string>>(new Set())
    const rfWrapper = useRef<HTMLDivElement>(null)
    const importRef = useRef<HTMLInputElement>(null)

    // ── Auto-save state ─────────────────────────────────────────────────────────
    const dirtyRef   = useRef(false)
    const lastSaveRef = useRef<number>(Date.now())
    const [autoSaveInfo, setAutoSaveInfo] = useState<string | null>(null)

    // ── Auto-save: save dirty diagram every 5 minutes ───────────────────────────
    useEffect(() => {
        const t = setInterval(async () => {
            if (!dirtyRef.current) return
            const age = Math.round((Date.now() - lastSaveRef.current) / 1000)
            if (age < 300) return          // less than 5 min since last save
            try {
                await api.saveDiagram({ nodes, edges })
                lastSaveRef.current = Date.now()
                dirtyRef.current = false
                const ts = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                setAutoSaveInfo(`Auto-guardado a las ${ts}`)
            } catch { /* silent */ }
        }, 30_000)                         // check every 30s
        return () => clearInterval(t)
    }, [nodes, edges])

    // Load diagram on mount
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

    // ── Live status polling ─────────────────────────────────────────────────────
    // Polls /api/network/live every 15s, updates node status + edge colors
    useEffect(() => {
        const tick = async () => {
            const live = await api.networkLive().catch(() => null)
            if (!live) return
            setNodes(ns => {
                const updated = ns.map(n => {
                    const ip     = (n.data as any).ip as string | undefined
                    const ntype  = (n.data as any).ntype as string
                    const isGw   = ntype === 'router' || ntype === 'wan'
                    const status = ip === undefined
                        ? 'unknown'
                        : (live.ping[ip] ? 'online' : 'offline')
                    return {
                        ...n,
                        data: {
                            ...n.data,
                            status,
                            ...(isGw && live.snmp_in_kbps  != null ? { in_kbps:  live.snmp_in_kbps  } : {}),
                            ...(isGw && live.snmp_out_kbps != null ? { out_kbps: live.snmp_out_kbps } : {}),
                        }
                    }
                })
                // Update edge colors based on endpoint status
                const statusMap: Record<string, string> = {}
                updated.forEach(n => { statusMap[n.id] = (n.data as any).status ?? 'unknown' })
                setEdges(es => es.map(e => {
                    const offline = statusMap[e.source] === 'offline' || statusMap[e.target] === 'offline'
                    return {
                        ...e,
                        animated: !offline,
                        style: {
                            stroke:      offline ? 'rgba(252,129,129,0.45)' : 'var(--accent)',
                            strokeWidth: 2,
                        },
                        markerEnd: { type: MarkerType.ArrowClosed, color: offline ? '#fc8181' : 'var(--accent)' },
                    }
                }))
                return updated
            })
            setLiveActive(true)
        }
        tick()
        const t = setInterval(tick, 15_000)
        return () => clearInterval(t)
    }, [setNodes, setEdges])

    // Keyboard shortcuts in edit mode
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
            lastSaveRef.current = Date.now()
            dirtyRef.current = false
            setAutoSaveInfo(null)
            onToast('success', '✓ Diagrama guardado')
        } catch {
            onToast('error', 'Error al guardar el diagrama')
        } finally { setSaving(false) }
    }

    const handleImportJson = (e: { target: HTMLInputElement }) => {
        const file = e.target.files?.[0]
        if (!file) return
        e.target.value = ''
        const reader = new FileReader()
        reader.onload = (ev) => {
            try {
                const data = JSON.parse(ev.target?.result as string)
                if (!data.nodes && !data.edges) {
                    onToast('error', 'JSON inválido: no contiene nodos ni edges')
                    return
                }
                if (data.nodes?.length) {
                    setNodes((data.nodes as Node[]) || [])
                    _nid = (data.nodes as any[]).reduce((max: number, n: any) => {
                        const num = parseInt(n.id.replace('n', ''), 10)
                        return isNaN(num) ? max : Math.max(max, num)
                    }, 0)
                }
                if (data.edges?.length) setEdges((data.edges as Edge[]) || [])
                dirtyRef.current = true
                onToast('success', `✓ Diagrama importado (${data.nodes?.length ?? 0} nodos, ${data.edges?.length ?? 0} conexiones)`)
            } catch {
                onToast('error', 'Error al leer el archivo JSON')
            }
        }
        reader.readAsText(file)
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

    const handleClearAll = () => {
        if (!confirm('¿Borrar todos los nodos y conexiones del diagrama? Esta acción no se puede deshacer (hasta que guardes).')) return
        setNodes([])
        setEdges([])
        dirtyRef.current = true
    }

    const handleExport = () => {
        const data = JSON.stringify({ nodes, edges }, null, 2)
        const blob = new Blob([data], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a'); a.href = url
        a.download = `labdash-network-${new Date().toISOString().slice(0, 10)}.json`
        a.click(); URL.revokeObjectURL(url)
        onToast('success', '✓ Diagrama exportado como JSON')
    }

    const handleExportPng = async () => {
        const el = rfWrapper.current?.querySelector('.react-flow__viewport') as HTMLElement | null
        if (!el) { onToast('error', 'No se puede capturar el diagrama'); return }
        try {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore — installed in Docker build
            const { toPng } = await import('html-to-image')
            const dataUrl = await toPng(el, { backgroundColor: '#0a0e1a', pixelRatio: 2 })
            const a = document.createElement('a')
            a.href = dataUrl
            a.download = `labdash-network-${new Date().toISOString().slice(0, 10)}.png`
            a.click()
            onToast('success', '✓ Diagrama exportado como PNG')
        } catch {
            onToast('error', 'Error al exportar PNG')
        }
    }

    const handleLoadArp = async () => {
        setArpLoading(true)
        try {
            const r = await api.opnsenseArp()
            setArpEntries(r.entries ?? [])
            setShowArp(true)
        } catch {
            onToast('error', 'No se pudo cargar la tabla ARP')
        } finally { setArpLoading(false) }
    }

    const handleAddFromArp = (entry: any) => {
        const selectedType = arpTypes[entry.ip] || 'generic'
        const label = entry.hostname || entry.ip
        const tpl = getNodeMeta(selectedType)
        const node: Node = {
            id: uid(),
            type: 'infra',
            position: { x: 150 + Math.random() * 500, y: 150 + Math.random() * 350 },
            data: { label, ip: entry.ip, ntype: selectedType, icon: tpl.icon, color: tpl.color },
        }
        setNodes((ns: Node[]) => [...ns, node])
        onToast('success', `✓ Nodo "${label}" (${tpl.label}) añadido`)
    }

    const handleLoadWifi = async () => {
        setWifiLoading(true)
        try {
            const r = await api.opnsenseWifi()
            setWifiClients(r.clients ?? [])
            setShowWifi(true)
        } catch {
            onToast('error', 'No se pudo cargar los clientes WiFi')
        } finally { setWifiLoading(false) }
    }

    const handleAutoTopology = async () => {
        setAutoTopoLoading(true)
        try {
            // Fetch ARP + DHCP + interfaces in parallel
            const [arpRes, dhcpRes, ifacesRes] = await Promise.allSettled([
                api.opnsenseArp(),
                api.opnsenseDhcp(),
                api.opnsenseIfaces(),
            ])
            const entries: any[] = arpRes.status === 'fulfilled' ? (arpRes.value.entries ?? []) : []
            const leases: any[]  = dhcpRes.status === 'fulfilled' ? (dhcpRes.value.leases ?? []) : []

            // Build hostname map from DHCP (more complete than ARP)
            const dhcpHostname: Record<string, string> = {}
            for (const l of leases) {
                const ip = l.address || l['ip-address'] || l.ip || ''
                const name = l.hostname || l['client-hostname'] || ''
                if (ip && name) dhcpHostname[ip] = name
            }

            // Build OS interface name → OPNsense friendly label map (e.g. vtnet1 → HOMELAB)
            const ifaceLabel: Record<string, string> = {}
            if (ifacesRes.status === 'fulfilled') {
                const raw = (ifacesRes.value as any)?.data ?? {}
                const statsMap: Record<string, any> = raw?.statistics ?? (typeof raw === 'object' ? raw : {})
                for (const [key, f] of Object.entries(statsMap) as [string, any][]) {
                    if (typeof f !== 'object' || !f) continue
                    const osName  = (f.name ?? '').toLowerCase()
                    const label   = (key.match(/^\[(.+?)\]/)?.[1] ?? '').trim()
                    if (osName && label) ifaceLabel[osName] = label
                }
            }
            const friendlyIface = (raw: string) => ifaceLabel[raw.toLowerCase()] || raw

            const existingIps  = new Set(nodes.map((n: Node) => (n.data as any)?.ip).filter(Boolean))
            const newEntries = entries.filter(e => e.ip && !existingIps.has(e.ip))

            if (newEntries.length === 0) {
                onToast('success', 'No hay nuevos dispositivos en la tabla ARP')
                return
            }

            // Group by interface (using friendly name)
            const byIface: Record<string, any[]> = {}
            for (const e of newEntries) {
                const iface = friendlyIface(e.interface || 'LAN')
                if (!byIface[iface]) byIface[iface] = []
                byIface[iface].push(e)
            }
            const ifaceNames = Object.keys(byIface)

            // Find existing router/switch nodes to use as anchors
            const existingAnchors = nodes.filter((n: Node) => {
                const ntype = (n.data as any)?.ntype
                return ntype === 'router' || ntype === 'switch' || ntype === 'gateway'
            })

            // Compute layout: start below existing nodes to avoid overlapping
            const existingMaxY = nodes.length > 0
                ? Math.max(...nodes.map((n: Node) => (n.position?.y ?? 0))) + 220
                : 80
            const COL_W  = 240  // horizontal spacing between interface groups
            const ROW_H  = 160  // vertical spacing between device rows
            const COLS   = 4    // devices per row

            const addedNodes: Node[] = []
            const addedEdges: Edge[] = []

            ifaceNames.forEach((iface, ifaceIdx) => {
                const devices = byIface[iface]
                const groupX  = 60 + ifaceIdx * (COLS * COL_W + 80)

                // Pick or create anchor for this interface
                let anchorId: string
                if (existingAnchors.length > 0) {
                    // Prefer anchor whose label matches the friendly iface name
                    const match = existingAnchors.find((n: Node) =>
                        (n.data as any)?.label?.toLowerCase() === iface.toLowerCase()
                    ) ?? existingAnchors[0]
                    anchorId = match.id
                } else {
                    // Create a segment/switch node for this interface
                    const swMeta = getNodeMeta('switch')
                    anchorId = uid()
                    addedNodes.push({
                        id: anchorId,
                        type: 'infra',
                        position: { x: groupX + (COLS * COL_W) / 2 - 60, y: existingMaxY },
                        data: { label: iface, ip: '', ntype: 'switch', icon: swMeta.icon, color: swMeta.color },
                    })
                }

                // Add device nodes + edges
                const devBaseY = existingAnchors.length > 0 ? existingMaxY : existingMaxY + ROW_H
                devices.forEach((entry, i) => {
                    const label  = dhcpHostname[entry.ip] || entry.hostname || entry.ip
                    const tpl    = getNodeMeta('generic')
                    const nodeId = uid()
                    addedNodes.push({
                        id: nodeId,
                        type: 'infra',
                        position: { x: groupX + (i % COLS) * COL_W, y: devBaseY + Math.floor(i / COLS) * ROW_H },
                        data: { label, ip: entry.ip, ntype: 'generic', icon: tpl.icon, color: tpl.color },
                    })
                    addedEdges.push({
                        id: `ae-${anchorId}-${nodeId}`,
                        source: anchorId,
                        target: nodeId,
                        animated: false,
                        style: { stroke: 'var(--accent)', strokeWidth: 1 },
                        markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--accent)' },
                    } as Edge)
                })
            })

            setNodes((ns: Node[]) => [...ns, ...addedNodes])
            setEdges((es: Edge[]) => [...es, ...addedEdges])
            dirtyRef.current = true
            const deviceCount = addedNodes.filter(n => (n.data as any).ntype !== 'switch').length
            onToast('success', `✓ ${deviceCount} nodos y ${addedEdges.length} enlaces añadidos desde ARP`)
        } catch {
            onToast('error', 'No se pudo cargar la tabla ARP')
        } finally { setAutoTopoLoading(false) }
    }

    const handleLoadInfra = async () => {
        setInfraLoading(true)
        setShowInfra(true)
        try {
            const [nodesRes, vmsRes, gwRes, tsRes] = await Promise.allSettled([
                api.proxmoxNodes(),
                api.proxmoxVMs(),
                api.opnsenseGateways(),
                api.tailscaleDevices(),
            ])
            const items: InfraItem[] = []

            // Proxmox nodes
            if (nodesRes.status === 'fulfilled') {
                const raw = nodesRes.value as any
                for (const n of raw.nodes ?? []) {
                    items.push({
                        id: `pv-node-${n.name}`,
                        label: n.name,
                        ip: '',
                        ntype: 'server',
                        icon: 'fa-server',
                        color: '#63b3ed',
                        group: 'Proxmox — Nodos',
                        badge: n.status,
                    })
                }
            }

            // Proxmox VMs
            if (vmsRes.status === 'fulfilled') {
                const raw = vmsRes.value as any
                for (const [nodeName, vms] of Object.entries(raw.by_node ?? {})) {
                    for (const vm of (vms as any[])) {
                        if (vm.template) continue
                        items.push({
                            id: `pv-vm-${vm.vmid}`,
                            label: vm.name || `VM ${vm.vmid}`,
                            ip: '',
                            ntype: 'vm',
                            icon: vm.type === 'qemu' ? 'fa-display' : 'fa-box',
                            color: vm.status === 'running' ? '#68d391' : '#fc8181',
                            group: `Proxmox — ${nodeName}`,
                            badge: vm.status,
                        })
                    }
                }
            }

            // OPNsense gateways
            if (gwRes.status === 'fulfilled') {
                const raw = gwRes.value as any
                const gws = raw?.items ?? raw?.data?.items ?? []
                for (const gw of gws) {
                    items.push({
                        id: `gw-${gw.name}`,
                        label: gw.name,
                        ip: gw.gwaddr || '',
                        ntype: 'router',
                        icon: 'fa-shield-halved',
                        color: '#f6ad55',
                        group: 'OPNsense — Gateways',
                        badge: gw.status_translated || gw.status,
                    })
                }
            }

            // Tailscale devices
            if (tsRes.status === 'fulfilled') {
                const raw = tsRes.value as any
                const devices = raw?.data?.devices ?? []
                for (const d of devices) {
                    const ip = d.addresses?.[0] ?? ''
                    items.push({
                        id: `ts-${d.id ?? d.hostname}`,
                        label: d.hostname || d.name || ip,
                        ip,
                        ntype: 'vpn',
                        icon: 'fa-shield-halved',
                        color: '#63b3ed',
                        group: 'Tailscale — Dispositivos',
                        badge: d.online ? 'online' : 'offline',
                    })
                }
            }

            setInfraItems(items)
        } catch {
            onToast('error', 'Error cargando recursos de infraestructura')
        } finally {
            setInfraLoading(false)
        }
    }

    const handleRemoveFromInfra = (item: InfraItem) => {
        setNodes((ns: Node[]) => ns.filter((n: Node) => {
            const nInfraId = (n.data as any)?.infraId
            const nIp = (n.data as any)?.ip
            if (nInfraId && nInfraId === item.id) return false
            if (!nInfraId && item.ip && nIp === item.ip) return false
            return true
        }))
        dirtyRef.current = true
        onToast('success', `✓ "${item.label}" eliminado del mapa`)
    }

    const handleAddFromInfra = () => {
        const existingIds = new Set(nodes.map((n: Node) => (n.data as any)?.infraId).filter(Boolean))
        const existingIps = new Set(nodes.map((n: Node) => (n.data as any)?.ip).filter(Boolean))
        const toAdd = infraItems.filter(item =>
            selectedInfra.has(item.id) &&
            !existingIds.has(item.id) &&
            !(item.ip && existingIps.has(item.ip))
        )
        if (toAdd.length === 0) return
        const newNodes: Node[] = toAdd.map((item, i) => ({
            id: uid(),
            type: 'infra',
            position: { x: 200 + (i % 4) * 200, y: 150 + Math.floor(i / 4) * 160 },
            data: {
                label: item.label,
                ip: item.ip,
                ntype: item.ntype,
                icon: item.icon,
                color: item.color,
                infraId: item.id,
            },
        }))
        setNodes((ns: Node[]) => [...ns, ...newNodes])
        setSelectedInfra(new Set())
        dirtyRef.current = true
        onToast('success', `✓ ${newNodes.length} nodo(s) añadido(s) al mapa`)
    }

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

                        <button className="btn btn-secondary" onClick={handleExport} disabled={nodes.length === 0} title="Exportar JSON">
                            <i className="fa-solid fa-file-code" /> JSON
                        </button>
                        <button className="btn btn-secondary" onClick={handleExportPng} disabled={nodes.length === 0} title="Exportar PNG">
                            <i className="fa-solid fa-image" /> PNG
                        </button>
                        <button className="btn btn-secondary" onClick={() => importRef.current?.click()} title="Importar diagrama desde archivo JSON">
                            <i className="fa-solid fa-file-import" /> Importar
                        </button>
                        <input
                            ref={importRef}
                            type="file"
                            accept=".json,application/json"
                            style={{ display: 'none' }}
                            onChange={handleImportJson}
                        />
                        <button
                            className={`btn ${showArp ? 'btn-primary' : 'btn-secondary'}`}
                            onClick={showArp ? () => setShowArp(false) : handleLoadArp}
                            disabled={arpLoading}
                            title="Descubrir dispositivos desde tabla ARP de OPNsense"
                        >
                            <i className={`fa-solid ${arpLoading ? 'fa-spinner fa-spin' : 'fa-magnifying-glass-location'}`} />
                            {arpLoading ? 'Buscando…' : 'ARP'}
                        </button>
                        <button
                            className="btn btn-secondary"
                            onClick={handleAutoTopology}
                            disabled={autoTopoLoading}
                            title="Auto-detectar topología desde ARP y añadir nodos no existentes"
                        >
                            <i className={`fa-solid ${autoTopoLoading ? 'fa-spinner fa-spin' : 'fa-wand-magic-sparkles'}`} />
                            {autoTopoLoading ? 'Detectando…' : 'Auto-topo'}
                        </button>
                        <button
                            className={`btn ${showWifi ? 'btn-primary' : 'btn-secondary'}`}
                            onClick={showWifi ? () => setShowWifi(false) : handleLoadWifi}
                            disabled={wifiLoading}
                            title="Ver clientes WiFi desde OPNsense"
                        >
                            <i className={`fa-solid ${wifiLoading ? 'fa-spinner fa-spin' : 'fa-wifi'}`} />
                            {wifiLoading ? 'Cargando…' : 'WiFi'}
                        </button>
                        <button
                            className={`btn ${showInfra ? 'btn-primary' : 'btn-secondary'}`}
                            onClick={showInfra ? () => setShowInfra(false) : handleLoadInfra}
                            disabled={infraLoading}
                            title="Seleccionar recursos de infraestructura controlada (Proxmox, OPNsense, Tailscale…)"
                        >
                            <i className={`fa-solid ${infraLoading ? 'fa-spinner fa-spin' : 'fa-layer-group'}`} />
                            {infraLoading ? 'Cargando…' : 'Recursos'}
                        </button>

                        {/* Auto-save indicator */}
                        {autoSaveInfo && (
                            <div title="Último auto-guardado" style={{
                                display: 'flex', alignItems: 'center', gap: 5,
                                padding: '4px 10px', borderRadius: 8, fontSize: 10,
                                background: 'rgba(99,179,237,0.07)',
                                border: '1px solid rgba(99,179,237,0.2)',
                                color: 'var(--muted)',
                            }}>
                                <i className="fa-solid fa-floppy-disk" style={{ color: 'var(--accent)', fontSize: 9 }} />
                                {autoSaveInfo}
                            </div>
                        )}

                        {/* Live indicator */}
                        {liveActive && (
                            <div title="Monitorización de estado activa (actualiza cada 15s)" style={{
                                display: 'flex', alignItems: 'center', gap: 5,
                                padding: '4px 10px', borderRadius: 8, fontSize: 10,
                                background: 'rgba(104,211,145,0.08)',
                                border: '1px solid rgba(104,211,145,0.25)',
                                color: '#68d391',
                            }}>
                                <span style={{
                                    width: 6, height: 6, borderRadius: '50%',
                                    background: '#68d391', boxShadow: '0 0 5px #68d391',
                                    animation: 'pulse 2s infinite', display: 'inline-block',
                                }} />
                                Live
                            </div>
                        )}

                        {editMode && <>
                            <button className="btn btn-secondary" onClick={() => { setShowAddNode(s => !s); setShowTemplates(false) }}>
                                <i className="fa-solid fa-plus" /> Nodo
                            </button>
                            <button className="btn btn-danger" onClick={handleDeleteSelected} title="Eliminar seleccionados (Del)">
                                <i className="fa-solid fa-trash" /> Borrar
                            </button>
                            <button className="btn btn-danger" onClick={handleClearAll} title="Borrar todo el diagrama" style={{ opacity: 0.75 }}>
                                <i className="fa-solid fa-trash-can" /> Todo
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

                {/* ── ARP discovery panel ── */}
                {showArp && !editingNodeId && !showTemplates && (
                    <Panel position="top-right">
                        <div className="diagram-node-panel" style={{ minWidth: 340, maxHeight: 420, overflowY: 'auto' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                                <h4 style={{ margin: 0 }}>
                                    <i className="fa-solid fa-magnifying-glass-location" style={{ marginRight: 8, color: 'var(--accent6)' }} />
                                    ARP — Dispositivos detectados
                                </h4>
                                <button className="btn btn-secondary" style={{ padding: '3px 8px', fontSize: 11 }}
                                    onClick={() => setShowArp(false)}>
                                    <i className="fa-solid fa-xmark" />
                                </button>
                            </div>
                            {arpEntries.length === 0 ? (
                                <p style={{ color: 'var(--muted)', fontSize: 12 }}>Sin entradas ARP. Configura OPNsense en Settings.</p>
                            ) : arpEntries.map((e, i) => {
                                const alreadyAdded = nodes.some((n: Node) => (n.data as any)?.ip === e.ip)
                                const selType = arpTypes[e.ip] || 'generic'
                                const selTpl = getNodeMeta(selType)
                                return (
                                    <div key={i} style={{
                                        padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.05)',
                                    }}>
                                        {/* IP + hostname row */}
                                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: alreadyAdded ? 0 : 6 }}>
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                {e.hostname && (
                                                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 1 }}>
                                                        {e.hostname}
                                                    </div>
                                                )}
                                                <div style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: 'var(--accent)' }}>
                                                    {e.ip}
                                                </div>
                                                <div style={{ fontSize: 9.5, color: 'var(--muted)', marginTop: 1 }}>
                                                    {e.mac || '—'}
                                                    {e.interface && <span style={{ marginLeft: 6, opacity: 0.6 }}>[{e.interface}]</span>}
                                                </div>
                                            </div>
                                            {alreadyAdded && (
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, marginTop: 2 }}>
                                                    <span style={{ fontSize: 10, color: 'var(--muted)' }}>ya existe</span>
                                                    {e.mac && (
                                                        <button
                                                            onClick={() => api.wol(e.mac).then(() => onToast('success', `WoL enviado a ${e.mac}`)).catch(() => onToast('error', 'Error al enviar WoL'))}
                                                            title={`Wake-on-LAN → ${e.mac}`}
                                                            style={{
                                                                background: 'rgba(237,137,54,0.1)', border: '1px solid rgba(237,137,54,0.3)',
                                                                borderRadius: 6, color: '#ed8936', cursor: 'pointer',
                                                                padding: '3px 7px', fontSize: 10, whiteSpace: 'nowrap',
                                                            }}
                                                        >
                                                            <i className="fa-solid fa-power-off" />
                                                        </button>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                        {/* Type selector + add button */}
                                        {!alreadyAdded && (
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                <i className={`fa-solid ${selTpl.icon}`} style={{ color: selTpl.color, fontSize: 12, width: 14, textAlign: 'center' }} />
                                                <select
                                                    value={selType}
                                                    onChange={ev => setArpTypes(prev => ({ ...prev, [e.ip]: ev.target.value }))}
                                                    style={{
                                                        flex: 1, background: 'rgba(255,255,255,0.05)',
                                                        border: '1px solid var(--border)', borderRadius: 6,
                                                        color: 'var(--text)', fontSize: 10.5, padding: '3px 6px',
                                                        outline: 'none', cursor: 'pointer',
                                                    }}
                                                >
                                                    {NODE_TEMPLATES.map((t: { type: string; label: string; group: string }) => (
                                                        <option key={t.type} value={t.type}>{t.group} — {t.label}</option>
                                                    ))}
                                                </select>
                                                <button
                                                    onClick={() => handleAddFromArp(e)}
                                                    style={{
                                                        background: 'rgba(104,211,145,0.1)', border: '1px solid rgba(104,211,145,0.3)',
                                                        borderRadius: 6, color: '#68d391', cursor: 'pointer',
                                                        padding: '4px 9px', fontSize: 11, flexShrink: 0, whiteSpace: 'nowrap',
                                                    }}
                                                >
                                                    <i className="fa-solid fa-plus" /> Añadir
                                                </button>
                                                {e.mac && (
                                                    <button
                                                        onClick={() => api.wol(e.mac).then(() => onToast('success', `WoL enviado a ${e.mac}`)).catch(() => onToast('error', 'Error al enviar WoL'))}
                                                        title={`Wake-on-LAN → ${e.mac}`}
                                                        style={{
                                                            background: 'rgba(237,137,54,0.1)', border: '1px solid rgba(237,137,54,0.3)',
                                                            borderRadius: 6, color: '#ed8936', cursor: 'pointer',
                                                            padding: '4px 7px', fontSize: 11, flexShrink: 0,
                                                        }}
                                                    >
                                                        <i className="fa-solid fa-power-off" />
                                                    </button>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )
                            })}
                        </div>
                    </Panel>
                )}

                {/* ── WiFi clients panel ── */}
                {showWifi && !editingNodeId && !showTemplates && !showArp && (
                    <Panel position="top-right">
                        <div className="diagram-node-panel" style={{ minWidth: 320, maxHeight: 420, overflowY: 'auto' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                                <h4 style={{ margin: 0 }}>
                                    <i className="fa-solid fa-wifi" style={{ marginRight: 8, color: 'var(--accent2)' }} />
                                    Clientes WiFi
                                </h4>
                                <button className="btn btn-secondary" style={{ padding: '3px 8px', fontSize: 11 }}
                                    onClick={() => setShowWifi(false)}>
                                    <i className="fa-solid fa-xmark" />
                                </button>
                            </div>
                            {wifiClients.length === 0 ? (
                                <p style={{ color: 'var(--muted)', fontSize: 12 }}>Sin clientes WiFi. Configura OPNsense en Settings.</p>
                            ) : wifiClients.map((c: any, i: number) => (
                                <div key={i} style={{ padding: '7px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 2 }}>
                                        {c.hostname || c.ip || c.mac || '—'}
                                    </div>
                                    <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'JetBrains Mono, monospace', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                        {c.ip && <span style={{ color: 'var(--accent)' }}>{c.ip}</span>}
                                        {c.mac && <span>{c.mac}</span>}
                                        {c.ssid && <span style={{ color: 'var(--accent2)' }}>{c.ssid}</span>}
                                        {c.signal !== undefined && <span>señal: {c.signal} dBm</span>}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </Panel>
                )}

                {/* ── Infra resources panel ── */}
                {showInfra && !editingNodeId && !showTemplates && !showArp && !showWifi && (() => {
                    const existingIps = new Set(nodes.map((n: Node) => (n.data as any)?.ip).filter(Boolean))
                    const existingInfraIds = new Set(nodes.map((n: Node) => (n.data as any)?.infraId).filter(Boolean))
                    const groups = [...new Set(infraItems.map(i => i.group))]
                    const selCount = selectedInfra.size
                    return (
                        <Panel position="top-right">
                            <div className="diagram-node-panel" style={{ minWidth: 340, maxHeight: 460, display: 'flex', flexDirection: 'column' }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexShrink: 0 }}>
                                    <h4 style={{ margin: 0 }}>
                                        <i className="fa-solid fa-layer-group" style={{ marginRight: 8, color: 'var(--accent)' }} />
                                        Recursos de infraestructura
                                    </h4>
                                    <button className="btn btn-secondary" style={{ padding: '3px 8px', fontSize: 11 }}
                                        onClick={() => setShowInfra(false)}>
                                        <i className="fa-solid fa-xmark" />
                                    </button>
                                </div>

                                {infraLoading ? (
                                    <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>
                                        <i className="fa-solid fa-spinner fa-spin" style={{ marginRight: 8 }} />
                                        Cargando recursos…
                                    </div>
                                ) : infraItems.length === 0 ? (
                                    <p style={{ color: 'var(--muted)', fontSize: 12 }}>
                                        Sin recursos disponibles. Configura las integraciones en Settings.
                                    </p>
                                ) : (
                                    <>
                                        {/* Select all */}
                                        <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexShrink: 0 }}>
                                            <button className="btn btn-secondary" style={{ fontSize: 10, padding: '3px 8px' }}
                                                onClick={() => {
                                                    const selectable = infraItems.filter(item =>
                                                        !existingInfraIds.has(item.id) && !(item.ip && existingIps.has(item.ip))
                                                    )
                                                    setSelectedInfra(new Set(selectable.map(i => i.id)))
                                                }}>
                                                Seleccionar todos
                                            </button>
                                            <button className="btn btn-secondary" style={{ fontSize: 10, padding: '3px 8px' }}
                                                onClick={() => setSelectedInfra(new Set())}>
                                                Limpiar
                                            </button>
                                        </div>

                                        {/* Item list */}
                                        <div style={{ overflowY: 'auto', flex: 1, marginBottom: 10 }}>
                                            {groups.map(group => (
                                                <div key={group} style={{ marginBottom: 12 }}>
                                                    <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 6 }}>
                                                        {group}
                                                    </div>
                                                    {infraItems.filter(item => item.group === group).map(item => {
                                                        const onMap = existingInfraIds.has(item.id) || (item.ip !== '' && existingIps.has(item.ip))
                                                        const checked = selectedInfra.has(item.id)
                                                        return (
                                                            <div key={item.id} style={{
                                                                display: 'flex', alignItems: 'center', gap: 8,
                                                                padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,0.04)',
                                                                opacity: onMap ? 0.5 : 1,
                                                            }}>
                                                                <input
                                                                    type="checkbox"
                                                                    checked={checked}
                                                                    disabled={onMap}
                                                                    onChange={e => {
                                                                        const next = new Set(selectedInfra)
                                                                        if (e.target.checked) next.add(item.id)
                                                                        else next.delete(item.id)
                                                                        setSelectedInfra(next)
                                                                    }}
                                                                    style={{ cursor: onMap ? 'default' : 'pointer', flexShrink: 0 }}
                                                                />
                                                                <div style={{ width: 24, height: 24, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', background: `${item.color}18`, flexShrink: 0 }}>
                                                                    <i className={`fa-solid ${item.icon}`} style={{ color: item.color, fontSize: 11 }} />
                                                                </div>
                                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                                    <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                                        {item.label}
                                                                    </div>
                                                                    {item.ip && <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'JetBrains Mono, monospace' }}>{item.ip}</div>}
                                                                </div>
                                                                {onMap ? (
                                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                                                                        <span style={{ fontSize: 9, color: 'var(--muted)' }}>en mapa</span>
                                                                        <button
                                                                            onClick={() => handleRemoveFromInfra(item)}
                                                                            title="Quitar del mapa"
                                                                            style={{
                                                                                background: 'rgba(252,129,129,0.12)', border: '1px solid rgba(252,129,129,0.3)',
                                                                                borderRadius: 4, color: '#fc8181', cursor: 'pointer',
                                                                                padding: '1px 5px', fontSize: 9, lineHeight: 1.6,
                                                                            }}
                                                                        >
                                                                            <i className="fa-solid fa-xmark" />
                                                                        </button>
                                                                    </div>
                                                                ) : item.badge && (
                                                                    <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 4, flexShrink: 0, background: `${item.color}18`, color: item.color, border: `1px solid ${item.color}33` }}>
                                                                        {item.badge}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        )
                                                    })}
                                                </div>
                                            ))}
                                        </div>

                                        {/* Add button */}
                                        <button
                                            className="btn btn-primary"
                                            style={{ width: '100%', justifyContent: 'center', flexShrink: 0 }}
                                            onClick={handleAddFromInfra}
                                            disabled={selCount === 0}
                                        >
                                            <i className="fa-solid fa-plus" />
                                            {selCount > 0 ? `Añadir ${selCount} seleccionado${selCount > 1 ? 's' : ''}` : 'Selecciona recursos'}
                                        </button>
                                    </>
                                )}
                            </div>
                        </Panel>
                    )
                })()}

                {/* ── Add node panel — grouped icon picker ── */}
                {editMode && showAddNode && !editingNodeId && (
                    <Panel position="top-right">
                        <div className="diagram-node-panel" style={{ minWidth: 340, maxWidth: 380 }}>
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
                                <label>Tipo de dispositivo</label>
                                <div style={{ maxHeight: 260, overflowY: 'auto', paddingRight: 4, marginTop: 6 }}>
                                    {NODE_GROUPS.map((group: string) => (
                                        <div key={group} style={{ marginBottom: 8 }}>
                                            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 4 }}>
                                                {group}
                                            </div>
                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                                {NODE_TEMPLATES.filter((t: { group: string }) => t.group === group).map((t: { type: string; icon: string; label: string; color: string }) => (
                                                    <button key={t.type}
                                                        onClick={() => setNewNode(n => ({ ...n, type: t.type }))}
                                                        title={t.label}
                                                        style={{
                                                            padding: '4px 8px', borderRadius: 7, fontSize: 10.5, cursor: 'pointer',
                                                            border: `1px solid ${newNode.type === t.type ? t.color : 'var(--border)'}`,
                                                            background: newNode.type === t.type ? `${t.color}22` : 'rgba(255,255,255,0.02)',
                                                            color: newNode.type === t.type ? t.color : 'var(--muted)',
                                                            transition: 'all .15s', display: 'flex', alignItems: 'center', gap: 4,
                                                        }}>
                                                        <i className={`fa-solid ${t.icon}`} />
                                                        <span style={{ fontSize: 9.5 }}>{t.label.split('/')[0].trim()}</span>
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
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
                            Carga un <strong style={{ color: 'var(--text)' }}>template</strong> o activa{' '}
                            <strong style={{ color: 'var(--text)' }}>modo Edición</strong> para construir tu topología
                        </div>
                    </Panel>
                )}
            </ReactFlow>
        </div>
    )
}
