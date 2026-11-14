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

  // ---------- Utilitários DOM ----------
  const $ = (id) => document.getElementById(id);
  const el = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  const R = Regras;

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
  const vazio = (ic, txt) => `<div class="vazio"><span class="ic">${ic}</span>${esc(txt)}</div>`;

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
            ⚠️ Use esta ligação apenas no seu próprio telemóvel/computador, protegido pelo código de desbloqueio.
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
    { id: "inicio", ic: "🏠", rot: "Início", perm: null },
    { id: "cobrancas", ic: "📋", rot: "Cobranças", perm: "COBRANCAS" },
    { id: "clientes", ic: "👥", rot: "Clientes", perm: "CLIENTES" },
    { id: "emprestimos", ic: "💳", rot: "Crédito", perm: null },
    { id: "mais", ic: "⋯", rot: "Mais", perm: null },
  ];

  function construirBarra() {
    const b = $("barra-inferior");
    b.innerHTML = "";
    ABAS.forEach((a) => {
      const btn = el(`<button data-aba="${a.id}"><span class="ic">${a.ic}</span><span>${a.rot}</span></button>`);
      btn.onclick = () => navegar(a.id);
      b.appendChild(btn);
    });
  }

  function navegar(aba) {
    S.ecra = aba;
    [...$("barra-inferior").children].forEach((b) => b.classList.toggle("ativo", b.dataset.aba === aba));
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
      <button class="icone" id="cb-olho" title="Mostrar/ocultar valores">${S.ocultar ? "🙈" : "👁️"}</button>
      <div class="avatar">${esc(ini)}</div>`;
    $("cb-olho").onclick = () => { S.ocultar = !S.ocultar; navegar(S.ecra); };
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
        <div class="seccao-titulo">Empréstimos</div>
        <div class="cartao"><div class="contadores">
          <div class="contador"><div class="n">${ind.pendentes}</div><div class="t">Pendentes</div></div>
          <div class="contador"><div class="n">${ind.emCurso}</div><div class="t">Em curso</div></div>
          <div class="contador"><div class="n">${ind.pagos}</div><div class="t">Pagos</div></div>
        </div></div>
        <div class="seccao-titulo">Cobranças previstas (7 dias)</div>
        <div class="cartao">${barras}</div>
        <div class="seccao-titulo">Maiores clientes</div>
        <div class="cartao">${topHtml}</div>`;
    } catch (e) { c.innerHTML = erroEcra(e, verInicio); }
  }

  // ============================================================
  // ECRÃ: COBRANÇAS (prestações por pagar)
  // ============================================================
  async function verCobrancas() {
    mostrar("ecra-app");
    cabecalho("Cobranças", "Prestações do dia e em atraso");
    const c = $("conteudo");
    c.innerHTML = `<div class="pesquisa"><span class="lupa">🔎</span><input id="cob-f" placeholder="Procurar cliente…"></div><div id="cob-lista">${spinner}</div>`;
    let todas = [];
    try { todas = await Dados.listarPorPagar(); }
    catch (e) { $("cob-lista").innerHTML = erroEcra(e, verCobrancas); return; }
    const hoje = R.hojeISO();
    const render = (f) => {
      f = (f || "").toLowerCase();
      const lista = todas.filter((p) => !f || p.nomeCliente.toLowerCase().includes(f));
      if (!lista.length) { $("cob-lista").innerHTML = vazio("✅", todas.length ? "Nenhum resultado." : "Não há prestações por cobrar. Bom trabalho!"); return; }
      let totalHoje = 0, totalAtraso = 0;
      const itens = lista.map((p) => {
        const falta = R.emFalta(p, hoje);
        const atraso = R.diasAtraso(p.vencimento, hoje);
        if (atraso > 0) totalAtraso += falta; else if (p.vencimento === hoje) totalHoje += falta;
        const sit = R.situacaoPrestacao(p);
        const cls = atraso > 0 ? "e-atraso" : p.vencimento === hoje ? "e-aviso" : "e-neutro";
        const detAtraso = atraso > 0 ? ` · ${atraso} dia${atraso > 1 ? "s" : ""} de atraso` : "";
        return `<button class="item" data-pid="${p.id}">
          <span class="avatar">${esc(R.iniciais(p.nomeCliente))}</span>
          <span class="meio"><span class="nome">${esc(p.nomeCliente)}</span>
            <span class="det">${p.numero}ª prest. · vence ${R.data(p.vencimento)}${detAtraso}</span>
            <span class="etiqueta ${cls}">${sit}</span></span>
          <span class="fim"><span class="mt">${vmt(falta)}</span></span></button>`;
      }).join("");
      $("cob-lista").innerHTML =
        `<div class="cartao" style="display:flex;justify-content:space-around;text-align:center">
           <div><div class="t" style="color:var(--texto-suave);font-size:.75rem">Vence hoje</div><div style="font-weight:800">${vmt(totalHoje)}</div></div>
           <div><div class="t" style="color:var(--texto-suave);font-size:.75rem">Em atraso</div><div style="font-weight:800;color:var(--vermelho)">${vmt(totalAtraso)}</div></div>
         </div>` + itens;
      $("cob-lista").querySelectorAll("[data-pid]").forEach((b) =>
        b.onclick = () => abrirPrestacao(todas.find((x) => x.id == b.dataset.pid), verCobrancas));
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
    abrirFolha(`
      <h3>${esc(p.nomeCliente)}</h3>
      <div class="sub">${p.numero}ª prestação · Empréstimo #${p.emprestimoId}</div>
      <div class="linha-dados"><span class="r">Vencimento</span><span class="v">${R.data(p.vencimento)}</span></div>
      <div class="linha-dados"><span class="r">Situação</span><span class="v">${R.situacaoPrestacao(p)}${atraso > 0 ? ` (${atraso}d)` : ""}</span></div>
      <div class="linha-dados"><span class="r">Valor da prestação</span><span class="v">${R.mt(p.valor)}</span></div>
      <div class="linha-dados"><span class="r">Já pago</span><span class="v">${R.mt(p.valorPago)}</span></div>
      <div class="linha-dados"><span class="r">Multa (2%/dia)</span><span class="v">${R.mt(multa)}</span></div>
      <div class="linha-dados"><span class="r">Em falta</span><span class="v" style="color:var(--vermelho)">${R.mt(falta)}</span></div>
      ${p.telefoneCliente ? `<div class="linha-dados"><span class="r">Telefone</span><span class="v"><a href="tel:${esc(p.telefoneCliente)}">${esc(p.telefoneCliente)}</a></span></div>` : ""}
      ${podePagar ? `
        <div class="campo" style="margin-top:16px"><label>Valor a pagar</label>
          <input id="pg-valor" type="number" inputmode="decimal" step="0.01" value="${falta.toFixed(2)}"></div>
        <div class="campo"><label>Data do pagamento</label>
          <input id="pg-data" type="date" value="${hoje}" max="${hoje}"></div>
        <button class="btn" id="pg-btn">Registar pagamento</button>` :
        (p.estado === "PAGO" ? `<p class="sub" style="text-align:center;margin-top:14px">Prestação paga.</p>` : "")}
    `);
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
    const acao = pode("CLIENTES") ? `<button class="icone" id="cl-novo" title="Novo cliente">＋</button>` : "";
    cabecalho("Clientes", "", acao);
    if ($("cl-novo")) $("cl-novo").onclick = () => formCliente(null);
    const c = $("conteudo");
    c.innerHTML = `<div class="pesquisa"><span class="lupa">🔎</span><input id="cl-f" placeholder="Procurar por nome, telefone ou local…"></div><div id="cl-lista">${spinner}</div>`;
    let timer;
    const carregar = async (f) => {
      $("cl-lista").innerHTML = spinner;
      try {
        const lista = await Dados.listarClientes(f);
        if (!lista.length) { $("cl-lista").innerHTML = vazio("👥", "Nenhum cliente encontrado."); return; }
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
        <span class="fim"><span class="mt">${e.emFalta > 0 ? vmt(e.emFalta) : "✓"}</span></span></button>`).join("")
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
      <div class="btn-linha" style="margin-top:16px">
        ${pode("NOVO_EMPRESTIMO") ? `<button class="btn" id="cl-pedir">Novo crédito</button>` : ""}
        ${pode("CLIENTES") ? `<button class="btn secundario" id="cl-editar">Editar</button>` : ""}
      </div>
      <div class="btn-linha" style="margin-top:10px">
        ${pode("CLIENTES") ? `<button class="btn secundario" id="cl-codigo">Novo código de acesso</button>` : ""}
        ${pode("ELIMINAR_CLIENTE") ? `<button class="btn perigo" id="cl-eliminar">Eliminar</button>` : ""}
      </div>`);
    $("folha").querySelectorAll("[data-eid]").forEach((b) =>
      b.onclick = () => abrirEmprestimo(emprestimos.find((x) => x.id == b.dataset.eid), () => abrirCliente(cl)));
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
      `<button class="btn ${id === ativa ? "" : "secundario"}" data-ab="${id}" style="margin:0;padding:10px">${r}</button>`).join("")}</div><div id="emp-lista">${spinner}</div>`;
    let fonte = [];
    const carregar = async () => {
      $("emp-lista").innerHTML = spinner;
      try {
        if (ativa === "pendentes") {
          fonte = await Dados.listarPendentes();
          if (!fonte.length) { $("emp-lista").innerHTML = vazio("✅", "Não há pedidos à espera de aprovação."); return; }
          $("emp-lista").innerHTML = fonte.map((e) => itemEmp(e, true)).join("");
        } else {
          fonte = await Dados.listarEmprestimos();
          if (!pode("TODOS_EMPRESTIMOS")) fonte = fonte.filter((e) => e.estado === "APROVADO");
          if (!fonte.length) { $("emp-lista").innerHTML = vazio("💳", "Nenhum empréstimo."); return; }
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
      <span class="fim"><span class="mt">${e.estado === "PENDENTE" ? "" : (e.emFalta > 0 ? vmt(e.emFalta) : "✓")}</span></span></button>`;
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
        <span class="fim"><span class="mt">${p.estado === "PAGO" ? "✓" : vmt(falta)}</span></span></button>`;
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
      ${!pend && pode("ANULAR_EMPRESTIMO") && e.estado === "APROVADO" && e.jaPago === 0 ? `<button class="btn perigo" id="e-anular" style="margin-top:14px">Anular empréstimo</button>` : ""}
    `);
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
    const op = (id, ic, t, sub) => `<button class="item" data-op="${id}"><span class="avatar" style="background:var(--fundo);color:var(--navy)">${ic}</span><span class="meio"><span class="nome">${t}</span>${sub ? `<span class="det">${sub}</span>` : ""}</span></button>`;
    c.innerHTML = `
      <div class="cartao" style="display:flex;align-items:center;gap:14px">
        <div class="avatar" style="width:54px;height:54px;background:var(--navy)">${esc(R.iniciais(S.user.nome || S.user.utilizador))}</div>
        <div><div style="font-weight:800;font-size:1.1rem">${esc(S.user.nome || S.user.utilizador)}</div>
          <div class="det" style="color:var(--texto-suave)">${perfilNome(S.user.perfil)}${S.user.principal ? " principal" : ""}</div></div>
      </div>
      <div class="seccao-titulo">Gestão</div>
      ${pode("CAIXA") ? op("caixa", "💰", "Fluxo de Caixa", "Saldo, entradas e despesas") : ""}
      ${pode("CAIXA") ? op("poupanca", "🐖", "Poupança de Clientes", "Cofres dos clientes") : ""}
      ${pode("UTILIZADORES") ? op("utilizadores", "🔑", "Utilizadores e Permissões", "") : ""}
      ${pode("CAIXA") ? op("lixeira", "🗑️", "Lixeira", "Lançamentos e pedidos apagados") : ""}
      ${pode("SMS_VER") ? op("sms", "✉️", "SMS enviados", "Cobranças e recados enviados") : ""}
      ${S.user.perfil === "ADMIN" ? op("acessos", "🕘", "Acessos", "Quem entrou e quando") : ""}
      ${op("notificacoes", "🔔", "Notificações", "")}
      <div class="seccao-titulo">Conta</div>
      ${op("perfil", "✏️", "Editar o meu nome", "")}
      ${op("senha", "🔒", "Alterar a minha senha", "")}
      <div class="seccao-titulo">Sistema</div>
      ${op("ligacao", "🔌", "Trocar de ligação", DB.servidorAtual() || "")}
      ${op("sobre", "ℹ️", "Sobre a aplicação", "")}
      ${op("sair", "🚪", "Terminar sessão", "")}`;
    c.querySelectorAll("[data-op]").forEach((b) => b.onclick = () => maisAcao(b.dataset.op));
  }

  async function maisAcao(op) {
    if (op === "caixa") return verCaixa();
    if (op === "poupanca") return verPoupanca();
    if (op === "lixeira") return verLixeira();
    if (op === "sms") return verSms();
    if (op === "acessos") return verAcessos();
    if (op === "utilizadores") return verUtilizadores();
    if (op === "notificacoes") return verNotificacoes();
    if (op === "perfil") return formNome();
    if (op === "senha") return formSenha();
    if (op === "sobre") return verSobre();
    if (op === "ligacao") {
      if (await confirmar("Trocar de ligação", "Vai sair e apagar a ligação deste aparelho.", "Trocar", true)) { DB.apagar(); verLigar(); }
    }
    if (op === "sair") { if (await confirmar("Terminar sessão", "Quer sair da sua conta?", "Sair")) sair(); }
  }

  // ---------- Caixa ----------
  async function verCaixa() {
    cabecalho("Fluxo de Caixa", "", `<button class="icone" id="cx-novo" title="Novo lançamento">＋</button>`);
    $("cx-novo").onclick = () => formCaixa();
    const c = $("conteudo");
    c.innerHTML = spinner;
    try {
      const [s, movs] = await Promise.all([Dados.saldoCaixa(), Dados.ultimosMovimentos(60)]);
      const lista = movs.map((m) => {
        const entrada = m.tipo === "ENTRADA";
        return `<div class="item" style="cursor:default">
          <span class="avatar" style="background:${entrada ? "var(--verde-bg)" : "var(--vermelho-bg)"};color:${entrada ? "var(--verde)" : "var(--vermelho)"}">${entrada ? "↓" : "↑"}</span>
          <span class="meio"><span class="nome">${esc(curto(m.categoria))}</span><span class="det">${esc(m.justificativa || "")}</span>
            <span class="det" style="font-size:.75rem">${R.dataHora(m.dataMovimento)}</span></span>
          <span class="fim"><span class="mt" style="color:${entrada ? "var(--verde)" : "var(--vermelho)"}">${entrada ? "+" : "−"}${vmt(m.valor)}</span></span></div>`;
      }).join("");
      c.innerHTML = `
        <div class="kpis" style="grid-template-columns:1fr">
          <div class="kpi destaque"><div class="rotulo">Saldo em caixa</div><div class="valor" style="font-size:1.6rem">${vmt(s.saldo)}</div></div>
        </div>
        <div class="kpis">
          <div class="kpi"><div class="rotulo">Entradas</div><div class="valor" style="color:var(--verde)">${vmt(s.entradas)}</div></div>
          <div class="kpi"><div class="rotulo">Saídas</div><div class="valor" style="color:var(--vermelho)">${vmt(s.saidas)}</div></div>
        </div>
        <div class="seccao-titulo">Últimos movimentos</div>${lista || vazio("💰", "Sem movimentos.")}`;
    } catch (e) { c.innerHTML = erroEcra(e, verCaixa); }
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
    cabecalho("Utilizadores", "", `<button class="icone" id="u-novo" title="Novo utilizador">＋</button>`);
    $("u-novo").onclick = () => formUtilizador(null);
    const c = $("conteudo");
    c.innerHTML = spinner;
    try {
      const lista = await Dados.listarUtilizadores();
      c.innerHTML = lista.map((u) => `<button class="item" data-uid="${u.id}">
        <span class="avatar">${esc(R.iniciais(u.nome || u.utilizador))}</span>
        <span class="meio"><span class="nome">${esc(u.nome || u.utilizador)}${u.principal ? " ⭐" : ""}</span>
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
        <span class="avatar" style="background:var(--fundo);color:var(--navy)">🔔</span>
        <span class="meio"><span class="nome">${esc(n.titulo || "Notificação")}</span><span class="det" style="white-space:normal">${esc(n.mensagem || "")}</span>
          <span class="det" style="font-size:.74rem">${R.dataHora(n.data)}</span></span></div>`).join("") : vazio("🔔", "Sem notificações.");
    } catch (e) { c.innerHTML = vazio("🔔", "Sem notificações."); }
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
        : vazio("🐖", "Ainda não há poupança de clientes.");
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
        <span class="avatar" style="background:${dep ? "var(--verde-bg)" : "var(--laranja-bg)"};color:${dep ? "var(--verde)" : "var(--laranja)"}">${dep ? "＋" : "−"}</span>
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
          if (!lista.length) { $("lix-lista").innerHTML = vazio("🗑️", "O lixo do caixa está vazio."); return; }
          $("lix-lista").innerHTML = lista.map((m) => {
            const entrada = m.tipo === "ENTRADA";
            return `<div class="item" style="cursor:default;align-items:flex-start">
              <span class="avatar" style="background:var(--fundo);color:var(--texto-suave)">🗑️</span>
              <span class="meio"><span class="nome">#${m.caixaId} · ${esc(curto(m.categoria))}</span>
                <span class="det" style="white-space:normal">${esc(m.justificativa || "")}</span>
                <span class="det" style="font-size:.74rem">Apagado por ${esc(m.eliminadoPor || "—")} · ${R.dataHora(m.eliminadoEm)}${m.anulado ? " · pagamento anulado" : ""}</span>
                <span style="display:flex;gap:8px;margin-top:8px">
                  <button class="btn secundario" data-restaurar="${m.id}" data-anul="${m.anulado}" style="margin:0;padding:8px 12px;width:auto;font-size:.82rem">↩ Restaurar</button>
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
          if (!lista.length) { $("lix-lista").innerHTML = vazio("🗑️", "Não há pedidos rejeitados."); return; }
          $("lix-lista").innerHTML = lista.map((e) => `<div class="item" style="cursor:default;align-items:flex-start">
            <span class="avatar">${esc(R.iniciais(e.nomeCliente))}</span>
            <span class="meio"><span class="nome">${esc(e.nomeCliente)} · #${e.id}</span>
              <span class="det">${vmt(e.capital)} · pedido ${R.data(e.dataPedido)}</span>
              <span class="det" style="font-size:.74rem">Rejeitado por ${esc(e.rejeitadoPor || "—")} · ${R.dataHora(e.rejeitadoEm)}</span>
              <span style="display:flex;gap:8px;margin-top:8px">
                <button class="btn secundario" data-rest="${e.id}" data-cli="${e.clienteId}" style="margin:0;padding:8px 12px;width:auto;font-size:.82rem">↩ Restaurar</button>
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
      if (lista === null) { c.innerHTML = vazio("✉️", "Esta base de dados não tem registo de SMS.\n(Os SMS são enviados pela app no telemóvel Android.)"); return; }
      if (!lista.length) { c.innerHTML = vazio("✉️", "Ainda não há SMS enviados."); return; }
      c.innerHTML = lista.map((s) => {
        const ok = s.estado === "ENVIADO";
        return `<div class="item" style="cursor:default;align-items:flex-start">
          <span class="avatar" style="background:${ok ? "var(--verde-bg)" : "var(--vermelho-bg)"};color:${ok ? "var(--verde)" : "var(--vermelho)"}">✉️</span>
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
      if (!lista.length) { c.innerHTML = vazio("🕘", "Sem registos de acesso."); return; }
      const cor = { ENTRADA: "var(--verde)", SAIDA: "var(--texto-suave)", FALHADA: "var(--vermelho)", BLOQUEIO: "var(--vermelho)", CONTA_DESATIVADA: "var(--vermelho)" };
      c.innerHTML = lista.map((a) => `<div class="item" style="cursor:default">
        <span class="avatar" style="background:var(--fundo);color:var(--texto-suave)">${a.dispositivo === "TELEMOVEL" ? "📱" : "💻"}</span>
        <span class="meio"><span class="nome">${esc(a.utilizador || "—")}</span>
          <span class="det">${esc(a.perfil || "")}${a.detalhe ? " · " + esc(a.detalhe) : ""}</span>
          <span class="det" style="font-size:.74rem">${R.dataHora(a.dataHora)}</span></span>
        <span class="fim"><span class="etiqueta e-neutro" style="color:${cor[a.evento] || "var(--texto-suave)"}">${esc(a.evento)}</span></span></div>`).join("");
    } catch (e) { c.innerHTML = erroEcra(e, verAcessos); }
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
  const curto = (cat) => ({ PRESTACAO: "Pagamento", DESEMBOLSO: "Desembolso", CAPITAL: "Entrada de capital", DESPESA: "Despesa", POUPANCA: "Poupança" }[cat] || cat || "Movimento");
  function erroEcra(e, retry) {
    window.__retry = retry;
    return `<div class="vazio"><span class="ic">⚠️</span>${esc(e.message || "Erro ao carregar.")}<br><br>
      <button class="btn secundario" style="max-width:220px;margin:14px auto 0" onclick="window.__retry&&window.__retry()">Tentar de novo</button></div>`;
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
