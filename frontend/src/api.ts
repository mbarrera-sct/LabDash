// Typed API helpers

export async function get<T>(path: string): Promise<T> {
    const r = await fetch(path)
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
    return r.json()
}

export async function post<T>(path: string, body: unknown): Promise<T> {
    const r = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    })
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
    return r.json()
}

// Convenience API calls
export const api = {
    status: () => get('/api/status'),
    proxmoxNodes: () => get('/api/proxmox/nodes'),
    proxmoxVMs: () => get('/api/proxmox/vms'),
    opnsenseGateways: () => get('/api/opnsense/gateways'),
    opnsenseIfaces: () => get('/api/opnsense/interfaces'),
    k8sNodes: () => get('/api/k8s/nodes'),
    k8sWorkloads: () => get('/api/k8s/workloads'),
    unraidSystem: () => get('/api/unraid/system'),
    unraidDocker: () => get('/api/unraid/docker'),
    plexInfo: () => get('/api/plex/info'),
    immichStats: () => get('/api/immich/stats'),
    haStates: () => get('/api/ha/states'),
    getDiagram: () => get('/api/diagram'),
    saveDiagram: (d: unknown) => post('/api/diagram', d),
    getSettings: () => get('/api/settings'),
    saveSettings: (s: Record<string, string>) => post('/api/settings', s),
}
