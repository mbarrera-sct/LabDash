// LabDash API — typed helpers + auth

const TOKEN_KEY = "labdash_token"

export function getToken(): string | null {
    return localStorage.getItem(TOKEN_KEY)
}
export function setToken(t: string) {
    localStorage.setItem(TOKEN_KEY, t)
}
export function clearToken() {
    localStorage.removeItem(TOKEN_KEY)
}

function authHeaders(): Record<string, string> {
    const t = getToken()
    return t ? { Authorization: `Bearer ${t}` } : {}
}

export async function get<T>(path: string, extraHeaders?: Record<string, string>): Promise<T> {
    const r = await fetch(path, { headers: { ...authHeaders(), ...extraHeaders } })
    if (r.status === 401) {
        clearToken()
        window.location.reload()
        throw new Error("Unauthorized")
    }
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
    return r.json()
}

export async function post<T>(path: string, body: unknown, extraHeaders?: Record<string, string>): Promise<T> {
    const r = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders(), ...extraHeaders },
        body: JSON.stringify(body),
    })
    if (r.status === 401 && !path.startsWith("/api/auth/")) {
        clearToken()
        window.location.reload()
        throw new Error("Unauthorized")
    }
    if (!r.ok) {
        const err = await r.json().catch(() => ({ detail: r.statusText }))
        throw new Error(err.detail || r.statusText)
    }
    return r.json()
}

export async function patch<T>(path: string, body?: unknown): Promise<T> {
    const r = await fetch(path, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    if (!r.ok) {
        const err = await r.json().catch(() => ({ detail: r.statusText }))
        throw new Error(err.detail || r.statusText)
    }
    return r.json()
}

export async function del<T>(path: string): Promise<T> {
    const r = await fetch(path, {
        method: "DELETE",
        headers: authHeaders(),
    })
    if (r.status === 401) {
        clearToken()
        window.location.reload()
        throw new Error("Unauthorized")
    }
    if (!r.ok) {
        const err = await r.json().catch(() => ({ detail: r.statusText }))
        throw new Error(err.detail || r.statusText)
    }
    return r.json()
}

// ── Auth ──────────────────────────────────────────────────────────────────────
export interface CurrentUser {
    id: number
    username: string
    totp_enabled: boolean
}

export const authApi = {
    login: (username: string, password: string) =>
        post<{ needs_totp: boolean; temp_token?: string; token?: string; username?: string }>(
            "/api/auth/login", { username, password }
        ),
    verifyTotp: (temp_token: string, code: string) =>
        post<{ token: string; username: string }>("/api/auth/verify-totp", { temp_token, code }),
    me: () => get<CurrentUser>("/api/auth/me"),
    logout: () => post("/api/auth/logout", {}),
    changePassword: (current_password: string, new_password: string) =>
        post<{ ok: boolean }>("/api/auth/change-password", { current_password, new_password }),
    disableTotp: () => post<{ ok: boolean }>("/api/auth/disable-totp", {}),
    initTotp: () => get<{ secret: string; uri: string }>("/api/auth/totp-init"),
    enableTotp: (code: string) => post<{ ok: boolean }>("/api/auth/totp-enable", { code }),
}

export const usersApi = {
    list: () => get<{ users: { id: number; username: string; totp_enabled: boolean }[] }>("/api/users"),
    create: (username: string, password: string) =>
        post<{ ok: boolean }>("/api/users", { username, password }),
    delete: (id: number) => del<{ ok: boolean }>(`/api/users/${id}`),
}

// ── Alert rules ───────────────────────────────────────────────────────────────
export interface AlertRule {
    id: number
    name: string
    metric_key: string
    operator: string
    threshold: number
    notify_url: string
    cooldown_s: number
    enabled: number
    last_fired: number
}

export const alertsApi = {
    list: () => get<{ rules: AlertRule[] }>("/api/alert-rules"),
    create: (rule: Omit<AlertRule, "id" | "enabled" | "last_fired">) =>
        post<{ ok: boolean; id: number }>("/api/alert-rules", rule),
    delete: (id: number) => del<{ ok: boolean }>(`/api/alert-rules/${id}`),
    toggle: (id: number, enabled: boolean) =>
        patch<{ ok: boolean }>(`/api/alert-rules/${id}/toggle?enabled=${enabled}`),
}

// ── Main API ──────────────────────────────────────────────────────────────────
export const api = {
    // Status & infra
    status:          () => get("/api/status"),
    proxmoxNodes:    () => get("/api/proxmox/nodes"),
    proxmoxVMs:      () => get("/api/proxmox/vms"),
    proxmoxTest:     () => post<{ ok: boolean; message: string }>("/api/proxmox/test", {}),
    proxmoxVmAction: (node: string, vmtype: string, vmid: number, action: string) =>
        post<{ ok: boolean; upid: string }>("/api/proxmox/vm-action", { node, vmtype, vmid, action }),

    // OPNsense
    opnsenseGateways:  () => get("/api/opnsense/gateways"),
    opnsenseIfaces:    () => get("/api/opnsense/interfaces"),
    opnsenseSysinfo:   () => get("/api/opnsense/sysinfo"),
    opnsenseDhcp:      () => get<{ leases: any[]; error: string | null }>("/api/opnsense/dhcp"),
    opnsenseArp:       () => get<{ entries: any[]; error: string | null }>("/api/opnsense/arp"),
    opnsenseFwlog:     () => get<{ entries: any[]; error: string | null }>("/api/opnsense/fwlog"),

    // Other services
    pingIPs:      (ips: string[]) => post<{ results: Record<string, boolean> }>("/api/ping", { ips }),
    k8sNodes:     () => get("/api/k8s/nodes"),
    k8sWorkloads: () => get("/api/k8s/workloads"),
    unraidSystem: () => get("/api/unraid/system"),
    unraidDocker: () => get("/api/unraid/docker"),
    plexInfo:     () => get("/api/plex/info"),
    immichStats:  () => get("/api/immich/stats"),
    haStates:     () => get("/api/ha/states"),
    snmpInterfaces: () => get<{ ports: any[]; error: string | null }>("/api/snmp/interfaces"),

    // Diagram
    getDiagram:    () => get("/api/diagram"),
    saveDiagram:   (d: unknown) => post("/api/diagram", d),
    listTemplates: () => get<{ id: string; name: string; description: string }[]>("/api/templates"),
    loadTemplate:  (id: string) => get<{ nodes: unknown[]; edges: unknown[] }>(`/api/templates/${id}`),

    // Settings
    getSettings:  () => get("/api/settings"),
    saveSettings: (s: Record<string, string>) => post("/api/settings", s),

    // Metrics
    getMetrics:  (key: string, hours?: number) =>
        get<{ key: string; points: { ts: number; value: number }[] }>(
            `/api/metrics/${encodeURIComponent(key)}${hours ? `?hours=${hours}` : ""}`
        ),
    metricsKeys: () => get<{ keys: string[] }>("/api/metrics-keys"),

    // Events
    getEvents: (limit?: number) =>
        get<{ events: { id: number; ts: number; level: string; source: string; message: string }[] }>(
            `/api/events${limit ? `?limit=${limit}` : ""}`
        ),

    // Uptime
    getUptime: (host: string, hours?: number) =>
        get<{ host: string; hours: number; pct: number }>(
            `/api/uptime/${encodeURIComponent(host)}${hours ? `?hours=${hours}` : ""}`
        ),

    // Network live status (ping + SNMP traffic per node)
    networkLive: () =>
        get<{ ping: Record<string, boolean>; snmp_in_kbps: number | null; snmp_out_kbps: number | null }>(
            "/api/network/live"
        ),
}
