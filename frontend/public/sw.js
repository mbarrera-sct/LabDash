/* LabDash Service Worker — handles push notifications and PWA caching */

const CACHE = 'labdash-v1'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()))

/* ── Push notification handler ── */
self.addEventListener('push', event => {
    if (!event.data) return
    let payload
    try { payload = event.data.json() } catch { payload = { title: 'LabDash Alert', body: event.data.text() } }

    const title = payload.title || 'LabDash Alert'
    const options = {
        body:    payload.body || payload.message || '',
        icon:    '/icons/icon-192.png',
        badge:   '/icons/icon-72.png',
        tag:     payload.tag  || 'labdash-alert',
        data:    payload.data || {},
        vibrate: [200, 100, 200],
        requireInteraction: payload.requireInteraction ?? false,
    }
    event.waitUntil(self.registration.showNotification(title, options))
})

/* ── Notification click: focus or open app ── */
self.addEventListener('notificationclick', event => {
    event.notification.close()
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
            for (const c of cs) {
                if (c.url.includes(self.location.origin) && 'focus' in c) return c.focus()
            }
            return clients.openWindow('/')
        })
    )
})
