/*
 * Service worker: guarda a "casca" da app (HTML/CSS/JS/ícones) para abrir depressa e offline.
 * Os dados (consultas à Neon) NUNCA são guardados aqui — vão sempre à base de dados pela rede.
 */
const CACHE = "kubatsira-v30";
const CASCA = [
  "./", "./index.html", "./styles.css", "./dicionario.js", "./idioma.js", "./icones.js","./regras.js", "./db.js", "./dados.js", "./app.js",
  "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png",
  "./icons/maskable-512.png", "./icons/apple-touch-180.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CASCA)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Tocar no aviso das mensagens de cobrança abre (ou traz para a frente) a app
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((cs) => {
    for (const c of cs) if ("focus" in c) return c.focus();
    return self.clients.openWindow("./");
  }));
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // Pedidos à base de dados (Neon) e qualquer outro domínio: sempre pela rede, nunca em cache.
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  // "Network-first" para os ficheiros da app: traz a versão nova se houver rede; senão, a guardada.
  e.respondWith(
    fetch(e.request).then((resp) => {
      const copia = resp.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copia)).catch(() => {});
      return resp;
    }).catch(() => caches.match(e.request).then((r) => r || caches.match("./index.html")))
  );
});
