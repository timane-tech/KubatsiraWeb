/*
 * Service worker: guarda a "casca" da app (HTML/CSS/JS/ícones) para abrir depressa e offline.
 * Os dados (consultas à Neon) NUNCA são guardados aqui — vão sempre à base de dados pela rede.
 */
const CACHE = "kubatsira-v1.1.3-3";
// Sem "./index.html": o Cloudflare responde a /index.html com um redirecionamento (307 -> /) e o Safari
// recusa abrir uma página servida pelo service worker que veio de um redirecionamento
// ("Response served by service worker has redirections"). A página é sempre a cópia de "./".
const CASCA = [
  "./", "./styles.css", "./dicionario.js", "./idioma.js", "./icones.js","./regras.js", "./db.js", "./dados.js", "./app.js",
  "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png",
  "./icons/maskable-512.png", "./icons/apple-touch-180.png",
];

self.addEventListener("install", (e) => {
  // cache:"reload" = vai mesmo à rede (não a uma cópia antiga do browser): a versão nova fica completa
  e.waitUntil(caches.open(CACHE)
    .then((c) => c.addAll(CASCA.map((u) => new Request(u, { cache: "reload" }))))
    .then(() => self.skipWaiting()));
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
  // "Procurar atualizações" pede a página com ?novo=…: vai sempre à rede para ver a versão publicada
  if (url.searchParams.has("novo")) return;
  // "Cache-first": os ficheiros da app abrem logo da cópia guardada (sem esperar pela rede).
  // Uma versão nova chega com um sw.js novo (o browser verifica-o sozinho): é descarregada inteira em
  // segundo plano e entra na abertura seguinte — nunca se misturam ficheiros de versões diferentes.
  // Abrir a app (qualquer endereço da app: /, /index.html, /?…) = a página guardada em "./".
  const pagina = e.request.mode === "navigate";
  e.respondWith(
    caches.open(CACHE).then((c) => c.match(pagina ? "./" : e.request, { ignoreSearch: true }).then((r) => {
      if (r) return limpa(r);
      return fetch(pagina ? "./" : e.request).then((resp) => {
        if (resp.ok) c.put(pagina ? "./" : e.request, resp.clone()).catch(() => {});
        return limpa(resp);
      }).catch(() => c.match("./").then((x) => x ? limpa(x) : Response.error()));
    }))
  );
});

// Uma resposta que passou por um redirecionamento não pode ser devolvida a uma navegação no Safari:
// copia o conteúdo para uma resposta nova, "limpa".
function limpa(r) {
  if (!r || !r.redirected) return r;
  return r.blob().then((b) => new Response(b, { status: r.status, statusText: r.statusText, headers: r.headers }));
}
