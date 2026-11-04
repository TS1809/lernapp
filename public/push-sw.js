/*
 * Push-Benachrichtigungen bei Stundenplan-Änderungen.
 * Wird vom generierten Service Worker via `importScripts` eingebunden (siehe vite.config.ts),
 * damit der Push-Empfang am selben Service Worker hängt wie der PWA-Cache.
 */
self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch (e) {
    data = { body: event.data && event.data.text() }
  }
  const title = data.title || 'Lernapp'
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      icon: 'icon-192.png',
      badge: 'icon-192.png',
      tag: 'stundenplan-aenderung',
      renotify: true,
      data: { url: data.url || '/lernapp/#/stundenplan' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/lernapp/#/stundenplan'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) {
          try {
            c.navigate(url)
          } catch (e) {
            /* manche Browser erlauben navigate() nicht – dann nur fokussieren */
          }
          return c.focus()
        }
      }
      return self.clients.openWindow(url)
    }),
  )
})
