self.addEventListener('push', event => {
  let data = {};
  try { data = event.data?.json() || {}; } catch { data = { body: event.data?.text() || '' }; }
  event.waitUntil(self.registration.showNotification(data.title || 'Smartrack', {
    body: data.body || 'You have a new update.',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: `smartrack-${data.type || 'general'}`,
    renotify: true,
    data: { url: data.url || '/' },
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
    const existing = clients.find(client => client.url.startsWith(self.location.origin));
    if (existing) {
      existing.navigate(target);
      return existing.focus();
    }
    return self.clients.openWindow(target);
  }));
});
