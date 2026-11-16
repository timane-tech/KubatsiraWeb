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
    ["SMS_AUTOMATICO", "SMS de cobrança automático", false],
  ];
  // Não vêm no padrão do Administrador (Permissoes.FORA_DO_PADRAO + as reservadas ao principal)
  const RESERVADAS = new Set(["UTILIZADORES", "SMS_AUTOMATICO"]);
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
    // Entrar sem senha: a conta ligada a este aparelho (só uma, como no Android)
    ligarEntrada(uid, nome) { try { localStorage.setItem("kub_bio_entrada", JSON.stringify({ uid, nome })); } catch (e) {} },
    desligarEntrada() { try { localStorage.removeItem("kub_bio_entrada"); } catch (e) {} },
    contaEntrada() {
      try { const c = JSON.parse(localStorage.getItem("kub_bio_entrada") || "null"); return c && this.ativa(c.uid) ? c : null; }
      catch (e) { return null; }
    },
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

  // Ícones cheios (Material Icons, como na barra e nos menus da app Android)
  const ICONES_CHEIOS = {
    inicio: "M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z",
    cobrancas: "M20 3h-1V1h-2v2H7V1H5v2H4c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 18H4V8h16v13z",
    clientes: "M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z",
    caixa: "M19 14V6c0-1.1-.9-2-2-2H3c-1.1 0-2 .9-2 2v8c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zm-9-1c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm13-6v11c0 1.1-.9 2-2 2H4v-2h17V7h2z",
    credito: "M20 4H4c-1.11 0-1.99.89-1.99 2L2 18c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V6c0-1.11-.89-2-2-2zm0 14H4v-6h16v6zm0-10H4V6h16v2z",
    mais: "M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z",
    balanco: "M5 9.2h3V19H5zM10.6 5h2.8v14h-2.8zm5.6 8H19v6h-2.8z",
    editar: "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z",
    pasta: "M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z",
    visto: "M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z",
    cadeado: "M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z",
    cofre: "M20 3H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2v1h2v-1h12v1h2v-1c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 14H4V5h16v12zM7 7h7v6H7zm2 2v2h3V9zm7-2h2v6h-2z",
    lixo: "M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zm2.46-7.12 1.41-1.41L12 12.59l2.12-2.12 1.41 1.41L13.41 14l2.12 2.12-1.41 1.41L12 15.41l-2.12 2.12-1.41-1.41L10.59 14l-2.13-2.12zM15.5 4l-1-1h-5l-1 1H5v2h14V4z",
    escudo: "M12 1 3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z",
    mensagem: "M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 9h12v2H6V9zm8 5H6v-2h8v2zm4-6H6V6h12v2z",
    chave: "M12.65 10A5.99 5.99 0 0 0 7 6c-3.31 0-6 2.69-6 6s2.69 6 6 6a5.99 5.99 0 0 0 5.65-4H17v4h4v-4h2v-4H12.65zM7 14c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z",
    olhofechado: "M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46A11.8 11.8 0 0 0 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78 3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z",
    olhoaberto: "M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z",
    engrenagem: "M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.48.48 0 0 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.48.48 0 0 0-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z",
    telefone: "M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z",
    local: "M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 0 1 0-5 2.5 2.5 0 0 1 0 5z",
    aviso: "M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z",
    calendario: "M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V10h14v10zM9 14H7v-2h2v2zm4 0h-2v-2h2v2zm4 0h-2v-2h2v2zm-8 4H7v-2h2v2zm4 0h-2v-2h2v2zm4 0h-2v-2h2v2z",
    atualizar: "M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z",
    documento: "M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z",
    tendencia: "m16 6 2.29 2.29-4.88 4.88-4-4L2 16.59 3.41 18l6-6 4 4 6.3-6.29L22 12V6z",
    sino: "M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z",
    porta: "M10.09 15.59 11.5 17l5-5-5-5-1.41 1.41L12.67 11H3v2h9.67l-2.58 2.59zM19 3H5a2 2 0 0 0-2 2v4h2V5h14v14H5v-4H3v4a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z",
    robo: "M20 9V7c0-1.1-.9-2-2-2h-3c0-1.66-1.34-3-3-3S9 3.34 9 5H6c-1.1 0-2 .9-2 2v2c-1.66 0-3 1.34-3 3s1.34 3 3 3v4c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-4c1.66 0 3-1.34 3-3s-1.34-3-3-3zM7.5 11.5c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5S9.83 13 9 13s-1.5-.67-1.5-1.5zM16 17H8v-2h8v2zm-1-4c-.83 0-1.5-.67-1.5-1.5S14.17 10 15 10s1.5.67 1.5 1.5S15.83 13 15 13z",
  };
  function icf(nome, tam) {
    const d = ICONES_CHEIOS[nome];
    if (!d) return ic(nome, tam);
    const s = tam || 22;
    return `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="currentColor" style="vertical-align:middle;flex:none;display:inline-block"><path d="${d}"/></svg>`;
  }

  // Cor do avatar a partir do nome — a mesma fórmula do Android (Ui.corAvatar, String.hashCode do Java):
  // o mesmo cliente tem a mesma cor no telemóvel, no iPhone e no computador.
  const CORES_AVATAR = ["#2F80ED", "#1E9A55", "#6E3CB4", "#E6821E", "#19969F", "#D2466E", "#5A6E8C"];
  function corAvatar(nome) {
    const s = nome || "";
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
    return CORES_AVATAR[Math.abs(h) % CORES_AVATAR.length];
  }
  const avatar = (nome, tam) => `<span class="av" style="background:${corAvatar(nome)}${tam ? `;width:${tam}px;height:${tam}px` : ""}">${esc(R.iniciais(nome))}</span>`;

  // Pares [texto, fundo] (seguem o tema claro/escuro, como as cores do colors.xml)
  const CORES = {
    azul: ["var(--accent)", "var(--accent-bg)"], verde: ["var(--verde)", "var(--verde-bg)"],
    vermelho: ["var(--vermelho)", "var(--vermelho-bg)"], laranja: ["var(--laranja)", "var(--laranja-bg)"],
    roxo: ["var(--roxo)", "var(--roxo-bg)"], cinzento: ["var(--texto-suave)", "var(--cinzento-claro)"],
  };
  // Cores [texto, fundo] de uma situação (Ui.coresSituacao)
  function coresSituacao(sit) {
    switch (sit) {
      case "Em curso": case "Por pagar": case "No prazo": return CORES.azul;
      case "Com atraso": case "Em atraso": case "Rejeitado": return CORES.vermelho;
      case "Por aprovar": case "Vence hoje": return CORES.laranja;
      case "Concluído": case "Paga": case "Pago": return CORES.verde;
      default: return CORES.cinzento;
    }
  }
  const pilula = (texto, cores) => `<span class="pilula" style="color:${cores[0]};background:${cores[1]}">${esc(texto)}</span>`;

  // Botões do cabeçalho das abas (como no Android: ↻ redondo e pílula "PDF")
  const btnAtualizar = (id) => `<button class="icone" id="${id}" title="Atualizar">${icf("atualizar", 21)}</button>`;
  const btnPdf = (id) => `<button class="pilula-cab" id="${id}" title="Exportar PDF">${icf("documento", 17)} PDF</button>`;

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
    // Primeira utilização neste aparelho: tem de aceitar os Termos e Condições (como na app)
    if (!termosAceites()) { verTermos(true, verLogin); return; }
    mostrar("ecra-login");
    const bioConta = Bio.contaEntrada();
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
            ${bioConta ? `<button class="btn contorno" id="l-bio" type="button" title="${esc(bioConta.nome || "")}">👆 Entrar com Face ID / impressão digital</button>` : ""}
          </form>
        </div>
        <div class="linha-link"><a id="l-idioma">🌐 ${Idioma.emIngles() ? "Português" : "English"}</a> · <a id="l-trocar">Trocar de ligação</a></div>
      </div>`;
    $("l-idioma").onclick = () => { Idioma.definir(Idioma.emIngles() ? "pt" : "en"); verLogin(); };
    if ($("l-bio")) $("l-bio").onclick = async () => {
      $("l-erro").textContent = "";
      try {
        await Bio.verificar(bioConta.uid);
        const user = await Dados.obterUtilizador(bioConta.uid);
        if (!user) { Bio.desligarEntrada(); $("l-erro").textContent = "A conta ligada ao Face ID / impressão digital já não existe. Entre com o utilizador e a senha."; return; }
        await entrar(user);
      } catch (e) { $("l-erro").textContent = e && e.name === "NotAllowedError" ? "Cancelado." : (e.message || "Não foi possível confirmar a identidade."); }
    };
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
        await entrar(user);
        if ($("l-btn")) $("l-btn").disabled = false;
      } catch (e) {
        $("l-erro").textContent = e.message || "Sem ligação. Verifique a Internet.";
        $("l-btn").disabled = false;
      }
    };
  }

  // Depois de confirmada a identidade: conta ativa? licença? (como o LoginActivity)
  async function entrar(user) {
    if (!user.ativo) { $("l-erro").textContent = "Esta conta está desativada. Contacte o Administrador."; return; }
    user.principal = user.id === (await Dados.idAdminPrincipal());
    let lic = null;
    try { lic = await Dados.licencaEstado(); } catch (e) {}
    if (lic && lic.expirada && user.perfil !== "ADMIN") { verManutencao(); return; }
    iniciarSessao(user);
    if (lic && lic.expirada) verLicenca(true);   // o Administrador tem de pagar antes de usar o sistema
  }

  function iniciarSessao(user) {
    S.user = user;
    S.perms = calcularPerms(user);
    Dados._nome = user.nome || user.utilizador;   // autor dos registos de edição
    S.cliente = user.perfil === "CLIENTE";
    S.ocultar = true;   // como no Android: cada sessão começa com os valores ocultos (Mostrar valores pede a identidade)
    mostrar("ecra-app");
    construirBarra();
    Dados.fotoPerfil(user.id).then((f) => { S.user.foto = f || ""; const a = $("cb-avatar"); if (a && f) pintarAvatar(a, f); }).catch(() => {});
    if (S.cliente) navegar("inicio");
    else navegar(pode("BALANCO") ? "inicio" : (pode("COBRANCAS") ? "cobrancas" : "clientes"));
  }

  function sair() {
    S.user = null; S.perms = new Set();
    $("barra-inferior").classList.remove("escondida");
    fecharFolha();
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

  const ABAS_CLIENTE = [
    { id: "inicio", ic: "inicio", rot: "Início" },
    { id: "pedir", ic: "credito", rot: "Pedir crédito" },
    { id: "mais", ic: "mais", rot: "Mais" },
  ];

  function tabsBarra() {
    if (S.cliente) return ABAS_CLIENTE;
    // Igual ao Android (BarraInferior): cada separador só aparece com a permissão correspondente
    const l = [{ id: "inicio", ic: "inicio", rot: "Início" }];
    if (pode("COBRANCAS")) l.push({ id: "cobrancas", ic: "cobrancas", rot: pode("PAGAR_PRESTACAO") ? "Prestações" : "Cobranças" });
    if (pode("CLIENTES")) l.push({ id: "clientes", ic: "clientes", rot: "Clientes" });
    if (pode("CAIXA")) l.push({ id: "caixa", ic: "caixa", rot: "Caixa" });
    l.push({ id: "mais", ic: "mais", rot: "Mais" });
    return l;
  }

  function construirBarra() {
    const b = $("barra-inferior");
    b.innerHTML = "";
    tabsBarra().forEach((a) => {
      const btn = el(`<button data-aba="${a.id}"><span class="ic">${icf(a.ic, 24)}</span><span>${a.rot}</span></button>`);
      btn.onclick = () => navegar(a.id);
      b.appendChild(btn);
    });
    if (!$("fab-ia-btn")) {
      const f = el(`<button class="fab-ia" id="fab-ia-btn">${icf("robo", 20)} IA</button>`);
      f.onclick = () => (S.cliente ? verAssistente() : verAssistente());
      $("ecra-app").appendChild(f);
    }
    $("fab-ia-btn").classList.toggle("oculto", !usarIA());   // Configurações › Assistente de IA
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

  // Área de conteúdo nova para cada ecrã: um ecrã que ainda estava a carregar (ex.: Início lento)
  // escreve na área antiga, que já saiu da página, e não por cima do ecrã que o utilizador abriu.
  function novoConteudo() {
    const velho = $("conteudo");
    const novo = velho.cloneNode(false);
    novo.className = "conteudo";
    novo.removeAttribute("style");
    velho.replaceWith(novo);
    const fab = $("fab-ia-btn");   // o botão IA aparece em todos os ecrãs (menos no próprio Assistente)
    if (fab && S.user) fab.classList.toggle("oculto", !usarIA());
    return novo;
  }

  function navegar(aba) {
    const mudou = S.ecra !== aba;
    S.ecra = aba;
    [...$("barra-inferior").children].forEach((b) => b.classList.toggle("ativo", b.dataset.aba === aba));
    if (mudou) animarLogo();
    window.scrollTo(0, 0);
    if (S.cliente) {
      if (aba === "inicio") verClienteInicio();
      else if (aba === "pedir") verClientePedir();
      else if (aba === "mais") verClienteMais();
      return;
    }
    if (aba === "inicio") verInicio();
    else if (aba === "cobrancas") verCobrancas();
    else if (aba === "clientes") verClientes();
    else if (aba === "caixa") verCaixa();
    else if (aba === "emprestimos") verEmprestimos();
    else if (aba === "mais") verMais();
  }

  // Cabeçalho como no Android: título + subtítulo e, à direita, os botões do ecrã (↻, PDF, +…).
  // Mostrar/ocultar valores fica no Início (pílula) e no menu Mais, como na app.
  function cabecalho(titulo, sub, acoes) {
    $("cabecalho").className = "cabecalho";
    $("cabecalho").innerHTML = `
      <div style="flex:1;min-width:0">
        <div class="titulo">${esc(titulo)}</div>
        ${sub ? `<div class="sub">${esc(sub)}</div>` : ""}
      </div>
      ${acoes ? `<div class="cab-acoes">${acoes}</div>` : ""}`;
  }

  // Mostrar/ocultar valores (pede Face ID / Touch ID para mostrar, se estiver ativo)
  async function alternarValores(depois) {
    if (S.ocultar && Bio.ativa(S.user.id)) {
      try { await Bio.verificar(S.user.id); }
      catch (e) { toast("Não foi possível confirmar a identidade.", true); return; }
    }
    S.ocultar = !S.ocultar;
    (depois || (() => navegar(S.ecra)))();
  }

  // Donut SVG (gráfico de estado). segs = [{rotulo, valor, cor}]. Identidade por legenda, não só por cor.
  function donutSVG(segs, centroTitulo, centroValor) {
    const total = segs.reduce((s, x) => s + x.valor, 0) || 1;
    const r = 52, cx = 70, cy = 70, C = 2 * Math.PI * r;
    let off = 0;
    const aneis = segs.filter((s) => s.valor > 0).map((s) => {
      const len = (s.valor / total) * C;
      const el = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" style="stroke:${s.cor}" stroke-width="18"
        stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}"
        transform="rotate(-90 ${cx} ${cy})"><title>${esc(s.rotulo)}: ${s.valor}</title></circle>`;
      off += len; return el;
    }).join("");
    // Legenda como no Android: ● Pagas / "50 · 56%"
    const legenda = segs.map((s) => `<div class="l"><span class="p" style="background:${s.cor}"></span>
      <div><div class="t">${esc(s.rotulo)}</div><div class="n">${s.valor} · ${Math.round((s.valor / total) * 100)}%</div></div></div>`).join("");
    return `<div style="display:flex;gap:18px;align-items:center">
      <svg viewBox="0 0 140 140" width="150" height="150" style="flex:none">
        <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" style="stroke:var(--cinzento-claro)" stroke-width="18"></circle>
        ${aneis}
        <text x="${cx}" y="${cy + 3}" text-anchor="middle" font-size="22" font-weight="800" style="fill:var(--texto)">${centroValor}</text>
        <text x="${cx}" y="${cy + 18}" text-anchor="middle" font-size="9" style="fill:var(--texto-suave)">${esc(centroTitulo)}</text>
      </svg>
      <div class="leg-donut" style="flex:1;min-width:0">${legenda}</div></div>`;
  }

  // ---------- Eixos dos gráficos (como no Android: 0 · 125 k · 250 k · 375 k · 500 k) ----------
  // Passo "redondo" (1,25; 2,5; 5 × 10^n, como no Android) para 4 intervalos que cobrem o máximo.
  function escalaEixo(max) {
    if (!(max > 0)) return { passo: 1, topo: 4 };
    const bruto = max / 4;
    const p = Math.pow(10, Math.floor(Math.log10(bruto)));
    const passo = [1.25, 2.5, 5, 12.5].map((f) => f * p).find((v) => v >= bruto - 1e-9);
    return { passo, topo: passo * 4 };
  }
  // 165680 -> "165,68 k"; 125000 -> "125 k"; 200 -> "200"
  function numCurto(v) {
    if (Math.abs(v) >= 1000) {
      const k = Math.round((v / 1000) * 100) / 100;
      return k.toLocaleString("pt-PT", { maximumFractionDigits: 2 }).replace(/ /g, " ") + " k";
    }
    return Math.round(v).toLocaleString("pt-PT");
  }
  // Grelha + rótulos do eixo Y. Devolve {svg, y(v)} para a área de desenho [x0..x1] × [yTopo..yBase]
  function grelhaY(max, x0, x1, yTopo, yBase) {
    const { passo, topo } = escalaEixo(max);
    const y = (v) => yBase - (v / topo) * (yBase - yTopo);
    let svg = "";
    for (let i = 0; i <= 4; i++) {
      const v = passo * i, yy = y(v).toFixed(1);
      svg += `<line x1="${x0}" y1="${yy}" x2="${x1}" y2="${yy}" style="stroke:var(--borda)" stroke-width="1"/>` +
        `<text x="${x0 - 6}" y="${(+yy + 3.5).toFixed(1)}" text-anchor="end" font-size="10" style="fill:var(--texto-suave)">${numCurto(v)}</text>`;
    }
    return { svg, y };
  }

  // ---------- Saudação e data ----------
  function saudacao() {
    const h = new Date().getHours();
    return h < 12 ? "Bom dia" : h < 19 ? "Boa tarde" : "Boa noite";
  }
  function dataExtenso() {
    const dias = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];
    const meses = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
    const d = new Date();
    if (Idioma.emIngles()) return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
    return `${dias[d.getDay()]}, ${d.getDate()} de ${meses[d.getMonth()]}`;
  }

  // Gráfico de linha/área (evolução). pontos = [{saldo}]
  // Linha/área com eixos (evolução do saldo, 30 dias). pontos = [{dia, saldo}]
  function svgLinha(pontos) {
    const W = 340, H = 200, x0 = 46, x1 = W - 10, yTopo = 10, yBase = H - 26;
    const max = Math.max(1, ...pontos.map((p) => p.saldo));
    const g = grelhaY(max, x0, x1, yTopo, yBase);
    const n = pontos.length;
    const x = (i) => x0 + (i * (x1 - x0)) / Math.max(1, n - 1);
    const y = (v) => Math.min(yBase, g.y(Math.max(0, v)));
    const linha = pontos.map((p, i) => `${x(i).toFixed(1)},${y(p.saldo).toFixed(1)}`);
    const area = `M ${x(0).toFixed(1)},${yBase} L ${linha.join(" L ")} L ${x(n - 1).toFixed(1)},${yBase} Z`;
    let datas = "";
    for (let i = 0; i < n; i += 6) {
      const d = pontos[i].dia || "";
      datas += `<text x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="10" style="fill:var(--texto-suave)">${d.slice(8, 10)}/${d.slice(5, 7)}</text>`;
    }
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block;height:auto">
      <defs><linearGradient id="gl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2f80ed" stop-opacity=".22"/><stop offset="1" stop-color="#2f80ed" stop-opacity=".02"/></linearGradient></defs>
      ${g.svg}<path d="${area}" fill="url(#gl)"/>
      <polyline points="${linha.join(" ")}" fill="none" stroke="#2f80ed" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${x(n - 1).toFixed(1)}" cy="${y(pontos[n - 1].saldo).toFixed(1)}" r="4.5" fill="#2f80ed"/>${datas}
    </svg>`;
  }

  // Barras agrupadas com eixos (Entradas / Empréstimos / Despesas por mês). dados = [{mes, entradas, emprestimos, despesas}]
  function svgBarrasAgrupadas(dados) {
    const W = 340, H = 210, x0 = 46, x1 = W - 8, yTopo = 10, yBase = H - 26;
    const max = Math.max(1, ...dados.flatMap((d) => [d.entradas, d.emprestimos, d.despesas]));
    const g = grelhaY(max, x0, x1, yTopo, yBase);
    const gw = (x1 - x0) / dados.length;
    const bw = Math.min(11, gw / 4.2);
    const cores = ["var(--verde)", "var(--roxo)", "var(--vermelho)"];
    let barras = "", rotulos = "";
    dados.forEach((d, i) => {
      const gx = x0 + i * gw + gw / 2;
      [d.entradas, d.emprestimos, d.despesas].forEach((v, j) => {
        const yy = g.y(Math.max(0, v));
        const bx = gx - (bw * 3 + 2.4) / 2 + j * (bw + 1.2);
        barras += `<rect x="${bx.toFixed(1)}" y="${yy.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0, yBase - yy).toFixed(1)}" rx="1.5" style="fill:${cores[j]}"/>`;
      });
      rotulos += `<text x="${gx.toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="10" style="fill:var(--texto-suave)">${esc(d.mes)}</text>`;
    });
    return `<div class="legenda-grafico"><span><i style="background:var(--verde)"></i>Entradas</span><span><i style="background:var(--roxo)"></i>Empréstimos</span><span><i style="background:var(--vermelho)"></i>Despesas</span></div>
      <svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block;height:auto">${g.svg}${barras}${rotulos}</svg>`;
  }

  // Barras verticais com eixos e o valor por cima (Cobranças previstas). mapa = Map(rótulo -> valor)
  function svgBarrasVert(mapa) {
    const W = 340, H = 210, x0 = 46, x1 = W - 8, yTopo = 14, yBase = H - 26;
    const itens = [...mapa.entries()];
    const max = Math.max(1, ...itens.map(([, v]) => v));
    const g = grelhaY(max, x0, x1, yTopo, yBase);
    const gw = (x1 - x0) / Math.max(1, itens.length);
    const bw = Math.min(18, gw * .45);
    let barras = "", rotulos = "";
    itens.forEach(([rot, v], i) => {
      const gx = x0 + i * gw + gw / 2;
      if (v > 0) {
        const yy = g.y(v);
        barras += `<rect x="${(gx - bw / 2).toFixed(1)}" y="${yy.toFixed(1)}" width="${bw.toFixed(1)}" height="${(yBase - yy).toFixed(1)}" rx="1.5" style="fill:${i === 0 ? "var(--vermelho)" : "var(--roxo)"}"/>` +
          `<text x="${gx.toFixed(1)}" y="${(yy - 5).toFixed(1)}" text-anchor="middle" font-size="9.5" style="fill:var(--texto-suave)">${numCurto(v)}</text>`;
      }
      rotulos += `<text x="${gx.toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="10" style="fill:var(--texto-suave)">${esc(rot)}</text>`;
    });
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block;height:auto">${g.svg}${barras}${rotulos}</svg>`;
  }

  // Barras horizontais (Top 5 clientes: GraficoBarrasH). lista = [{nome, total}]
  function barrasHorizontais(lista) {
    if (!lista.length) return `<div class="vazio" style="padding:20px">Sem dados.</div>`;
    const max = Math.max(1, ...lista.map((x) => x.total));
    return lista.map((x) => {
      const pct = Math.max(2, (x.total / max) * 100);
      const dentro = pct > 62;   // o valor vai dentro da barra quando ela é comprida
      return `<div class="barra-h"><span class="n">${esc(x.nome)}</span><span class="tr">
        <span class="pr" style="width:${pct.toFixed(1)}%"></span>
        <span class="vl" style="${dentro ? `right:${(100 - pct + 1).toFixed(1)}%;color:#fff` : `left:calc(${pct.toFixed(1)}% + 6px)`}">${numCurto(x.total)}</span></span></div>`;
    }).join("");
  }

  const ocultoCartao = () => `<div style="text-align:center;color:var(--texto-suave);padding:26px 0 30px;font-weight:500">🔒 Valores ocultos</div>`;

  // ============================================================
  // ECRÃ: INÍCIO (Balanço ou Cobranças)
  // ============================================================
  // Painel inicial: Administrador (PainelAdminActivity) ou Agente (PainelAgenteActivity), como no Android.
  async function verInicio() {
    const nome = S.user.nome || S.user.utilizador;
    const c = novoConteudo();
    c.innerHTML = spinner;
    const sinoOn = await Dados.sinoAtivo().catch(() => true);
    if (!c.isConnected) return;   // entretanto o utilizador abriu outro ecrã
    $("cabecalho").className = "cabecalho cab-painel";
    $("cabecalho").innerHTML = `
      <div class="cab-topo">
        <div class="avatar" id="cb-avatar" style="background-color:${corAvatar(nome)}">${esc(R.iniciais(nome))}</div>
        <div class="cab-saud"><div class="ola">${esc(saudacao())},</div><div class="data">${esc(dataExtenso())}</div></div>
        <button class="icone" id="cb-atualizar" title="Atualizar">${icf("atualizar", 21)}</button>
        ${sinoOn ? `<button class="icone" id="cb-sino" title="Notificações">${icf("sino", 21)}<span class="badge-sino oculto" id="cb-badge"></span></button>` : ""}
        <button class="icone" id="cb-sair" title="Sair">${icf("porta", 21)}</button>
      </div>
      <span class="pilula-perfil">Painel do ${esc(perfilNome(S.user.perfil))}</span>`;
    pintarAvatar($("cb-avatar"), S.user.foto);
    $("cb-atualizar").onclick = () => verInicio();
    if ($("cb-sino")) $("cb-sino").onclick = () => verNotificacoes();
    $("cb-sair").onclick = async () => { if (await confirmar("Terminar sessão", "Quer sair da sua conta?", "Sair")) sair(); };
    if (sinoOn) atualizarBadgeSino();
    const hoje = R.hojeISO();
    const aviso = (texto, cores, id) => `<div class="aviso-painel"${id ? ` id="${id}" style="cursor:pointer;color:${cores[0]};background:${cores[1]}"` : ` style="color:${cores[0]};background:${cores[1]}"`}>${texto}</div>`;
    const kpi = (rot, txt, cor) => `<div class="kpi-card" style="--cor:${cor}"><div class="rotulo">${esc(rot)}</div><div class="valor">${txt}</div></div>`;
    try {
      // ---------------- Agente ----------------
      if (S.user.perfil === "AGENTE") {
        const [cobrar, clientes] = await Promise.all([pode("COBRANCAS") ? Dados.listarCobrancas(hoje) : [], Dados.listarClientes("")]);
        const atrasadas = cobrar.filter((p) => R.diasAtraso(p.vencimento, hoje) > 0).length;
        c.innerHTML = `
          <div class="kpis-scroll">${kpi("Cobrar hoje", String(cobrar.length - atrasadas), "var(--accent)")}${kpi("Em atraso", String(atrasadas), atrasadas > 0 ? "var(--vermelho)" : "var(--verde)")}${kpi("Clientes", String(clientes.length), "var(--roxo)")}</div>
          ${atrasadas > 0 ? aviso(`⚠ Há <b>${atrasadas} prestação(ões) em atraso</b>. Comece pelas mais antigas (estão no topo da lista).`, CORES.vermelho) : ""}
          <div class="seccao-titulo">Cobrar hoje e em atraso</div>
          ${cobrar.length ? cobrar.slice(0, 8).map((p) => cartaoCobranca(p, hoje)).join("") : `<div class="vazio" style="padding:20px">✓ Não há cobranças para hoje.</div>`}`;
        ligarCartoesCobranca(c, cobrar, verInicio);
        return;
      }

      // ---------------- Administrador ----------------
      const verFin = pode("CAIXA") || pode("BALANCO");
      const [pendentes, porPagar, saldo, lic] = await Promise.all([
        pode("APROVACOES") ? Dados.listarPendentes() : [], Dados.listarPorPagar(),
        verFin ? Dados.saldoCaixa() : null, Dados.licencaEstado().catch(() => null)]);
      let emDivida = 0, emAtraso = 0;
      porPagar.forEach((p) => { const f = R.emFalta(p, hoje); emDivida += f; if (R.diasAtraso(p.vencimento, hoje) > 0) emAtraso += f; });
      let kpis = "", avisos = "";
      if (verFin) {
        kpis += kpi("Saldo em caixa", vmt(saldo.saldo), saldo.saldo >= 0 ? "var(--accent)" : "var(--vermelho)");
        if (saldo.saldo <= 0 && saldo.entradas === 0)
          avisos += aviso("💡 O caixa está vazio. Registe o <b>capital investido</b> no <b>Caixa</b> antes de aprovar créditos.", CORES.azul);
      }
      if (pode("APROVACOES")) kpis += kpi("Por aprovar", String(pendentes.length), pendentes.length ? "var(--laranja)" : "var(--verde)");
      if (pode("BALANCO")) {
        kpis += kpi("Em dívida", vmt(emDivida), "var(--roxo)");
        kpis += kpi("Em atraso", vmt(emAtraso), emAtraso > 0 ? "var(--vermelho)" : "var(--verde)");
      }
      if (lic && lic.aExpirar && S.user.perfil === "ADMIN") {
        const quando = lic.diasRestantes === 0 ? "hoje" : lic.diasRestantes === 1 ? "amanhã" : "daqui a " + lic.diasRestantes + " dias";
        avisos += aviso(`⚠ A licença do sistema expira <b>${quando}</b> (${R.data(lic.expiracao)}). Pague em <b>Mais › Licença</b> para evitar que o sistema entre em manutenção.`, CORES.laranja, "ini-lic");
      }

      let balanco = "", dadosBal = null;
      if (pode("BALANCO")) {
        dadosBal = await Promise.all([Dados.balanco(), Dados.cobrancasPrevistas(), Dados.graficoEntradasSaidas(), Dados.graficoEvolucaoCaixa()]);
        const [ind, cob, es, ev] = dadosBal;
        balanco = `
          <div class="linha-seccao"><div class="seccao-titulo">Balanço</div>
            <button class="pilula-btn" id="bal-olho">${icf(S.ocultar ? "olhoaberto" : "olhofechado", 15)} ${S.ocultar ? "Mostrar valores" : "Ocultar"}</button></div>
          ${graficosBalanco(ind, cob, es, ev)}
          <button class="btn-contorno" id="bal-completo">${icf("balanco", 18)} Ver o balanço completo</button>`;
      }

      let cobrancas = "", aCobrar = [];
      if (pode("COBRANCAS")) {
        aCobrar = await Dados.listarCobrancas(hoje);
        cobrancas = `<div class="linha-seccao"><div class="seccao-titulo">Cobrar hoje e em atraso (${aCobrar.length})</div>
            ${aCobrar.length > 5 ? `<button class="pilula-btn" id="ini-todas">Ver todas ›</button>` : ""}</div>
          ${aCobrar.length ? aCobrar.slice(0, 5).map((p) => cartaoCobranca(p, hoje)).join("") : `<div class="vazio" style="padding:20px">✓ Não há cobranças para hoje.</div>`}`;
      }

      const pedidos = pode("APROVACOES") ? `<div class="seccao-titulo">Pedidos à espera de aprovação (${pendentes.length})</div>
        ${pendentes.length ? pendentes.map(cartaoEmprestimo).join("") : `<div class="vazio" style="padding:20px">✓ Não há pedidos à espera de aprovação.</div>`}` : "";

      c.innerHTML = `${kpis ? `<div class="kpis-scroll">${kpis}</div>` : ""}${avisos}${balanco}${cobrancas}${pedidos}`;
      if ($("bal-olho")) $("bal-olho").onclick = () => alternarValores(verInicio);
      if ($("bal-completo")) $("bal-completo").onclick = () => verBalanco();
      if ($("ini-todas")) $("ini-todas").onclick = () => navegar("cobrancas");
      if ($("ini-lic")) $("ini-lic").onclick = () => verLicenca(false);
      ligarCartoesCobranca(c, aCobrar, verInicio);
      c.querySelectorAll(".cl[data-eid]").forEach((b) => b.onclick = () => abrirEmprestimo(pendentes.find((x) => x.id == b.dataset.eid), verInicio));
    } catch (e) { c.innerHTML = erroEcra(e, verInicio); }
  }

  // Os 4 gráficos principais do balanço (ecrã inicial e Balanço Geral)
  function graficosBalanco(ind, cob, es, ev) {
    const donut = donutSVG([
      { rotulo: "Pagas", valor: ind.prestacoesPagas, cor: "var(--verde)" },
      { rotulo: "No prazo", valor: ind.prestacoesNoPrazo, cor: "var(--accent)" },
      { rotulo: "Em atraso", valor: ind.prestacoesAtrasadas, cor: "var(--vermelho)" },
    ], "prestações", ind.prestacoesPagas + ind.prestacoesNoPrazo + ind.prestacoesAtrasadas);
    return `
      <div class="grafico-cartao"><h3>Entradas vs Saídas</h3><div class="sub">Últimos 6 meses · empréstimos e despesas separados</div>${S.ocultar ? ocultoCartao() : svgBarrasAgrupadas(es)}</div>
      <div class="grafico-cartao"><h3>Evolução do saldo em caixa</h3><div class="sub">Últimos 30 dias</div>${S.ocultar ? ocultoCartao() : svgLinha(ev)}</div>
      <div class="grafico-cartao"><h3>Situação das prestações</h3><div class="sub">Pagas, no prazo e em atraso</div>${S.ocultar ? ocultoCartao() : donut}</div>
      <div class="grafico-cartao"><h3>Cobranças previstas</h3><div class="sub">Valor em falta: atrasadas e próximos 7 dias</div>${S.ocultar ? ocultoCartao() : svgBarrasVert(cob)}</div>`;
  }

  // Cartão de um empréstimo/pedido (ListaActivity.itemEmprestimo)
  function cartaoEmprestimo(e) {
    const sit = R.situacaoEmprestimo(e.estado, e.prestacoesEmAtraso);
    const sub = `Empréstimo nº ${e.id}\n` + (e.estado === "PENDENTE"
      ? "Aprovar até " + R.data(R.limiteAprovacao(e.dataPedido))
      : (e.totalPrestacoes === 0 ? "Sem prestações" : `${e.prestacoesPagas} de ${e.totalPrestacoes} prestações pagas`));
    const linhas = [`<div>📝<span>Pedido em ${R.data(e.dataPedido)}</span></div>`];
    if (e.dataAprovacao) linhas.push(`<div>💸<span>Desembolso em ${R.data(e.dataAprovacao)}</span></div>`);
    linhas.push(`<div>📆<span>${e.modalidade === "PARCELADO" ? "6 prestações de 5 em 5 dias" : "Prestação única aos 30 dias"}</span></div>`);
    if (e.bensGarantia && e.bensGarantia.trim()) linhas.push(`<div>🔒<span>Garantia: ${esc(e.bensGarantia.trim())}</span></div>`);
    return `<div class="cl" data-eid="${e.id}">
      <div class="cl-topo">${avatar(e.nomeCliente)}
        <div class="cl-meio"><div class="cl-tit">${esc(e.nomeCliente)}</div><div class="cl-sub">${esc(sub)}</div></div>
        <div class="cl-fim"><div class="cl-valor">${vmt(e.capital)}</div>${pilula(sit, coresSituacao(sit))}</div>
      </div><div class="cl-det">${linhas.join("")}</div></div>`;
  }

  // ---------- Sino: notificações por ler (notificacoes_lidas, como no Android) ----------
  async function atualizarBadgeSino() {
    try {
      const n = await Dados.contarNaoLidas(S.user.id, S.user.perfil);
      const b = $("cb-badge"); if (!b) return;
      b.textContent = n > 99 ? "99+" : String(n);
      b.classList.toggle("oculto", n === 0);
    } catch (e) {}
  }

  // ---------- Cartão de uma prestação a cobrar (ListaActivity.itemCobranca) ----------
  function cartaoCobranca(p, hoje) {
    const dias = R.diasAtraso(p.vencimento, hoje);
    const paga = p.estado === "PAGO";
    const sit = R.situacaoPrestacao(p);
    const sub = paga
      ? `${p.numero}ª prestação · paga em ${R.data(p.dataPagamento)}`
      : `${p.numero}ª prestação · ${dias > 0 ? "venceu" : "vence"} ${R.data(p.vencimento)}` + (dias > 0 ? `\n${dias} ${dias === 1 ? "dia" : "dias"} de atraso` : "");
    const multa = paga ? 0 : R.multaPrestacao(p, hoje);
    const linhas = [];
    if (p.telefoneCliente) linhas.push(`<div>${icf("telefone", 15)}<span>${esc(p.telefoneCliente)}</span></div>`);
    if (p.localNegocio) linhas.push(`<div>${icf("local", 15)}<span>${esc(p.localNegocio)}</span></div>`);
    if (multa > 0) linhas.push(`<div>${icf("aviso", 15)}<span>Multa: ${vmt(multa)}</span></div>`);
    if (p.valorPago > 0 && !paga) linhas.push(`<div>${icf("visto", 15)}<span>Já pago: ${vmt(p.valorPago)}</span></div>`);
    const valor = paga ? p.valorPago : R.emFalta(p, hoje);
    return `<div class="cl" data-pid="${p.id}">
      <div class="cl-topo">${avatar(p.nomeCliente)}
        <div class="cl-meio"><div class="cl-tit">${esc(p.nomeCliente)}</div><div class="cl-sub">${esc(sub)}</div></div>
        <div class="cl-fim"><div class="cl-valor" style="color:${dias > 0 && !paga ? "var(--vermelho)" : "var(--texto)"}">${vmt(valor)}</div>${pilula(sit, coresSituacao(sit))}</div>
      </div>
      ${linhas.length ? `<div class="cl-det">${linhas.join("")}</div>` : ""}</div>`;
  }
  function ligarCartoesCobranca(raiz, lista, recarregar) {
    raiz.querySelectorAll(".cl[data-pid]").forEach((b) =>
      b.onclick = () => abrirPrestacao(lista.find((x) => x.id == b.dataset.pid), recarregar));
  }

  // ============================================================
  // ECRÃ: BALANÇO GERAL (completo, como o BalancoActivity)
  // ============================================================
  async function verBalanco() {
    mostrar("ecra-app");
    if (!pode("BALANCO")) { toast("Sem permissão.", true); return; }
    cabecalho("Balanço Geral", "Indicadores e gráficos da empresa",
      `<button class="pilula-cab" id="bg-olho">${S.ocultar ? "👁 Mostrar" : "🙈 Ocultar"}</button>`);
    $("bg-olho").onclick = () => alternarValores(verBalanco);
    const c = novoConteudo();
    c.innerHTML = spinner;
    try {
      const [ind, cob, saldo, es, ev, top, hoje, ultimos] = await Promise.all([Dados.balanco(), Dados.cobrancasPrevistas(), Dados.saldoCaixa(),
        Dados.graficoEntradasSaidas(), Dados.graficoEvolucaoCaixa(), Dados.topClientes(), Dados.caixaDoDia(R.hojeISO()), Dados.ultimosMovimentos(6)]);
      const num = (v) => S.ocultar ? "••••" : R.mt(v).replace(/\s*MT$/, "");
      const entHoje = hoje.prestacoes + hoje.outras, saiHoje = hoje.emprestimos + hoje.despesas;
      // Os 6 indicadores: {título, valor, cor, linha de detalhe}
      const cartoes = [
        ["Valor investido (capital)", ind.capitalInvestido, "#19969F", null],
        ["Total a receber", ind.totalAReceber, "var(--verde)", ind.emAtraso > 0 ? "em atraso: " + vmt(ind.emAtraso) : null],
        ["Margem de lucro esperada", ind.margemLucro, "#B8860B", "juros de 30%"],
        ["↓ Entradas de hoje", entHoje, "var(--verde)", "prestações " + num(hoje.prestacoes) + " · outras " + num(hoje.outras)],
        ["↑ Saídas de hoje", saiHoje, "var(--vermelho)", "empréstimos " + num(hoje.emprestimos) + " · despesas " + num(hoje.despesas)],
        ["Saldo atual em caixa", saldo.saldo, "var(--roxo)", "entrou " + num(saldo.entradas) + " · saiu " + num(saldo.saidas)],
      ];
      const estados = [
        { rotulo: "Aprovados", valor: ind.emCurso + ind.pagos, cor: "var(--verde)" },
        { rotulo: "Pendentes", valor: ind.pendentes, cor: "#F39C12" },
        { rotulo: "Rejeitados", valor: ind.rejeitados, cor: "var(--vermelho)" },
      ];
      if (ind.cancelados > 0) estados.push({ rotulo: "Cancelados", valor: ind.cancelados, cor: "var(--texto-suave)" });
      c.innerHTML = `
        <div class="ind-grelha">${cartoes.map(([t, v, cor, d]) => `<div class="ind"><div class="t">${esc(t)}</div>
          <div class="v" style="color:${cor}">${vmt(v)}</div>${d ? `<div class="d">${esc(d)}</div>` : ""}</div>`).join("")}</div>
        ${graficosBalanco(ind, cob, es, ev)}
        <div class="grafico-cartao"><h3>Empréstimos por estado</h3><div class="sub">Aprovados, pendentes e rejeitados</div>${S.ocultar ? ocultoCartao() : donutSVG(estados, "empréstimos", estados.reduce((s, x) => s + x.valor, 0))}</div>
        <div class="grafico-cartao"><h3>Top 5 clientes</h3><div class="sub">Maior capital emprestado (aprovados)</div>${S.ocultar ? ocultoCartao() : barrasHorizontais(top)}</div>
        <div class="cartao"><div class="titulo-cfg">Últimos lançamentos no caixa</div>
          ${ultimos.length ? ultimos.map((m) => {
            const ent = m.tipo === "ENTRADA";
            return `<div class="linha-dados" style="align-items:flex-start;gap:10px"><span style="min-width:0;flex:1">
              <b style="display:block">${esc(movLongo(m))}</b>
              <span class="r" style="font-size:.8rem;white-space:pre-line">${esc(String(m.dataMovimento || "").substring(0, 16))}\n${esc(m.justificativa || "")}</span></span>
              <span class="v" style="color:${ent ? "var(--verde)" : "var(--vermelho)"};white-space:nowrap;flex:none">${ent ? "+ " : "− "}${vmt(m.valor)}</span></div>`;
          }).join("") : `<div class="vazio" style="padding:14px">Ainda não há lançamentos.</div>`}
        </div>
        ${pode("EXPORTAR") ? `<button class="btn contorno" id="bg-pdf">📄 Exportar o balanço em PDF</button>` : ""}`;
      if ($("bg-pdf")) $("bg-pdf").onclick = () => exportarPDF("Balanço Geral", ["Indicador", "Valor"],
        cartoes.map(([t, v]) => [t, R.mt(v)]).concat([
          ["Prestações pagas / no prazo / em atraso", ind.prestacoesPagas + " / " + ind.prestacoesNoPrazo + " / " + ind.prestacoesAtrasadas],
          ["Empréstimos em curso / pagos / pendentes", ind.emCurso + " / " + ind.pagos + " / " + ind.pendentes]]), []);
    } catch (e) { c.innerHTML = erroEcra(e, verBalanco); }
  }

  // Tipo de movimento por extenso (CaixaDao.Movimento.movimento)
  function movLongo(m) {
    const ent = m.tipo === "ENTRADA";
    return ({ PRESTACAO: "Pagamento de prestação", DESEMBOLSO: "Desembolso de empréstimo", AJUSTE: "Ajuste de reconciliação",
      LICENCA: "Pagamento da licença", POUPANCA: ent ? "Depósito na poupança do cliente" : "Uso da poupança do cliente" }[m.categoria])
      || (ent ? "Outra entrada" : "Despesa / outra saída");
  }

  // ============================================================
  // ECRÃ: COBRANÇAS (prestações por pagar)
  // ============================================================
  // Como no Android (ListaActivity, modo COBRANCAS): situação × período, resumo e cartões.
  const SIT_PREST = ["Por pagar", "Em curso", "Atrasadas", "Pagas"];
  // Período pela data de vencimento (nas pagas, pela data do pagamento). [de, até]; null = sem limite.
  // "Hoje + atrasos", "Próximos 7 dias" e "Este mês" incluem as que já estão em atraso; "Só hoje" não.
  function periodosCobranca() {
    const h = R.hojeISO(), d = (n) => R.somaDias(h, n);
    const agora = new Date();
    const fimMes = R.isoLocal(new Date(agora.getFullYear(), agora.getMonth() + 1, 0));
    const iniMes = R.isoLocal(new Date(agora.getFullYear(), agora.getMonth(), 1));
    return [
      ["Hoje + atrasos", null, h], ["Só hoje", h, h], ["Ontem", d(-1), d(-1)], ["Últimos 7 dias", d(-6), h],
      ["Amanhã", d(1), d(1)], ["Próximos 7 dias", null, d(6)], ["Este mês", null, fimMes, iniMes],
    ];
  }
  let cobSit = 0, cobPer = 0;

  async function verCobrancas() {
    mostrar("ecra-app");
    cabecalho("Prestações do Dia", "Toque para pagar, ajustar multa ou contactar", btnAtualizar("cob-atu") + (pode("EXPORTAR") ? btnPdf("cob-pdf") : ""));
    $("cob-atu").onclick = () => verCobrancas();
    const c = novoConteudo();
    const pers = periodosCobranca();
    c.innerHTML = `
      <div class="pesquisa"><span class="lupa">${ic("pesquisa", 18)}</span><input id="cob-f" placeholder="Cliente, contacto ou local"></div>
      <div class="chips" id="cob-sit" style="padding-bottom:6px">${SIT_PREST.map((s, i) => `<button class="chip ${i === cobSit ? "ativo" : ""}" data-i="${i}">${s}</button>`).join("")}</div>
      <div class="chips" id="cob-per">${pers.map((p, i) => `<button class="chip ${i === cobPer ? "ativo" : ""}" data-i="${i}">${p[0]}</button>`).join("")}</div>
      <div id="cob-lista">${spinner}</div>`;
    const hoje = R.hojeISO();
    let porPagar = null, pagas = null, busca = "", lista = [];
    const passaBusca = (p) => !busca || (p.nomeCliente || "").toLowerCase().includes(busca) ||
      (p.telefoneCliente || "").includes(busca) || (p.localNegocio || "").toLowerCase().includes(busca);
    const carregar = async () => {
      $("cob-lista").innerHTML = spinner;
      try {
        if (cobSit === 3) { const [, de, ate] = pers[cobPer]; pagas = await Dados.listarPagas(de || pers[cobPer][3], ate); }
        else if (!porPagar) porPagar = await Dados.listarPorPagar();
        render();
      } catch (e) { $("cob-lista").innerHTML = erroEcra(e, verCobrancas); }
    };
    const render = () => {
      const [, de, ate] = pers[cobPer];
      if (cobSit === 3) lista = pagas.filter(passaBusca);
      else lista = porPagar.filter((p) => {
        const dias = R.diasAtraso(p.vencimento, hoje);
        if (cobSit === 1 && dias > 0) return false;    // "Em curso": ainda dentro do prazo
        if (cobSit === 2 && dias === 0) return false;  // "Atrasadas"
        if (de && p.vencimento < de) return false;
        if (ate && p.vencimento > ate) return false;
        return passaBusca(p);
      });
      const nAtraso = lista.filter((p) => p.estado !== "PAGO" && R.diasAtraso(p.vencimento, hoje) > 0).length;
      const total = lista.reduce((s, p) => s + (p.estado === "PAGO" ? p.valorPago : R.emFalta(p, hoje)), 0);
      const resumo = cobSit === 3
        ? `${lista.length} prestaç${lista.length === 1 ? "ão" : "ões"} paga${lista.length === 1 ? "" : "s"} · recebido: <b>${vmt(total)}</b>`
        : `${lista.length} prestaç${lista.length === 1 ? "ão" : "ões"} · <b>${nAtraso} em atraso</b> · a cobrar: <b>${vmt(total)}</b>`;
      $("cob-lista").innerHTML = `<div class="resumo-lista">${resumo}</div>` +
        (lista.length ? lista.map((p) => cartaoCobranca(p, hoje)).join("") : vazio("ok", "Nenhuma prestação neste filtro."));
      ligarCartoesCobranca($("cob-lista"), lista, verCobrancas);
    };
    const chips = (id, fn) => $(id).querySelectorAll(".chip").forEach((ch) => ch.onclick = () => {
      $(id).querySelectorAll(".chip").forEach((x) => x.classList.toggle("ativo", x === ch));
      fn(Number(ch.dataset.i));
    });
    chips("cob-sit", (i) => { cobSit = i; carregar(); });
    chips("cob-per", (i) => { cobPer = i; if (cobSit === 3) carregar(); else render(); });
    $("cob-f").oninput = (e) => { busca = (e.target.value || "").toLowerCase().trim(); if (porPagar || pagas) render(); };
    if ($("cob-pdf")) $("cob-pdf").onclick = () => exportarPDF("Prestações do Dia — " + SIT_PREST[cobSit] + " · " + pers[cobPer][0],
      ["Cliente", "Prest.", "Vencimento", "Atraso", cobSit === 3 ? "Pago (MT)" : "Em falta (MT)"],
      lista.map((p) => [p.nomeCliente, p.numero + "ª", R.data(p.vencimento), (p.estado === "PAGO" ? 0 : R.diasAtraso(p.vencimento, hoje)) + "d",
        R.mt(p.estado === "PAGO" ? p.valorPago : R.emFalta(p, hoje))]),
      ["Total: " + R.mt(lista.reduce((s, p) => s + (p.estado === "PAGO" ? p.valorPago : R.emFalta(p, hoje)), 0))]);
    carregar();
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
      ${pode("REMOVER_MULTA") && p.multaAlteradaPor ? `<div class="aviso-caixa" style="margin:12px 0 6px">A multa desta prestação foi alterada por <b>${esc(p.multaAlteradaPor)}</b>.</div><button class="btn" id="pg-repor">Repor a multa (anular remoção)</button>` : ""}
    `);
    if ($("pg-sms")) $("pg-sms").onclick = () => abrirSMS(p.telefoneCliente, mensagemCobranca(p));
    if ($("pg-repor")) $("pg-repor").onclick = async () => {
      if (!(await confirmar("Repor a multa", "A multa volta a ser calculada normalmente (2% por dia de atraso). Serve para anular uma remoção feita por engano. Vale em todos os dispositivos.", "Repor"))) return;
      const r = await comErro(() => Dados.reporMulta(p.id));
      fecharFolha(); toast(r.msg, !r.ok); if (r.ok && recarregar) recarregar();
    };
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
  // Como no Android (ListaActivity, modo CLIENTES): pesquisa, 5 filtros, cartões e "+ Registar cliente".
  const SIT_CLIENTE = ["Todos", "Em curso", "Atrasados", "Pagos", "Sem empréstimo"];
  let cliSit = 0;
  function cartaoCliente(cl) {
    const classe = (cl.classificacao || "NOVO").replace(/\s*\(.*$/, "");   // "BOM CLIENTE (…)" -> "BOM CLIENTE", como aparece no Android
    const bom = classe.toUpperCase().startsWith("BOM");
    let valor = "";
    if (cl.prestacoesEmAtraso > 0) valor = `<div class="cl-valor" style="color:var(--vermelho)">${cl.prestacoesEmAtraso} em atraso</div>`;
    else if (pode("BALANCO") && cl.emDivida > 0) valor = `<div class="cl-valor" style="color:var(--laranja)">${vmt(cl.emDivida)}</div>`;
    else if (cl.emDivida === 0) valor = `<div class="cl-valor" style="color:var(--verde)">✓ Sem dívida</div>`;
    const sub = `<span style="display:inline-flex;align-items:center;gap:4px">${icf("telefone", 14)}${esc(cl.telefone || "")}</span>${cl.tipoNegocio ? " · " + esc(cl.tipoNegocio) : ""}`;
    const det = (cl.morada || "") + (cl.localNegocio ? "  ·  negócio: " + cl.localNegocio : "");
    return `<div class="cl" data-cid="${cl.id}">
      <div class="cl-topo">${avatar(cl.nome)}
        <div class="cl-meio"><div class="cl-tit">${esc(cl.nome)}</div><div class="cl-sub" style="white-space:normal">${sub}</div></div>
        <div class="cl-fim">${valor}${pilula(bom ? "★ " + classe : classe, bom ? CORES.verde : CORES.azul)}</div>
      </div>
      ${det.trim() ? `<div class="cl-det"><div>${icf("local", 15)}<span>${esc(det)}</span></div></div>` : ""}</div>`;
  }

  async function verClientes() {
    mostrar("ecra-app");
    cabecalho("Gestão de Clientes", "Toque num cliente para abrir a ficha", btnAtualizar("cl-atu") + (pode("EXPORTAR") ? btnPdf("cl-pdf") : ""));
    $("cl-atu").onclick = () => verClientes();
    const c = novoConteudo();
    if (pode("CLIENTES")) c.classList.add("com-btn-fixo");
    c.innerHTML = `<div class="pesquisa"><span class="lupa">${ic("pesquisa", 18)}</span><input id="cl-f" placeholder="Nome, telefone, negócio ou local"></div>
      <div class="chips" id="cl-sit">${SIT_CLIENTE.map((s, i) => `<button class="chip ${i === cliSit ? "ativo" : ""}" data-i="${i}">${s}</button>`).join("")}</div>
      <div id="cl-lista">${spinner}</div>
      ${pode("CLIENTES") ? `<button class="btn-fixo" id="cl-novo">+ Registar cliente</button>` : ""}`;
    if ($("cl-novo")) $("cl-novo").onclick = () => formCliente(null);
    let timer, todos = [], lista = [];
    const render = () => {
      lista = todos.filter((cl) => {
        if (cliSit === 1 && cl.prestacoesPorPagar === 0) return false;                    // Em curso
        if (cliSit === 2 && cl.prestacoesEmAtraso === 0) return false;                    // Atrasados
        if (cliSit === 3 && (cl.emprestimos === 0 || cl.prestacoesPorPagar > 0)) return false; // Pagos: tudo pago
        if (cliSit === 4 && cl.emprestimos > 0) return false;                             // Sem empréstimo
        return true;
      });
      if (!lista.length) { $("cl-lista").innerHTML = vazio("clientes", "Nenhum cliente encontrado."); return; }
      $("cl-lista").innerHTML = lista.map(cartaoCliente).join("");
      $("cl-lista").querySelectorAll(".cl[data-cid]").forEach((b) =>
        b.onclick = () => abrirCliente(lista.find((x) => x.id == b.dataset.cid)));
    };
    const carregar = async (f) => {
      $("cl-lista").innerHTML = spinner;
      try { todos = await Dados.listarClientes(f); render(); }
      catch (e) { $("cl-lista").innerHTML = erroEcra(e, () => carregar(f)); }
    };
    $("cl-sit").querySelectorAll(".chip").forEach((ch) => ch.onclick = () => {
      $("cl-sit").querySelectorAll(".chip").forEach((x) => x.classList.toggle("ativo", x === ch));
      cliSit = Number(ch.dataset.i); render();
    });
    if ($("cl-pdf")) $("cl-pdf").onclick = () => exportarPDF("Clientes — " + SIT_CLIENTE[cliSit],
      ["Nome", "Telefone", "Local", "Empr.", "Dívida (MT)"],
      lista.map((cl) => [cl.nome, cl.telefone || "", cl.localNegocio || "", String(cl.emprestimos), R.mt(cl.emDivida)]),
      ["Total de clientes: " + lista.length]);
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
  async function verEmprestimos(abaInicial) {
    mostrar("ecra-app");
    cabecalho(abaInicial === "pendentes" ? "Aprovar Pedidos" : abaInicial === "todos" ? "Todos Empréstimos" : "Empréstimos", "");
    const c = novoConteudo();
    const abas = [];
    if (pode("APROVACOES")) abas.push(["pendentes", "Pendentes"]);
    abas.push(["todos", pode("TODOS_EMPRESTIMOS") ? "Todos" : "Em curso"]);
    let ativa = abas.some((a) => a[0] === abaInicial) ? abaInicial : abas[0][0];
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
      if ((p.estado !== "PAGO" && pode("PAGAR_PRESTACAO")) || (p.multaAlteradaPor && pode("REMOVER_MULTA")))
        b.onclick = () => abrirPrestacao(p, recarregar);
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
  // Como no Android (BarraInferior → "Mais"): o "Menu" com as mesmas opções, cores e ícones.
  async function verMais() {
    mostrar("ecra-app");
    cabecalho("Mais", "");
    $("cabecalho").classList.add("oculto");   // o Menu do Android não tem cabeçalho azul
    const c = novoConteudo();
    const AZ = CORES.azul, VE = CORES.verde, RO = CORES.roxo, LA = CORES.laranja;
    const op = (id, icone, cores, texto) => `<button class="op-menu" data-op="${id}">
      <span class="bola" style="background:${cores[1]};color:${cores[0]}">${icf(icone, 22)}</span>${esc(texto)}
      <span class="seta"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m9 6 6 6-6 6"/></svg></span></button>`;
    const admin = S.user.perfil === "ADMIN";
    // Agente e Cliente: as opções do Android (BarraInferior.mostrarMais)
    const comuns = `${op("valores", S.ocultar ? "olhoaberto" : "olhofechado", RO, S.ocultar ? "Mostrar valores" : "Ocultar valores")}
      ${op("config", "engrenagem", LA, "Configurações")}`;
    if (S.user.perfil === "CLIENTE") {
      c.innerHTML = `<div class="menu-tit">Menu</div>${comuns}`;
    } else if (S.user.perfil === "AGENTE") {
      c.innerHTML = `<div class="menu-tit">Menu</div>
        ${pode("CLIENTES") ? op("registar", "clientes", AZ, "Registar cliente") : ""}
        ${pode("NOVO_EMPRESTIMO") ? op("novo", "editar", VE, "Novo pedido") : ""}
        ${pode("SMS_VER") ? op("sms", "mensagem", AZ, "SMS enviados") : ""}
        ${comuns}`;
    }
    if (S.user.perfil !== "ADMIN") {
      c.querySelectorAll("[data-op]").forEach((b) => b.onclick = () => { $("cabecalho").classList.remove("oculto"); maisAcao(b.dataset.op); });
      return;
    }
    c.innerHTML = `<div class="menu-tit">Menu</div>
      ${pode("BALANCO") ? op("balanco", "balanco", AZ, "Balanço Geral") : ""}
      ${pode("NOVO_EMPRESTIMO") ? op("novo", "editar", VE, "Novo Empréstimo") : ""}
      ${pode("TODOS_EMPRESTIMOS") ? op("todos", "pasta", RO, "Todos Empréstimos") : op("todos", "pasta", RO, "Empréstimos")}
      ${pode("APROVACOES") ? op("aprovar", "visto", LA, "Aprovar Pedidos") : ""}
      ${pode("UTILIZADORES") ? op("utilizadores", "cadeado", AZ, "Utilizadores") : ""}
      ${pode("CAIXA") ? op("poupanca", "cofre", VE, "Poupança de Clientes") : ""}
      ${pode("CAIXA") ? op("lixeira", "lixo", RO, "Lixeira") : ""}
      ${admin ? op("acessos", "escudo", LA, "Controlo de Acesso") : ""}
      ${pode("COBRANCAS") || pode("SMS_VER") ? op("sms", "mensagem", AZ, "SMS aos clientes") : ""}
      ${admin ? op("licenca", "chave", VE, "Licença") : ""}
      ${op("valores", S.ocultar ? "olhoaberto" : "olhofechado", RO, S.ocultar ? "Mostrar valores" : "Ocultar valores")}
      ${op("config", "engrenagem", LA, "Configurações")}`;
    c.querySelectorAll("[data-op]").forEach((b) => b.onclick = () => {
      $("cabecalho").classList.remove("oculto");
      maisAcao(b.dataset.op);
    });
  }

  // "Novo Empréstimo" a partir do menu: escolher o cliente e abrir o pedido
  async function escolherClienteParaPedido() {
    abrirFolha(`<h3>Novo Empréstimo</h3><div class="sub">Escolha o cliente</div>
      <div class="pesquisa"><span class="lupa">${ic("pesquisa", 18)}</span><input id="ec-f" placeholder="Nome, telefone, negócio ou local"></div>
      <div id="ec-lista">${spinner}</div>`);
    let todos = [];
    const render = (f) => {
      const t = (f || "").toLowerCase().trim();
      const l = todos.filter((cl) => !t || (cl.nome || "").toLowerCase().includes(t) || (cl.telefone || "").includes(t)).slice(0, 40);
      $("ec-lista").innerHTML = l.map((cl) => `<button class="item" data-cid="${cl.id}">${avatar(cl.nome, 40)}
        <span class="meio"><span class="nome">${esc(cl.nome)}</span><span class="det">${esc(cl.telefone || "")}</span></span></button>`).join("") || vazio("clientes", "Nenhum cliente.");
      $("ec-lista").querySelectorAll("[data-cid]").forEach((b) => b.onclick = () => formPedido(todos.find((x) => x.id == b.dataset.cid)));
    };
    try { todos = await Dados.listarClientes(""); render(""); $("ec-f").oninput = (e) => render(e.target.value); }
    catch (e) { $("ec-lista").innerHTML = erroEcra(e, escolherClienteParaPedido); }
  }

  async function maisAcao(op) {
    if (op === "balanco") return verBalanco();
    if (op === "novo") return escolherClienteParaPedido();
    if (op === "todos") return verEmprestimos("todos");
    if (op === "aprovar") return verEmprestimos("pendentes");
    if (op === "valores") return alternarValores(verMais);
    if (op === "licenca") return verLicenca(false);
    if (op === "registar") return formCliente(null);
    if (op === "config") return verConfiguracoes();
    if (op === "emprestimos") return verEmprestimos();
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
          Bio.desativar(S.user.id); toast("Biometria desativada."); navegar("mais");
        }
      } else {
        try { await Bio.registar(S.user.id, S.user.nome || S.user.utilizador); toast("Face ID / Touch ID ativado."); navegar("mais"); }
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

  // Como no Android (CaixaActivity): saldo, gráfico, caixa do dia, novo lançamento e lançamentos por dia.
  let caixaVerOcultos = false;
  let cxDia = null, cxPer = 2, cxTipo = 0, cxEntrada = true;
  const DIAS_SEMANA = ["DOMINGO", "SEGUNDA-FEIRA", "TERÇA-FEIRA", "QUARTA-FEIRA", "QUINTA-FEIRA", "SEXTA-FEIRA", "SÁBADO"];
  const movCurto = (m) => ({ PRESTACAO: "Prestação", DESEMBOLSO: "Desembolso", AJUSTE: "Ajuste", LICENCA: "Licença", POUPANCA: "Poupança" }[m.categoria]
    || (m.tipo === "ENTRADA" ? "Entrada" : "Despesa"));
  const coresMov = (m) => m.tipo === "ENTRADA" ? CORES.verde : m.categoria === "DESEMBOLSO" ? CORES.roxo : CORES.vermelho;

  async function verCaixa() {
    mostrar("ecra-app");
    cabecalho("Fluxo de Caixa", "Entradas, saídas e saldo");
    const c = novoConteudo();
    c.innerHTML = spinner;
    const hoje = R.hojeISO();
    if (!cxDia) cxDia = hoje;
    const gere = pode("CAIXA_EDITAR") || pode("CAIXA_OCULTAR");
    try {
      const [s, ev] = await Promise.all([Dados.saldoCaixa(), Dados.graficoEvolucaoCaixa()]);
      const sugEntrada = ["Capital investido", "Reposição do caixa", "Pagamento de dívida antiga", "Multa paga à parte"];
      const sugDespesa = ["Pagamento de salário", "Renda do escritório", "Energia (Credelec)", "Transporte", "Comunicação"];
      const periodos = [["Hoje", hoje, hoje], ["Ontem", R.somaDias(hoje, -1), R.somaDias(hoje, -1)], ["Últimos 7 dias", R.somaDias(hoje, -6), hoje],
        ["Este mês", hoje.slice(0, 8) + "01", hoje]];
      c.innerHTML = `
        <div class="saldo-cartao">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span class="rot">SALDO EM CAIXA</span>
            <button class="pilula-btn" id="cx-olho">${icf(S.ocultar ? "olhoaberto" : "olhofechado", 15)} ${S.ocultar ? "Mostrar" : "Ocultar"}</button></div>
          <div class="grande">${vmt(s.saldo)}</div>
          <div class="tiles">
            <div class="tile"><div class="r">↓ ENTRADAS</div><div class="v">${vmt(s.entradas)}</div></div>
            <div class="tile"><div class="r">↑ SAÍDAS</div><div class="v">${vmt(s.saidas)}</div></div>
          </div>
        </div>
        <div class="grafico-cartao"><div class="titulo-cartao">${icf("tendencia", 18)} Evolução do saldo · últimos 30 dias</div>${S.ocultar ? ocultoCartao() : svgLinha(ev)}</div>
        <div class="cartao">
          <div class="titulo-cartao">${icf("calendario", 18)} Caixa do dia</div>
          <div class="nav-dia">
            <button id="cxd-ant" title="Dia anterior">◀</button>
            <div class="dia"><span id="cxd-txt"></span><input type="date" id="cxd-data" max="${hoje}"></div>
            <button id="cxd-seg" title="Dia seguinte">▶</button>
            <button id="cxd-hoje">Hoje</button>
          </div>
          <div id="cxd-corpo">${spinner}</div>
        </div>
        ${pode("CAIXA") ? `<div class="cartao">
          <div class="titulo-cartao" style="margin-bottom:10px">Novo lançamento</div>
          <div class="chips" id="nl-tipo" style="padding-bottom:0"></div>
          <input class="campo-linha" id="nl-valor" type="number" inputmode="decimal" step="0.01" placeholder="Valor (MT)">
          <input class="campo-linha" id="nl-desc" placeholder="Descrição">
          <div class="chips" id="nl-sug" style="margin-top:12px;padding-bottom:0"></div>
          <div class="campo-dia"><span id="nl-dia-txt"></span><input type="date" id="nl-dia" max="${hoje}" value="${hoje}"></div>
          <div class="erro-msg" id="nl-erro" style="min-height:0"></div>
          <button class="btn btn-verde" id="nl-ok">✓ Registar lançamento</button>
        </div>` : ""}
        <div class="cartao">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px">
            <div class="titulo-cartao" style="margin:0">Lançamentos</div>
            <div style="display:flex;gap:6px">
              ${pode("EXPORTAR") ? `<button class="pilula-btn" id="cx-pdf">${icf("documento", 14)} PDF</button>` : ""}
              ${pode("CAIXA_RECONCILIAR") ? `<button class="pilula-btn" id="cx-rec">Reconciliar</button>` : ""}
            </div>
          </div>
          <div class="chips" id="lc-per" style="padding-bottom:6px">${periodos.map((p, i) => `<button class="chip ${i === cxPer ? "ativo" : ""}" data-i="${i}">${p[0]}</button>`).join("")}</div>
          <div class="chips" id="lc-tipo">${["Todos", "Entradas", "Saídas"].map((t, i) => `<button class="chip ${i === cxTipo ? "ativo" : ""}" data-i="${i}">${t}</button>`).join("")}</div>
          <div class="pesquisa" style="margin-bottom:8px"><span class="lupa">${ic("pesquisa", 18)}</span><input id="lc-f" placeholder="Pesquisar na descrição"></div>
          ${pode("CAIXA_OCULTAR") ? `<label style="display:flex;align-items:center;gap:10px;font-size:.95rem;padding:4px 2px"><input type="checkbox" id="cx-oc" ${caixaVerOcultos ? "checked" : ""} style="width:20px;height:20px"> Mostrar lançamentos ocultos</label>` : ""}
        </div>
        <div id="lc-lista">${spinner}</div>`;
      $("cx-olho").onclick = () => alternarValores(verCaixa);

      // --- Caixa do dia (◀ data ▶ Hoje) ---
      const mostrarDia = async () => {
        $("cxd-txt").textContent = R.data(cxDia) + (cxDia === hoje ? " (hoje)" : "");
        $("cxd-data").value = cxDia;
        $("cxd-seg").disabled = cxDia >= hoje; $("cxd-seg").style.opacity = cxDia >= hoje ? ".4" : "1";
        $("cxd-corpo").innerHTML = spinner;
        try {
          const d = await Dados.caixaDoDia(cxDia);
          const ld = (r, v, cor, sinal) => `<div class="linha-dados"><span class="r">${r}</span><span class="v" style="color:${cor || "var(--texto)"}">${sinal || ""}${vmt(v)}</span></div>`;
          $("cxd-corpo").innerHTML =
            ld("Saldo de abertura", d.abertura) +
            ld("↓ Prestações recebidas", d.prestacoes, "var(--verde)", "+ ") +
            ld("↓ Outras entradas", d.outras, "var(--verde)", "+ ") +
            ld("↑ Empréstimos concedidos", d.emprestimos, "var(--vermelho)", "− ") +
            ld("↑ Despesas", d.despesas, "var(--vermelho)", "− ") +
            `<div class="linha-dados" style="border-top:1.5px solid var(--borda);border-bottom:0;padding-top:12px"><span style="font-weight:700;font-size:1.02rem">Saldo de fecho</span><span class="v" style="color:var(--accent);font-size:1.15rem">${vmt(d.fecho)}</span></div>`;
        } catch (e) { $("cxd-corpo").innerHTML = erroEcra(e, mostrarDia); }
      };
      $("cxd-ant").onclick = () => { cxDia = R.somaDias(cxDia, -1); mostrarDia(); };
      $("cxd-seg").onclick = () => { if (cxDia < hoje) { cxDia = R.somaDias(cxDia, 1); mostrarDia(); } };
      $("cxd-hoje").onclick = () => { cxDia = hoje; mostrarDia(); };
      $("cxd-data").onchange = (e) => { if (e.target.value) { cxDia = e.target.value > hoje ? hoje : e.target.value; mostrarDia(); } };
      mostrarDia();

      // --- Novo lançamento ---
      if ($("nl-ok")) {
        const desenharTipo = () => {
          $("nl-tipo").innerHTML = `<button class="chip ${cxEntrada ? "ativo" : ""}" data-e="1">↓ Entrada</button><button class="chip ${cxEntrada ? "" : "ativo"}" data-e="0">↑ Despesa</button>`;
          $("nl-tipo").querySelectorAll(".chip").forEach((b) => b.onclick = () => { cxEntrada = b.dataset.e === "1"; desenharTipo(); });
          const sug = cxEntrada ? sugEntrada : sugDespesa;
          $("nl-sug").innerHTML = sug.map((t, i) => `<button class="chip" data-i="${i}">${t}</button>`).join("");
          $("nl-sug").querySelectorAll(".chip").forEach((b) => b.onclick = () => { $("nl-desc").value = sug[Number(b.dataset.i)]; });
        };
        const mostrarDiaNovo = () => {
          const v = $("nl-dia").value || hoje;
          $("nl-dia-txt").textContent = "📅 Data do lançamento: " + R.data(v) + (v === hoje ? " (hoje)" : "") + "  ·  tocar para mudar";
        };
        desenharTipo(); mostrarDiaNovo();
        $("nl-dia").onchange = mostrarDiaNovo;
        $("nl-ok").onclick = async () => {
          const valor = parseFloat(String($("nl-valor").value).replace(",", "."));
          if (!valor || valor <= 0) { $("nl-erro").textContent = "Indique um valor válido."; return; }
          $("nl-ok").disabled = true; $("nl-erro").textContent = "";
          try {
            const r = await Dados.registarCaixa(cxEntrada ? "ENTRADA" : "SAIDA", valor, $("nl-desc").value, $("nl-dia").value || hoje, nomeRegisto());
            if (!r.ok) { $("nl-erro").textContent = r.msg; $("nl-ok").disabled = false; return; }
            toast(r.msg); verCaixa();
          } catch (e) { $("nl-erro").textContent = e.message; $("nl-ok").disabled = false; }
        };
      }

      // --- Lançamentos (período × tipo × pesquisa), agrupados por dia ---
      let movs = [], naLista = [], busca = "";
      const render = () => {
        naLista = movs.filter((m) => (cxTipo === 0 || (cxTipo === 1) === (m.tipo === "ENTRADA")) &&
          (!busca || (m.justificativa || "").toLowerCase().includes(busca)));
        let ent = 0, sai = 0;
        naLista.forEach((m) => { if (m.tipo === "ENTRADA") ent += m.valor; else sai += m.valor; });
        let html = `<div style="font-size:.88rem;color:var(--texto-suave);margin:2px 2px 4px">${naLista.length} lançamentos · <b style="color:var(--texto)">+ ${vmt(ent).replace(" MT", "")}</b> · <b style="color:var(--texto)">− ${vmt(sai).replace(" MT", "")}</b> · diferença ${vmt(ent - sai)}</div>`;
        if (!naLista.length) html += `<div class="vazio" style="padding:24px">Não há lançamentos neste período.</div>`;
        let diaAtual = null;
        naLista.slice(0, 100).forEach((m) => {
          const dia = R.dataBase(m.dataMovimento);
          if (dia !== diaAtual) {
            diaAtual = dia;
            const tot = naLista.filter((x) => R.dataBase(x.dataMovimento) === dia).reduce((s2, x) => s2 + (x.tipo === "ENTRADA" ? x.valor : -x.valor), 0);
            const nome = dia === hoje ? "HOJE" : dia === R.somaDias(hoje, -1) ? "ONTEM" : DIAS_SEMANA[new Date(dia + "T00:00:00").getDay()];
            html += `<div class="grupo-dia"><span>${nome} · ${R.data(dia)}</span><span style="color:${tot >= 0 ? "var(--verde)" : "var(--vermelho)"}">${tot >= 0 ? "+" : "−"}${vmt(Math.abs(tot))}</span></div>`;
          }
          const cores = coresMov(m), ent2 = m.tipo === "ENTRADA";
          const hora = (m.dataMovimento || "").length > 11 ? String(m.dataMovimento).substring(11, 16) : "";
          html += `<div class="cl" data-mid="${m.id}" style="${gere ? "" : "cursor:default;"}${m.oculto ? "opacity:.55" : ""}">
            <div class="cl-topo"><span class="circ-ic" style="background:${cores[0]}">${icf(ent2 ? "entrada" : "saida", 18)}</span>
              <div class="cl-meio"><div class="mov-tit">${esc(m.justificativa || movCurto(m))}</div>
                <div class="cl-sub">${hora ? hora + " · " : ""}nº ${m.id}${m.oculto ? " · oculto" : ""}</div></div>
              <div class="cl-fim"><div class="cl-valor" style="color:${cores[0]}">${ent2 ? "+ " : "− "}${vmt(m.valor)}</div>${pilula(movCurto(m), cores)}</div>
            </div></div>`;
        });
        if (naLista.length > 100) html += `<div class="vazio" style="padding:12px">(mostrados os 100 mais recentes; use os filtros)</div>`;
        $("lc-lista").innerHTML = html;
        if (gere) $("lc-lista").querySelectorAll(".cl[data-mid]").forEach((b) => b.onclick = () => gerirCaixa(movs.find((m) => m.id == b.dataset.mid)));
      };
      const carregar = async () => {
        $("lc-lista").innerHTML = spinner;
        try { const [, de, ate] = periodos[cxPer]; movs = await Dados.movimentosPeriodo(de, ate, caixaVerOcultos); render(); }
        catch (e) { $("lc-lista").innerHTML = erroEcra(e, carregar); }
      };
      const chips = (id, fn) => $(id).querySelectorAll(".chip").forEach((ch) => ch.onclick = () => {
        $(id).querySelectorAll(".chip").forEach((x) => x.classList.toggle("ativo", x === ch)); fn(Number(ch.dataset.i));
      });
      chips("lc-per", (i) => { cxPer = i; carregar(); });
      chips("lc-tipo", (i) => { cxTipo = i; render(); });
      $("lc-f").oninput = (e) => { busca = (e.target.value || "").toLowerCase().trim(); render(); };
      if ($("cx-oc")) $("cx-oc").onchange = (e) => { caixaVerOcultos = e.target.checked; carregar(); };
      carregar();

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
      if ($("cx-pdf")) $("cx-pdf").onclick = () => exportarPDF("Fluxo de Caixa — " + periodos[cxPer][0],
        ["Data", "Tipo", "Categoria", "Descrição", "Valor (MT)"],
        naLista.map((m) => [R.dataHora(m.dataMovimento), m.tipo, movCurto(m), m.justificativa || "", (m.tipo === "ENTRADA" ? "+" : "-") + R.mt(m.valor)]),
        [`Saldo: ${R.mt(s.saldo)}  |  Entradas: ${R.mt(s.entradas)}  |  Saídas: ${R.mt(s.saidas)}`]);
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
    const c = novoConteudo();
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
    const c = novoConteudo();
    c.innerHTML = spinner;
    try {
      const lista = await Dados.listarNotificacoes(S.user.id, S.user.perfil);
      const cor = (t) => t === "SEGURANCA" ? CORES.vermelho : t === "ATUALIZACAO" ? CORES.verde : t === "RECADO" ? CORES.roxo : CORES.azul;
      c.innerHTML = lista.length ? lista.map((n) => `<div class="cl" style="cursor:default;${n.lida ? "" : "border-left:4px solid var(--accent)"}">
        <div class="cl-topo"><span class="circ-ic" style="background:${cor(n.tipo)[1]};color:${cor(n.tipo)[0]};width:42px;height:42px">${icf("sino", 20)}</span>
          <div class="cl-meio"><div class="cl-tit">${esc(n.titulo || "Notificação")}${n.lida ? "" : ` ${pilula("Nova", CORES.azul)}`}</div>
            <div class="cl-sub" style="white-space:pre-line">${esc(n.mensagem || "")}</div>
            <div class="cl-sub" style="font-size:.76rem;margin-top:4px">${R.dataHora(n.data)}${n.autor ? " · " + esc(n.autor) : ""}</div></div>
          <button class="icone" data-rem="${n.id}" title="Remover" style="background:none;border:0;color:var(--texto-suave);cursor:pointer;font-size:1.1rem">✕</button>
        </div></div>`).join("") : vazio("notificacoes", "Sem notificações.");
      c.querySelectorAll("[data-rem]").forEach((b) => b.onclick = async () => {
        try { await Dados.removerNotificacao(S.user.id, Number(b.dataset.rem)); b.closest(".cl").remove(); } catch (e) { toast(e.message, true); }
      });
      // Abrir o sino marca tudo como lido (o número vermelho desaparece)
      const porLer = lista.filter((n) => !n.lida).map((n) => n.id);
      if (porLer.length) Dados.marcarLidas(S.user.id, porLer).catch(() => {});
    } catch (e) { c.innerHTML = vazio("notificacoes", "Sem notificações."); }
  }

  // ---------- Poupança de Clientes ----------
  async function verPoupanca() {
    cabecalho("Poupança de Clientes", "Cofres dos clientes");
    const c = novoConteudo();
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
    const c = novoConteudo();
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
    cabecalho("SMS aos clientes", "Cobranças e recados");
    const c = novoConteudo();
    c.innerHTML = spinner;
    // No iPhone não há envio automático: abre a app Mensagens já preenchida, um cliente de cada vez
    const btnTodos = pode("COBRANCAS") ? `<button class="btn" id="sms-todos" style="margin-bottom:14px">${ic("sms", 16)} Enviar SMS a todos os que estão a dever</button>` : "";
    const ligar = () => { if ($("sms-todos")) $("sms-todos").onclick = cobrarTodos; };
    try {
      const lista = pode("SMS_VER") ? await Dados.smsEnviadosListar() : [];
      if (lista === null) { c.innerHTML = btnTodos + vazio("sms", "Esta base de dados não tem registo de SMS.\n(Os SMS são enviados pela app no telemóvel Android.)"); ligar(); return; }
      if (!lista.length) { c.innerHTML = btnTodos + vazio("sms", "Ainda não há SMS enviados."); ligar(); return; }
      c.innerHTML = btnTodos + `<div class="seccao-titulo">Enviados</div>` + lista.map((s) => {
        const ok = s.estado === "ENVIADO";
        return `<div class="item" style="cursor:default;align-items:flex-start">
          <span class="avatar" style="background:${ok ? "var(--verde-bg)" : "var(--vermelho-bg)"};color:${ok ? "var(--verde)" : "var(--vermelho)"}">${ic("sms", 18)}</span>
          <span class="meio"><span class="nome">${esc(s.nome || s.telefone)}</span>
            <span class="det" style="white-space:normal">${esc(s.texto)}</span>
            <span class="det" style="font-size:.74rem">${esc(s.telefone)} · ${esc(s.quando || "")} · ${esc(s.estado || "")}</span></span></div>`;
      }).join("");
      ligar();
    } catch (e) { c.innerHTML = erroEcra(e, verSms); }
  }

  // ---------- Acessos ----------
  async function verAcessos() {
    cabecalho("Acessos", "Entradas e saídas");
    const c = novoConteudo();
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
  // ============================================================
  // ASSISTENTE DE IA — o mesmo contexto da app Android (ia/ContextoIA)
  // PRIVACIDADE: cada perfil só envia à IA o que pode ver no seu painel.
  //  - CLIENTE: só os seus empréstimos e prestações (nunca os de outros clientes);
  //  - AGENTE:  cobranças e clientes (contactos), sem caixa, saldos ou lucros da empresa;
  //  - ADMIN:   indicadores, pedidos, cobranças e clientes — conforme as permissões que tem.
  // Como os dados que o perfil não pode ver nem sequer são enviados, a IA não os pode revelar.
  // ============================================================
  const REGRAS_CREDITO =
    "Produto de crédito: juros de 30% sobre o capital; taxa de assistência de 1% (registada, não entra no total). " +
    "Total a pagar = capital + 30%. Valor por pedido: mínimo 1 000 MT e máximo 35 000 MT. " +
    "Modalidades: (1) Prestação única, a pagar 30 dias após o pedido; (2) Parcelado: 6 prestações de 5 em 5 dias, a contar da data do pedido. " +
    "Multa por atraso: 2% do valor da prestação por cada dia de atraso. " +
    "Um cliente só pode pedir novo crédito depois de pagar toda a dívida e se não tiver outro pedido à espera. " +
    "Um pedido fica PENDENTE até o Administrador o aprovar ou rejeitar; se não for aprovado em 5 dias, é cancelado. " +
    "Só o Administrador aprova pedidos e regista pagamentos. Os bens de garantia são indicados em cada pedido.";

  function instrucoesIA() {
    const u = S.user, nome = u.nome || u.utilizador;
    let s = "És o Assistente Kubatsira Microcrédito, o assistente virtual da app da Kubatsira Microcrédito, empresa de microcrédito em Moçambique. " +
      "Quando falares da empresa ou da app, usa sempre o nome \"Kubatsira Microcrédito\". " +
      `Estás a falar com "${nome}", com o perfil ${perfilNome(u.perfil)}.\n\n`;
    if (Idioma.emIngles())
      s += "IDIOMA: a app está em INGLÊS. Responde SEMPRE em inglês, mesmo que os dados do contexto estejam em português. " +
        "Nomes dos botões em inglês: Request credit, New request, Collections, Register client, Clients, General Balance, " +
        "Today's Installments, New Loan, Cash Flow, All Loans, Approve Requests, Users, Recycle Bin, Settings.\n";
    s += "FORMATO: responde " + (Idioma.emIngles() ? "em inglês" : "em português de Moçambique") +
      ", curto (até ~150 palavras), cordial e prático. Vai direto à resposta, sem repetir a pergunta. " +
      "Usa listas com \"- \" e **negrito** para valores, datas e nomes de botões. Não uses tabelas. " +
      "Valores em MT com espaço nos milhares e vírgula decimal (ex.: 1 083,33 MT); datas dd/MM/yyyy.\n\n";
    s += "REGRAS: usa APENAS os dados do CONTEXTO; nunca inventes valores, clientes ou funcionalidades. " +
      "Se algo não estiver no contexto, diz que não tens essa informação. Recusa com educação temas fora do microcrédito. " +
      "Respeita SEMPRE as permissões abaixo: se pedirem algo que este utilizador não pode fazer ou ver, diz claramente que não tem essa permissão " +
      "e quem pode fazê-lo (normalmente o Administrador). Nunca ensines formas de contornar as permissões.\n\n";

    s += "O QUE ESTE UTILIZADOR PODE FAZER NO SEU PAINEL:\n";
    if (u.perfil === "CLIENTE") {
      s += "- Ver os seus empréstimos, o calendário de prestações, o que deve e as multas.\n" +
        "- Pedir um novo crédito no botão **Pedir crédito** (escolhe o valor, a modalidade e os bens de garantia; vê a simulação). O pedido fica à espera do Administrador.\n" +
        "- Tocar num empréstimo para ver as prestações.\n" +
        "- NÃO pode aprovar pedidos, nem registar pagamentos (paga ao agente/escritório e o Administrador regista).\n" +
        "- **Configurações**: foto, nome a mostrar, senha, Face ID, tema, idioma, ligar/desligar este assistente e ler os Termos e Condições.\n" +
        "- Só tens os dados DESTE cliente: nunca fales de outros clientes nem das finanças da empresa, mesmo que insista.\n";
    } else if (u.perfil === "AGENTE") {
      s += "- **Prestações/Cobranças**: ver as prestações que vencem hoje e as que estão em atraso, ligar ou mandar SMS ao cliente.\n" +
        "- **Registar cliente**: nome, telefone (será o utilizador do cliente na app), morada, renda diária, negócio, local, coabitantes; ao guardar, a app gera o código de acesso de 6 dígitos do cliente (a entregar-lhe; na ficha pode gerar-se um novo).\n" +
        "- **Novo pedido**: escolher o cliente, o valor, a modalidade e a garantia; o pedido fica à espera do Administrador.\n" +
        "- **Clientes**: consultar a lista, abrir a ficha de cada cliente (editar dados, ver empréstimos, fazer novo pedido, ligar).\n" +
        "- **Configurações**: nome, senha, ligar/desligar o assistente e Termos e Condições.\n" +
        "- Os agentes não criam conta sozinhos: só o Administrador os adiciona (em Utilizadores).\n" +
        "- NÃO pode aprovar pedidos nem registar pagamentos (é o Administrador).\n" +
        "- SEGURANÇA: este utilizador NÃO pode saber nada sobre a situação financeira da empresa (caixa, saldos, lucros, totais emprestados, despesas). " +
        "Mesmo que insista, recusa educadamente. Tu também não tens esses dados.\n";
    } else {
      s += "- **Balanço Geral**: 6 indicadores e 6 gráficos (entradas vs saídas, evolução do saldo, situação das prestações, cobranças previstas, empréstimos por estado, top 5 clientes); botão Ocultar valores; exportar PDF.\n" +
        "- **Prestações do Dia**: filtros por situação (Por pagar, Em curso, Atrasadas, Pagas) e período (Hoje + atrasos, Só hoje, Ontem, Últimos 7 dias, Amanhã, Próximos 7 dias, Este mês); tocar numa prestação para registar o pagamento (o excesso passa para a seguinte ou para a poupança), remover/reduzir a multa, alterar o vencimento, ligar ou SMS.\n" +
        "- **Clientes**: lista com pesquisa e filtros (Em curso, Atrasados, Pagos, Sem empréstimo); a ficha permite editar, ver os empréstimos, novo pedido, novo código de acesso e eliminar o cliente.\n" +
        "- **Novo Empréstimo**: escolher o cliente, valor (1 000 a 35 000 MT), modalidade e garantia.\n" +
        "- **Fluxo de Caixa**: saldo, caixa do dia (abertura, entradas, empréstimos, despesas, fecho, navegar entre dias), novo lançamento (entrada/despesa), lançamentos por período, editar, apagar (vai para a Lixeira), ocultar, reconciliar e exportar PDF.\n" +
        "- **Todos Empréstimos** e **Aprovar Pedidos**: aprovar ajustando valor, modalidade e data do desembolso; rejeitar; anular.\n" +
        "- **Utilizadores**: criar/editar/eliminar agentes e administradores e marcar as permissões de cada um (um agente nunca pode ter permissões de aprovar, pagar ou ver finanças).\n" +
        "- **Licença**: só o Administrador paga a licença (3 500 MT por mês: Mensal 30 dias = 3 500 MT, Trimestral 90 dias = 10 500 MT, Anual 365 dias = 42 000 MT; M-Pesa, e-Mola, mKesh ou transferência; escreve a referência da transação). " +
        "Aviso nos últimos 10 dias; se expirar, os agentes e clientes veem 'Sistema em manutenção' e o Administrador é levado ao ecrã da licença ao entrar.\n" +
        "- **Poupança de Clientes**, **Lixeira**, **Controlo de Acesso**, **SMS aos clientes**, **Configurações** (tema, idioma, sino, SMS automático).\n" +
        "- Exportar listas em PDF. A sessão termina após 5 minutos sem uso.\n" +
        (pode("BALANCO") || pode("CAIXA") ? "- Pode analisar a situação financeira e dar recomendações com base nos indicadores do contexto.\n"
          : "- SEGURANÇA: este Administrador NÃO tem acesso às finanças (Balanço/Caixa). Não fales de saldos, lucros nem totais da empresa.\n");
    }
    // As permissões exatas desta conta (o Administrador pode ter tirado algumas)
    if (u.perfil !== "CLIENTE") {
      const tem = CAT.filter(([c]) => pode(c)).map(([, nomeP]) => nomeP);
      const naoTem = CAT.filter(([c]) => !pode(c)).map(([, nomeP]) => nomeP);
      s += "\nPERMISSÕES DESTA CONTA (definidas pelo Administrador; mandam sobre a lista acima):\n" +
        "- TEM: " + (tem.join("; ") || "nenhuma") + ".\n" +
        "- NÃO TEM: " + (naoTem.join("; ") || "—") + ". Se perguntarem por algo destas, explica que a conta não tem essa permissão e que deve pedir ao Administrador.\n";
    }
    return s + "\n" + REGRAS_CREDITO;
  }

  // Dados atuais que este perfil pode ver (as listas param em 40 linhas: custo e rapidez)
  async function dadosIA() {
    const u = S.user, hoje = R.hojeISO();
    let s = "Hoje é " + R.data(hoje) + ".\n";
    const situ = (e) => R.situacaoEmprestimo(e.estado, e.prestacoesEmAtraso);
    const modal = (e) => e.modalidade === "PARCELADO" ? "6 prestações de 5 em 5 dias" : "Prestação única aos 30 dias";
    if (u.perfil === "CLIENTE") {
      const [meus, pp] = await Promise.all([Dados.emprestimosDoCliente(u.clienteId), Dados.porPagarDoCliente(u.clienteId)]);
      s += `--- OS MEUS EMPRÉSTIMOS (${meus.length}) ---\n`;
      meus.forEach((e) => { s += `- Nº ${e.id}: capital ${R.mt(e.capital)}, total a pagar ${R.mt(e.totalAPagar)}, ${modal(e)}, pedido em ${R.data(e.dataPedido)}, situação: ${situ(e)}, já pago ${R.mt(e.jaPago)}, em falta ${R.mt(e.emFalta)}, garantia: ${e.bensGarantia || "-"}\n`; });
      s += "--- AS MINHAS PRESTAÇÕES POR PAGAR ---\n";
      pp.forEach((p) => { const d = R.diasAtraso(p.vencimento, hoje);
        s += `- Empréstimo ${p.emprestimoId}, ${p.numero}ª prestação: vence ${R.data(p.vencimento)}, valor ${R.mt(p.valor)}, multa ${R.mt(R.multaPrestacao(p, hoje))}, em falta ${R.mt(R.emFalta(p, hoje))}, ${R.situacaoPrestacao(p)}${d > 0 ? " (" + d + " dias)" : ""}\n`; });
      const pendente = meus.find((e) => e.estado === "PENDENTE");
      s += pp.length ? "Ainda não pode pedir novo crédito: tem prestações por pagar.\n"
        : pendente ? `Ainda não pode pedir novo crédito: já tem o pedido nº ${pendente.id} à espera de aprovação.\n` : "Pode pedir um novo crédito.\n";
    } else if (u.perfil === "AGENTE") {
      const [cobrar, clientes] = await Promise.all([pode("COBRANCAS") ? Dados.listarCobrancas(hoje) : [], pode("CLIENTES") ? Dados.listarClientes("") : []]);
      if (pode("COBRANCAS")) {
        s += `--- COBRANÇAS DE HOJE E EM ATRASO (${cobrar.length}) ---\n`;
        cobrar.slice(0, 40).forEach((p) => { const d = R.diasAtraso(p.vencimento, hoje);
          s += `- ${p.nomeCliente} | tel ${p.telefoneCliente || "-"} | local: ${p.localNegocio || "-"} | ${p.numero}ª prestação | vence ${R.data(p.vencimento)} | a cobrar ${R.mt(R.emFalta(p, hoje))}${d > 0 ? " | " + d + " dias de atraso" : ""}\n`; });
        if (cobrar.length > 40) s += "... (lista truncada)\n";
      }
      if (pode("CLIENTES")) {
        s += `--- CLIENTES (${clientes.length}) ---\n`;
        clientes.slice(0, 40).forEach((c) => { s += `- ${c.nome} | tel ${c.telefone || "-"} | negócio: ${c.tipoNegocio || "-"} | local: ${c.localNegocio || "-"} | ${c.prestacoesEmAtraso > 0 ? "com prestações em atraso" : "sem atrasos"}\n`; });
        if (clientes.length > 40) s += "... (lista truncada)\n";
      }
    } else {
      const fin = pode("BALANCO") || pode("CAIXA");
      const [porPagar, pendentes, cobrar, clientes, caixa, lic] = await Promise.all([
        Dados.listarPorPagar(), pode("APROVACOES") ? Dados.listarPendentes() : [], pode("COBRANCAS") ? Dados.listarCobrancas(hoje) : [],
        pode("CLIENTES") ? Dados.listarClientes("") : [], fin ? Dados.saldoCaixa() : null, Dados.licencaEstado().catch(() => null)]);
      if (fin) {
        let emDivida = 0, emAtraso = 0, atrasadas = 0;
        porPagar.forEach((p) => { const f = R.emFalta(p, hoje); emDivida += f; if (R.diasAtraso(p.vencimento, hoje) > 0) { emAtraso += f; atrasadas++; } });
        s += "--- INDICADORES ---\n" +
          `- Saldo em caixa: ${R.mt(caixa.saldo)} (entradas ${R.mt(caixa.entradas)}, saídas ${R.mt(caixa.saidas)})\n` +
          `- Dívida total em aberto: ${R.mt(emDivida)}; em atraso: ${R.mt(emAtraso)} (${atrasadas} prestações)\n` +
          `- Pedidos pendentes: ${pendentes.length}\n`;
        if (pode("BALANCO")) {
          const ind = await Dados.balanco();
          s += `- Capital investido: ${R.mt(ind.capitalInvestido)}; margem de lucro esperada: ${R.mt(ind.margemLucro)}\n` +
            `- Empréstimos: ${ind.emCurso} em curso, ${ind.pagos} pagos, ${ind.pendentes} pendentes, ${ind.rejeitados} rejeitados, ${ind.cancelados} cancelados\n` +
            `- Prestações: ${ind.prestacoesPagas} pagas, ${ind.prestacoesNoPrazo} no prazo, ${ind.prestacoesAtrasadas} em atraso\n`;
        }
      }
      if (lic) s += "--- LICENÇA DO SISTEMA ---\n- " + (lic.expirada
        ? `EXPIRADA desde ${R.data(lic.expiracao)} (agentes e clientes veem 'Sistema em manutenção'; pagar no botão Licença)`
        : `Válida até ${R.data(lic.expiracao)} (faltam ${lic.diasRestantes} dias), plano ${lic.nomePlano}`) + "\n";
      if (pode("APROVACOES")) {
        s += "--- PEDIDOS PENDENTES ---\n";
        pendentes.forEach((e) => { s += `- Nº ${e.id} ${e.nomeCliente}: ${R.mt(e.capital)}, ${modal(e)}, pedido em ${R.data(e.dataPedido)}, aprovar até ${R.data(R.limiteAprovacao(e.dataPedido))}, garantia: ${e.bensGarantia || "-"}\n`; });
      }
      if (pode("COBRANCAS")) {
        s += "--- COBRANÇAS DE HOJE E EM ATRASO ---\n";
        cobrar.slice(0, 40).forEach((p) => { const d = R.diasAtraso(p.vencimento, hoje);
          s += `- ${p.nomeCliente} | tel ${p.telefoneCliente || "-"} | empréstimo ${p.emprestimoId} | ${p.numero}ª | vence ${R.data(p.vencimento)} | em falta ${R.mt(R.emFalta(p, hoje))}${d > 0 ? " | " + d + " dias de atraso" : ""}\n`; });
        if (cobrar.length > 40) s += "... (lista truncada)\n";
      }
      if (pode("CLIENTES")) {
        s += "--- CLIENTES ---\n";
        clientes.slice(0, 40).forEach((c) => { s += `- ${c.nome} | tel ${c.telefone || "-"} | ${c.classificacao || "NOVO"}${fin ? " | em dívida " + R.mt(c.emDivida) : ""}${c.prestacoesEmAtraso > 0 ? " | " + c.prestacoesEmAtraso + " em atraso" : ""}\n`; });
        if (clientes.length > 40) s += "... (lista truncada)\n";
      }
    }
    return s;
  }

  async function montarContextoIA() {
    let dados;
    try { dados = await dadosIA(); } catch (e) { dados = "(Não foi possível carregar os dados atuais: " + (e.message || "sem ligação") + ".)\n"; }
    return instrucoesIA() + "\n\n=== CONTEXTO (dados atuais) ===\n" + dados;
  }

  function markdownLeve(t) {
    return esc(t).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\*(.+?)\*/g, "<i>$1</i>").replace(/\n/g, "<br>");
  }

  // Boas-vindas (RespostasLocais: o que se pode fazer neste painel) e perguntas rápidas, por perfil
  function boasVindasIA() {
    const p = S.user.perfil;
    if (p === "CLIENTE") return "No seu painel pode:\n- Ver os seus **empréstimos** e **prestações** (toque num para ver o calendário).\n- Ver o que **deve** e as **multas**.\n- **Pedir crédito** (fica à espera do Administrador).\nPergunte, por exemplo: \"Como peço crédito?\" ou \"Como funciona a multa?\"";
    if (p === "AGENTE") return "No seu painel pode:\n- Ver as **Cobranças** de hoje e em atraso (ligar/SMS).\n- **Registar clientes** e fazer **novos pedidos**.\n- Consultar a lista de **Clientes**.\nNão pode aprovar pedidos nem registar pagamentos.";
    return "No painel do Administrador pode:\n- Ver o **Balanço Geral** com gráficos, **aprovar pedidos**, registar **pagamentos** e ver **Todos os empréstimos** e **Clientes**.\n- Gerir o **Fluxo de Caixa**, a **Lixeira** e os **Utilizadores** (criar agentes e definir permissões).";
  }
  function sugestoesIA() {
    const p = S.user.perfil;
    if (p === "CLIENTE") return ["Quanto devo?", "Quando vence a próxima prestação?", "Como peço crédito?", "Como funciona a multa?"];
    if (p === "AGENTE") return ["Quem devo cobrar hoje?", "Quem está em atraso?", "Como registo um cliente?", "Escreve uma mensagem de cobrança"];
    return ["Resumo da situação", "Que pedidos devo aprovar?", "Quem está em atraso?", "Como registo um pagamento?"];
  }

  async function verAssistente() {
    mostrar("ecra-app");
    cabecalho("Assistente", "Ajuda para o painel do " + perfilNome(S.user.perfil));
    const c = novoConteudo();
    if ($("fab-ia-btn")) $("fab-ia-btn").classList.add("oculto");
    c.innerHTML = `<div id="ia-chat" style="display:flex;flex-direction:column;gap:10px;margin-bottom:12px"></div>
      <div style="position:sticky;bottom:calc(var(--barra) + env(safe-area-inset-bottom));background:var(--fundo);padding:8px 0">
        <div class="chips" id="ia-sug" style="padding-bottom:8px">${sugestoesIA().map((q) => `<button class="chip">${esc(q)}</button>`).join("")}</div>
        <div style="display:flex;gap:8px">
          <input id="ia-in" placeholder="Escreva a sua pergunta…" style="flex:1;padding:12px 14px;border:1.5px solid var(--borda);border-radius:12px;background:var(--campo);color:var(--texto)">
          <button class="btn" id="ia-send" style="width:auto;margin:0;padding:12px 16px">${ic("enviar", 18)}</button>
        </div></div>`;
    const chat = $("ia-chat");
    const bolha = (texto, meu) => {
      const d = el(`<div style="max-width:85%;padding:11px 14px;border-radius:16px;font-size:.92rem;${meu
        ? "align-self:flex-end;background:var(--accent);color:#fff;border-bottom-right-radius:4px"
        : "align-self:flex-start;background:var(--cartao);border:1px solid var(--borda);border-bottom-left-radius:4px"}">${meu ? esc(texto) : markdownLeve(texto)}</div>`);
      chat.appendChild(d); window.scrollTo(0, document.body.scrollHeight); return d;
    };
    bolha("Olá! Sou o **Assistente Kubatsira Microcrédito**. 👋\n\n" + boasVindasIA(), false);
    iaHist.forEach((m) => bolha(m.texto, m.user));

    let aPensar = false;
    const enviar = async (texto) => {
      const q = (texto != null ? texto : $("ia-in").value).trim();
      if (!q || aPensar) return;
      aPensar = true;
      $("ia-in").value = ""; $("ia-send").disabled = true;
      bolha(q, true);
      const pensar = bolha("⏳ A pensar…", false);
      try {
        // Contexto novo a cada pergunta (dados atuais) — como no Android
        const contexto = await montarContextoIA();
        const r = await Dados.iaPerguntar(contexto, iaHist.slice(-10), q);
        pensar.innerHTML = markdownLeve(r.texto);
        iaHist.push({ user: true, texto: q }, { user: false, texto: r.texto });
      } catch (e) { pensar.innerHTML = esc("Erro: " + e.message); }
      aPensar = false; $("ia-send").disabled = false; window.scrollTo(0, document.body.scrollHeight);
    };
    $("ia-send").onclick = () => enviar();
    $("ia-in").onkeydown = (e) => { if (e.key === "Enter") enviar(); };
    $("ia-sug").querySelectorAll(".chip").forEach((b) => b.onclick = () => enviar(b.textContent));
  }
  // ---------- Configurações (A minha conta) ----------
  // ============================================================
  // CONFIGURAÇÕES (como o ConfiguracoesActivity do Android)
  // ============================================================
  const chaveIA = () => "kub_ia_" + String(S.user ? S.user.utilizador : "").toLowerCase();
  function usarIA() { try { return localStorage.getItem(chaveIA()) !== "0"; } catch (e) { return true; } }
  function definirUsarIA(sim) {
    try { localStorage.setItem(chaveIA(), sim ? "1" : "0"); } catch (e) {}
    const f = $("fab-ia-btn"); if (f) f.classList.toggle("oculto", !sim);
  }
  const temaAtual = () => document.documentElement.dataset.tema || "sistema";
  function definirTema(t) {
    document.documentElement.dataset.tema = t;
    try { localStorage.setItem("kub_tema", t); } catch (e) {}
  }

  async function verConfiguracoes() {
    mostrar("ecra-app");
    cabecalho("Configurações", "A minha conta e preferências");
    const c = novoConteudo();
    c.innerHTML = spinner;
    const admin = S.user.perfil === "ADMIN";
    const [bioDisp, sinoOn, smsOn, lic] = await Promise.all([
      Bio.disponivel(), admin ? Dados.sinoAtivo() : true,
      pode("SMS_AUTOMATICO") ? Dados.smsAutomaticoAtivo() : false,
      admin ? Dados.licencaEstado().catch(() => null) : null]);
    const nome = S.user.nome || S.user.utilizador;
    const sw = (id, texto, on, dis) => `<label class="interruptor"><span>${esc(texto)}</span><input type="checkbox" id="${id}" ${on ? "checked" : ""} ${dis ? "disabled" : ""}></label>`;
    const chips = (id, opcoes, ativa) => `<div class="chips" id="${id}" style="padding-bottom:4px">${opcoes.map((o, i) => `<button class="chip ${i === ativa ? "ativo" : ""}" data-i="${i}">${o}</button>`).join("")}</div>`;
    const temas = ["sistema", "claro", "escuro"];
    c.innerHTML = `
      <div class="cartao"><div class="titulo-cfg">👤 A minha conta</div>
        <div style="display:flex;align-items:center;gap:14px;margin-bottom:14px">
          <div class="avatar" id="cfg-avatar" style="width:92px;height:92px;font-size:2rem;flex:none;border-radius:50%;display:grid;place-items:center;color:#fff;font-weight:700;background-size:cover;background-position:center;background-color:${corAvatar(nome)}">${esc(R.iniciais(nome))}</div>
          <div style="flex:1;display:flex;flex-direction:column;gap:8px;min-width:0">
            <button class="btn contorno" id="cfg-foto" style="margin:0;padding:10px">🖼 Escolher da galeria</button>
            <button class="btn contorno" id="cfg-camara" style="margin:0;padding:10px">📷 Tirar foto</button>
            <button class="btn contorno-vermelho" id="cfg-remfoto" style="margin:0;padding:10px">🗑 Remover foto</button>
          </div>
        </div>
        <div style="font-size:.95rem;line-height:1.6">Utilizador (para entrar): <b>${esc(S.user.utilizador)}</b><br>Perfil: <b>${esc(perfilNome(S.user.perfil))}</b></div>
        <div class="campo" style="margin:12px 0 0"><label>Nome a mostrar</label><input id="cfg-nome" value="${esc(S.user.nome || "")}"></div>
        <div class="erro-msg" id="cfg-nerro" style="min-height:0"></div>
        <button class="btn btn-verde" id="cfg-gnome">✓ Guardar nome</button>
        <div class="explica" style="margin-top:10px"><i>O nome a mostrar não muda o utilizador com que entra na app.</i></div>
      </div>

      <div class="cartao"><div class="titulo-cfg">🔑 Alterar a senha</div>
        <div class="campo"><label>Senha atual</label><input id="cfg-sat" type="password" autocomplete="current-password"></div>
        <div class="campo"><label>Nova senha (mín. 6)</label><input id="cfg-snova" type="password" autocomplete="new-password"></div>
        <div class="campo"><label>Confirmar nova senha</label><input id="cfg-sconf" type="password" autocomplete="new-password"></div>
        <label style="display:flex;align-items:center;gap:8px;font-size:.88rem;color:var(--texto-suave);margin:-4px 0 6px"><input type="checkbox" id="cfg-ver" style="width:18px;height:18px"> Mostrar as senhas</label>
        <div class="erro-msg" id="cfg-serro"></div>
        <button class="btn azul" id="cfg-gsenha">Alterar senha</button>
      </div>

      <div class="cartao"><div class="titulo-cfg">👆 Face ID / impressão digital</div>
        ${sw("cfg-bio", "Entrar com Face ID / impressão digital", bioDisp && Bio.ativa(S.user.id), !bioDisp)}
        <div class="explica" id="cfg-bio-txt"></div>
      </div>

      <div class="cartao"><div class="titulo-cfg">🤖 Assistente de Inteligência Artificial</div>
        ${sw("cfg-ia", "Usar o assistente de IA", usarIA())}
        <div class="explica" id="cfg-ia-txt"></div>
      </div>

      <div class="cartao"><div class="titulo-cfg">🎨 Aparência</div>
        <div class="sub-secao">TEMA</div>
        ${chips("cfg-tema", ["📱 Sistema", "☀ Claro", "🌙 Escuro"], Math.max(0, temas.indexOf(temaAtual())))}
        <div class="explica"><i>O tema "Sistema" segue o modo claro/escuro do telemóvel.</i></div>
      </div>

      <div class="cartao"><div class="titulo-cfg">🌐 Idioma</div>
        <div class="sub-secao">IDIOMA</div>
        ${chips("cfg-idioma", ["🇲🇿 Português", "🇬🇧 English"], Idioma.emIngles() ? 1 : 0)}
        <div class="explica"><i>A app inteira muda de idioma, incluindo mensagens, relatórios PDF e o assistente de IA.</i></div>
      </div>

      ${admin && lic ? `<div class="cartao"><div class="titulo-cfg">🔑 Licença do Sistema</div>
        <div style="font-size:.95rem;line-height:1.6;color:${lic.expirada ? "var(--vermelho)" : lic.aExpirar ? "var(--laranja)" : "var(--texto)"}">
          ${lic.expirada ? "✕ <b>Expirada</b> desde " + R.data(lic.expiracao) : "Válida até <b>" + R.data(lic.expiracao) + "</b>"}<br>Plano: <b>${esc(lic.nomePlano)}</b></div>
        <button class="btn contorno" id="cfg-lic">Pagar / renovar a licença</button>
      </div>` : ""}

      ${admin ? `<div class="cartao"><div class="titulo-cfg">🔔 Notificações</div>
        ${sw("cfg-sino", "Mostrar o sino de notificações", sinoOn)}
        <div class="explica" id="cfg-sino-txt"></div>
      </div>` : ""}

      ${pode("SMS_AUTOMATICO") ? `<div class="cartao"><div class="titulo-cfg">💬 SMS de cobrança automático</div>
        ${sw("cfg-sms", "Enviar às 08:00, 12:00 e 14:00", smsOn)}
        <div class="explica" id="cfg-sms-txt"></div>
        <button class="btn contorno" id="cfg-sms-abrir">Abrir SMS aos clientes</button>
      </div>` : ""}

      ${pode("UTILIZADORES") ? `<div class="cartao"><div class="titulo-cfg">🔐 Utilizadores do sistema</div>
        <div class="explica" style="margin:0 0 8px;font-size:.88rem">Criar agentes e administradores, definir permissões, ativar ou desativar contas.</div>
        <button class="btn contorno" id="cfg-users">Gerir utilizadores e permissões</button>
      </div>` : ""}

      <div class="cartao"><div class="titulo-cfg">📄 Ajuda e documentos</div>
        <button class="btn contorno" id="cfg-termos">Termos e Condições (versão ${esc(Idioma.versaoTermos())})</button>
        <div class="explica" style="margin-top:12px">Kubatsira Microcrédito · app web versão ${esc(window.KUB_VER || "—")}<br>
          Dados na base Neon (PostgreSQL), partilhada com o Kubatsira. A sessão termina após 5 minutos sem uso.</div>
      </div>

      <div class="cartao"><div class="titulo-cfg">🔄 Versão e atualizações</div>
        <div style="font-size:.92rem;line-height:1.5">Versão instalada: <b>${esc(window.KUB_VER || "—")}</b><br>
          As novas versões são procuradas sozinhas ao abrir a app. Também pode procurar agora.</div>
        <button class="btn contorno" id="cfg-atualizar">🔄 Procurar atualizações</button>
      </div>

      <div class="cartao"><div class="titulo-cfg">🔌 Ligação à base de dados</div>
        <div class="explica" style="margin:0 0 4px">Servidor</div>
        <div style="font-size:.82rem;font-weight:600;word-break:break-all;margin-bottom:6px">${esc(DB.servidorAtual() || "—")}</div>
        <button class="btn contorno-vermelho" id="cfg-ligacao">Trocar de ligação</button>
      </div>`;
    pintarAvatar($("cfg-avatar"), S.user.foto);

    // --- Foto ---
    const guardarFoto = async (b64) => {
      try {
        await Dados.guardarFoto(S.user.id, b64);
        S.user.foto = b64; pintarAvatar($("cfg-avatar"), b64);
        toast("Foto de perfil atualizada.");
      } catch (e) { toast(e.message, true); }
    };
    $("cfg-foto").onclick = () => escolherFoto(guardarFoto, false);
    $("cfg-camara").onclick = () => escolherFoto(guardarFoto, true);
    $("cfg-remfoto").onclick = async () => {
      if (!S.user.foto) { toast("Não há foto para remover."); return; }
      try { await Dados.removerFoto(S.user.id); S.user.foto = ""; pintarAvatar($("cfg-avatar"), ""); toast("Foto removida."); }
      catch (e) { toast(e.message, true); }
    };
    // --- Nome ---
    $("cfg-gnome").onclick = async () => {
      try {
        const r = await Dados.alterarNome(S.user.id, $("cfg-nome").value);
        if (r.ok === false) { $("cfg-nerro").textContent = r.msg; return; }
        S.user.nome = $("cfg-nome").value.trim(); Dados._nome = S.user.nome || S.user.utilizador;
        $("cfg-nerro").textContent = ""; toast(r.msg || "Nome guardado.");
      } catch (e) { $("cfg-nerro").textContent = e.message; }
    };
    // --- Senha ---
    $("cfg-ver").onchange = (e) => ["cfg-sat", "cfg-snova", "cfg-sconf"].forEach((id) => { $(id).type = e.target.checked ? "text" : "password"; });
    $("cfg-gsenha").onclick = async () => {
      if ($("cfg-snova").value !== $("cfg-sconf").value) { $("cfg-serro").textContent = "A confirmação da nova senha não coincide."; return; }
      $("cfg-gsenha").disabled = true;
      try {
        const r = await Dados.alterarSenha(S.user.id, $("cfg-sat").value, $("cfg-snova").value);
        if (!r.ok) { $("cfg-serro").textContent = r.msg; $("cfg-gsenha").disabled = false; return; }
        ["cfg-sat", "cfg-snova", "cfg-sconf"].forEach((id) => { $(id).value = ""; });
        $("cfg-serro").textContent = ""; $("cfg-gsenha").disabled = false; toast(r.msg);
      } catch (e) { $("cfg-serro").textContent = e.message; $("cfg-gsenha").disabled = false; }
    };
    // --- Face ID / impressão digital (WebAuthn, como a Biometria do Android) ---
    const textoBio = () => {
      $("cfg-bio-txt").innerHTML = !bioDisp ? "⚠ Este aparelho ou navegador não tem Face ID / impressão digital disponível."
        : $("cfg-bio").checked ? "Ativada: no ecrã de entrada toque em <b>Entrar com Face ID / impressão digital</b> — não precisa de escrever a senha. Também é pedida para mostrar os valores."
        : "Desativada. Ao ativar, a sua conta fica ligada ao Face ID / impressão digital deste aparelho (a senha continua a funcionar).";
    };
    textoBio();
    $("cfg-bio").onchange = async (e) => {
      if (!e.target.checked) { Bio.desativar(S.user.id); Bio.desligarEntrada(); textoBio(); return; }
      const outro = Bio.contaEntrada();
      if (outro && outro.uid !== S.user.id &&
        !(await confirmar("Face ID / impressão digital", `Este aparelho está ligado à conta "${outro.nome}". Quer ligá-lo à sua conta em vez disso?`, "Ligar"))) {
        e.target.checked = false; textoBio(); return;
      }
      try {
        await Bio.registar(S.user.id, S.user.nome || S.user.utilizador);
        Bio.ligarEntrada(S.user.id, S.user.utilizador);
        textoBio(); toast("Ativada. Na próxima entrada já pode usá-la.");
      } catch (err) { e.target.checked = false; textoBio(); toast("Não foi possível ativar neste aparelho.", true); }
    };
    // --- IA ---
    const textoIA = () => { $("cfg-ia-txt").textContent = $("cfg-ia").checked
      ? "Ligado: o botão do assistente aparece no painel. As perguntas são enviadas pela Internet para o Google Gemini (só os dados do seu perfil)."
      : "Desligado: o botão do assistente desaparece e nenhuma pergunta é enviada."; };
    textoIA();
    $("cfg-ia").onchange = (e) => { definirUsarIA(e.target.checked); textoIA(); };
    // --- Tema e idioma ---
    const ligarChips = (id, fn) => $(id).querySelectorAll(".chip").forEach((ch) => ch.onclick = () => {
      $(id).querySelectorAll(".chip").forEach((x) => x.classList.toggle("ativo", x === ch)); fn(Number(ch.dataset.i));
    });
    ligarChips("cfg-tema", (i) => definirTema(temas[i]));
    ligarChips("cfg-idioma", (i) => {
      Idioma.definir(i === 1 ? "en" : "pt");
      construirBarra(); verConfiguracoes();   // os ecrãs são desenhados de novo no idioma escolhido
    });
    // --- Licença, sino, SMS, utilizadores, termos, versão, ligação ---
    if ($("cfg-lic")) $("cfg-lic").onclick = () => verLicenca(false);
    if ($("cfg-sino")) {
      const textoSino = () => { $("cfg-sino-txt").textContent = $("cfg-sino").checked
        ? "Ligado: o sino aparece no cabeçalho de todos os painéis, com o número de notificações por ler (avisos, atualizações e recados)."
        : "Desligado: o sino desaparece para todos os utilizadores e não são criados avisos nem recados novos."; };
      textoSino();
      $("cfg-sino").onchange = async (e) => {
        try { await Dados.configGravar("sino_ativo", e.target.checked ? "1" : "0"); textoSino(); }
        catch (err) { e.target.checked = !e.target.checked; toast("Não foi possível gravar: " + err.message, true); }
      };
    }
    if ($("cfg-sms")) {
      const textoSms = () => { $("cfg-sms-txt").innerHTML = $("cfg-sms").checked
        ? "Ligado: todos os dias às 08:00, 12:00 e 14:00 cada cliente com prestação a vencer hoje ou em atraso recebe um SMS com as prestações em dívida e o total. Os SMS saem pelo cartão SIM do telemóvel de envio.<br>Para um telemóvel enviar: na app Android, Mais › SMS aos clientes › Autorizar este telemóvel."
        : "Desligado: não é enviado nenhum SMS automático (pode enviar à mão em Mais › SMS aos clientes)."; };
      textoSms();
      $("cfg-sms").onchange = async (e) => {
        try { await Dados.definirSmsAutomatico(e.target.checked); textoSms(); }
        catch (err) { e.target.checked = !e.target.checked; toast("Não foi possível gravar: " + err.message, true); }
      };
      $("cfg-sms-abrir").onclick = () => verSms();
    }
    if ($("cfg-users")) $("cfg-users").onclick = () => verUtilizadores();
    $("cfg-termos").onclick = () => verTermos(false);
    $("cfg-atualizar").onclick = procurarAtualizacoes;
    $("cfg-ligacao").onclick = async () => {
      if (await confirmar("Trocar de ligação", "Vai sair e apagar a ligação deste aparelho.", "Trocar", true)) { DB.apagar(); verLigar(); }
    };
  }

  // Procura uma versão nova (service worker) e recarrega se houver
  async function procurarAtualizacoes() {
    try {
      const r = await fetch("index.html?v=" + Date.now(), { cache: "no-store" });
      const t = await r.text();
      const m = /KUB_VER\s*=\s*"([^"]+)"/.exec(t);
      const nova = m ? m[1] : null;
      if (nova && nova !== window.KUB_VER) {
        if (await confirmar("Nova versão " + nova + " disponível", "Quer atualizar agora? A app volta a abrir (terá de entrar outra vez).", "Atualizar")) {
          try { const reg = await navigator.serviceWorker.getRegistration(); if (reg) await reg.update(); } catch (e) {}
          location.reload();
        }
      } else toast("Já tem a versão mais recente (" + (window.KUB_VER || "") + ").");
    } catch (e) { toast("Sem Internet: não foi possível procurar atualizações.", true); }
  }

  // ============================================================
  // TERMOS E CONDIÇÕES (TermosActivity)
  // ============================================================
  const termosAceites = () => { try { return localStorage.getItem("kub_termos_versao") === Idioma.versaoTermos(); } catch (e) { return true; } };
  // Texto com **negrito** -> HTML
  const markdown = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/_(.+?)_/g, "<i>$1</i>");
  function htmlTermos(aceitacao) {
    return `<div class="cartao termos">${markdown(Idioma.termos())}</div>
      ${aceitacao ? `<div class="cartao">
        <label style="display:flex;align-items:center;gap:10px;font-size:.98rem"><input type="checkbox" id="tm-li" style="width:22px;height:22px"> Li e aceito os Termos e Condições</label>
        <button class="btn btn-verde" id="tm-ok" disabled>✓ Aceito</button></div>` : ""}`;
  }
  function verTermos(aceitacao, depois) {
    if (aceitacao) {
      // Primeira utilização neste aparelho: antes de entrar (ecrã próprio, sem barra)
      mostrar("ecra-login");
      $("ecra-login").innerHTML = `<header class="cabecalho"><div style="flex:1;min-width:0"><div class="titulo">Termos e Condições</div>
        <div class="sub">Leia com atenção antes de usar a app</div></div>
        <div class="cab-acoes"><button class="pilula-cab" id="tm-idioma">🌐 ${Idioma.emIngles() ? "PT" : "EN"}</button></div></header>
        <div class="conteudo" style="padding-bottom:30px">${htmlTermos(true)}</div>`;
      $("tm-idioma").onclick = () => { Idioma.definir(Idioma.emIngles() ? "pt" : "en"); verTermos(true, depois); };
      $("tm-li").onchange = (e) => { $("tm-ok").disabled = !e.target.checked; };
      $("tm-ok").onclick = () => {
        try { localStorage.setItem("kub_termos_versao", Idioma.versaoTermos()); localStorage.setItem("kub_termos_data", R.agoraLocal()); } catch (e) {}
        (depois || verLogin)();
      };
      return;
    }
    mostrar("ecra-app");
    cabecalho("Termos e Condições", "Leia com atenção antes de usar a app");
    novoConteudo().innerHTML = htmlTermos(false);
  }

  // ============================================================
  // LICENÇA DO SISTEMA (LicencaActivity) — só o Administrador
  // ============================================================
  let licPlano = 0, licMetodo = 0;
  async function verLicenca(obrigatoria) {
    if (S.user.perfil !== "ADMIN") return;
    mostrar("ecra-app");
    cabecalho("Licença do Sistema", "Pagamento e validade da licença");
    $("barra-inferior").classList.toggle("escondida", !!obrigatoria);
    const fab = $("fab-ia-btn"); if (fab && obrigatoria) fab.classList.add("oculto");
    const c = novoConteudo();
    c.innerHTML = spinner;
    try {
      const [e, hist] = await Promise.all([Dados.licencaEstado(), Dados.licencaHistorico()]);
      const cor = e.expirada ? CORES.vermelho : e.aExpirar ? CORES.laranja : CORES.verde;
      const titulo = e.expirada ? "✕ Licença expirada" : e.diasRestantes === 0 ? "⚠ A licença expira hoje"
        : e.aExpirar ? "⚠ A licença expira daqui a " + e.diasRestantes + " dias" : "✓ Licença ativa";
      c.innerHTML = `
        <div class="cartao" style="background:${cor[1]};border-color:transparent">
          <div style="font-weight:800;font-size:1.25rem;color:${cor[0]};margin-bottom:4px">${titulo}</div>
          <div style="font-size:.95rem;line-height:1.6">${e.expirada ? "Expirou a: " : "Válida até: "}<b>${R.data(e.expiracao)}</b><br>Plano: <b>${esc(e.nomePlano)}</b></div>
          ${e.expirada ? `<div style="color:var(--vermelho);font-size:.88rem;margin-top:10px">Enquanto a licença não for paga, os <b>Agentes e Clientes</b> veem <b>Sistema em manutenção</b> e não conseguem entrar.</div>` : ""}
        </div>
        <div class="cartao"><div class="titulo-cfg">💳 ${e.expirada ? "Pagar a licença" : "Renovar a licença"}</div>
          <div class="sub-secao">1. PLANO</div><div class="chips" id="lc-plano" style="flex-wrap:wrap"></div>
          <div class="sub-secao" style="margin-top:8px">2. MÉTODO DE PAGAMENTO</div><div class="chips" id="lc-metodo" style="flex-wrap:wrap"></div>
          <div id="lc-instr" style="font-size:.9rem;margin:10px 0"></div>
          <div class="campo"><label>Número / conta usado no pagamento</label><input id="lc-conta" type="tel" inputmode="tel"></div>
          <div class="campo"><label>Referência da transação (ex.: 9JK4XL2M1Q)</label><input id="lc-ref" autocapitalize="characters" style="text-transform:uppercase"></div>
          <label style="display:flex;align-items:center;gap:10px;font-size:.92rem"><input type="checkbox" id="lc-caixa" checked style="width:20px;height:20px"> Registar como despesa no Fluxo de Caixa</label>
          <div id="lc-resumo" style="font-size:.95rem;margin:12px 0 4px"></div>
          <div class="erro-msg" id="lc-erro"></div>
          <button class="btn btn-verde" id="lc-ok">✓ Confirmar pagamento</button>
        </div>
        <div class="cartao"><div class="titulo-cfg">🧾 Pagamentos da licença</div>
          ${hist.length ? hist.map((p) => `<div class="cl" style="cursor:default;box-shadow:none">
            <div class="cl-topo"><div class="cl-meio"><div class="cl-tit">Plano ${esc(p.plano)} · ${p.dias} dias</div>
              <div class="cl-sub">${esc(String(p.data || "").substring(0, 16))} · ${esc(p.pagoPor || "")}</div></div>
              <div class="cl-fim"><div class="cl-valor" style="color:var(--verde)">${R.mt(p.valor)}</div>${pilula("até " + R.data(p.novaExpiracao), CORES.azul)}</div></div>
            <div class="cl-det"><div><span>${esc(p.metodo)} · ref. ${esc(p.referencia)} · ${esc(p.conta || "")}</span></div></div></div>`).join("")
            : `<div class="explica"><i>Ainda não há pagamentos registados.</i></div>`}
        </div>
        ${obrigatoria ? `<button class="btn contorno-vermelho" id="lc-sair">Terminar sessão</button>` : ""}`;
      const desenhar = () => {
        const p = Dados.PLANOS[licPlano];
        $("lc-plano").innerHTML = Dados.PLANOS.map((x, i) => `<button class="chip ${i === licPlano ? "ativo" : ""}" data-i="${i}">${x.nome} · ${x.dias} dias · ${R.mt(x.preco)}</button>`).join("");
        $("lc-metodo").innerHTML = Dados.METODOS.map((x, i) => `<button class="chip ${i === licMetodo ? "ativo" : ""}" data-i="${i}">${x}</button>`).join("");
        $("lc-plano").querySelectorAll(".chip").forEach((b) => b.onclick = () => { licPlano = Number(b.dataset.i); desenhar(); });
        $("lc-metodo").querySelectorAll(".chip").forEach((b) => b.onclick = () => { licMetodo = Number(b.dataset.i); desenhar(); });
        $("lc-instr").innerHTML = `3. Envie <b>${R.mt(p.preco)}</b> por <b>${Dados.METODOS[licMetodo]}</b> para a conta do fornecedor do Kubatsira e escreva a referência que vem na mensagem de confirmação.`;
        $("lc-resumo").innerHTML = `Nova validade: <b>${R.data(Dados.licencaNovaExpiracao(e, p))}</b> (+${p.dias} dias)`;
      };
      desenhar();
      $("lc-ok").onclick = async () => {
        const p = Dados.PLANOS[licPlano], metodo = Dados.METODOS[licMetodo];
        const ref = $("lc-ref").value.trim().toUpperCase();
        if (!(await confirmar("Confirmar pagamento", `Pagar a licença ${p.nome} (${R.mt(p.preco)}) por ${metodo}?\nReferência: ${ref}\nNova validade: ${R.data(Dados.licencaNovaExpiracao(e, p))}`, "Confirmar"))) return;
        $("lc-ok").disabled = true;
        try {
          const r = await Dados.licencaPagar(p.codigo, metodo, ref, $("lc-conta").value, $("lc-caixa").checked, S.user.utilizador);
          if (!r.ok) { $("lc-erro").textContent = r.msg; $("lc-ok").disabled = false; return; }
          toast(r.msg);
          $("barra-inferior").classList.remove("escondida");
          if (fab && usarIA()) fab.classList.remove("oculto");
          if (obrigatoria) navegar("inicio"); else verLicenca(false);
        } catch (err) { $("lc-erro").textContent = err.message; $("lc-ok").disabled = false; }
      };
      if ($("lc-sair")) $("lc-sair").onclick = async () => {
        if (await confirmar("Terminar sessão", "A licença continua por pagar. Quer sair da app?", "Sair", true)) sair();
      };
    } catch (err) { c.innerHTML = erroEcra(err, () => verLicenca(obrigatoria)); }
  }

  // Licença expirada: os Agentes e Clientes não entram (ManutencaoActivity)
  function verManutencao() {
    mostrar("ecra-login");
    $("ecra-login").innerHTML = `<div class="centro"><div class="manutencao">
      <div class="grande">🔧</div>
      <h2 style="margin:10px 0 6px">Sistema em manutenção</h2>
      <p style="color:var(--texto-suave)">O sistema está temporariamente indisponível. Tente mais tarde ou fale com o Administrador.</p>
      <button class="btn" id="mn-sair" style="margin-top:18px">Voltar ao início</button></div></div>`;
    $("mn-sair").onclick = () => { S.user = null; verLogin(); };
  }

  // ---------- Fim da sessão após 5 minutos sem uso (como na app) ----------
  const SESSAO_MS = 5 * 60 * 1000;
  let ultimoUso = Date.now();
  ["pointerdown", "keydown", "scroll", "touchstart"].forEach((ev) => window.addEventListener(ev, () => { ultimoUso = Date.now(); }, { passive: true, capture: true }));
  setInterval(() => {
    if (S.user && Date.now() - ultimoUso > SESSAO_MS) {
      sair();
      toast("A sessão terminou depois de 5 minutos sem uso. Entre outra vez.");
    }
  }, 15000);

  // ---------- Perfil ----------
  function formNome() {
    abrirFolha(`<h3>O meu nome</h3>
      <div class="campo"><label>Nome a mostrar</label><input id="n-nome" value="${esc(S.user.nome || "")}"></div>
      <div class="erro-msg" id="n-erro"></div><button class="btn" id="n-btn">Guardar</button>`);
    $("n-btn").onclick = async () => {
      const r = await comErro(() => Dados.alterarNome(S.user.id, $("n-nome").value));
      S.user.nome = $("n-nome").value.trim(); fecharFolha(); toast(r.msg); navegar("mais");
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

  // Pinta um elemento .avatar com a foto (base64 JPEG) ou deixa as iniciais.
  function pintarAvatar(elem, foto) {
    if (!elem) return;
    if (foto) {
      elem.style.backgroundImage = "url('data:image/jpeg;base64," + foto + "')";
      elem.style.backgroundSize = "cover"; elem.style.backgroundPosition = "center"; elem.style.color = "transparent";
    } else { elem.style.backgroundImage = ""; elem.style.color = ""; }
  }

  // Avatar HTML com foto (se houver) ou iniciais. Para o utilizador atual usa S.user.foto.
  function avatarFoto(nome, foto, extra) {
    const ini = esc(R.iniciais(nome));
    if (foto) return `<div class="avatar" style="${extra || ""};background-image:url('data:image/jpeg;base64,${foto}');background-size:cover;background-position:center;color:transparent">${ini}</div>`;
    return `<div class="avatar" style="${extra || ""}">${ini}</div>`;
  }

  // Abre o seletor de imagem, recorta ao centro e reduz para 256px JPEG (base64).
  function escolherFoto(aoPronto, camara) {
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = "image/*";
    if (camara) inp.setAttribute("capture", "user");   // abre logo a câmara (telemóvel)
    inp.onchange = () => {
      const file = inp.files && inp.files[0]; if (!file) return;
      const img = new Image();
      img.onload = () => {
        try {
          const s = 256, canvas = document.createElement("canvas");
          canvas.width = s; canvas.height = s;
          const ctx = canvas.getContext("2d");
          const min = Math.min(img.width, img.height);
          ctx.drawImage(img, (img.width - min) / 2, (img.height - min) / 2, min, min, 0, 0, s, s);
          aoPronto(canvas.toDataURL("image/jpeg", 0.82).split(",")[1]);
        } catch (e) { toast("Não foi possível processar a imagem.", true); }
        URL.revokeObjectURL(img.src);
      };
      img.onerror = () => toast("Imagem inválida.", true);
      img.src = URL.createObjectURL(file);
    };
    inp.click();
  }
  function erroEcra(e, retry) {
    window.__retry = retry;
    return `<div class="vazio"><span class="ic" style="color:var(--laranja)">${ic("alerta", 44)}</span>${esc(e.message || "Erro ao carregar.")}<br><br>
      <button class="btn secundario" style="max-width:220px;margin:14px auto 0" onclick="window.__retry&&window.__retry()">Tentar de novo</button></div>`;
  }

  // ============================================================
  // PAINEL DO CLIENTE (só vê os seus próprios dados)
  // ============================================================
  // Painel do CLIENTE (PainelClienteActivity): só os SEUS dados — o que deve, a próxima prestação,
  // os atrasos (com a multa) e os seus empréstimos. Não aprova pedidos nem regista pagamentos.
  async function verClienteInicio() {
    const nome = S.user.nome || S.user.utilizador;
    const c = novoConteudo();
    c.innerHTML = spinner;
    const sinoOn = await Dados.sinoAtivo().catch(() => true);
    if (!c.isConnected) return;
    $("cabecalho").className = "cabecalho cab-painel";
    $("cabecalho").innerHTML = `
      <div class="cab-topo">
        <div class="avatar" id="cb-avatar" style="background-color:${corAvatar(nome)}">${esc(R.iniciais(nome))}</div>
        <div class="cab-saud"><div class="ola">${esc(saudacao())},</div><div class="data">${esc(dataExtenso())}</div></div>
        <button class="icone" id="cb-atualizar" title="Atualizar">${icf("atualizar", 21)}</button>
        ${sinoOn ? `<button class="icone" id="cb-sino" title="Notificações">${icf("sino", 21)}<span class="badge-sino oculto" id="cb-badge"></span></button>` : ""}
        <button class="icone" id="cb-sair" title="Sair">${icf("porta", 21)}</button>
      </div>
      <span class="pilula-perfil">Painel do Cliente</span>`;
    pintarAvatar($("cb-avatar"), S.user.foto);
    $("cb-atualizar").onclick = () => verClienteInicio();
    if ($("cb-sino")) $("cb-sino").onclick = () => verNotificacoes();
    $("cb-sair").onclick = async () => { if (await confirmar("Terminar sessão", "Quer sair da sua conta?", "Sair")) sair(); };
    if (sinoOn) atualizarBadgeSino();
    try {
      // Tudo é filtrado pelo id DESTE cliente: nunca se leem dados de outros clientes
      const [porPagar, meus] = await Promise.all([
        Dados.porPagarDoCliente(S.user.clienteId), Dados.emprestimosDoCliente(S.user.clienteId)]);
      const hoje = R.hojeISO();
      let divida = 0, multas = 0, atrasadas = 0, proxima = null;
      for (const p of porPagar) {
        divida += R.emFalta(p, hoje); multas += R.multaPrestacao(p, hoje);
        if (R.diasAtraso(p.vencimento, hoje) > 0) atrasadas++;
        if (!proxima) proxima = p;   // a lista vem ordenada por vencimento
      }
      divida = R.arredondar(divida); multas = R.arredondar(multas);
      const pendente = meus.find((e) => e.estado === "PENDENTE");
      const podePedir = !porPagar.length && !pendente;
      const kpi = (rot, txt, cor) => `<div class="kpi-card" style="--cor:${cor}"><div class="rotulo">${esc(rot)}</div><div class="valor">${txt}</div></div>`;
      const aviso = (t, cores) => `<div class="aviso-painel" style="color:${cores[0]};background:${cores[1]}">${t}</div>`;
      let avisos = "";
      if (atrasadas > 0) avisos = aviso(`⚠ Tem <b>${atrasadas} prestação(ões) em atraso</b>. A multa já vai em <b>${vmt(multas)}</b> e aumenta 2% por dia. Pague o quanto antes.`, CORES.vermelho);
      else if (proxima && proxima.vencimento === hoje) avisos = aviso(`📅 A sua <b>${proxima.numero}ª prestação vence hoje</b>: ${vmt(R.emFalta(proxima, hoje))}.`, CORES.laranja);
      else if (podePedir) avisos = aviso("✓ Não tem dívidas. Pode <b>pedir um novo crédito</b>.", CORES.verde);
      const lista = meus.length ? meus.map((e) => {
        const sit = R.situacaoEmprestimo(e.estado, e.prestacoesEmAtraso);
        const prog = e.totalPrestacoes === 0 ? "Pedido em " + R.data(e.dataPedido) : `${e.prestacoesPagas}/${e.totalPrestacoes} prestações pagas`;
        return `<div class="cl" data-eid="${e.id}">
          <div class="cl-topo"><div class="cl-meio"><div class="cl-tit">Empréstimo nº ${e.id} · ${vmt(e.capital)}</div><div class="cl-sub">${esc(prog)}</div></div>
            <div class="cl-fim"><div class="cl-valor" style="color:${e.emFalta > 0 ? "var(--laranja)" : "var(--texto)"}">${e.emFalta > 0 ? "Falta " + vmt(e.emFalta) : vmt(e.totalAPagar)}</div>${pilula(sit, coresSituacao(sit))}</div></div>
          <div class="cl-det"><div>📆<span>${e.modalidade === "PARCELADO" ? "6 prestações de 5 em 5 dias" : "Prestação única aos 30 dias"}</span></div></div></div>`;
      }).join("") : `<div class="vazio" style="padding:20px">Ainda não tem empréstimos. Toque em "Pedir crédito" para fazer o primeiro pedido.</div>`;
      c.innerHTML = `
        <div class="kpis-scroll">
          ${kpi("Em dívida", vmt(divida), divida > 0 ? "var(--laranja)" : "var(--verde)")}
          ${kpi("Próxima prestação", proxima ? R.data(proxima.vencimento) : "—", proxima && R.diasAtraso(proxima.vencimento, hoje) > 0 ? "var(--vermelho)" : "var(--accent)")}
          ${kpi("Em atraso", String(atrasadas), atrasadas > 0 ? "var(--vermelho)" : "var(--verde)")}
        </div>
        ${avisos}
        <div class="seccao-titulo">Os meus empréstimos</div>${lista}`;
      c.querySelectorAll(".cl[data-eid]").forEach((b) => b.onclick = () =>
        abrirEmprestimo(meus.find((x) => x.id == b.dataset.eid), verClienteInicio));
    } catch (e) { c.innerHTML = erroEcra(e, verClienteInicio); }
  }

  async function verClientePedir() {
    cabecalho("Pedir crédito", "");
    const c = novoConteudo();
    c.innerHTML = spinner;
    try {
      const [porPagar, meus] = await Promise.all([
        Dados.porPagarDoCliente(S.user.clienteId), Dados.emprestimosDoCliente(S.user.clienteId)]);
      const pendente = meus.find((e) => e.estado === "PENDENTE");
      let motivo = null;
      if (pendente) motivo = "Já tem um pedido (nº " + pendente.id + ") à espera de aprovação. Aguarde a decisão do Administrador.";
      else if (porPagar.length) motivo = "Ainda tem prestações por pagar. Só pode pedir um novo crédito depois de pagar toda a dívida.";
      if (motivo) { c.innerHTML = vazio("alerta", motivo); return; }
      c.innerHTML = `
        <div class="cartao">
          <h3>Novo pedido de crédito</h3>
          <div class="campo"><label>Valor (MT)</label><input id="pd-valor" type="number" inputmode="decimal" placeholder="1000 a 35000"></div>
          <div class="campo"><label>Modalidade</label>
            <select id="pd-mod"><option value="PARCELADO">6 prestações (5 em 5 dias)</option><option value="UNICO">Prestação única (30 dias)</option></select></div>
          <div class="campo"><label>Bens dados como garantia</label><textarea id="pd-garantia" rows="2" placeholder="ex.: Geleira, televisor"></textarea></div>
          <div id="pd-sim" class="cartao" style="display:none;background:var(--fundo)"></div>
          <div class="erro-msg" id="pd-erro"></div>
          <button class="btn" id="pd-btn">Enviar pedido</button>
        </div>
        <p class="sub" style="color:var(--texto-suave);text-align:center">O pedido fica à espera da aprovação do Administrador.</p>`;
      const simular = () => {
        const v = parseFloat($("pd-valor").value); const sim = $("pd-sim");
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
          const r = await Dados.pedirEmprestimo(S.user.clienteId, parseFloat($("pd-valor").value), $("pd-mod").value, $("pd-garantia").value, S.user.nome || S.user.utilizador);
          if (!r.ok) { $("pd-erro").textContent = r.msg; $("pd-btn").disabled = false; return; }
          toast(r.msg); navegar("inicio");
        } catch (e) { $("pd-erro").textContent = e.message; $("pd-btn").disabled = false; }
      };
    } catch (e) { c.innerHTML = erroEcra(e, verClientePedir); }
  }

  // O Mais do cliente é o mesmo Menu (verMais escolhe as opções conforme o perfil)
  function verClienteMais() { return verMais(); }

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
