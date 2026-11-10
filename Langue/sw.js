// Service worker : ouverture rapide de l'appli + notifications de rappel.
const VERSION = "langue-v1";
const SHELL = [
  "./", "index.html", "styles.css", "config.js", "manifest.webmanifest",
  "js/app.js", "js/store.js", "js/util.js", "js/editor.js", "js/speech.js", "js/demo.js", "js/spell-worker.js",
  "icons/apple-touch-icon.png", "icons/icon-192.png", "icons/icon-512.png", "icons/logo-round.svg",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== "langue-cdn").map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  // Dictionnaire et librairies (CDN) : cache d'abord, ils ne changent pas
  if (url.hostname === "cdn.jsdelivr.net" || url.hostname === "esm.sh") {
    e.respondWith(caches.open("langue-cdn").then(async (c) => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok) c.put(e.request, res.clone());
      return res;
    }));
    return;
  }
  // Fichiers de l'appli : réseau d'abord (pour avoir les mises à jour), cache si hors ligne
  if (url.origin === self.location.origin) {
    e.respondWith(fetch(e.request, { cache: "no-cache" }).then((res) => {
      const copy = res.clone();
      caches.open(VERSION).then((c) => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request)));
  }
});

self.addEventListener("push", (e) => {
  let data = { title: "Langue", body: "Tes exercices d'anglais t'attendent." };
  try { data = { ...data, ...e.data.json() }; } catch {}
  e.waitUntil(self.registration.showNotification(data.title, {
    body: data.body, icon: "icons/icon-192.png", badge: "icons/icon-192.png", tag: "langue-rappel",
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window" }).then((list) => {
    for (const c of list) if ("focus" in c) return c.focus();
    return self.clients.openWindow("./");
  }));
});
