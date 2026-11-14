/*
 * Kubatsira Microcrédito — aplicação web (PWA).
 * Liga à mesma base Neon da app Android. Interface e regras equivalentes.
 */
(() => {
  "use strict";

  // ---------- Estado ----------
  const S = { user: null, perms: new Set(), ecra: "inicio", ocultar: false };

  // ---------- Permissões (equivalente a regras/Permissoes) ----------
  const CAT = [
    ["BALANCO", "Balanço Geral", true], ["COBRANCAS", "Cobranças / Prestações do dia", false],
    ["CLIENTES", "Clientes", false], ["NOVO_EMPRESTIMO", "Novo Empréstimo", false],
    ["CAIXA", "Fluxo de Caixa", true], ["TODOS_EMPRESTIMOS", "Todos os Empréstimos", true],
    ["APROVACOES", "Aprovar Pedidos", true], ["UTILIZADORES", "Utilizadores e Permissões", true],
    ["PAGAR_PRESTACAO", "Registar pagamentos", true], ["REMOVER_MULTA", "Remover / reduzir multas", true],
    ["ELIMINAR_CLIENTE", "Eliminar clientes", true], ["ANULAR_EMPRESTIMO", "Anular empréstimos", true],
    ["CAIXA_EDITAR", "Editar / apagar no caixa", true], ["CAIXA_OCULTAR", "Ocultar operações do caixa", true],
    ["CAIXA_RECONCILIAR", "Reconciliar o caixa", true],
    ["EXPORTAR", "Exportar relatórios", false], ["SMS_VER", "Ver SMS enviados", false],
  ];
  const RESERVADAS = new Set(["UTILIZADORES"]);
  function permsPadrao(perfil) {
    const s = new Set();
    if (perfil === "ADMIN") CAT.forEach(([c]) => { if (!RESERVADAS.has(c)) s.add(c); });
    else if (perfil === "AGENTE") ["COBRANCAS", "CLIENTES", "NOVO_EMPRESTIMO", "SMS_VER"].forEach((c) => s.add(c));
    return s;
  }
  function calcularPerms(u) {
    let base;
    if (!u.permissoes || !u.permissoes.trim()) base = permsPadrao(u.perfil);
    else {
      base = new Set();
      u.permissoes.split(",").forEach((c) => { if (c.trim()) base.add(c.trim()); });
    }
    // Filtra pelo perfil (agente nunca recebe as "soAdmin")
    const valido = new Set();
    CAT.forEach(([c, , soAdmin]) => {
      if (!base.has(c)) return;
      if (u.perfil === "AGENTE" && soAdmin) return;
      valido.add(c);
    });
    if (u.principal) CAT.forEach(([c]) => valido.add(c));  // admin principal: tudo
    return valido;
  }
  const pode = (c) => S.perms.has(c);

  // ---------- Biometria (Face ID / Touch ID) via WebAuthn ----------
  const Bio = {
    async disponivel() {
      try { return !!window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(); }
      catch (e) { return false; }
    },
    chave(uid) { return "kub_bio_" + uid; },
    ativa(uid) { try { return !!localStorage.getItem(this.chave(uid)); } catch (e) { return false; } },
    async registar(uid, nome) {
      const cred = await navigator.credentials.create({ publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rp: { name: "Kubatsira", id: location.hostname },
        user: { id: new TextEncoder().encode(String(uid)), name: nome || ("user" + uid), displayName: nome || ("user" + uid) },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "preferred" },
        timeout: 60000, attestation: "none",
      } });
      const id = btoa(String.fromCharCode.apply(null, new Uint8Array(cred.rawId)));
      localStorage.setItem(this.chave(uid), id);
      return true;
    },
    async verificar(uid) {
      const id = localStorage.getItem(this.chave(uid));
      if (!id) return false;
      const rawId = Uint8Array.from(atob(id), (c) => c.charCodeAt(0));
      await navigator.credentials.get({ publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rpId: location.hostname, timeout: 60000, userVerification: "required",
        allowCredentials: [{ type: "public-key", id: rawId, transports: ["internal"] }],
      } });
      return true;
    },
    desativar(uid) { try { localStorage.removeItem(this.chave(uid)); } catch (e) {} },
  };

  // ---------- Utilitários DOM ----------
  const $ = (id) => document.getElementById(id);
  const el = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  const R = Regras;

  // ---------- Ícones SVG (linha, herdam a cor do texto) ----------
  const ICONES = {
    inicio: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
    cobrancas: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M9 12h6"/><path d="M9 16h6"/>',
    clientes: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    credito: '<rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/>',
    mais: '<circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none"/>',
    caixa: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/><path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
    poupanca: '<path d="M19 5c-1.5 0-2.7 1-3 2.3A8.9 8.9 0 0 0 12 6.5C7 6.5 3 9.4 3 13c0 1.9 1.1 3.6 2.8 4.8L5 21h3l.8-2.1c1 .2 2.1.3 3.2.3s2.2-.1 3.2-.3L16 21h3l-.8-3.2c1.2-.8 2-1.9 2.4-3.1H22v-4h-1.3A5.3 5.3 0 0 0 19 8.3V5z"/><circle cx="8.5" cy="12" r=".9" fill="currentColor" stroke="none"/>',
    utilizadores: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3z"/>',
    lixeira: '<path d="M3 6h18"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
    sms: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m2 7 10 6 10-6"/>',
    acessos: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    assistente: '<rect x="4" y="8" width="16" height="12" rx="2"/><path d="M12 4v4"/><circle cx="12" cy="3" r="1" fill="currentColor" stroke="none"/><circle cx="9" cy="14" r="1.1" fill="currentColor" stroke="none"/><circle cx="15" cy="14" r="1.1" fill="currentColor" stroke="none"/><path d="M2 14h2"/><path d="M20 14h2"/>',
    notificacoes: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
    perfil: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    senha: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    biometria: '<path d="M5.3 11a7 7 0 0 1 11-5.6"/><path d="M4 15s.6-1.6.6-3.2"/><path d="M8.6 8.6a5 5 0 0 1 7.4 4.4c0 1.8.3 3 .3 3"/><path d="M12 11a1 1 0 0 0-1 1c0 2.2.6 4.2.6 4.2"/><path d="M19.8 12c0-.3.1-.7.1-1"/>',
    ligacao: '<path d="M9 7V2"/><path d="M15 7V2"/><path d="M6 7h12v3a6 6 0 0 1-12 0z"/><path d="M12 16v6"/>',
    sobre: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><circle cx="12" cy="8" r=".6" fill="currentColor" stroke="none"/>',
    sair: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
    olho: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
    olhoff: '<path d="M9.9 4.2A10.9 10.9 0 0 1 12 4c6.5 0 10 7 10 7a18 18 0 0 1-3 3.6"/><path d="M6.6 6.6A18 18 0 0 0 2 12s3.5 7 10 7a10.9 10.9 0 0 0 4.4-.9"/><path d="M3 3l18 18"/>',
    mais_add: '<path d="M12 5v14"/><path d="M5 12h14"/>',
    pdf: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h6"/><path d="M9 17h4"/>',
    reconciliar: '<path d="M12 3v18"/><path d="M5 7h14"/><path d="m5 7-3 6a3 3 0 0 0 6 0z"/><path d="m19 7 3 6a3 3 0 0 1-6 0z"/><path d="M7 21h10"/>',
    pesquisa: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
    entrada: '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
    saida: '<path d="M12 19V5"/><path d="m5 12 7-7 7 7"/>',
    restaurar: '<path d="M3 7v6h6"/><path d="M3 13a9 9 0 1 0 2.6-6.4L3 9"/>',
    enviar: '<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>',
    alerta: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4"/><circle cx="12" cy="17" r=".6" fill="currentColor" stroke="none"/>',
    ok: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
    check: '<path d="M5 13l4 4L19 7"/>',
    estrela: '<path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9 6.8 19.1l1-5.8L3.5 9.2l5.9-.9z" fill="currentColor" stroke="none"/>',
    telemovel: '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/>',
    computador: '<rect x="2" y="4" width="20" height="12" rx="2"/><path d="M8 20h8"/><path d="M12 16v4"/>',
  };
  function ic(nome, tam) {
    const p = ICONES[nome];
    if (!p) return "";
    const s = tam || 22;
    return `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;flex:none;display:inline-block">${p}</svg>`;
  }

  // Valor eventualmente oculto (modo privado)
  const vmt = (v) => (S.ocultar ? "••••" : R.mt(v));

  function toast(msg, erro) {
    const t = $("toast");
    t.textContent = msg;
    t.className = "toast ver" + (erro ? " erro" : "");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (t.className = "toast"), 3200);
  }

  // ---------- Diálogo (folha deslizante) ----------
  function abrirFolha(html) {
    $("folha").innerHTML = '<div class="pega"></div>' + html;
    $("fundo-escuro").classList.add("aberto");
  }
  function fecharFolha() { $("fundo-escuro").classList.remove("aberto"); }
  $("fundo-escuro").addEventListener("click", (e) => { if (e.target === $("fundo-escuro")) fecharFolha(); });

  function confirmar(titulo, texto, textoBtn, perigo) {
    return new Promise((res) => {
      abrirFolha(`<h3>${esc(titulo)}</h3><p class="sub">${esc(texto)}</p>
        <div class="btn-linha">
          <button class="btn secundario" id="c-nao">Cancelar</button>
          <button class="btn ${perigo ? "perigo" : ""}" id="c-sim">${esc(textoBtn || "Confirmar")}</button>
        </div>`);
      $("c-nao").onclick = () => { fecharFolha(); res(false); };
      $("c-sim").onclick = () => { fecharFolha(); res(true); };
    });
  }

  const spinner = '<div class="carregar"><div class="spinner"></div>A carregar…</div>';
  const vazio = (nome, txt) => `<div class="vazio"><span class="ic" style="color:var(--borda)">${ic(nome, 46)}</span>${esc(txt)}</div>`;

  async function comErro(fn) {
    try { return await fn(); }
    catch (e) { toast(e.message || "Ocorreu um erro.", true); throw e; }
  }

  // ============================================================
  // ECRÃ: LIGAR (setup)
  // ============================================================
  function verLigar() {
    mostrar("ecra-ligar");
    $("ecra-ligar").innerHTML = `
      <div class="centro">
        <div class="marca">
          <img src="icons/icon-192.png" alt="Kubatsira">
          <div class="nome">Kubatsira</div>
          <div class="slogan">Microcrédito</div>
        </div>
        <div class="cartao">
          <h3>Ligar à base de dados</h3>
          <p class="sub" style="color:var(--texto-suave);font-size:.88rem;margin-top:-6px">
            Cole o <b>código de ligação</b> (começa por <code>KUB1.</code>) que recebeu do Administrador.
            Só precisa de fazer isto uma vez neste aparelho.</p>
          <div class="campo">
            <label>Código de ligação</label>
            <textarea id="lig-codigo" rows="3" placeholder="KUB1...." autocomplete="off" autocapitalize="off" spellcheck="false"></textarea>
          </div>
          <div class="erro-msg" id="lig-erro"></div>
          <button class="btn" id="lig-btn">Ligar</button>
          <div class="aviso-caixa" style="margin-bottom:0">
            ${ic("alerta", 15)} Use esta ligação apenas no seu próprio telemóvel/computador, protegido pelo código de desbloqueio.
            O código dá acesso aos dados dos clientes.
          </div>
        </div>
      </div>`;
    $("lig-btn").onclick = async () => {
      const cod = $("lig-codigo").value.trim();
      const servidor = DB.servidorDoCodigo(cod);
      if (!servidor) { $("lig-erro").textContent = "Código inválido. Copie-o outra vez, completo (começa por KUB1.)."; return; }
      if (!(await confirmar("Confirmar ligação", "Vai ligar ao servidor:\n" + servidor, "Ligar"))) return;
      try {
        DB.guardar(cod);
        $("lig-btn").disabled = true; $("lig-erro").textContent = "A testar a ligação…";
        await Dados.idAdminPrincipal();   // consulta de teste
        verLogin();
      } catch (e) {
        DB.apagar();
        $("lig-btn").disabled = false;
        $("lig-erro").textContent = "Não foi possível ligar: " + (e.message || "verifique a Internet e o código.");
      }
    };
  }

  // ============================================================
  // ECRÃ: ENTRAR (login)
  // ============================================================
  function verLogin() {
    mostrar("ecra-login");
    $("ecra-login").innerHTML = `
      <div class="centro">
        <div class="marca">
          <img src="icons/icon-192.png" alt="Kubatsira">
          <div class="nome">Kubatsira</div>
          <div class="slogan">Microcrédito</div>
        </div>
        <div class="cartao">
          <form id="login-form" autocomplete="on">
            <div class="campo">
              <label>Utilizador</label>
              <input id="l-user" type="text" autocomplete="username" autocapitalize="none" placeholder="utilizador ou telefone">
            </div>
            <div class="campo">
              <label>Senha</label>
              <input id="l-senha" type="password" autocomplete="current-password" placeholder="a sua senha">
            </div>
            <div class="erro-msg" id="l-erro"></div>
            <button class="btn" id="l-btn" type="submit">Entrar</button>
          </form>
        </div>
        <div class="linha-link"><a id="l-trocar">Trocar de ligação</a></div>
      </div>`;
    $("l-trocar").onclick = async () => {
      if (await confirmar("Trocar de ligação", "Vai apagar a ligação atual deste aparelho e colar outro código.", "Trocar", true)) {
        DB.apagar(); verLigar();
      }
    };
    $("login-form").onsubmit = async (ev) => {
      ev.preventDefault();
      const u = $("l-user").value.trim(), s = $("l-senha").value;
      if (!u || !s) { $("l-erro").textContent = "Escreva o utilizador e a senha."; return; }
      $("l-btn").disabled = true; $("l-erro").textContent = "";
      try {
        const user = await Dados.autenticar(u, s);
        if (!user) { $("l-erro").textContent = "Utilizador ou senha incorretos."; $("l-btn").disabled = false; return; }
        if (!user.ativo) { $("l-erro").textContent = "Esta conta está desativada. Contacte o Administrador."; $("l-btn").disabled = false; return; }
        user.principal = user.id === (await Dados.idAdminPrincipal());
        iniciarSessao(user);
      } catch (e) {
        $("l-erro").textContent = e.message || "Sem ligação. Verifique a Internet.";
        $("l-btn").disabled = false;
      }
    };
  }

  function iniciarSessao(user) {
    S.user = user;
    S.perms = calcularPerms(user);
    Dados._nome = user.nome || user.utilizador;   // autor dos registos de edição
    S.ocultar = true;   // modo privado ao entrar, como na app
    if (user.perfil === "CLIENTE") { $("l-erro").textContent = "Este painel é para a equipa. Use a app do cliente."; $("l-btn").disabled = false; S.user = null; return; }
    mostrar("ecra-app");
    construirBarra();
    navegar(pode("BALANCO") ? "inicio" : (pode("COBRANCAS") ? "cobrancas" : "clientes"));
  }

  function sair() {
    S.user = null; S.perms = new Set();
    verLogin();
  }

  // ============================================================
  // Navegação
  // ============================================================
  const ABAS = [
    { id: "inicio", ic: "inicio", rot: "Início", perm: null },
    { id: "cobrancas", ic: "cobrancas", rot: "Cobranças", perm: "COBRANCAS" },
    { id: "clientes", ic: "clientes", rot: "Clientes", perm: "CLIENTES" },
    { id: "emprestimos", ic: "credito", rot: "Crédito", perm: null },
    { id: "mais", ic: "mais", rot: "Mais", perm: null },
  ];

  function construirBarra() {
    const b = $("barra-inferior");
    b.innerHTML = "";
    ABAS.forEach((a) => {
      const btn = el(`<button data-aba="${a.id}"><span class="ic">${ic(a.ic, 23)}</span><span>${a.rot}</span></button>`);
      btn.onclick = () => navegar(a.id);
      b.appendChild(btn);
    });
  }

  function animarLogo() {
    try {
      const o = document.createElement("div");
      o.className = "logo-anim";
      o.innerHTML = '<div class="circ"><img src="icons/icon-192.png" alt=""></div>';
      document.body.appendChild(o);
      setTimeout(() => o.remove(), 660);
    } catch (e) {}
  }

  function navegar(aba) {
    const mudou = S.ecra !== aba;
    S.ecra = aba;
    [...$("barra-inferior").children].forEach((b) => b.classList.toggle("ativo", b.dataset.aba === aba));
    if (mudou) animarLogo();
    window.scrollTo(0, 0);
    if (aba === "inicio") verInicio();
    else if (aba === "cobrancas") verCobrancas();
    else if (aba === "clientes") verClientes();
    else if (aba === "emprestimos") verEmprestimos();
    else if (aba === "mais") verMais();
  }

  function cabecalho(titulo, sub, acoes) {
    const ini = R.iniciais(S.user.nome || S.user.utilizador);
    $("cabecalho").innerHTML = `
      <div style="flex:1;min-width:0">
        <div class="titulo">${esc(titulo)}</div>
        ${sub ? `<div class="sub">${esc(sub)}</div>` : ""}
      </div>
      ${acoes || ""}
      <button class="icone" id="cb-olho" title="Mostrar/ocultar valores">${ic(S.ocultar ? "olhoff" : "olho", 20)}</button>
      <div class="avatar">${esc(ini)}</div>`;
    $("cb-olho").onclick = async () => {
      if (S.ocultar && Bio.ativa(S.user.id)) {   // vai revelar: pede Face ID/Touch ID
        try { await Bio.verificar(S.user.id); }
        catch (e) { toast("Não foi possível confirmar a identidade.", true); return; }
      }
      S.ocultar = !S.ocultar; navegar(S.ecra);
    };
  }

  // Donut SVG (gráfico de estado). segs = [{rotulo, valor, cor}]. Identidade por legenda, não só por cor.
  function donutSVG(segs, centroTitulo, centroValor) {
    const total = segs.reduce((s, x) => s + x.valor, 0) || 1;
    const r = 52, cx = 70, cy = 70, C = 2 * Math.PI * r;
    let off = 0;
    const aneis = segs.filter((s) => s.valor > 0).map((s) => {
      const len = (s.valor / total) * C;
      const el = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${s.cor}" stroke-width="18"
        stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}"
        transform="rotate(-90 ${cx} ${cy})"><title>${esc(s.rotulo)}: ${s.valor}</title></circle>`;
      off += len; return el;
    }).join("");
    const legenda = segs.map((s) => `<div style="display:flex;align-items:center;gap:8px;font-size:.84rem;margin:4px 0">
      <span style="width:12px;height:12px;border-radius:3px;background:${s.cor};flex:none"></span>
      <span style="flex:1">${esc(s.rotulo)}</span><b style="font-variant-numeric:tabular-nums">${s.valor}</b></div>`).join("");
    return `<div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">
      <svg viewBox="0 0 140 140" width="140" height="140" style="flex:none">
        <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--fundo)" stroke-width="18"></circle>
        ${aneis}
        <text x="${cx}" y="${cy - 2}" text-anchor="middle" font-size="22" font-weight="800" fill="var(--texto)">${centroValor}</text>
        <text x="${cx}" y="${cy + 15}" text-anchor="middle" font-size="10" fill="var(--texto-suave)">${esc(centroTitulo)}</text>
      </svg>
      <div style="flex:1;min-width:140px">${legenda}</div></div>`;
  }

  // ============================================================
  // ECRÃ: INÍCIO (Balanço ou Cobranças)
  // ============================================================
  async function verInicio() {
    cabecalho("Olá, " + primeiroNome(S.user.nome || S.user.utilizador), S.user.perfilParaMostrar ? "" : perfilNome(S.user.perfil));
    const c = $("conteudo");
    if (!pode("BALANCO")) { verCobrancas(); return; }
    c.innerHTML = spinner;
    try {
      const [ind, cob, top] = await Promise.all([Dados.balanco(), Dados.cobrancasPrevistas(), Dados.topClientes()]);
      let barras = "";
      const max = Math.max(1, ...[...cob.values()]);
      for (const [rot, val] of cob) {
        const pct = Math.round((val / max) * 100);
        barras += `<div class="barra-linha ${rot === "Atraso" ? "atraso" : ""}">
          <span class="rot">${esc(rot)}</span>
          <span class="barra-trilho"><span class="barra-preench" style="width:${val > 0 ? Math.max(4, pct) : 0}%"></span></span>
          <span class="mt">${vmt(val)}</span></div>`;
      }
      let topHtml = top.length ? top.map((t) => `<div class="linha-dados"><span class="r">${esc(t.nome)}</span><span class="v">${vmt(t.total)}</span></div>`).join("") : `<p class="sub" style="color:var(--texto-suave)">Sem dados.</p>`;
      c.innerHTML = `
        <div class="kpis">
          <div class="kpi destaque"><div class="rotulo">Capital investido</div><div class="valor">${vmt(ind.capitalInvestido)}</div></div>
          <div class="kpi"><div class="rotulo">A receber</div><div class="valor">${vmt(ind.totalAReceber)}</div></div>
          <div class="kpi alerta"><div class="rotulo">Em atraso</div><div class="valor">${vmt(ind.emAtraso)}</div></div>
          <div class="kpi"><div class="rotulo">Margem (juros)</div><div class="valor">${vmt(ind.margemLucro)}</div></div>
        </div>
        <div class="seccao-titulo">Empréstimos por estado</div>
        <div class="cartao">${donutSVG([
          { rotulo: "Em curso", valor: ind.emCurso, cor: "#1f3a5f" },
          { rotulo: "Pagos", valor: ind.pagos, cor: "#1b8f5a" },
          { rotulo: "Pendentes", valor: ind.pendentes, cor: "#c77700" },
          { rotulo: "Cancelados", valor: ind.cancelados, cor: "#94a3b8" },
        ], "total", ind.emCurso + ind.pagos + ind.pendentes + ind.cancelados)}</div>
        <div class="seccao-titulo">Cobranças previstas (7 dias)</div>
        <div class="cartao">${barras}</div>
        <div class="seccao-titulo">Maiores clientes</div>
        <div class="cartao">${topHtml}</div>
        ${pode("EXPORTAR") ? `<button class="btn secundario" id="bal-pdf" style="margin-top:4px">${ic("pdf", 16)} Exportar Balanço (PDF)</button>` : ""}`;
      if ($("bal-pdf")) $("bal-pdf").onclick = () => exportarPDF("Balanço Geral",
        ["Indicador", "Valor"],
        [["Capital investido", R.mt(ind.capitalInvestido)], ["Total a receber", R.mt(ind.totalAReceber)],
         ["Em atraso", R.mt(ind.emAtraso)], ["Margem (juros)", R.mt(ind.margemLucro)],
         ["Empréstimos em curso", String(ind.emCurso)], ["Pagos", String(ind.pagos)],
         ["Pendentes", String(ind.pendentes)], ["Prestações em atraso", String(ind.prestacoesAtrasadas)]],
        []);`;
    } catch (e) { c.innerHTML = erroEcra(e, verInicio); }
  }

  // ============================================================
  // ECRÃ: COBRANÇAS (prestações por pagar)
  // ============================================================
  async function verCobrancas() {
    mostrar("ecra-app");
    cabecalho("Cobranças", "Prestações do dia e em atraso");
    const c = $("conteudo");
    c.innerHTML = `<div class="pesquisa"><span class="lupa">${ic("pesquisa", 18)}</span><input id="cob-f" placeholder="Procurar cliente…"></div>
      <button class="btn" id="cob-todos" style="margin-bottom:10px">${ic("sms", 16)} Enviar SMS a todos os que estão a dever</button>
      ${pode("EXPORTAR") ? `<button class="btn secundario" id="cob-pdf" style="margin-bottom:10px">${ic("pdf", 16)} Exportar PDF</button>` : ""}
      <div id="cob-lista">${spinner}</div>`;
    $("cob-todos").onclick = cobrarTodos;
    let todas = [];
    try { todas = await Dados.listarPorPagar(); }
    catch (e) { $("cob-lista").innerHTML = erroEcra(e, verCobrancas); return; }
    if ($("cob-pdf")) $("cob-pdf").onclick = () => exportarPDF("Cobranças / Prestações",
      ["Cliente", "Prest.", "Vencimento", "Atraso", "Em falta (MT)"],
      todas.map((p) => [p.nomeCliente, p.numero + "ª", R.data(p.vencimento), (R.diasAtraso(p.vencimento, R.hojeISO()) || 0) + "d", R.mt(R.emFalta(p, R.hojeISO()))]),
      ["Total por cobrar: " + R.mt(todas.reduce((s, p) => s + R.emFalta(p, R.hojeISO()), 0))]);
    const hoje = R.hojeISO();
    const render = (f) => {
      f = (f || "").toLowerCase();
      const lista = todas.filter((p) => !f || p.nomeCliente.toLowerCase().includes(f));
      if (!lista.length) { $("cob-lista").innerHTML = vazio("ok", todas.length ? "Nenhum resultado." : "Não há prestações por cobrar. Bom trabalho!"); return; }
      let totalHoje = 0, totalAtraso = 0;
      const itens = lista.map((p) => {
        const falta = R.emFalta(p, hoje);
        const atraso = R.diasAtraso(p.vencimento, hoje);
        if (atraso > 0) totalAtraso += falta; else if (p.vencimento === hoje) totalHoje += falta;
        const sit = R.situacaoPrestacao(p);
        const cls = atraso > 0 ? "e-atraso" : p.vencimento === hoje ? "e-aviso" : "e-neutro";
        const detAtraso = atraso > 0 ? ` · ${atraso} dia${atraso > 1 ? "s" : ""} de atraso` : "";
        return `<div class="item" style="gap:10px">
          <span class="avatar" data-pid="${p.id}">${esc(R.iniciais(p.nomeCliente))}</span>
          <span class="meio" data-pid="${p.id}" style="cursor:pointer"><span class="nome">${esc(p.nomeCliente)}</span>
            <span class="det">${p.numero}ª prest. · vence ${R.data(p.vencimento)}${detAtraso}</span>
            <span class="etiqueta ${cls}">${sit}</span></span>
          <span class="fim" style="display:flex;flex-direction:column;align-items:flex-end;gap:6px">
            <span class="mt">${vmt(falta)}</span>
            ${p.telefoneCliente ? `<button class="btn secundario" data-sms="${p.clienteId}" title="Enviar SMS" style="padding:6px 10px;width:auto;margin:0">${ic("sms", 15)}</button>` : ""}
          </span></div>`;
      }).join("");
      $("cob-lista").innerHTML =
        `<div class="cartao" style="display:flex;justify-content:space-around;text-align:center">
           <div><div class="t" style="color:var(--texto-suave);font-size:.75rem">Vence hoje</div><div style="font-weight:800">${vmt(totalHoje)}</div></div>
           <div><div class="t" style="color:var(--texto-suave);font-size:.75rem">Em atraso</div><div style="font-weight:800;color:var(--vermelho)">${vmt(totalAtraso)}</div></div>
         </div>` + itens;
      $("cob-lista").querySelectorAll("[data-pid]").forEach((b) =>
        b.onclick = () => abrirPrestacao(todas.find((x) => x.id == b.dataset.pid), verCobrancas));
      $("cob-lista").querySelectorAll("[data-sms]").forEach((b) => b.onclick = (ev) => {
        ev.stopPropagation();
        const cid = Number(b.dataset.sms);
        const ps = todas.filter((x) => x.clienteId === cid);
        if (!ps.length) return;
        const total = ps.reduce((s, p) => s + R.emFalta(p, hoje), 0);
        abrirSMS(ps[0].telefoneCliente, mensagemCobrancaGrupo(ps, total));
      });
    };
    render("");
    $("cob-f").oninput = (e) => render(e.target.value);
  }

  // Folha de uma prestação (detalhe + registar pagamento)
  function abrirPrestacao(p, recarregar) {
    const hoje = R.hojeISO();
    const falta = R.emFalta(p, hoje);
    const multa = R.multaPrestacao(p, hoje);
    const atraso = R.diasAtraso(p.vencimento, hoje);
    const podePagar = pode("PAGAR_PRESTACAO") && p.estado !== "PAGO";
    const podeMulta = pode("REMOVER_MULTA") && p.estado !== "PAGO" && multa > 0.004;
    abrirFolha(`
      <h3>${esc(p.nomeCliente)}</h3>
      <div class="sub">${p.numero}ª prestação · Empréstimo #${p.emprestimoId}</div>
      <div class="linha-dados"><span class="r">Vencimento</span><span class="v">${R.data(p.vencimento)}</span></div>
      <div class="linha-dados"><span class="r">Situação</span><span class="v">${R.situacaoPrestacao(p)}${atraso > 0 ? ` (${atraso}d)` : ""}</span></div>
      <div class="linha-dados"><span class="r">Valor da prestação</span><span class="v">${R.mt(p.valor)}</span></div>
      <div class="linha-dados"><span class="r">Já pago</span><span class="v">${R.mt(p.valorPago)}</span></div>
      <div class="linha-dados"><span class="r">Multa (2%/dia)</span><span class="v">${R.mt(multa)}${p.multaAlteradaPor ? " (alterada)" : ""}</span></div>
      <div class="linha-dados"><span class="r">Em falta</span><span class="v" style="color:var(--vermelho)">${R.mt(falta)}</span></div>
      ${p.telefoneCliente ? `<div class="linha-dados"><span class="r">Telefone</span><span class="v"><a href="tel:${esc(p.telefoneCliente)}">${esc(p.telefoneCliente)}</a></span></div>` : ""}
      ${podePagar ? `
        <div class="campo" style="margin-top:16px"><label>Valor a pagar</label>
          <input id="pg-valor" type="number" inputmode="decimal" step="0.01" value="${falta.toFixed(2)}"></div>
        <div class="campo"><label>Data do pagamento</label>
          <input id="pg-data" type="date" value="${hoje}" max="${hoje}"></div>
        <button class="btn" id="pg-btn">Registar pagamento</button>` :
        (p.estado === "PAGO" ? `<p class="sub" style="text-align:center;margin-top:14px">Prestação paga.</p>` : "")}
      ${podeMulta ? `<button class="btn secundario" id="pg-multa" style="margin-top:10px">Perdoar / reduzir multa</button>` : ""}
      ${pode("ANULAR_EMPRESTIMO") && p.estado !== "PAGO" ? `<button class="btn secundario" id="pg-venc" style="margin-top:10px">Alterar data de vencimento</button>` : ""}
      ${p.telefoneCliente && p.estado !== "PAGO" ? `<button class="btn secundario" id="pg-sms" style="margin-top:10px">${ic("sms", 16)} Enviar SMS de cobrança</button>` : ""}
    `);
    if ($("pg-sms")) $("pg-sms").onclick = () => abrirSMS(p.telefoneCliente, mensagemCobranca(p));
    if (pode("ANULAR_EMPRESTIMO") && p.estado !== "PAGO") $("pg-venc").onclick = () => {
      abrirFolha(`<h3>Alterar vencimento</h3><div class="sub">${p.numero}ª prestação · ${esc(p.nomeCliente)} · vence ${R.data(p.vencimento)}</div>
        <div class="campo"><label>Nova data de vencimento</label><input id="vn-data" type="date" value="${p.vencimento}"></div>
        <div class="erro-msg" id="vn-erro"></div><button class="btn" id="vn-ok">Guardar</button>`);
      $("vn-ok").onclick = async () => {
        $("vn-ok").disabled = true;
        try { const r = await Dados.alterarVencimento(p.id, $("vn-data").value, p.nomeCliente, p.numero);
          if (!r.ok) { $("vn-erro").textContent = r.msg; $("vn-ok").disabled = false; return; }
          fecharFolha(); toast(r.msg); if (recarregar) recarregar();
        } catch (e) { $("vn-erro").textContent = e.message; $("vn-ok").disabled = false; }
      };
    };
    if (podeMulta) $("pg-multa").onclick = () => {
      abrirFolha(`<h3>Multa de ${esc(p.nomeCliente)}</h3><div class="sub">${p.numero}ª prestação · multa atual ${R.mt(multa)}</div>
        <div class="campo"><label>Nova multa (0 para perdoar tudo)</label><input id="mu-valor" type="number" inputmode="decimal" step="0.01" value="0" max="${multa.toFixed(2)}"></div>
        <div class="erro-msg" id="mu-erro"></div>
        <div class="btn-linha"><button class="btn secundario" id="mu-zero">Perdoar tudo (0)</button><button class="btn" id="mu-ok">Guardar</button></div>`);
      $("mu-zero").onclick = () => { $("mu-valor").value = "0"; };
      $("mu-ok").onclick = async () => {
        $("mu-ok").disabled = true;
        try {
          const r = await Dados.alterarMulta(p.id, parseFloat($("mu-valor").value) || 0, nomeRegisto());
          if (!r.ok) { $("mu-erro").textContent = r.msg; $("mu-ok").disabled = false; return; }
          fecharFolha(); toast(r.msg); if (recarregar) recarregar();
        } catch (e) { $("mu-erro").textContent = e.message; $("mu-ok").disabled = false; }
      };
    };
    if (podePagar) {
      $("pg-btn").onclick = async () => {
        const valor = parseFloat($("pg-valor").value);
        const data = $("pg-data").value || hoje;
        if (!valor || valor <= 0) { toast("Indique um valor válido.", true); return; }
        $("pg-btn").disabled = true;
        try {
          const r = await Dados.registarPagamento(p.id, valor, nomeRegisto(), data);
          fecharFolha();
          toast(r.msg, !r.ok);
          if (r.ok && recarregar) recarregar();
        } catch (e) { toast(e.message, true); $("pg-btn").disabled = false; }
      };
    }
  }

  // ============================================================
  // ECRÃ: CLIENTES
  // ============================================================
  async function verClientes() {
    mostrar("ecra-app");
    const acao = pode("CLIENTES") ? `<button class="icone" id="cl-novo" title="Novo cliente">${ic("mais_add", 20)}</button>` : "";
    cabecalho("Clientes", "", acao);
    if ($("cl-novo")) $("cl-novo").onclick = () => formCliente(null);
    const c = $("conteudo");
    c.innerHTML = `<div class="pesquisa"><span class="lupa">${ic("pesquisa", 18)}</span><input id="cl-f" placeholder="Procurar por nome, telefone ou local…"></div>
      ${pode("EXPORTAR") ? `<button class="btn secundario" id="cl-pdf" style="margin-bottom:10px">${ic("pdf", 16)} Exportar PDF</button>` : ""}
      <div id="cl-lista">${spinner}</div>`;
    let timer, ultima = [];
    if ($("cl-pdf")) $("cl-pdf").onclick = () => exportarPDF("Clientes",
      ["Nome", "Telefone", "Local", "Empr.", "Dívida (MT)"],
      ultima.map((cl) => [cl.nome, cl.telefone || "", cl.localNegocio || "", String(cl.emprestimos), R.mt(cl.emDivida)]),
      ["Total de clientes: " + ultima.length]);
    const carregar = async (f) => {
      $("cl-lista").innerHTML = spinner;
      try {
        const lista = await Dados.listarClientes(f);
        ultima = lista;
        if (!lista.length) { $("cl-lista").innerHTML = vazio("clientes", "Nenhum cliente encontrado."); return; }
        $("cl-lista").innerHTML = lista.map((cl) => {
          const atraso = cl.prestacoesEmAtraso > 0;
          return `<button class="item" data-cid="${cl.id}">
            <span class="avatar">${esc(cl.iniciais || R.iniciais(cl.nome))}</span>
            <span class="meio"><span class="nome">${esc(cl.nome)}</span>
              <span class="det">${esc(cl.telefone || "")}${cl.localNegocio ? " · " + esc(cl.localNegocio) : ""}</span>
              ${cl.emDivida > 0 ? `<span class="etiqueta ${atraso ? "e-atraso" : "e-neutro"}">Dívida ${vmt(cl.emDivida)}${atraso ? " · em atraso" : ""}</span>` : `<span class="etiqueta e-ok">Sem dívida</span>`}
            </span>
            <span class="fim"><span class="det">${cl.emprestimos} empr.</span></span></button>`;
        }).join("");
        $("cl-lista").querySelectorAll("[data-cid]").forEach((b) =>
          b.onclick = () => abrirCliente(lista.find((x) => x.id == b.dataset.cid)));
      } catch (e) { $("cl-lista").innerHTML = erroEcra(e, () => carregar(f)); }
    };
    carregar("");
    $("cl-f").oninput = (e) => { clearTimeout(timer); const v = e.target.value; timer = setTimeout(() => carregar(v), 350); };
  }

  async function abrirCliente(cl) {
    abrirFolha(`<h3>${esc(cl.nome)}</h3><div class="sub">${esc(cl.classificacao || "")}</div>${spinner}`);
    let emprestimos = [];
    try { emprestimos = (await Dados.listarEmprestimos()).filter((e) => e.clienteId === cl.id); } catch (e) {}
    let poup = 0; try { poup = await Dados.poupancaSaldo(cl.id); } catch (e) {}
    const empHtml = emprestimos.length ? emprestimos.map((e) => `
      <button class="item" data-eid="${e.id}">
        <span class="meio"><span class="nome">#${e.id} · ${vmt(e.capital)}</span>
          <span class="det">${R.situacaoEmprestimo(e.estado, e.prestacoesEmAtraso)} · ${e.prestacoesPagas}/${e.totalPrestacoes} pagas</span></span>
        <span class="fim"><span class="mt">${e.emFalta > 0 ? vmt(e.emFalta) : `<span style="color:var(--verde)">${ic("check", 18)}</span>`}</span></span></button>`).join("")
      : `<p class="sub" style="color:var(--texto-suave)">Sem empréstimos.</p>`;
    abrirFolha(`
      <h3>${esc(cl.nome)}</h3><div class="sub">${esc(cl.classificacao || "Cliente")}</div>
      <div class="linha-dados"><span class="r">Telefone</span><span class="v"><a href="tel:${esc(cl.telefone)}">${esc(cl.telefone || "—")}</a></span></div>
      <div class="linha-dados"><span class="r">Morada</span><span class="v">${esc(cl.morada || "—")}</span></div>
      <div class="linha-dados"><span class="r">Negócio</span><span class="v">${esc(cl.tipoNegocio || "—")}${cl.localNegocio ? " · " + esc(cl.localNegocio) : ""}</span></div>
      <div class="linha-dados"><span class="r">Renda diária</span><span class="v">${vmt(cl.rendaDiaria)}</span></div>
      <div class="linha-dados"><span class="r">Dívida atual</span><span class="v" style="${cl.emDivida > 0 ? "color:var(--vermelho)" : ""}">${vmt(cl.emDivida)}</span></div>
      ${poup > 0 ? `<div class="linha-dados"><span class="r">Poupança</span><span class="v">${vmt(poup)}</span></div>` : ""}
      <div class="seccao-titulo" style="margin-left:0">Empréstimos</div>
      ${empHtml}
      ${cl.emDivida > 0 && cl.telefone ? `<button class="btn" id="cl-sms" style="margin-top:14px">${ic("sms", 16)} Enviar SMS de cobrança</button>` : ""}
      <div class="btn-linha" style="margin-top:10px">
        ${pode("NOVO_EMPRESTIMO") ? `<button class="btn" id="cl-pedir">Novo crédito</button>` : ""}
        ${pode("CLIENTES") ? `<button class="btn secundario" id="cl-editar">Editar</button>` : ""}
      </div>
      <div class="btn-linha" style="margin-top:10px">
        ${pode("CLIENTES") ? `<button class="btn secundario" id="cl-codigo">Novo código de acesso</button>` : ""}
        ${pode("ELIMINAR_CLIENTE") ? `<button class="btn perigo" id="cl-eliminar">Eliminar</button>` : ""}
      </div>`);
    $("folha").querySelectorAll("[data-eid]").forEach((b) =>
      b.onclick = () => abrirEmprestimo(emprestimos.find((x) => x.id == b.dataset.eid), () => abrirCliente(cl)));
    if ($("cl-sms")) $("cl-sms").onclick = async () => {
      try {
        const ps = (await Dados.listarPorPagar()).filter((p) => p.clienteId === cl.id);
        if (!ps.length) { toast("Este cliente não tem prestações por pagar.", true); return; }
        const total = ps.reduce((s, p) => s + R.emFalta(p, R.hojeISO()), 0);
        abrirSMS(cl.telefone, mensagemCobrancaGrupo(ps, total));
      } catch (e) { toast(e.message, true); }
    };
    if ($("cl-pedir")) $("cl-pedir").onclick = () => formPedido(cl);
    if ($("cl-editar")) $("cl-editar").onclick = () => formCliente(cl);
    if ($("cl-codigo")) $("cl-codigo").onclick = async () => {
      if (!(await confirmar("Novo código de acesso", "A senha atual do cliente deixará de funcionar.", "Gerar"))) return;
      const r = await comErro(() => Dados.novoCodigoAcesso(cl.id, cl.usuarioId));
      abrirFolha(`<h3>Código gerado</h3><p class="sub">Entregue este código ao cliente:</p>
        <div class="kpi destaque" style="text-align:center"><div class="valor" style="font-size:2rem;letter-spacing:.3em">${esc(r.codigo || "")}</div></div>
        <button class="btn" onclick="void 0" id="ok">OK</button>`);
      $("ok").onclick = fecharFolha;
    };
    if ($("cl-eliminar")) $("cl-eliminar").onclick = async () => {
      if (!(await confirmar("Eliminar cliente", "Apaga o cliente e TODOS os seus empréstimos e prestações. Não pode ser desfeito.", "Eliminar", true))) return;
      const r = await comErro(() => Dados.eliminarCliente(cl.usuarioId));
      fecharFolha(); toast(r.msg, !r.ok); if (r.ok) navegar("clientes");
    };
  }

  function formCliente(cl) {
    const e = cl || {};
    abrirFolha(`
      <h3>${cl ? "Editar cliente" : "Novo cliente"}</h3>
      <div class="campo"><label>Nome completo</label><input id="f-nome" value="${esc(e.nome || "")}"></div>
      <div class="campo"><label>Telefone ${cl ? "(não muda)" : ""}</label><input id="f-tel" type="tel" inputmode="numeric" value="${esc(e.telefone || "")}" ${cl ? "disabled" : ""}></div>
      <div class="campo"><label>Morada</label><input id="f-morada" value="${esc(e.morada || "")}"></div>
      <div class="campo"><label>Tipo de negócio</label><input id="f-neg" value="${esc(e.tipoNegocio || "")}" placeholder="ex.: Banca de fruta"></div>
      <div class="campo"><label>Local do negócio</label><input id="f-local" value="${esc(e.localNegocio || "")}" placeholder="ex.: Mercado Central"></div>
      <div class="campo"><label>Renda diária (MT)</label><input id="f-renda" type="number" inputmode="decimal" value="${e.rendaDiaria || ""}"></div>
      <div class="campo"><label>Vive com (referências)</label><input id="f-coab" value="${esc(e.coabitantes || "")}"></div>
      <div class="erro-msg" id="f-erro"></div>
      <button class="btn" id="f-btn">${cl ? "Guardar" : "Registar"}</button>`);
    $("f-btn").onclick = async () => {
      const dados = {
        id: e.id, nome: $("f-nome").value, telefone: cl ? e.telefone : $("f-tel").value,
        morada: $("f-morada").value, tipoNegocio: $("f-neg").value, localNegocio: $("f-local").value,
        rendaDiaria: parseFloat($("f-renda").value) || 0, coabitantes: $("f-coab").value,
      };
      $("f-btn").disabled = true;
      try {
        const r = cl ? await Dados.atualizarCliente(dados) : await Dados.registarCliente(dados, nomeRegisto());
        if (!r.ok) { $("f-erro").textContent = r.msg; $("f-btn").disabled = false; return; }
        if (!cl && r.codigo) {
          abrirFolha(`<h3>Cliente registado</h3><p class="sub">Código de acesso do cliente (entregue-o):</p>
            <div class="kpi destaque" style="text-align:center"><div class="valor" style="font-size:2rem;letter-spacing:.3em">${esc(r.codigo)}</div></div>
            <button class="btn" id="ok">OK</button>`);
          $("ok").onclick = fecharFolha;
        } else { fecharFolha(); toast(r.msg); }
        navegar("clientes");
      } catch (err) { $("f-erro").textContent = err.message; $("f-btn").disabled = false; }
    };
  }

  // ============================================================
  // ECRÃ: EMPRÉSTIMOS / CRÉDITO
  // ============================================================
  async function verEmprestimos() {
    mostrar("ecra-app");
    cabecalho("Empréstimos", "");
    const c = $("conteudo");
    const abas = [];
    if (pode("APROVACOES")) abas.push(["pendentes", "Pendentes"]);
    abas.push(["todos", pode("TODOS_EMPRESTIMOS") ? "Todos" : "Em curso"]);
    let ativa = abas[0][0];
    c.innerHTML = `<div class="cartao" style="display:flex;gap:8px;padding:8px">${abas.map(([id, r]) =>
      `<button class="btn ${id === ativa ? "" : "secundario"}" data-ab="${id}" style="margin:0;padding:10px">${r}</button>`).join("")}</div>
      ${pode("EXPORTAR") ? `<button class="btn secundario" id="emp-pdf" style="margin-bottom:10px">${ic("pdf", 16)} Exportar PDF</button>` : ""}
      <div id="emp-lista">${spinner}</div>`;
    let fonte = [];
    if ($("emp-pdf")) $("emp-pdf").onclick = () => exportarPDF("Empréstimos",
      ["#", "Cliente", "Capital (MT)", "Situação", "Em falta (MT)"],
      fonte.map((e) => [String(e.id), e.nomeCliente, R.mt(e.capital), R.situacaoEmprestimo(e.estado, e.prestacoesEmAtraso), e.emFalta > 0 ? R.mt(e.emFalta) : "—"]),
      ["Total: " + fonte.length + " empréstimo(s)"]);
    const carregar = async () => {
      $("emp-lista").innerHTML = spinner;
      try {
        if (ativa === "pendentes") {
          fonte = await Dados.listarPendentes();
          if (!fonte.length) { $("emp-lista").innerHTML = vazio("ok", "Não há pedidos à espera de aprovação."); return; }
          $("emp-lista").innerHTML = fonte.map((e) => itemEmp(e, true)).join("");
        } else {
          fonte = await Dados.listarEmprestimos();
          if (!pode("TODOS_EMPRESTIMOS")) fonte = fonte.filter((e) => e.estado === "APROVADO");
          if (!fonte.length) { $("emp-lista").innerHTML = vazio("credito", "Nenhum empréstimo."); return; }
          $("emp-lista").innerHTML = fonte.map((e) => itemEmp(e, false)).join("");
        }
        $("emp-lista").querySelectorAll("[data-eid]").forEach((b) => b.onclick = () =>
          abrirEmprestimo(fonte.find((x) => x.id == b.dataset.eid), carregar));
      } catch (e) { $("emp-lista").innerHTML = erroEcra(e, carregar); }
    };
    c.querySelectorAll("[data-ab]").forEach((b) => b.onclick = () => {
      ativa = b.dataset.ab;
      c.querySelectorAll("[data-ab]").forEach((x) => x.className = "btn " + (x.dataset.ab === ativa ? "" : "secundario") );
      carregar();
    });
    carregar();
  }

  function itemEmp(e, pend) {
    const cls = e.prestacoesEmAtraso > 0 ? "e-atraso" : e.estado === "PAGO" ? "e-ok" : e.estado === "PENDENTE" ? "e-aviso" : "e-neutro";
    return `<button class="item" data-eid="${e.id}">
      <span class="avatar">${esc(R.iniciais(e.nomeCliente))}</span>
      <span class="meio"><span class="nome">${esc(e.nomeCliente)} · #${e.id}</span>
        <span class="det">${vmt(e.capital)} · ${e.modalidade === "PARCELADO" ? "6 prest." : "única"}${pend ? " · pedido " + R.data(e.dataPedido) : ""}</span>
        <span class="etiqueta ${cls}">${R.situacaoEmprestimo(e.estado, e.prestacoesEmAtraso)}</span></span>
      <span class="fim"><span class="mt">${e.estado === "PENDENTE" ? "" : (e.emFalta > 0 ? vmt(e.emFalta) : `<span style="color:var(--verde)">${ic("check", 18)}</span>`)}</span></span></button>`;
  }

  async function abrirEmprestimo(e, recarregar) {
    abrirFolha(`<h3>Empréstimo #${e.id}</h3><div class="sub">${esc(e.nomeCliente)}</div>${spinner}`);
    let prest = [];
    try { prest = await Dados.listarPorEmprestimo(e.id); } catch (err) {}
    const hoje = R.hojeISO();
    const prestHtml = prest.map((p) => {
      const falta = R.emFalta(p, hoje);
      const cls = p.estado === "PAGO" ? "e-ok" : R.diasAtraso(p.vencimento, hoje) > 0 ? "e-atraso" : "e-neutro";
      return `<button class="item" data-pid="${p.id}" ${p.estado === "PAGO" || !pode("PAGAR_PRESTACAO") ? "" : ""}>
        <span class="meio"><span class="nome">${p.numero}ª · ${R.data(p.vencimento)}</span>
          <span class="det">${R.mt(p.valor)}${p.multaCongelada || R.diasAtraso(p.vencimento, hoje) > 0 ? " + multa " + R.mt(R.multaPrestacao(p, hoje)) : ""}</span>
          <span class="etiqueta ${cls}">${R.situacaoPrestacao(p)}</span></span>
        <span class="fim"><span class="mt">${p.estado === "PAGO" ? `<span style="color:var(--verde)">${ic("check", 18)}</span>` : vmt(falta)}</span></span></button>`;
    }).join("");
    const pend = e.estado === "PENDENTE";
    abrirFolha(`
      <h3>Empréstimo #${e.id}</h3><div class="sub">${esc(e.nomeCliente)} · ${esc(e.telefoneCliente || "")}</div>
      <div class="linha-dados"><span class="r">Situação</span><span class="v">${R.situacaoEmprestimo(e.estado, e.prestacoesEmAtraso)}</span></div>
      <div class="linha-dados"><span class="r">Capital</span><span class="v">${vmt(e.capital)}</span></div>
      <div class="linha-dados"><span class="r">Total a pagar</span><span class="v">${vmt(e.totalAPagar)}</span></div>
      <div class="linha-dados"><span class="r">Modalidade</span><span class="v">${e.modalidade === "PARCELADO" ? "6 prestações (5/5 dias)" : "Única (30 dias)"}</span></div>
      <div class="linha-dados"><span class="r">Pedido</span><span class="v">${R.data(e.dataPedido)}</span></div>
      ${e.dataAprovacao ? `<div class="linha-dados"><span class="r">Desembolso</span><span class="v">${R.data(e.dataAprovacao)}</span></div>` : ""}
      ${e.bensGarantia ? `<div class="linha-dados"><span class="r">Garantia</span><span class="v">${esc(e.bensGarantia)}</span></div>` : ""}
      ${e.emFalta > 0 ? `<div class="linha-dados"><span class="r">Em falta</span><span class="v" style="color:var(--vermelho)">${vmt(e.emFalta)}</span></div>` : ""}
      ${pend ? aprovarBloco(e) : (prest.length ? `<div class="seccao-titulo" style="margin-left:0">Prestações</div>${prestHtml}` : "")}
      ${!pend && pode("ANULAR_EMPRESTIMO") && (e.estado === "APROVADO" || e.estado === "PAGO") && e.dataAprovacao ? `<button class="btn secundario" id="e-desemb" style="margin-top:14px">Alterar data de desembolso</button>` : ""}
      ${!pend && pode("ANULAR_EMPRESTIMO") && e.estado === "APROVADO" && e.jaPago === 0 ? `<button class="btn perigo" id="e-anular" style="margin-top:10px">Anular empréstimo</button>` : ""}
    `);
    if ($("e-desemb")) $("e-desemb").onclick = () => {
      abrirFolha(`<h3>Data de desembolso</h3><div class="sub">Empréstimo #${e.id} · ${esc(e.nomeCliente)} · atual ${R.data(e.dataAprovacao)}</div>
        <div class="campo"><label>Nova data de desembolso</label><input id="dd-data" type="date" value="${e.dataAprovacao}" max="${R.hojeISO()}"></div>
        <label style="display:flex;align-items:center;gap:10px;font-size:.9rem;margin-bottom:12px">
          <input type="checkbox" id="dd-mover" checked style="width:auto;transform:scale(1.2)"> Mover também as datas das prestações</label>
        <div class="erro-msg" id="dd-erro"></div><button class="btn" id="dd-ok">Guardar</button>`);
      $("dd-ok").onclick = async () => {
        $("dd-ok").disabled = true;
        try { const r = await Dados.alterarDataDesembolso(e, $("dd-data").value, nomeRegisto(), $("dd-mover").checked);
          if (!r.ok) { $("dd-erro").textContent = r.msg; $("dd-ok").disabled = false; return; }
          fecharFolha(); toast(r.msg); if (recarregar) recarregar();
        } catch (err) { $("dd-erro").textContent = err.message; $("dd-ok").disabled = false; }
      };
    };
    $("folha").querySelectorAll("[data-pid]").forEach((b) => {
      const p = prest.find((x) => x.id == b.dataset.pid);
      if (p.estado !== "PAGO" && pode("PAGAR_PRESTACAO")) b.onclick = () => abrirPrestacao(p, recarregar);
    });
    if (pend && pode("APROVACOES")) ligarAprovacao(e, recarregar);
    if ($("e-anular")) $("e-anular").onclick = async () => {
      if (!(await confirmar("Anular empréstimo", "O desembolso volta ao caixa (Lixo) e as prestações são apagadas.", "Anular", true))) return;
      const r = await comErro(() => Dados.anular(e, nomeRegisto()));
      fecharFolha(); toast(r.msg, !r.ok); if (r.ok && recarregar) recarregar();
    };
  }

  function aprovarBloco(e) {
    if (!pode("APROVACOES")) return `<p class="sub" style="text-align:center;margin-top:14px">Pedido à espera de aprovação.</p>`;
    const hoje = R.hojeISO();
    return `
      <div class="seccao-titulo" style="margin-left:0">Decidir pedido</div>
      <div class="campo"><label>Valor a aprovar (MT)</label><input id="ap-valor" type="number" inputmode="decimal" value="${e.capital}"></div>
      <div class="campo"><label>Modalidade</label>
        <select id="ap-mod"><option value="PARCELADO" ${e.modalidade === "PARCELADO" ? "selected" : ""}>6 prestações (5/5 dias)</option>
        <option value="UNICO" ${e.modalidade === "UNICO" ? "selected" : ""}>Única (30 dias)</option></select></div>
      <div class="campo"><label>Data de aprovação</label><input id="ap-data" type="date" value="${hoje}" max="${hoje}" min="${e.dataPedido}"></div>
      <div class="btn-linha">
        <button class="btn perigo" id="ap-rej">Rejeitar</button>
        <button class="btn" id="ap-ok">Aprovar</button>
      </div>`;
  }

  function ligarAprovacao(e, recarregar) {
    $("ap-ok").onclick = async () => {
      const valor = parseFloat($("ap-valor").value);
      const mod = $("ap-mod").value, data = $("ap-data").value;
      if (!(await confirmar("Aprovar pedido", `Vai aprovar ${R.mt(valor)} para ${e.nomeCliente}. Sai do caixa e gera as prestações.`, "Aprovar"))) return;
      $("ap-ok").disabled = true;
      try { const r = await Dados.aprovar(e, nomeRegisto(), valor, mod, data); fecharFolha(); toast(r.msg, !r.ok); if (r.ok && recarregar) recarregar(); }
      catch (err) { toast(err.message, true); $("ap-ok").disabled = false; }
    };
    $("ap-rej").onclick = async () => {
      if (!(await confirmar("Rejeitar pedido", "O pedido vai para a Lixeira.", "Rejeitar", true))) return;
      const r = await comErro(() => Dados.rejeitar(e.id, nomeRegisto()));
      fecharFolha(); toast(r.msg, !r.ok); if (r.ok && recarregar) recarregar();
    };
  }

  function formPedido(cl) {
    abrirFolha(`
      <h3>Novo crédito</h3><div class="sub">${esc(cl.nome)}</div>
      <div class="campo"><label>Valor (MT)</label><input id="pd-valor" type="number" inputmode="decimal" placeholder="1000 a 35000"></div>
      <div class="campo"><label>Modalidade</label>
        <select id="pd-mod"><option value="PARCELADO">6 prestações (5 em 5 dias)</option><option value="UNICO">Prestação única (30 dias)</option></select></div>
      <div class="campo"><label>Bens dados como garantia</label><textarea id="pd-garantia" rows="2" placeholder="ex.: Geleira, televisor"></textarea></div>
      <div id="pd-sim" class="cartao" style="display:none;background:var(--fundo)"></div>
      <div class="erro-msg" id="pd-erro"></div>
      <button class="btn" id="pd-btn">Enviar pedido</button>`);
    const simular = () => {
      const v = parseFloat($("pd-valor").value);
      const sim = $("pd-sim");
      if (!v || v < 1000) { sim.style.display = "none"; return; }
      const total = R.totalAPagar(v);
      sim.style.display = "block";
      sim.innerHTML = `<div class="linha-dados"><span class="r">Total a pagar (c/ 30%)</span><span class="v">${R.mt(total)}</span></div>
        <div class="linha-dados"><span class="r">${$("pd-mod").value === "PARCELADO" ? "6 prestações de" : "1 pagamento de"}</span><span class="v">${R.mt($("pd-mod").value === "PARCELADO" ? R.arredondar(total / 6) : total)}</span></div>`;
    };
    $("pd-valor").oninput = simular; $("pd-mod").onchange = simular;
    $("pd-btn").onclick = async () => {
      $("pd-btn").disabled = true;
      try {
        const r = await Dados.pedirEmprestimo(cl.id, parseFloat($("pd-valor").value), $("pd-mod").value, $("pd-garantia").value, nomeRegisto());
        if (!r.ok) { $("pd-erro").textContent = r.msg; $("pd-btn").disabled = false; return; }
        fecharFolha(); toast(r.msg);
      } catch (e) { $("pd-erro").textContent = e.message; $("pd-btn").disabled = false; }
    };
  }

  // ============================================================
  // ECRÃ: MAIS
  // ============================================================
  async function verMais() {
    mostrar("ecra-app");
    cabecalho("Mais", "");
    const c = $("conteudo");
    const bioDisp = await Bio.disponivel();
    const bioOn = Bio.ativa(S.user.id);
    const op = (id, nome, t, sub) => `<button class="item" data-op="${id}"><span class="avatar" style="background:var(--fundo);color:var(--navy)">${ic(nome, 20)}</span><span class="meio"><span class="nome">${t}</span>${sub ? `<span class="det">${sub}</span>` : ""}</span></button>`;
    c.innerHTML = `
      <div class="cartao" style="display:flex;align-items:center;gap:14px">
        <div class="avatar" style="width:54px;height:54px;background:var(--navy)">${esc(R.iniciais(S.user.nome || S.user.utilizador))}</div>
        <div><div style="font-weight:800;font-size:1.1rem">${esc(S.user.nome || S.user.utilizador)}</div>
          <div class="det" style="color:var(--texto-suave)">${perfilNome(S.user.perfil)}${S.user.principal ? " principal" : ""}</div></div>
      </div>
      <div class="seccao-titulo">Gestão</div>
      ${pode("CAIXA") ? op("caixa", "caixa", "Fluxo de Caixa", "Saldo, entradas e despesas") : ""}
      ${pode("CAIXA") ? op("poupanca", "poupanca", "Poupança de Clientes", "Cofres dos clientes") : ""}
      ${pode("UTILIZADORES") ? op("utilizadores", "utilizadores", "Utilizadores e Permissões", "") : ""}
      ${pode("CAIXA") ? op("lixeira", "lixeira", "Lixeira", "Lançamentos e pedidos apagados") : ""}
      ${pode("SMS_VER") ? op("sms", "sms", "SMS enviados", "Cobranças e recados enviados") : ""}
      ${S.user.perfil === "ADMIN" ? op("acessos", "acessos", "Acessos", "Quem entrou e quando") : ""}
      ${op("assistente", "assistente", "Assistente", "Perguntas sobre o negócio")}
      ${op("notificacoes", "notificacoes", "Notificações", "")}
      <div class="seccao-titulo">Conta</div>
      ${op("perfil", "perfil", "Editar o meu nome", "")}
      ${op("senha", "senha", "Alterar a minha senha", "")}
      ${bioDisp ? op("biometria", "biometria", bioOn ? "Desativar Face ID / Touch ID" : "Ativar Face ID / Touch ID", bioOn ? "Pede a biometria para mostrar valores" : "Proteger a app com biometria") : ""}
      <div class="seccao-titulo">Sistema</div>
      ${op("ligacao", "ligacao", "Trocar de ligação", DB.servidorAtual() || "")}
      ${op("sobre", "sobre", "Sobre a aplicação", "")}
      ${op("sair", "sair", "Terminar sessão", "")}`;
    c.querySelectorAll("[data-op]").forEach((b) => b.onclick = () => maisAcao(b.dataset.op));
  }

  async function maisAcao(op) {
    if (op === "caixa") return verCaixa();
    if (op === "poupanca") return verPoupanca();
    if (op === "lixeira") return verLixeira();
    if (op === "sms") return verSms();
    if (op === "acessos") return verAcessos();
    if (op === "assistente") return verAssistente();
    if (op === "utilizadores") return verUtilizadores();
    if (op === "notificacoes") return verNotificacoes();
    if (op === "perfil") return formNome();
    if (op === "senha") return formSenha();
    if (op === "biometria") {
      if (Bio.ativa(S.user.id)) {
        if (await confirmar("Desativar biometria", "Deixa de pedir Face ID / Touch ID para mostrar valores.", "Desativar", true)) {
          Bio.desativar(S.user.id); toast("Biometria desativada."); verMais();
        }
      } else {
        try { await Bio.registar(S.user.id, S.user.nome || S.user.utilizador); toast("Face ID / Touch ID ativado."); verMais(); }
        catch (e) { toast("Não foi possível ativar a biometria neste aparelho.", true); }
      }
      return;
    }
    if (op === "sobre") return verSobre();
    if (op === "ligacao") {
      if (await confirmar("Trocar de ligação", "Vai sair e apagar a ligação deste aparelho.", "Trocar", true)) { DB.apagar(); verLigar(); }
    }
    if (op === "sair") { if (await confirmar("Terminar sessão", "Quer sair da sua conta?", "Sair")) sair(); }
  }

  // ---------- Caixa ----------
  let caixaVerOcultos = false;
  async function verCaixa() {
    cabecalho("Fluxo de Caixa", "", `<button class="icone" id="cx-novo" title="Novo lançamento">${ic("mais_add", 20)}</button>`);
    $("cx-novo").onclick = () => formCaixa();
    const c = $("conteudo");
    c.innerHTML = spinner;
    const gere = pode("CAIXA_EDITAR") || pode("CAIXA_OCULTAR");
    try {
      const [s, movs] = await Promise.all([Dados.saldoCaixa(), Dados.movimentosCaixa(80, caixaVerOcultos)]);
      const lista = movs.map((m) => {
        const entrada = m.tipo === "ENTRADA";
        return `<button class="item" data-mid="${m.id}" style="${gere ? "" : "cursor:default"};${m.oculto ? "opacity:.55" : ""}">
          <span class="avatar" style="background:${entrada ? "var(--verde-bg)" : "var(--vermelho-bg)"};color:${entrada ? "var(--verde)" : "var(--vermelho)"}">${ic(entrada ? "entrada" : "saida", 18)}</span>
          <span class="meio"><span class="nome">${esc(curto(m.categoria))}${m.oculto ? " · oculto" : ""}</span><span class="det">${esc(m.justificativa || "")}</span>
            <span class="det" style="font-size:.75rem">${R.dataHora(m.dataMovimento)}</span></span>
          <span class="fim"><span class="mt" style="color:${entrada ? "var(--verde)" : "var(--vermelho)"}">${entrada ? "+" : "−"}${vmt(m.valor)}</span></span></button>`;
      }).join("");
      c.innerHTML = `
        <div class="kpis" style="grid-template-columns:1fr">
          <div class="kpi destaque"><div class="rotulo">Saldo em caixa</div><div class="valor" style="font-size:1.6rem">${vmt(s.saldo)}</div></div>
        </div>
        <div class="kpis">
          <div class="kpi"><div class="rotulo">Entradas</div><div class="valor" style="color:var(--verde)">${vmt(s.entradas)}</div></div>
          <div class="kpi"><div class="rotulo">Saídas</div><div class="valor" style="color:var(--vermelho)">${vmt(s.saidas)}</div></div>
        </div>
        <div class="btn-linha" style="margin-bottom:8px">
          ${pode("EXPORTAR") ? `<button class="btn secundario" id="cx-pdf">${ic("pdf", 16)} PDF</button>` : ""}
          ${pode("CAIXA_RECONCILIAR") ? `<button class="btn secundario" id="cx-rec">${ic("reconciliar", 16)} Reconciliar</button>` : ""}
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div class="seccao-titulo">Movimentos</div>
          ${pode("CAIXA_OCULTAR") ? `<label style="font-size:.78rem;color:var(--texto-suave)"><input type="checkbox" id="cx-oc" ${caixaVerOcultos ? "checked" : ""}> ver ocultos</label>` : ""}
        </div>${lista || vazio("caixa", "Sem movimentos.")}`;
      if ($("cx-oc")) $("cx-oc").onchange = (e) => { caixaVerOcultos = e.target.checked; verCaixa(); };
      if ($("cx-rec")) $("cx-rec").onclick = () => {
        abrirFolha(`<h3>Reconciliar o caixa</h3><div class="sub">Saldo do sistema: ${R.mt(s.saldo)}</div>
          <div class="campo"><label>Dinheiro contado (MT)</label><input id="rc-contado" type="number" inputmode="decimal" value="${s.saldo.toFixed(2)}"></div>
          <div class="campo"><label>Observação (opcional)</label><input id="rc-obs" placeholder="ex.: contagem do fim do dia"></div>
          <label style="display:flex;align-items:center;gap:10px;font-size:.9rem;margin-bottom:6px">
            <input type="checkbox" id="rc-ajuste" checked style="width:auto;transform:scale(1.2)"> Registar a diferença como ajuste no caixa</label>
          <div id="rc-dif" class="sub" style="margin:8px 0"></div>
          <div class="erro-msg" id="rc-erro"></div><button class="btn" id="rc-ok">Reconciliar</button>`);
        const mostrarDif = () => {
          const cont = parseFloat($("rc-contado").value);
          if (isNaN(cont)) { $("rc-dif").textContent = ""; return; }
          const d = R.arredondar(cont - s.saldo);
          $("rc-dif").innerHTML = Math.abs(d) < 0.005 ? `<span style="color:var(--verde)">${ic("check", 15)} Sem diferença</span>`
            : `<b style="color:${d > 0 ? "var(--verde)" : "var(--vermelho)"}">${d > 0 ? "Sobra" : "Falta"} ${R.mt(Math.abs(d))}</b>`;
        };
        $("rc-contado").oninput = mostrarDif; mostrarDif();
        $("rc-ok").onclick = async () => {
          $("rc-ok").disabled = true;
          try { const r = await Dados.reconciliar(parseFloat($("rc-contado").value), $("rc-obs").value, $("rc-ajuste").checked, nomeRegisto());
            if (!r.ok) { $("rc-erro").textContent = r.msg; $("rc-ok").disabled = false; return; }
            fecharFolha(); toast(r.msg); verCaixa();
          } catch (e) { $("rc-erro").textContent = e.message; $("rc-ok").disabled = false; }
        };
      };
      if ($("cx-pdf")) $("cx-pdf").onclick = () => exportarPDF("Fluxo de Caixa",
        ["Data", "Tipo", "Categoria", "Descrição", "Valor (MT)"],
        movs.map((m) => [R.dataHora(m.dataMovimento), m.tipo, curto(m.categoria), m.justificativa || "", (m.tipo === "ENTRADA" ? "+" : "-") + R.mt(m.valor)]),
        [`Saldo: ${R.mt(s.saldo)}  |  Entradas: ${R.mt(s.entradas)}  |  Saídas: ${R.mt(s.saidas)}`]);
      if (gere) c.querySelectorAll("[data-mid]").forEach((b) => b.onclick = () => gerirCaixa(movs.find((m) => m.id == b.dataset.mid)));
    } catch (e) { c.innerHTML = erroEcra(e, verCaixa); }
  }

  function gerirCaixa(m) {
    const podeEditar = pode("CAIXA_EDITAR") && m.livre;
    abrirFolha(`<h3>${esc(curto(m.categoria))}</h3><div class="sub">Lançamento #${m.id} · ${R.dataHora(m.dataMovimento)}</div>
      <div class="linha-dados"><span class="r">Tipo</span><span class="v">${m.tipo === "ENTRADA" ? "Entrada" : "Saída"}</span></div>
      <div class="linha-dados"><span class="r">Valor</span><span class="v">${R.mt(m.valor)}</span></div>
      <div class="linha-dados"><span class="r">Descrição</span><span class="v" style="max-width:60%">${esc(m.justificativa || "")}</span></div>
      ${!m.livre ? `<p class="sub" style="margin-top:12px;color:var(--texto-suave)">Este lançamento está ligado a um empréstimo/prestação. Só pode ser ocultado aqui; para o anular, use o empréstimo.</p>` : ""}
      <div class="btn-linha" style="margin-top:14px">
        ${podeEditar ? `<button class="btn secundario" id="g-editar">Editar</button>` : ""}
        ${pode("CAIXA_OCULTAR") ? `<button class="btn secundario" id="g-ocultar">${m.oculto ? "Mostrar" : "Ocultar"}</button>` : ""}
      </div>
      ${podeEditar ? `<button class="btn perigo" id="g-apagar" style="margin-top:10px">Apagar (vai para o Lixo)</button>` : ""}`);
    if ($("g-editar")) $("g-editar").onclick = () => {
      abrirFolha(`<h3>Editar lançamento</h3>
        <div class="campo"><label>Tipo</label><select id="ge-tipo"><option value="ENTRADA" ${m.tipo === "ENTRADA" ? "selected" : ""}>Entrada</option><option value="SAIDA" ${m.tipo === "SAIDA" ? "selected" : ""}>Saída</option></select></div>
        <div class="campo"><label>Valor (MT)</label><input id="ge-valor" type="number" inputmode="decimal" value="${m.valor}"></div>
        <div class="campo"><label>Descrição</label><input id="ge-just" value="${esc(m.justificativa || "")}"></div>
        <div class="erro-msg" id="ge-erro"></div><button class="btn" id="ge-ok">Guardar</button>`);
      $("ge-ok").onclick = async () => {
        $("ge-ok").disabled = true;
        try { const r = await Dados.caixaEditar(m.id, $("ge-tipo").value, parseFloat($("ge-valor").value), $("ge-just").value);
          if (!r.ok) { $("ge-erro").textContent = r.msg; $("ge-ok").disabled = false; return; }
          fecharFolha(); toast(r.msg); verCaixa();
        } catch (e) { $("ge-erro").textContent = e.message; $("ge-ok").disabled = false; }
      };
    };
    if ($("g-ocultar")) $("g-ocultar").onclick = async () => {
      const r = await comErro(() => Dados.caixaOcultar(m.id, !m.oculto)); fecharFolha(); toast(r.msg, !r.ok); verCaixa();
    };
    if ($("g-apagar")) $("g-apagar").onclick = async () => {
      if (!(await confirmar("Apagar lançamento", "Vai para o Lixo do Caixa. O saldo é atualizado (pode restaurar depois).", "Apagar", true))) return;
      const r = await comErro(() => Dados.caixaApagar(m.id, nomeRegisto())); fecharFolha(); toast(r.msg, !r.ok); verCaixa();
    };
  }

  function formCaixa() {
    const hoje = R.hojeISO();
    abrirFolha(`
      <h3>Novo lançamento</h3>
      <div class="campo"><label>Tipo</label><select id="cx-tipo"><option value="ENTRADA">Entrada (ex.: capital)</option><option value="SAIDA">Despesa / saída</option></select></div>
      <div class="campo"><label>Valor (MT)</label><input id="cx-valor" type="number" inputmode="decimal"></div>
      <div class="campo"><label>Justificação</label><input id="cx-just" placeholder="ex.: Reforço de capital"></div>
      <div class="campo"><label>Data</label><input id="cx-data" type="date" value="${hoje}" max="${hoje}"></div>
      <div class="erro-msg" id="cx-erro"></div>
      <button class="btn" id="cx-btn">Registar</button>`);
    $("cx-btn").onclick = async () => {
      $("cx-btn").disabled = true;
      try {
        const r = await Dados.registarCaixa($("cx-tipo").value, parseFloat($("cx-valor").value), $("cx-just").value, $("cx-data").value, nomeRegisto());
        if (!r.ok) { $("cx-erro").textContent = r.msg; $("cx-btn").disabled = false; return; }
        fecharFolha(); toast(r.msg); verCaixa();
      } catch (e) { $("cx-erro").textContent = e.message; $("cx-btn").disabled = false; }
    };
  }

  // ---------- Utilizadores ----------
  async function verUtilizadores() {
    cabecalho("Utilizadores", "", `<button class="icone" id="u-novo" title="Novo utilizador">${ic("mais_add", 20)}</button>`);
    $("u-novo").onclick = () => formUtilizador(null);
    const c = $("conteudo");
    c.innerHTML = spinner;
    try {
      const lista = await Dados.listarUtilizadores();
      c.innerHTML = lista.map((u) => `<button class="item" data-uid="${u.id}">
        <span class="avatar">${esc(R.iniciais(u.nome || u.utilizador))}</span>
        <span class="meio"><span class="nome">${esc(u.nome || u.utilizador)}${u.principal ? ` <span style="color:var(--laranja)">${ic("estrela", 13)}</span>` : ""}</span>
          <span class="det">${esc(u.utilizador)} · ${perfilNome(u.perfil)}</span>
          <span class="etiqueta ${u.ativo ? "e-ok" : "e-atraso"}">${u.ativo ? "Ativo" : "Desativado"}</span></span></button>`).join("");
      c.querySelectorAll("[data-uid]").forEach((b) => b.onclick = () => formUtilizador(lista.find((x) => x.id == b.dataset.uid)));
    } catch (e) { c.innerHTML = erroEcra(e, verUtilizadores); }
  }

  function formUtilizador(u) {
    const permsAtuais = u ? calcularPerms(u) : permsPadrao("AGENTE");
    const perfilInicial = u ? u.perfil : "AGENTE";
    const catHtml = () => CAT.map(([cod, nome, soAdmin]) => {
      const perfil = $("u-perfil") ? $("u-perfil").value : perfilInicial;
      if (perfil === "AGENTE" && soAdmin) return "";
      const checked = permsAtuais.has(cod) ? "checked" : "";
      return `<label style="display:flex;align-items:center;gap:10px;padding:7px 0;font-size:.9rem">
        <input type="checkbox" class="u-perm" value="${cod}" ${checked} style="width:auto;transform:scale(1.2)"> ${esc(nome)}</label>`;
    }).join("");
    abrirFolha(`
      <h3>${u ? "Editar utilizador" : "Novo utilizador"}</h3>
      <div class="campo"><label>Nome de utilizador ${u ? "(não muda)" : ""}</label><input id="u-user" value="${esc(u ? u.utilizador : "")}" ${u ? "disabled" : ""} autocapitalize="none"></div>
      <div class="campo"><label>Nome a mostrar</label><input id="u-nome" value="${esc(u ? u.nome : "")}"></div>
      <div class="campo"><label>Perfil</label><select id="u-perfil"><option value="AGENTE" ${perfilInicial === "AGENTE" ? "selected" : ""}>Agente</option><option value="ADMIN" ${perfilInicial === "ADMIN" ? "selected" : ""}>Administrador</option></select></div>
      ${u ? `<div class="campo"><label>Estado</label><select id="u-ativo"><option value="1" ${u.ativo ? "selected" : ""}>Ativo</option><option value="0" ${!u.ativo ? "selected" : ""}>Desativado</option></select></div>` : ""}
      <div class="campo"><label>${u ? "Nova senha (deixe vazio para manter)" : "Senha"}</label><input id="u-senha" type="text" autocapitalize="none" placeholder="mínimo 6 caracteres"></div>
      <div class="seccao-titulo" style="margin-left:0">Permissões</div>
      <div id="u-perms" class="cartao" style="box-shadow:none;background:var(--fundo)">${catHtml()}</div>
      <div class="erro-msg" id="u-erro"></div>
      <div class="btn-linha"><button class="btn" id="u-btn">${u ? "Guardar" : "Criar"}</button>
      ${u && !u.principal ? `<button class="btn perigo" id="u-del">Eliminar</button>` : ""}</div>`);
    $("u-perfil").onchange = () => { $("u-perms").innerHTML = catHtml(); };
    $("u-btn").onclick = async () => {
      const perms = [...$("u-perms").querySelectorAll(".u-perm:checked")].map((x) => x.value).join(",");
      const perfil = $("u-perfil").value;
      $("u-btn").disabled = true;
      try {
        let r;
        if (u) r = await Dados.atualizarUtilizador(u.id, $("u-nome").value, perfil, $("u-ativo").value === "1", perms, $("u-senha").value);
        else r = await Dados.criarUtilizador($("u-user").value, $("u-nome").value, $("u-senha").value, perfil, perms);
        if (!r.ok) { $("u-erro").textContent = r.msg; $("u-btn").disabled = false; return; }
        fecharFolha(); toast(r.msg); verUtilizadores();
      } catch (e) { $("u-erro").textContent = e.message; $("u-btn").disabled = false; }
    };
    if ($("u-del")) $("u-del").onclick = async () => {
      if (!(await confirmar("Eliminar utilizador", "A conta será apagada.", "Eliminar", true))) return;
      const r = await comErro(() => Dados.eliminarUtilizador(u.id));
      fecharFolha(); toast(r.msg, !r.ok); verUtilizadores();
    };
  }

  // ---------- Notificações ----------
  async function verNotificacoes() {
    cabecalho("Notificações", "");
    const c = $("conteudo");
    c.innerHTML = spinner;
    try {
      const lista = await Dados.listarNotificacoes(S.user.id, S.user.perfil);
      c.innerHTML = lista.length ? lista.map((n) => `<div class="item" style="cursor:default">
        <span class="avatar" style="background:var(--fundo);color:var(--navy)">${ic("notificacoes", 18)}</span>
        <span class="meio"><span class="nome">${esc(n.titulo || "Notificação")}</span><span class="det" style="white-space:normal">${esc(n.mensagem || "")}</span>
          <span class="det" style="font-size:.74rem">${R.dataHora(n.data)}</span></span></div>`).join("") : vazio("notificacoes", "Sem notificações.");
    } catch (e) { c.innerHTML = vazio("notificacoes", "Sem notificações."); }
  }

  // ---------- Poupança de Clientes ----------
  async function verPoupanca() {
    cabecalho("Poupança de Clientes", "Cofres dos clientes");
    const c = $("conteudo");
    c.innerHTML = spinner;
    try {
      const lista = await Dados.poupancaSaldos(false);
      const comSaldo = lista.filter((x) => x.saldo > 0.005);
      const total = comSaldo.reduce((s, x) => s + x.saldo, 0);
      const itens = lista.length ? lista.map((x) => `<button class="item" data-cid="${x.clienteId}">
        <span class="avatar" style="background:${x.saldo > 0.005 ? "var(--navy)" : "var(--fundo)"};color:${x.saldo > 0.005 ? "#fff" : "var(--texto-suave)"}">${esc(R.iniciais(x.nome))}</span>
        <span class="meio"><span class="nome">${esc(x.nome)}</span>
          <span class="det">Depositado ${vmt(x.depositado)} · usado ${vmt(x.usado)}</span></span>
        <span class="fim"><span class="mt" style="${x.saldo > 0.005 ? "" : "color:var(--texto-suave)"}">${vmt(x.saldo)}</span></span></button>`).join("")
        : vazio("poupanca", "Ainda não há poupança de clientes.");
      c.innerHTML = `
        <div class="kpis" style="grid-template-columns:1fr">
          <div class="kpi destaque"><div class="rotulo">Total guardado nos cofres</div><div class="valor" style="font-size:1.5rem">${vmt(total)}</div></div>
        </div>
        <div class="seccao-titulo">Clientes (${comSaldo.length} com saldo)</div>${itens}`;
      c.querySelectorAll("[data-cid]").forEach((b) => b.onclick = () => {
        const x = lista.find((y) => y.clienteId == b.dataset.cid); abrirPoupancaCliente(x);
      });
    } catch (e) { c.innerHTML = erroEcra(e, verPoupanca); }
  }

  async function abrirPoupancaCliente(x) {
    abrirFolha(`<h3>${esc(x.nome)}</h3><div class="sub">Poupança</div>${spinner}`);
    let movs = [];
    try { movs = await Dados.poupancaMovimentos(x.clienteId); } catch (e) {}
    const linhas = movs.map((m) => {
      const dep = m.tipo === "DEPOSITO";
      return `<div class="item" style="cursor:default">
        <span class="avatar" style="background:${dep ? "var(--verde-bg)" : "var(--laranja-bg)"};color:${dep ? "var(--verde)" : "var(--laranja)"}">${ic(dep ? "entrada" : "saida", 18)}</span>
        <span class="meio"><span class="nome">${dep ? "Depósito" : "Uso"}</span><span class="det" style="white-space:normal">${esc(m.descricao)}</span>
          <span class="det" style="font-size:.74rem">${R.dataHora(m.data)}</span></span>
        <span class="fim"><span class="mt" style="color:${dep ? "var(--verde)" : "var(--laranja)"}">${dep ? "+" : "−"}${R.mt(m.valor)}</span></span></div>`;
    }).join("");
    abrirFolha(`<h3>${esc(x.nome)}</h3><div class="sub">Poupança do cliente</div>
      <div class="linha-dados"><span class="r">Saldo atual</span><span class="v">${R.mt(x.saldo)}</span></div>
      <div class="linha-dados"><span class="r">Total depositado</span><span class="v">${R.mt(x.depositado)}</span></div>
      <div class="linha-dados"><span class="r">Total usado</span><span class="v">${R.mt(x.usado)}</span></div>
      <div class="seccao-titulo" style="margin-left:0">Movimentos</div>
      ${linhas || `<p class="sub" style="color:var(--texto-suave)">Sem movimentos.</p>`}`);
  }

  // ---------- Lixeira ----------
  async function verLixeira() {
    cabecalho("Lixeira", "Lançamentos e pedidos apagados");
    const c = $("conteudo");
    let ativa = "caixa";
    c.innerHTML = `<div class="cartao" style="display:flex;gap:8px;padding:8px">
      <button class="btn" data-ab="caixa" style="margin:0;padding:10px">Lançamentos do caixa</button>
      <button class="btn secundario" data-ab="pedidos" style="margin:0;padding:10px">Pedidos rejeitados</button></div><div id="lix-lista">${spinner}</div>`;
    const carregar = async () => {
      $("lix-lista").innerHTML = spinner;
      try {
        if (ativa === "caixa") {
          const lista = await Dados.lixoCaixaListar();
          if (!lista.length) { $("lix-lista").innerHTML = vazio("lixeira", "O lixo do caixa está vazio."); return; }
          $("lix-lista").innerHTML = lista.map((m) => {
            const entrada = m.tipo === "ENTRADA";
            return `<div class="item" style="cursor:default;align-items:flex-start">
              <span class="avatar" style="background:var(--fundo);color:var(--texto-suave)">${ic("lixeira", 18)}</span>
              <span class="meio"><span class="nome">#${m.caixaId} · ${esc(curto(m.categoria))}</span>
                <span class="det" style="white-space:normal">${esc(m.justificativa || "")}</span>
                <span class="det" style="font-size:.74rem">Apagado por ${esc(m.eliminadoPor || "—")} · ${R.dataHora(m.eliminadoEm)}${m.anulado ? " · pagamento anulado" : ""}</span>
                <span style="display:flex;gap:8px;margin-top:8px">
                  <button class="btn secundario" data-restaurar="${m.id}" data-anul="${m.anulado}" style="margin:0;padding:8px 12px;width:auto;font-size:.82rem">${ic("restaurar", 15)} Restaurar</button>
                  <button class="btn perigo" data-elim="${m.id}" style="margin:0;padding:8px 12px;width:auto;font-size:.82rem">Eliminar</button>
                </span></span>
              <span class="fim"><span class="mt" style="color:${entrada ? "var(--verde)" : "var(--vermelho)"}">${entrada ? "+" : "−"}${vmt(m.valor)}</span></span></div>`;
          }).join("") + `<button class="btn secundario" id="lix-esvaziar" style="margin-top:8px">Esvaziar lixo do caixa</button>`;
          $("lix-lista").querySelectorAll("[data-restaurar]").forEach((b) => b.onclick = async () => {
            if (!(await confirmar("Restaurar lançamento", "O lançamento volta ao caixa e o saldo é atualizado.", "Restaurar"))) return;
            const r = await comErro(() => Dados.lixoCaixaRestaurar(Number(b.dataset.restaurar), b.dataset.anul === "true"));
            toast(r.msg, !r.ok); if (r.ok) carregar();
          });
          $("lix-lista").querySelectorAll("[data-elim]").forEach((b) => b.onclick = async () => {
            if (!(await confirmar("Eliminar de vez", "Remove o lançamento do lixo definitivamente.", "Eliminar", true))) return;
            const r = await comErro(() => Dados.lixoCaixaEliminar(Number(b.dataset.elim)));
            toast(r.msg, !r.ok); if (r.ok) carregar();
          });
          $("lix-esvaziar").onclick = async () => {
            if (!(await confirmar("Esvaziar lixo", "Remove TODOS os lançamentos do lixo do caixa, definitivamente.", "Esvaziar", true))) return;
            const r = await comErro(() => Dados.lixoCaixaEsvaziar()); toast(r.msg, !r.ok); carregar();
          };
        } else {
          const lista = await Dados.rejeitadosListar();
          if (!lista.length) { $("lix-lista").innerHTML = vazio("lixeira", "Não há pedidos rejeitados."); return; }
          $("lix-lista").innerHTML = lista.map((e) => `<div class="item" style="cursor:default;align-items:flex-start">
            <span class="avatar">${esc(R.iniciais(e.nomeCliente))}</span>
            <span class="meio"><span class="nome">${esc(e.nomeCliente)} · #${e.id}</span>
              <span class="det">${vmt(e.capital)} · pedido ${R.data(e.dataPedido)}</span>
              <span class="det" style="font-size:.74rem">Rejeitado por ${esc(e.rejeitadoPor || "—")} · ${R.dataHora(e.rejeitadoEm)}</span>
              <span style="display:flex;gap:8px;margin-top:8px">
                <button class="btn secundario" data-rest="${e.id}" data-cli="${e.clienteId}" style="margin:0;padding:8px 12px;width:auto;font-size:.82rem">${ic("restaurar", 15)} Restaurar</button>
                <button class="btn perigo" data-del="${e.id}" style="margin:0;padding:8px 12px;width:auto;font-size:.82rem">Eliminar</button>
              </span></span></div>`).join("");
          $("lix-lista").querySelectorAll("[data-rest]").forEach((b) => b.onclick = async () => {
            if (!(await confirmar("Restaurar pedido", "O pedido volta a Aprovar pedidos.", "Restaurar"))) return;
            const r = await comErro(() => Dados.rejeitadoRestaurar(Number(b.dataset.rest), Number(b.dataset.cli)));
            toast(r.msg, !r.ok); if (r.ok) carregar();
          });
          $("lix-lista").querySelectorAll("[data-del]").forEach((b) => b.onclick = async () => {
            if (!(await confirmar("Eliminar de vez", "Remove o pedido rejeitado definitivamente.", "Eliminar", true))) return;
            const r = await comErro(() => Dados.rejeitadoEliminar(Number(b.dataset.del)));
            toast(r.msg, !r.ok); if (r.ok) carregar();
          });
        }
      } catch (e) { $("lix-lista").innerHTML = erroEcra(e, carregar); }
    };
    c.querySelectorAll("[data-ab]").forEach((b) => b.onclick = () => {
      ativa = b.dataset.ab;
      c.querySelectorAll("[data-ab]").forEach((x) => x.className = "btn " + (x.dataset.ab === ativa ? "" : "secundario"));
      carregar();
    });
    carregar();
  }

  // ---------- SMS enviados ----------
  async function verSms() {
    cabecalho("SMS enviados", "Cobranças e recados");
    const c = $("conteudo");
    c.innerHTML = spinner;
    try {
      const lista = await Dados.smsEnviadosListar();
      if (lista === null) { c.innerHTML = vazio("sms", "Esta base de dados não tem registo de SMS.\n(Os SMS são enviados pela app no telemóvel Android.)"); return; }
      if (!lista.length) { c.innerHTML = vazio("sms", "Ainda não há SMS enviados."); return; }
      c.innerHTML = lista.map((s) => {
        const ok = s.estado === "ENVIADO";
        return `<div class="item" style="cursor:default;align-items:flex-start">
          <span class="avatar" style="background:${ok ? "var(--verde-bg)" : "var(--vermelho-bg)"};color:${ok ? "var(--verde)" : "var(--vermelho)"}">${ic("sms", 18)}</span>
          <span class="meio"><span class="nome">${esc(s.nome || s.telefone)}</span>
            <span class="det" style="white-space:normal">${esc(s.texto)}</span>
            <span class="det" style="font-size:.74rem">${esc(s.telefone)} · ${esc(s.quando || "")} · ${esc(s.estado || "")}</span></span></div>`;
      }).join("");
    } catch (e) { c.innerHTML = erroEcra(e, verSms); }
  }

  // ---------- Acessos ----------
  async function verAcessos() {
    cabecalho("Acessos", "Entradas e saídas");
    const c = $("conteudo");
    c.innerHTML = spinner;
    try {
      const lista = await Dados.acessosListar(100);
      if (!lista.length) { c.innerHTML = vazio("acessos", "Sem registos de acesso."); return; }
      const cor = { ENTRADA: "var(--verde)", SAIDA: "var(--texto-suave)", FALHADA: "var(--vermelho)", BLOQUEIO: "var(--vermelho)", CONTA_DESATIVADA: "var(--vermelho)" };
      c.innerHTML = lista.map((a) => `<div class="item" style="cursor:default">
        <span class="avatar" style="background:var(--fundo);color:var(--texto-suave)">${ic(a.dispositivo === "TELEMOVEL" ? "telemovel" : "computador", 18)}</span>
        <span class="meio"><span class="nome">${esc(a.utilizador || "—")}</span>
          <span class="det">${esc(a.perfil || "")}${a.detalhe ? " · " + esc(a.detalhe) : ""}</span>
          <span class="det" style="font-size:.74rem">${R.dataHora(a.dataHora)}</span></span>
        <span class="fim"><span class="etiqueta e-neutro" style="color:${cor[a.evento] || "var(--texto-suave)"}">${esc(a.evento)}</span></span></div>`).join("");
    } catch (e) { c.innerHTML = erroEcra(e, verAcessos); }
  }

  // ---------- Assistente de IA ----------
  let iaHist = [];
  async function montarContextoIA() {
    const nome = S.user.nome || S.user.utilizador;
    let ctx = "És o assistente virtual do Kubatsira Microcrédito, uma empresa de microcrédito em Moçambique. " +
      "Falas com " + nome + " (" + perfilNome(S.user.perfil) + "). Responde em português de Moçambique, de forma curta, clara e educada. " +
      "Regras do produto: juros de 30% sobre o capital; multa de 2% do valor da prestação por cada dia de atraso; " +
      "modalidades: 6 prestações de 5 em 5 dias, ou prestação única aos 30 dias. Valores em Meticais (MT).\n\n";
    try {
      if (pode("BALANCO")) {
        const ind = await Dados.balanco();
        const s = await Dados.saldoCaixa();
        ctx += "Dados atuais da empresa:\n" +
          "- Capital investido: " + R.mt(ind.capitalInvestido) + "\n" +
          "- Total a receber: " + R.mt(ind.totalAReceber) + " (em atraso: " + R.mt(ind.emAtraso) + ")\n" +
          "- Margem de juros esperada: " + R.mt(ind.margemLucro) + "\n" +
          "- Saldo em caixa: " + R.mt(s.saldo) + "\n" +
          "- Empréstimos: " + ind.emCurso + " em curso, " + ind.pagos + " pagos, " + ind.pendentes + " pendentes\n" +
          "- Prestações: " + ind.prestacoesAtrasadas + " em atraso, " + ind.prestacoesNoPrazo + " no prazo\n";
      } else {
        const cob = await Dados.listarPorPagar();
        ctx += "Há " + cob.length + " prestações por cobrar. NÃO reveles valores financeiros globais da empresa a um agente.\n";
      }
    } catch (e) { ctx += "(Não foi possível carregar os números atuais.)\n"; }
    return ctx;
  }

  function markdownLeve(t) {
    return esc(t).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\*(.+?)\*/g, "<i>$1</i>").replace(/\n/g, "<br>");
  }

  async function verAssistente() {
    cabecalho("Assistente", "Perguntas sobre o negócio");
    const c = $("conteudo");
    c.innerHTML = `<div id="ia-chat" style="display:flex;flex-direction:column;gap:10px;margin-bottom:12px"></div>
      <div style="position:sticky;bottom:calc(var(--barra) + env(safe-area-inset-bottom));background:var(--fundo);padding:8px 0">
        <div style="display:flex;gap:8px">
          <input id="ia-in" placeholder="Escreva a sua pergunta…" style="flex:1;padding:12px 14px;border:1.5px solid var(--borda);border-radius:12px;font-size:1rem">
          <button class="btn" id="ia-send" style="width:auto;margin:0;padding:12px 16px">${ic("enviar", 18)}</button>
        </div></div>`;
    const chat = $("ia-chat");
    const bolha = (texto, meu) => {
      const d = el(`<div style="max-width:85%;padding:11px 14px;border-radius:16px;font-size:.92rem;${meu
        ? "align-self:flex-end;background:var(--navy);color:#fff;border-bottom-right-radius:4px"
        : "align-self:flex-start;background:var(--cartao);border:1px solid var(--borda);border-bottom-left-radius:4px"}">${meu ? esc(texto) : markdownLeve(texto)}</div>`);
      chat.appendChild(d); window.scrollTo(0, document.body.scrollHeight); return d;
    };
    if (!iaHist.length) bolha("Olá! Sou o assistente do Kubatsira. Pergunte-me sobre cobranças, clientes, o balanço ou as regras do crédito.", false);
    else iaHist.forEach((m) => bolha(m.texto, m.user));

    let contexto = null;
    const enviar = async () => {
      const q = $("ia-in").value.trim();
      if (!q) return;
      $("ia-in").value = ""; $("ia-send").disabled = true;
      bolha(q, true); iaHist.push({ user: true, texto: q });
      const pensar = bolha("…", false);
      try {
        if (!contexto) contexto = await montarContextoIA();
        const r = await Dados.iaPerguntar(contexto, iaHist.slice(0, -1), q);
        pensar.innerHTML = markdownLeve(r.texto);
        iaHist.push({ user: false, texto: r.texto });
      } catch (e) { pensar.innerHTML = esc("Erro: " + e.message); }
      $("ia-send").disabled = false; window.scrollTo(0, document.body.scrollHeight);
    };
    $("ia-send").onclick = enviar;
    $("ia-in").onkeydown = (e) => { if (e.key === "Enter") enviar(); };
  }

  // ---------- Perfil ----------
  function formNome() {
    abrirFolha(`<h3>O meu nome</h3>
      <div class="campo"><label>Nome a mostrar</label><input id="n-nome" value="${esc(S.user.nome || "")}"></div>
      <div class="erro-msg" id="n-erro"></div><button class="btn" id="n-btn">Guardar</button>`);
    $("n-btn").onclick = async () => {
      const r = await comErro(() => Dados.alterarNome(S.user.id, $("n-nome").value));
      S.user.nome = $("n-nome").value.trim(); fecharFolha(); toast(r.msg); verMais();
    };
  }
  function formSenha() {
    abrirFolha(`<h3>Alterar senha</h3>
      <div class="campo"><label>Senha atual</label><input id="s-at" type="password"></div>
      <div class="campo"><label>Nova senha</label><input id="s-nova" type="password"></div>
      <div class="erro-msg" id="s-erro"></div><button class="btn" id="s-btn">Alterar</button>`);
    $("s-btn").onclick = async () => {
      $("s-btn").disabled = true;
      try {
        const r = await Dados.alterarSenha(S.user.id, $("s-at").value, $("s-nova").value);
        if (!r.ok) { $("s-erro").textContent = r.msg; $("s-btn").disabled = false; return; }
        fecharFolha(); toast(r.msg);
      } catch (e) { $("s-erro").textContent = e.message; $("s-btn").disabled = false; }
    };
  }
  function verSobre() {
    abrirFolha(`<h3>Kubatsira Microcrédito</h3>
      <p class="sub">Aplicação web (PWA). Liga à mesma base de dados da app Android e do programa de computador.</p>
      <div class="linha-dados"><span class="r">Servidor</span><span class="v" style="font-size:.78rem">${esc(DB.servidorAtual() || "—")}</span></div>
      <div class="linha-dados"><span class="r">Utilizador</span><span class="v">${esc(S.user.utilizador)}</span></div>
      <p class="sub" style="margin-top:14px">Para instalar no telemóvel: abra no Safari/Chrome e escolha <b>“Adicionar ao ecrã principal”</b>.</p>
      <button class="btn" id="sb-ok" style="margin-top:10px">Fechar</button>`);
    $("sb-ok").onclick = fecharFolha;
  }

  // ---------- Auxiliares ----------
  function mostrar(id) {
    ["ecra-ligar", "ecra-login", "ecra-app"].forEach((e) => $(e).classList.toggle("ativo", e === id));
  }
  const primeiroNome = (n) => (n || "").trim().split(/\s+/)[0] || "";
  const perfilNome = (p) => p === "ADMIN" ? "Administrador" : p === "AGENTE" ? "Agente" : "Cliente";
  const nomeRegisto = () => S.user.nome || S.user.utilizador;
  const ehApple = () => /iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent);

  // Abre a app de Mensagens já preenchida (usa o SIM do telemóvel; o utilizador carrega em Enviar).
  function abrirSMS(tel, texto) {
    const num = (tel || "").replace(/\s/g, "");
    if (!num) { toast("Este cliente não tem telefone.", true); return; }
    const sep = ehApple() ? "&" : "?";
    window.location.href = `sms:${num}${sep}body=${encodeURIComponent(texto)}`;
  }

  // Mensagem agrupada: todas as prestações em dívida de um cliente (igual ao gateway/Android).
  function mensagemCobrancaGrupo(prest, dividaTotal) {
    const hoje = R.hojeISO();
    const ps = [...prest].sort((a, b) => (a.vencimento || "").localeCompare(b.vencimento || "") || a.numero - b.numero);
    let total = 0, multas = 0, atraso = false, n = 0; const linhas = [];
    for (const p of ps) {
      n++;
      const m = R.multaPrestacao(p, hoje), falta = R.emFalta(p, hoje), dd = R.diasAtraso(p.vencimento, hoje);
      total += falta; multas += m; if (dd > 0) atraso = true;
      if (n > 3) continue;
      let l = `- ${p.numero}a prest. (emp. ${p.emprestimoId}), `;
      if (dd > 0) l += `venceu ${R.data(p.vencimento).slice(0, 5)} (${dd} dia${dd !== 1 ? "s" : ""} atraso)`;
      else if (p.vencimento === hoje) l += "vence HOJE";
      else l += `vence ${R.data(p.vencimento).slice(0, 5)}`;
      l += ": " + R.mt(falta); if (m > 0) l += " c/ multa " + R.mt(m);
      linhas.push(l);
    }
    if (n > 3) linhas.push(`- e mais ${n - 3} valor(es) em atraso`);
    const qt = ps.length;
    let t = `Caro(a) ${ps[0].nomeCliente},\nKubatsira Microcredito informa que tem ${qt === 1 ? "1 prestacao" : qt + " prestacoes"} em divida:\n`;
    t += linhas.join("\n") + "\n";
    t += "TOTAL A PAGAR: " + R.mt(total);
    if (multas > 0) t += " (inclui multas de " + R.mt(multas) + ")";
    t += "\n";
    if (dividaTotal > total + 0.5) t += "Divida total (com prestacoes por vencer): " + R.mt(dividaTotal) + "\n";
    t += atraso ? "Regularize o pagamento o mais breve possivel. Obrigado." : "Obrigado.";
    return t;
  }

  // Fluxo "Enviar SMS a todos": percorre os clientes com cobranças, um a um (1 toque por cliente).
  async function cobrarTodos() {
    toast("A preparar as cobranças…");
    const hoje = R.hojeISO();
    let cobr, todas;
    try { cobr = await Dados.listarCobrancas(hoje); todas = await Dados.listarPorPagar(); }
    catch (e) { toast(e.message, true); return; }
    const divida = {}; todas.forEach((p) => divida[p.clienteId] = (divida[p.clienteId] || 0) + R.emFalta(p, hoje));
    const grupos = {}; cobr.forEach((p) => { (grupos[p.clienteId] = grupos[p.clienteId] || []).push(p); });
    const lista = Object.keys(grupos).map((cid) => {
      const ps = grupos[cid];
      return { nome: ps[0].nomeCliente, tel: ps[0].telefoneCliente,
        texto: mensagemCobrancaGrupo(ps, divida[cid] || 0),
        total: ps.reduce((s, p) => s + R.emFalta(p, hoje), 0) };
    });
    const semTel = lista.filter((x) => !x.tel).length;
    const comTel = lista.filter((x) => x.tel);
    if (!comTel.length) { toast("Não há clientes com telefone para cobrar.", true); return; }
    let i = 0;
    const render = () => {
      if (i >= comTel.length) {
        abrirFolha(`<h3>Concluído</h3><p class="sub">Percorreste os ${comTel.length} cliente(s)${semTel ? " (" + semTel + " sem telefone foram ignorados)" : ""}.</p><button class="btn" id="ct-ok">Fechar</button>`);
        $("ct-ok").onclick = fecharFolha; return;
      }
      const x = comTel[i];
      abrirFolha(`<h3>Enviar SMS a todos</h3><div class="sub">Cliente ${i + 1} de ${comTel.length}</div>
        <div class="linha-dados"><span class="r">Cliente</span><span class="v">${esc(x.nome)}</span></div>
        <div class="linha-dados"><span class="r">Telefone</span><span class="v">${esc(x.tel)}</span></div>
        <div class="linha-dados"><span class="r">A pagar</span><span class="v">${vmt(x.total)}</span></div>
        <div class="cartao" style="background:var(--fundo);white-space:pre-wrap;font-size:.8rem;margin-top:10px">${esc(x.texto)}</div>
        <button class="btn" id="ct-env">${ic("sms", 16)} Enviar a ${esc(primeiroNome(x.nome))} e seguir</button>
        <div class="btn-linha" style="margin-top:10px">
          <button class="btn secundario" id="ct-salta">Saltar</button>
          <button class="btn secundario" id="ct-fim">Terminar</button>
        </div>`);
      $("ct-env").onclick = () => { abrirSMS(x.tel, x.texto); i++; setTimeout(render, 500); };
      $("ct-salta").onclick = () => { i++; render(); };
      $("ct-fim").onclick = fecharFolha;
    };
    render();
  }

  // Texto da cobrança (uma prestação).
  function mensagemCobranca(p) {
    const hoje = R.hojeISO();
    const atraso = R.diasAtraso(p.vencimento, hoje);
    const falta = R.emFalta(p, hoje);
    let m = `Kubatsira: Ola ${primeiroNome(p.nomeCliente)}, `;
    if (atraso > 0) m += `a sua ${p.numero}a prestacao (emprestimo #${p.emprestimoId}) venceu em ${R.data(p.vencimento)} e tem ${atraso} dia(s) de atraso. `;
    else m += `a sua ${p.numero}a prestacao (emprestimo #${p.emprestimoId}) vence em ${R.data(p.vencimento)}. `;
    m += `Valor a pagar: ${R.mt(falta)}${p.multaCongelada || atraso > 0 ? " (inclui multa)" : ""}. Por favor regularize. Obrigado.`;
    return m;
  }
  const curto = (cat) => ({ PRESTACAO: "Pagamento", DESEMBOLSO: "Desembolso", CAPITAL: "Entrada de capital", DESPESA: "Despesa", POUPANCA: "Poupança" }[cat] || cat || "Movimento");
  function erroEcra(e, retry) {
    window.__retry = retry;
    return `<div class="vazio"><span class="ic" style="color:var(--laranja)">${ic("alerta", 44)}</span>${esc(e.message || "Erro ao carregar.")}<br><br>
      <button class="btn secundario" style="max-width:220px;margin:14px auto 0" onclick="window.__retry&&window.__retry()">Tentar de novo</button></div>`;
  }

  // ---------- Exportar PDF ----------
  function carregarScript(src) {
    return new Promise((res, rej) => {
      if ([...document.scripts].some((s) => s.src === src)) return res();
      const s = document.createElement("script");
      s.src = src; s.onload = res; s.onerror = () => rej(new Error("Não foi possível carregar o gerador de PDF (precisa de Internet)."));
      document.head.appendChild(s);
    });
  }

  async function exportarPDF(titulo, colunas, linhas, notas) {
    toast("A preparar o PDF…");
    try {
      await carregarScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js");
      await carregarScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js");
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF();
      doc.setFillColor(31, 58, 95); doc.rect(0, 0, 210, 24, "F");
      doc.setTextColor(255, 255, 255); doc.setFontSize(15); doc.setFont(undefined, "bold");
      doc.text("Kubatsira Microcrédito", 14, 11);
      doc.setFontSize(10); doc.setFont(undefined, "normal");
      doc.text(titulo, 14, 18);
      doc.setTextColor(90, 90, 90); doc.setFontSize(9);
      doc.text("Gerado em " + R.data(R.hojeISO()) + " · " + (S.user.nome || S.user.utilizador), 196, 18, { align: "right" });
      let y = 30;
      (notas || []).forEach((n) => { doc.setTextColor(40, 40, 40); doc.setFontSize(10); doc.text(String(n), 14, y); y += 6; });
      doc.autoTable({
        head: [colunas], body: linhas, startY: y + 2, styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fillColor: [31, 58, 95], textColor: 255 }, alternateRowStyles: { fillColor: [238, 242, 247] },
        margin: { left: 14, right: 14 },
      });
      doc.save("Kubatsira - " + titulo + " - " + R.data(R.hojeISO()).replace(/\//g, "-") + ".pdf");
      toast("PDF gerado.");
    } catch (e) { toast(e.message || "Falha ao gerar o PDF.", true); }
  }

  // ---------- Arranque ----------
  DB.iniciar();
  if (!DB.configurado()) verLigar();
  else verLogin();

  // Service worker (PWA offline shell)
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }
})();
