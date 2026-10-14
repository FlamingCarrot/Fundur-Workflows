// Fundur's service worker: shows notifications pushed to this device and
// opens the right page when one is tapped. It caches nothing.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: event.data ? event.data.text() : "Fundur" };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "Fundur", {
      body: data.body || "",
      tag: data.tag || undefined,
      icon: "/favicon.ico",
      data: { href: typeof data.href === "string" && data.href.startsWith("/") ? data.href : "/notifications" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const href = (event.notification.data && event.notification.data.href) || "/notifications";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if ("focus" in w) {
          w.navigate(href).catch(() => undefined);
          return w.focus();
        }
      }
      return self.clients.openWindow(href);
    }),
  );
});
