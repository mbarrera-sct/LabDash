/** Shared formatting utilities */

export function fmtKbps(n: number): string {
    if (!n || n < 0.1) return '0'
    if (n >= 1024) return `${(n / 1024).toFixed(1)} MB/s`
    if (n >= 1)    return `${n.toFixed(0)} KB/s`
    return `< 1 KB/s`
}

export function fmtBytes(b: number): string {
    if (!b) return '—'
    const u = ['B', 'KB', 'MB', 'GB', 'TB']
    let i = 0; let n = b
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++ }
    return `${n.toFixed(1)} ${u[i]}`
}

export function fmtUptime(s: number): string {
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600)
    return d > 0 ? `${d}d ${h}h` : `${h}h`
}
