/*
 * Perch on the phone: shows notifications pushed by the computer and opens the page when one is
 * tapped. It caches nothing, so the phone never shows an old state as if it were current.
 */
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { title: 'Perch', body: event.data ? event.data.text() : '' }
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Perch', {
      body: data.body || '',
      icon: '/icon-192.png',
      lang: 'zh-Hant',
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    (async () => {
      const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const page = open.find((c) => 'focus' in c)
      return page ? page.focus() : self.clients.openWindow('/')
    })(),
  )
})
