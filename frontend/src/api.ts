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
    role?: string
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
    list: () => get<{ users: { id: number; username: string; totp_enabled: boolean; role: string }[] }>("/api/users"),
    create: (username: string, password: string, role?: string) =>
        post<{ ok: boolean }>("/api/users", { username, password, role: role ?? "admin" }),
    delete: (id: number) => del<{ ok: boolean }>(`/api/users/${id}`),
    setRole: (id: number, role: string) => patch<{ ok: boolean }>(`/api/users/${id}/role`, { role }),
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
    list:   () => get<{ rules: AlertRule[] }>("/api/alert-rules"),
    create: (rule: Omit<AlertRule, "id" | "enabled" | "last_fired">) =>
        post<{ ok: boolean; id: number }>("/api/alert-rules", rule),
    update: (id: number, rule: Partial<AlertRule>) =>
        patch<{ ok: boolean }>(`/api/alert-rules/${id}`, rule),
    delete: (id: number) => del<{ ok: boolean }>(`/api/alert-rules/${id}`),
    toggle: (id: number, enabled: boolean) =>
        patch<{ ok: boolean }>(`/api/alert-rules/${id}/toggle?enabled=${enabled}`),
    test:   (id: number) =>
        post<{ ok: boolean; message: string }>(`/api/alert-rules/${id}/test`, {}),
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
    unraidDisks:  () => get<{ status: string; capacity: Record<string, number>; disks: any[]; parities: any[]; error: string|null }>("/api/unraid/disks"),
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

    // Portainer
    portainerData:    () => get<{ data: any; error: string|null }>("/api/portainer/data"),
    portainerCompose: (stackId: number) => get<{ stack_id: number; compose: string }>(`/api/portainer/stacks/${stackId}/compose`),
    // Uptime Kuma
    uptimeKumaMonitors: () => get<{ data: any; error: string|null }>("/api/uptime-kuma/monitors"),
    // OPNsense extras
    opnsenseFwRules:  () => get<{ rules: any[]; error: string|null }>("/api/opnsense/fw-rules"),
    opnsenseWifi:     () => get<{ clients: any[]; error: string|null }>("/api/opnsense/wifi"),
    opnsenseWireguard: () => get<{ data: any; error: string|null }>("/api/opnsense/wireguard"),
    // Audit log
    getAuditLog:      (limit?: number) => get<{ entries: any[] }>(`/api/audit-log${limit ? `?limit=${limit}` : ''}`),
    // Alert history
    getAlertHistory:  (limit?: number) => get<{ entries: any[] }>(`/api/alert-history${limit ? `?limit=${limit}` : ''}`),
    // Sessions
    getSessions:      () => get<{ sessions: { token_hint: string; expires_at: number; token: string }[] }>("/api/sessions"),
    revokeSession:    (token: string) => del<{ ok: boolean }>(`/api/sessions/${encodeURIComponent(token)}`),
    // Backup / Restore
    restore:          (payload: unknown) => post<{ ok: boolean; restored: string[] }>("/api/restore", { payload }),
    // Proxmox extras
    proxmoxNodeDetail: (node: string) => get<{ node: string; cpu_temp: number|null; disks: any[]; sensors: any }>(`/api/proxmox/node-detail/${encodeURIComponent(node)}`),
    proxmoxConfig:    () => get<{ pve_url: string }>("/api/proxmox/config"),
    // Tailscale
    tailscaleDevices: () => get<{ data: any; error: string|null }>("/api/tailscale/devices"),
    // Wake-on-LAN
    wol:              (mac: string, broadcast?: string) => post<{ ok: boolean; mac: string }>("/api/wol", { mac, broadcast: broadcast ?? "255.255.255.255" }),

    // Setup wizard
    setupStatus:   () => get<{ needs_setup: boolean }>("/api/setup/status"),
    setupComplete: (settings: Record<string, string>) =>
        post<{ ok: boolean }>("/api/setup/complete", { settings }),

    // Push notifications
    pushVapidKey:     () => get<{ key: string | null; error?: string }>("/api/push/vapid-public-key"),
    pushSubscribe:    (sub: { endpoint: string; p256dh: string; auth: string }) => post<{ ok: boolean }>("/api/push/subscribe", sub),
    pushUnsubscribe:  (endpoint: string) => fetch("/api/push/unsubscribe", { method: "DELETE", headers: { "Content-Type": "application/json", ...{ Authorization: `Bearer ${localStorage.getItem("labdash_token") ?? ""}` } }, body: JSON.stringify({ endpoint }) }).then(r => r.json()),

    // Telegram
    telegramStatus: () => get<{ configured: boolean; bot: { username: string; first_name: string } | null; chat_id: string | null; daily_digest: boolean }>("/api/telegram/status"),
    telegramConfig: (body: { token: string; chat_id?: string; daily_digest?: boolean; webhook_url?: string }) =>
        post<{ ok: boolean; error?: string }>("/api/telegram/config", body),
    telegramTest:   () => post<{ ok: boolean; message?: string; error?: string }>("/api/telegram/test", {}),
    telegramDelete: () => del<{ ok: boolean }>("/api/telegram/config"),

    // Alert silences
    alertSilences:  () => get<{ silences: { rule_id: number; until_ts: number }[] }>("/api/alert-silences"),
    silenceAlert:   (rule_id: number, hours: number) =>
        post<{ ok: boolean; until_ts: number }>(`/api/alert-rules/${rule_id}/silence`, { hours }),

    // Alert history
    getAlertHistory: (limit?: number) =>
        get<{ entries: any[] }>(`/api/alert-history${limit ? `?limit=${limit}` : ""}`),

    // Dashboard bundle
    dashboardBundle: () => get<{ status: any; proxmox: any; opnsense: any; k8s: any; services: any }>("/api/dashboard/bundle"),

    // Re-export alertsApi for Notifications page convenience
    alertsApi,
}
