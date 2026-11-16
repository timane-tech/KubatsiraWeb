/*
 * Ligação à base de dados PostgreSQL do Neon, a partir do browser.
 *
 * Usa a mesma API HTTP ("SQL over HTTP") da app Android Kubatsira: cada consulta é um POST HTTPS
 * com o SQL + parâmetros em JSON e os cabeçalhos Neon-*. O endereço da base (utilizador, senha,
 * servidor e nome da base) vem do "código de ligação" (KUB1.…) colado pelo Administrador e guardado
 * neste dispositivo. NÃO está no código.
 *
 * Importante (segurança): num browser, quem abrir as Ferramentas de Programador vê o endereço da base.
 * Por isso o código de ligação só deve ser introduzido no próprio telemóvel/PC do dono, protegido pelo
 * código de desbloqueio do aparelho. É o mesmo princípio da app Android.
 */
const DB = (() => {
  const PREFIXO = "KUB1.";
  const CHAVE = "kubatsira_ligacao";   // localStorage

  let endereco = "";          // postgresql://utilizador:senha@servidor/base?sslmode=require
  let gemini = "";
  let pontos = [];            // endereços HTTP possíveis da API
  let pontoQueFunciona = null;

  // Servidor (host) de uma URL postgresql://utilizador:senha@servidor/base. Não usa new URL(): em versões
  // antigas do Chrome (Android) os esquemas "postgresql:" não são reconhecidos e o host vem vazio.
  function hostDe(url) {
    const m = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@\/?#]*@)?([^\/?#:]+)(?::\d+)?/i.exec(url || "");
    return m ? m[1].toLowerCase() : "";
  }

  function prepararPontos() {
    pontos = [];
    if (!endereco) return;
    let host;
    host = hostDe(endereco);
    if (host) {
      const ponto = host.indexOf(".");
      if (ponto > 0) pontos.push("https://api." + host.substring(ponto + 1) + "/sql");
      pontos.push("https://" + host + "/sql");
    }
  }

  // ---- Código de ligação ----

  // "KUB1.<base64url de {neon, gemini}>" -> {neon, gemini}; aceita também uma URL postgresql:// direta
  function lerCodigo(codigo) {
    let c = (codigo || "").replace(/\s+/g, "");
    if (c.startsWith("postgresql://") || c.startsWith("postgres://")) {
      return { neon: c, gemini: "" };
    }
    if (!c.startsWith(PREFIXO)) throw new Error("prefixo");
    let b64 = c.substring(PREFIXO.length).replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    const texto = decodeURIComponent(escape(atob(b64)));
    const j = JSON.parse(texto);
    const neon = j.neon || "";
    let host = null;
    host = neon.startsWith("postgres") ? (hostDe(neon) || null) : null;
    if (!host || !host.endsWith(".neon.tech")) throw new Error("neon");
    return { neon: neon, gemini: j.gemini || "" };
  }

  function servidorDoCodigo(codigo) {
    try { return hostDe(lerCodigo(codigo).neon) || null; } catch (e) { return null; }
  }

  function guardar(codigo) {
    const dados = lerCodigo(codigo);          // lança se inválido
    localStorage.setItem(CHAVE, JSON.stringify(dados));
    aplicar(dados);
  }

  function aplicar(dados) {
    endereco = dados.neon || "";
    gemini = dados.gemini || "";
    pontoQueFunciona = null;
    prepararPontos();
    try { const p = localStorage.getItem(CHAVE + "_ponto"); if (p && pontos.includes(p)) pontoQueFunciona = p; } catch (e) {}
    limparCache();
  }

  function iniciar() {
    try {
      const guardado = localStorage.getItem(CHAVE);
      if (guardado) aplicar(JSON.parse(guardado));
    } catch (e) { endereco = ""; }
  }

  function apagar() {
    localStorage.removeItem(CHAVE);
    endereco = ""; gemini = ""; pontos = []; pontoQueFunciona = null;
  }

  const configurado = () => !!endereco && pontos.length > 0;
  const servidorAtual = () => hostDe(endereco) || null;
  const chaveGemini = () => gemini;

  // ---- Execução de SQL ----

  // Troca os "?" (estilo SQLite) por $1, $2... (PostgreSQL), ignorando os que estão dentro de textos '...'
  function paraPostgres(sql) {
    let out = "", emTexto = false, n = 0;
    for (const ch of sql) {
      if (ch === "'") emTexto = !emTexto;
      if (ch === "?" && !emTexto) out += "$" + (++n);
      else out += ch;
    }
    return out;
  }

  function texto(o) {
    if (o === null || o === undefined) return null;
    if (typeof o === "boolean") return o ? "true" : "false";
    return String(o);
  }

  function corpoComando(sql, params) {
    const p = (params || []).map(texto);
    return { query: paraPostgres(sql), params: p };
  }

  async function enviar(corpo) {
    if (!configurado()) throw new Error("A ligação à base de dados ainda não foi configurada neste dispositivo.");
    const tentar = [];
    if (pontoQueFunciona) tentar.push(pontoQueFunciona);
    for (const p of pontos) if (!tentar.includes(p)) tentar.push(p);

    let ultimo = null;
    for (const ponto of tentar) {
      try {
        const resp = await fetch(ponto, {
          method: "POST",
          headers: {
            // text/plain (não application/json) para o browser NÃO exigir autorização CORS do Content-Type:
            // o endpoint do Neon lê o JSON na mesma, mas só autoriza os cabeçalhos Neon-* no preflight.
            "Content-Type": "text/plain;charset=UTF-8",
            "Neon-Connection-String": endereco,
            "Neon-Raw-Text-Output": "true",
            "Neon-Array-Mode": "true",
          },
          body: JSON.stringify(corpo),
        });
        if (resp.status === 404) { ultimo = new Error("404 em " + ponto); continue; }
        const txt = await resp.text();
        if (resp.status >= 400) throw erroDaBase(txt);
        if (pontoQueFunciona !== ponto) {
          pontoQueFunciona = ponto;
          // guarda o endereço que funcionou: na próxima abertura não se perde um pedido a tentar o outro
          try { localStorage.setItem(CHAVE + "_ponto", ponto); } catch (e) {}
        }
        return txt;
      } catch (e) {
        // erro de rede (TypeError do fetch) -> tenta o próximo endereço; erro da base -> propaga já
        if (e && e.daBase) throw e;
        ultimo = e;
      }
    }
    throw new Error("Sem ligação à base de dados. Verifique a Internet e tente novamente." +
      (ultimo ? " (" + ultimo.message + ")" : ""));
  }

  function erroDaBase(txt) {
    let msg = txt, code = "";
    try { const j = JSON.parse(txt); msg = j.message || txt; code = j.code || ""; } catch (e) {}
    const err = new Error("Erro na base de dados: " + msg);
    err.daBase = true; err.code = code;
    return err;
  }

  function ler(json) {
    const j = JSON.parse(json);
    const colunas = (j.fields || []).map((f, i) => f.name || ("c" + i));
    const linhas = (j.rows || []).map((linha) =>
      colunas.map((_, c) => (linha[c] === null || linha[c] === undefined ? null : String(linha[c])))
    );
    return { colunas, linhas, afetadas: j.rowCount != null ? j.rowCount : linhas.length };
  }

  // ---- Cache de leituras (como o dados/Cache da app Android) ----
  // A mesma consulta pedida várias vezes seguidas (ex.: as prestações por pagar, usadas pelo balanço, pelos
  // clientes e pelas cobranças) vai UMA vez à base: os pedidos iguais em curso são partilhados e o resultado
  // fica guardado uns segundos. Qualquer gravação (INSERT/UPDATE/DELETE) limpa tudo, para nunca mostrar dados
  // antigos depois de uma alteração feita aqui. Login, senhas, notificações e SMS vão sempre à base.
  const CACHE_MS = 20000;
  const cache = new Map();        // chave -> { quando, promessa }
  function limparCache() { cache.clear(); }
  const ehLeitura = (sql) => /^\s*SELECT\b/i.test(sql) && !/\b(INSERT|UPDATE|DELETE)\b/i.test(sql);
  const semCache = (sql) => /senha_hash|notificac|sms_cobranca|registo_acessos|sms_fila/i.test(sql);

  // Executa uma consulta. Devolve {colunas, linhas, afetadas}.
  async function executar(sql, params) {
    if (!ehLeitura(sql)) {
      limparCache();
      try { return ler(await enviar(corpoComando(sql, params))); }
      finally { limparCache(); }
    }
    if (semCache(sql)) return ler(await enviar(corpoComando(sql, params)));
    const chave = sql + "\u0001" + JSON.stringify((params || []).map(texto));
    const c = cache.get(chave);
    if (c && Date.now() - c.quando < CACHE_MS) return c.promessa;
    const promessa = enviar(corpoComando(sql, params)).then(ler);
    cache.set(chave, { quando: Date.now(), promessa });
    promessa.catch(() => { if (cache.get(chave) && cache.get(chave).promessa === promessa) cache.delete(chave); });   // falhas nunca ficam guardadas
    return promessa;
  }

  // Consulta de leitura: devolve as linhas como objetos {coluna: valor}.
  async function consultar(sql, params) {
    const r = await executar(sql, params);
    return r.linhas.map((l) => {
      const o = {};
      r.colunas.forEach((c, i) => (o[c] = l[i]));
      return o;
    });
  }

  // Vários comandos numa só transação (todos ou nenhum). comandos = [{sql, params}]
  async function lote(comandos) {
    if (!comandos.length) return;
    if (comandos.length === 1) return executar(comandos[0].sql, comandos[0].params);
    const queries = comandos.map((c) => corpoComando(c.sql, c.params));
    limparCache();
    try { await enviar({ queries }); }
    finally { limparCache(); }
  }

  return {
    PREFIXO, iniciar, guardar, apagar, configurado, servidorAtual, servidorDoCodigo,
    chaveGemini, executar, consultar, lote, limparCache,
  };
})();
