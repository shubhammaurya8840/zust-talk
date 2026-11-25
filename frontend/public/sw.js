const CACHE_NAME = "zust-talk-v1";

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Handle Chrome notification click on mobile & desktop
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          client.focus();
          client.postMessage({ type: "NOTIFICATION_CLICK", data });
          return;
        }
      }
      if (self.clients.openWindow) {
        const targetUrl = data.url || "/";
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
