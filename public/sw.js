// Moana: nhận thông báo đẩy (khách đặt lịch, yêu cầu cần duyệt...) và mở đúng trang khi bấm vào
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

function setBadge(n) {
  try {
    if (typeof n !== "number") return Promise.resolve();
    if (n > 0 && self.navigator.setAppBadge) return self.navigator.setAppBadge(n);
    if (n === 0 && self.navigator.clearAppBadge) return self.navigator.clearAppBadge();
  } catch (e) {
    // máy không hỗ trợ số trên biểu tượng
  }
  return Promise.resolve();
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Moana", body: event.data ? event.data.text() : "" };
  }
  const url = data.url || "/quan-ly";
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(data.title || "Moana", {
        body: data.body || "",
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        tag: data.tag || undefined,
        renotify: true,
        silent: false,
        vibrate: [180, 90, 180],
        requireInteraction: true,
        data: { url, id: data.id || null },
      }),
      setBadge(data.badge),
      // app đang mở: báo để kêu ting ting + hiện thông báo trong app
      self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
        for (const c of list) c.postMessage({ type: "moana-push", data });
      }),
    ]),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const d = event.notification.data || {};
  const target = new URL(d.url || "/quan-ly", self.location.origin);
  if (d.id) target.searchParams.set("tb", d.id); // app tự đánh dấu đã đọc
  const url = target.href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url.startsWith(self.location.origin) && "focus" in c) {
          c.navigate(url);
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
