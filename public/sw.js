// PacedMind's service worker, for notifications only (src/server/push.ts sends them, Settings turns them on). It shows
// what a push says, and a tap opens that session in the app: a path on this site, never another address.

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // Not what PacedMind sends: show a plain notification.
  }
  const text = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");
  event.waitUntil(
    self.registration.showNotification(text(data.title, 120) || "PacedMind", {
      body: text(data.body, 300),
      tag: text(data.tag, 60) || undefined,
      renotify: !!data.tag,
      icon: "/brand/pacedmind-emblem.png",
      badge: "/brand/pacedmind-emblem.png",
      data: { path: text(data.path, 200) },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = event.notification.data && event.notification.data.path;
  const safe = typeof path === "string" && /^\/(?!\/)[\w\-./?=&%]*$/.test(path) ? path : "/sessions";
  const url = new URL(safe, self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const w of windows) {
        if (new URL(w.url).origin === self.location.origin && "focus" in w) {
          return w.navigate(url).then((c) => (c || w).focus());
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
