/*
 * Idioma da interface: Português (padrão) ou Inglês — o mesmo método da app Android (regras/Idioma + ui/Tradutor).
 *
 * O código escreve sempre os textos em português. Em Inglês, tudo o que aparece no ecrã é traduzido
 * com o dicionário da app (dicionario.js, gerado a partir do Dicionario.java):
 *   1. frase inteira no dicionário ("Guardar" -> "Save");
 *   2. frase com números: os números passam a {0}, {1}... ("Pedido nº {0} rejeitado.");
 *   3. modelos com partes variáveis (expressões regulares: "Olá, (.+)!" -> "Hello, $1!");
 *   4. símbolos à volta ("✓ ", "⚠ ", ":" no fim), "Rótulo: valor" e partes separadas por " · ".
 * Os dados (nomes, valores) não mudam. A escolha fica guardada neste aparelho.
 */
const Idioma = (() => {
  "use strict";
  const CHAVE = "kub_idioma";
  let atual = "pt";
  try { atual = localStorage.getItem(CHAVE) === "en" ? "en" : "pt"; } catch (e) {}

  const D = window.KUB_DIC || { frases: [], modelos: [], termos: {} };
  const FRASES = new Map(D.frases);
  const MODELOS = D.modelos.map(([re, en]) => {
    let padrao = null;
    try { padrao = new RegExp(re, "u"); } catch (e) { try { padrao = new RegExp(re); } catch (e2) {} }
    return padrao ? { padrao, en } : null;
  }).filter(Boolean);
  // Frases próprias da versão web (não existem na app Android)
  [["Trocar de ligação", "Change connection"], ["Servidor", "Server"], ["Ligar à base de dados", "Connect to the database"],
   ["Código de ligação", "Connection code"], ["Ligar", "Connect"], ["Ver todas ›", "See all ›"], ["Menu", "Menu"],
   ["Gestão de Clientes", "Client Management"], ["Toque num cliente para abrir a ficha", "Tap a client to open the record"],
   ["Toque para pagar, ajustar multa ou contactar", "Tap to pay, adjust the fine or contact"], ["Entradas, saídas e saldo", "Income, expenses and balance"],
   ["Indicadores, gráficos e maiores clientes", "Indicators, charts and top clients"], ["Mostrar", "Show"], ["Capital emprestado", "Lent capital"],
   ["Escolha o cliente", "Choose the client"], ["Nenhum cliente.", "No clients."], ["A carregar…", "Loading…"],
   ["Enviar SMS a todos os que estão a dever", "Send SMS to everyone who owes"], ["Enviados", "Sent"],
   ["Mostrar lançamentos ocultos", "Show hidden entries"], ["Pesquisar na descrição", "Search the description"],
   ["Nome, telefone, negócio ou local", "Name, phone, business or place"], ["Cliente, contacto ou local", "Client, contact or place"],
   ["Procurar atualizações", "Check for updates"], ["Instalar no ecrã principal", "Install on the home screen"],
   ["Entrar com Face ID / Touch ID", "Sign in with Face ID / Touch ID"], ["Usar Face ID / Touch ID", "Use Face ID / Touch ID"],
   ["{0} prestações", "{0} installments"], ["{0} prestação", "{0} installment"], ["{0} prestações pagas", "{0} installments paid"],
   ["{0} lançamentos", "{0} entries"], ["recebido: {0}", "received: {0}"],
   ["Saldo em caixa", "Cash balance"], ["Em dívida", "Outstanding"], ["Balanço", "Balance"], ["Licença", "License"],
   ["SMS aos clientes", "SMS to clients"], ["Cobrar hoje", "Collect today"], ["Clientes", "Clients"],
   ["Pagamentos da licença", "License payments"], ["Renovar a licença", "Renew the license"], ["Pagar a licença", "Pay the license"],
   ["Entrar com Face ID / impressão digital", "Sign in with Face ID / fingerprint"], ["Face ID / impressão digital", "Face ID / fingerprint"],
   ["Ligação à base de dados", "Database connection"], ["Mostrar as senhas", "Show passwords"], ["Nova", "New"],
   ["Indicadores e gráficos da empresa", "Company indicators and charts"], ["Últimos lançamentos no caixa", "Latest cash entries"],
   ["Pedidos à espera de aprovação ({0})", "Requests awaiting approval ({0})"], ["Cobrar hoje e em atraso ({0})", "Collect today and overdue ({0})"],
  ].forEach(([pt, en]) => { if (!FRASES.has(pt)) FRASES.set(pt, en); });

  const CACHE = new Map();
  const NUMEROS = /[-−]?\d(?:[\d.,:/]|\s(?=\d{3}\b))*\d|[-−]?\d/g;
  const AFIXOS = /^([^\p{L}\d"(*_]*)([\s\S]*?)([\s.:!?…]*)$/u;
  const SEPARADORES = ["   ·   ", "  ·  ", " · ", " — ", " | "];

  function direto(texto, prof) {
    const d = FRASES.get(texto);
    if (d != null) return d;
    const valores = [];
    const chave = texto.replace(NUMEROS, (n) => { valores.push(n); return "{" + (valores.length - 1) + "}"; });
    if (valores.length) {
      let modelo = FRASES.get(chave);
      if (modelo != null) {
        for (let i = valores.length - 1; i >= 0; i--) modelo = modelo.split("{" + i + "}").join(valores[i]);
        return modelo;
      }
    }
    for (const mod of MODELOS) {
      const mm = mod.padrao.exec(texto);
      if (!mm || mm[0] !== texto) continue;
      let r = mod.en;
      for (let g = mm.length - 1; g >= 1; g--) r = r.split("$" + g).join(linha(mm[g] || "", prof + 1));
      return r;
    }
    return null;
  }

  function linha(l, prof) {
    if (!l || prof > 4) return l;
    let d = direto(l, prof);
    if (d != null) return d;
    const a = AFIXOS.exec(l);
    if (!a) return l;
    const pre = a[1], nucleo = a[2], suf = a[3];
    if (!nucleo) return l;
    if (pre || suf) {
      const sufSem = suf.trim();
      d = direto(nucleo + sufSem, prof);
      if (d != null) return pre + d + suf.substring(sufSem.length);
      d = direto(nucleo, prof);
      if (d != null) return pre + d + suf;
    }
    for (const sep of SEPARADORES) {
      if (!nucleo.includes(sep)) continue;
      const partes = nucleo.split(sep);
      let mudou = false;
      for (let i = 0; i < partes.length; i++) {
        const t = linha(partes[i], prof + 1);
        if (t !== partes[i]) { partes[i] = t; mudou = true; }
      }
      if (mudou) return pre + partes.join(sep) + suf;
    }
    const dp = nucleo.indexOf(": ");
    if (dp > 0) {
      const tr = direto(nucleo.substring(0, dp), prof);
      if (tr != null) return pre + tr + ": " + linha(nucleo.substring(dp + 2), prof + 1) + suf;
    }
    return l;
  }

  /** Traduz um texto (igual em Português ou quando não há tradução). */
  function T(s) {
    if (s == null) return "";
    s = String(s);
    if (!s || atual !== "en") return s;
    const c = CACHE.get(s);
    if (c != null) return c;
    let r = FRASES.get(s);
    if (r == null) r = s.split("\n").map((l) => linha(l, 0)).join("\n");
    if (s.length < 600) CACHE.set(s, r);
    return r;
  }

  // ---------- Tradutor do ecrã (como o ui/Tradutor do Android) ----------
  const IGNORAR = new Set(["SCRIPT", "STYLE", "TEXTAREA", "INPUT", "SELECT", "OPTION"]);
  function traduzirTexto(no) {
    const v = no.nodeValue;
    if (!v || !v.trim() || !/\p{L}/u.test(v)) return;
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(v);
    const t = T(m[2]);
    if (t !== m[2]) no.nodeValue = m[1] + t + m[3];
  }
  function traduzirArvore(raiz) {
    if (atual !== "en" || !raiz) return;
    if (raiz.nodeType === 3) { if (!raiz.parentElement || !IGNORAR.has(raiz.parentElement.tagName)) traduzirTexto(raiz); return; }
    if (raiz.nodeType !== 1 || IGNORAR.has(raiz.tagName) || raiz.closest("[data-sem-traducao]")) return;
    ["placeholder", "title", "aria-label"].forEach((at) => { if (raiz.hasAttribute && raiz.hasAttribute(at)) { const t = T(raiz.getAttribute(at)); if (t !== raiz.getAttribute(at)) raiz.setAttribute(at, t); } });
    const w = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode: (n) => n.nodeType === 1 ? (IGNORAR.has(n.tagName) || n.hasAttribute("data-sem-traducao") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP) : NodeFilter.FILTER_ACCEPT,
    });
    raiz.querySelectorAll("[placeholder],[title],[aria-label]").forEach((e) => {
      ["placeholder", "title", "aria-label"].forEach((at) => { const v = e.getAttribute(at); if (v) { const t = T(v); if (t !== v) e.setAttribute(at, t); } });
    });
    let n; while ((n = w.nextNode())) traduzirTexto(n);
  }
  let obs = null;
  function vigiar() {
    if (obs) { obs.disconnect(); obs = null; }
    if (atual !== "en") return;
    traduzirArvore(document.body);
    obs = new MutationObserver((muds) => {
      for (const m of muds) {
        if (m.type === "characterData") traduzirTexto(m.target);
        else m.addedNodes.forEach(traduzirArvore);
      }
    });
    obs.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  function definir(idioma) {
    atual = idioma === "en" ? "en" : "pt";
    try { localStorage.setItem(CHAVE, atual); } catch (e) {}
    CACHE.clear();
    document.documentElement.lang = atual === "en" ? "en" : "pt";
    vigiar();
  }

  document.documentElement.lang = atual === "en" ? "en" : "pt";
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", vigiar); else vigiar();

  return { T, definir, atual: () => atual, emIngles: () => atual === "en", termos: () => (atual === "en" ? D.termos.en : D.termos.pt) || "", versaoTermos: () => D.termos.versao || "" };
})();
