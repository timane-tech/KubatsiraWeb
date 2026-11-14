/*
 * Acesso aos dados (equivalente aos DAOs da app Android). Só este ficheiro escreve SQL.
 * As consultas e as colunas são as da base partilhada do Kubatsira.
 */
const Dados = (() => {

  // ---------- Autenticação ----------
  const SELECT_USER =
    "SELECT u.id, u.telefone, COALESCE(NULLIF(u.nome_exibicao, ''), c.nome, '') AS nome, u.tipo_usuario, " +
    "u.ativo, c.id AS cliente_id, u.permissoes, u.ultimo_acesso " +
    "FROM usuarios u LEFT JOIN clientes c ON c.usuario_id = u.id ";

  function lerUser(r) {
    return {
      id: Number(r.id),
      utilizador: r.telefone,
      nome: r.nome,
      perfil: r.tipo_usuario,
      ativo: r.ativo === "true" || r.ativo === "t" || r.ativo === true,
      clienteId: r.cliente_id ? Number(r.cliente_id) : 0,
      permissoes: traduzPermissoes(r.permissoes),
      ultimoAcesso: r.ultimo_acesso,
    };
  }

  // Códigos do Kubatsira -> códigos da app
  function traduzPermissoes(gravadas) {
    if (!gravadas || !gravadas.trim()) return gravadas || "";
    const s = new Set();
    for (let c of gravadas.split(",")) {
      let x = c.trim();
      if (x === "PRESTACOES_DIA" || x === "COBRANCAS_HOJE") x = "COBRANCAS";
      else if (x === "AGENTES") x = "UTILIZADORES";
      if (x) s.add(x);
    }
    return [...s].join(",");
  }

  async function autenticar(utilizador, senha) {
    if (!utilizador || !senha) return null;
    const h = await Regras.hash(senha);
    const rows = await DB.consultar(
      SELECT_USER + "WHERE LOWER(u.telefone) = LOWER(?) AND u.senha_hash = ?",
      [utilizador.trim(), h]
    );
    if (!rows.length) return null;
    const u = lerUser(rows[0]);
    if (u.ativo) {
      const agora = new Date().toISOString().slice(0, 19).replace("T", " ");
      await DB.executar("UPDATE usuarios SET ultimo_acesso = ? WHERE id = ?", [agora, u.id]);
    }
    return u;
  }

  async function idAdminPrincipal() {
    const r = await DB.consultar("SELECT COALESCE(MIN(id),0) AS id FROM usuarios WHERE tipo_usuario='ADMIN' AND ativo", []);
    return r.length ? Number(r[0].id) : 0;
  }

  // ---------- Prestações ----------
  const SELECT_PREST =
    "SELECT p.id, p.emprestimo_id, p.numero_prestacao, p.data_vencimento, p.valor_esperado, p.valor_pago, " +
    "p.multa_congelada, p.status, p.data_pagamento, c.id AS cliente_id, c.nome, u.telefone, c.local_negocio, p.multa_alterada_por " +
    "FROM prestacoes p JOIN emprestimos e ON e.id = p.emprestimo_id " +
    "JOIN clientes c ON c.id = e.cliente_id JOIN usuarios u ON u.id = c.usuario_id ";

  // Prestação por pagar que já está, na verdade, coberta (multa removida) — não conta como cobrança.
  const JA_COBERTA =
    "(p.multa_congelada IS NOT NULL AND COALESCE(p.valor_pago,0)+0.005 >= p.valor_esperado + p.multa_congelada)";

  function lerPrest(r) {
    return {
      id: Number(r.id),
      emprestimoId: Number(r.emprestimo_id),
      numero: Number(r.numero_prestacao),
      vencimento: Regras.dataBase(r.data_vencimento),
      valor: Number(r.valor_esperado),
      valorPago: Number(r.valor_pago || 0),
      multaCongelada: r.multa_congelada == null ? null : Number(r.multa_congelada),
      estado: r.status,
      dataPagamento: Regras.dataBase(r.data_pagamento),
      clienteId: Number(r.cliente_id),
      nomeCliente: r.nome,
      telefoneCliente: r.telefone,
      localNegocio: r.local_negocio,
      multaAlteradaPor: r.multa_alterada_por,
    };
  }

  const listarPorPagar = async () =>
    (await DB.consultar(SELECT_PREST +
      "WHERE p.status='PENDENTE' AND e.status='APROVADO' AND NOT " + JA_COBERTA +
      " ORDER BY p.data_vencimento, c.nome", [])).map(lerPrest);

  const listarCobrancas = async (ateISO) =>
    (await DB.consultar(SELECT_PREST +
      "WHERE p.status='PENDENTE' AND e.status='APROVADO' AND p.data_vencimento <= ? AND NOT " + JA_COBERTA +
      " ORDER BY p.data_vencimento, c.nome", [ateISO])).map(lerPrest);

  const listarPorEmprestimo = async (empId) =>
    (await DB.consultar(SELECT_PREST + "WHERE p.emprestimo_id = ? ORDER BY p.numero_prestacao", [empId])).map(lerPrest);

  // ---------- Balanço (Administrador) ----------
  async function balanco() {
    const r = (await DB.consultar(
      "SELECT " +
      "COALESCE(SUM(CASE WHEN status IN ('APROVADO','PAGO') THEN valor_solicitado END),0) AS capital," +
      "COALESCE(SUM(CASE WHEN status IN ('APROVADO','PAGO') THEN valor_total - valor_solicitado END),0) AS margem," +
      "COUNT(CASE WHEN status='PENDENTE' THEN 1 END) AS pendentes," +
      "COUNT(CASE WHEN status='APROVADO' THEN 1 END) AS emcurso," +
      "COUNT(CASE WHEN status='PAGO' THEN 1 END) AS pagos," +
      "COUNT(CASE WHEN status='REJEITADO' THEN 1 END) AS rejeitados," +
      "COUNT(CASE WHEN status='CANCELADO' THEN 1 END) AS cancelados " +
      "FROM emprestimos", []))[0];

    const ind = {
      capitalInvestido: Number(r.capital),
      margemLucro: Number(r.margem),
      pendentes: Number(r.pendentes), emCurso: Number(r.emcurso), pagos: Number(r.pagos),
      rejeitados: Number(r.rejeitados), cancelados: Number(r.cancelados),
      totalAReceber: 0, emAtraso: 0, prestacoesNoPrazo: 0, prestacoesAtrasadas: 0,
    };
    const hoje = Regras.hojeISO();
    for (const p of await listarPorPagar()) {
      ind.totalAReceber += Regras.emFalta(p, hoje);
      if (Regras.diasAtraso(p.vencimento, hoje) > 0) { ind.prestacoesAtrasadas++; ind.emAtraso += Regras.emFalta(p, hoje); }
      else ind.prestacoesNoPrazo++;
    }
    ind.totalAReceber = Regras.arredondar(ind.totalAReceber);
    ind.emAtraso = Regras.arredondar(ind.emAtraso);
    return ind;
  }

  // Cobranças previstas: em atraso + o que vence em cada um dos próximos 7 dias
  async function cobrancasPrevistas() {
    const hoje = Regras.hojeISO();
    const mapa = new Map();
    mapa.set("Atraso", 0);
    for (let i = 0; i < 7; i++) {
      const d = new Date(hoje + "T00:00:00"); d.setDate(d.getDate() + i);
      const iso = d.toISOString().slice(0, 10);
      const rot = i === 0 ? "Hoje" : Regras.data(iso).substring(0, 5);
      mapa.set(rot, 0);
    }
    const ate = new Date(hoje + "T00:00:00"); ate.setDate(ate.getDate() + 6);
    for (const p of await listarCobrancas(ate.toISOString().slice(0, 10))) {
      let chave;
      if (Regras.diasAtraso(p.vencimento, hoje) > 0) chave = "Atraso";
      else if (p.vencimento === hoje) chave = "Hoje";
      else chave = Regras.data(p.vencimento).substring(0, 5);
      if (!mapa.has(chave)) mapa.set(chave, 0);
      mapa.set(chave, mapa.get(chave) + Regras.emFalta(p, hoje));
    }
    return mapa;
  }

  async function topClientes() {
    return (await DB.consultar(
      "SELECT c.nome, SUM(e.valor_solicitado) AS total FROM emprestimos e JOIN clientes c ON c.id = e.cliente_id " +
      "WHERE e.status IN ('APROVADO','PAGO') GROUP BY c.id, c.nome ORDER BY total DESC LIMIT 5", []))
      .map((r) => ({ nome: r.nome, total: Number(r.total) }));
  }

  // ---------- Clientes ----------
  const SELECT_CLIENTE =
    "SELECT c.id, c.usuario_id, c.nome, u.telefone, c.morada, c.renda_diaria, c.tipo_negocio, c.local_negocio, " +
    "c.coabitantes, c.classificacao FROM clientes c JOIN usuarios u ON u.id = c.usuario_id ";

  function lerCliente(r) {
    return {
      id: Number(r.id), usuarioId: Number(r.usuario_id), nome: r.nome, telefone: r.telefone,
      morada: r.morada, rendaDiaria: Number(r.renda_diaria || 0), tipoNegocio: r.tipo_negocio,
      localNegocio: r.local_negocio, coabitantes: r.coabitantes, classificacao: r.classificacao,
      emDivida: 0, prestacoesEmAtraso: 0, prestacoesPorPagar: 0, emprestimos: 0,
    };
  }

  async function listarClientes(filtro) {
    const f = "%" + (filtro || "").trim() + "%";
    const lista = (await DB.consultar(SELECT_CLIENTE +
      "WHERE c.nome ILIKE ? OR u.telefone ILIKE ? OR c.local_negocio ILIKE ? ORDER BY c.nome", [f, f, f]))
      .map(lerCliente);
    const porId = new Map(lista.map((c) => [c.id, c]));
    const hoje = Regras.hojeISO();
    for (const p of await listarPorPagar()) {
      const c = porId.get(p.clienteId);
      if (!c) continue;
      c.emDivida += Regras.emFalta(p, hoje);
      c.prestacoesPorPagar++;
      if (Regras.diasAtraso(p.vencimento, hoje) > 0) c.prestacoesEmAtraso++;
    }
    for (const c of lista) c.emDivida = Regras.arredondar(c.emDivida);
    for (const r of await DB.consultar(
      "SELECT cliente_id, COUNT(*) AS n FROM emprestimos WHERE status IN ('APROVADO','PAGO') GROUP BY cliente_id", [])) {
      const c = porId.get(Number(r.cliente_id));
      if (c) c.emprestimos = Number(r.n);
    }
    return lista;
  }

  // ---------- Empréstimos ----------
  const SELECT_EMP =
    "SELECT e.id, e.cliente_id, c.nome, u.telefone, e.valor_solicitado, e.taxa_assistencia, e.valor_total, " +
    "e.tipo_pagamento, e.data_solicitacao, e.data_aprovacao, e.bens_garantia, e.status, e.criado_por " +
    "FROM emprestimos e JOIN clientes c ON c.id = e.cliente_id JOIN usuarios u ON u.id = c.usuario_id ";

  function lerEmp(r) {
    return {
      id: Number(r.id), clienteId: Number(r.cliente_id), nomeCliente: r.nome, telefoneCliente: r.telefone,
      capital: Number(r.valor_solicitado), taxaAssistencia: Number(r.taxa_assistencia || 0),
      totalAPagar: Number(r.valor_total), modalidade: r.tipo_pagamento,
      dataPedido: Regras.dataBase(r.data_solicitacao), dataAprovacao: Regras.dataBase(r.data_aprovacao),
      bensGarantia: r.bens_garantia, estado: r.status, criadoPor: r.criado_por,
      jaPago: 0, emFalta: 0, prestacoesPagas: 0, totalPrestacoes: 0, prestacoesEmAtraso: 0,
    };
  }

  async function listarEmprestimos() {
    const lista = (await DB.consultar(SELECT_EMP + "WHERE e.status <> 'REJEITADO' ORDER BY e.id DESC", [])).map(lerEmp);
    if (!lista.length) return lista;
    const ids = lista.map((e) => e.id);
    const porId = new Map(lista.map((e) => [e.id, e]));
    const hoje = Regras.hojeISO();
    const prest = (await DB.consultar(SELECT_PREST +
      "WHERE p.emprestimo_id = ANY(?::int[]) ORDER BY p.emprestimo_id, p.numero_prestacao",
      ["{" + ids.join(",") + "}"])).map(lerPrest);
    for (const p of prest) {
      const e = porId.get(p.emprestimoId);
      if (!e) continue;
      e.totalPrestacoes++;
      if (p.estado === "PAGO") { e.prestacoesPagas++; e.jaPago += p.valorPago; }
      else {
        e.emFalta += Regras.emFalta(p, hoje);
        if (Regras.diasAtraso(p.vencimento, hoje) > 0) e.prestacoesEmAtraso++;
      }
    }
    for (const e of lista) { e.emFalta = Regras.arredondar(e.emFalta); e.jaPago = Regras.arredondar(e.jaPago); }
    return lista;
  }

  // ---------- Caixa ----------
  async function saldoCaixa() {
    const r = (await DB.consultar(
      "SELECT COALESCE(SUM(CASE WHEN tipo='ENTRADA' THEN valor END),0) AS entradas, " +
      "COALESCE(SUM(CASE WHEN tipo='SAIDA' THEN valor END),0) AS saidas FROM caixa", []))[0];
    const entradas = Number(r.entradas), saidas = Number(r.saidas);
    return { entradas, saidas, saldo: Regras.arredondar(entradas - saidas) };
  }

  async function ultimosMovimentos(quantidade) {
    return (await DB.consultar(
      "SELECT id, tipo, valor, justificativa, categoria, data_movimento, registado_por " +
      "FROM caixa WHERE NOT oculto ORDER BY id DESC LIMIT ?", [quantidade || 50]))
      .map((r) => ({
        id: Number(r.id), tipo: r.tipo, valor: Number(r.valor), justificativa: r.justificativa,
        categoria: r.categoria, dataMovimento: r.data_movimento, registadoPor: r.registado_por,
      }));
  }

  // ---------- Registar pagamento (transação, fiel ao PrestacaoDao) ----------
  async function registarPagamento(prestacaoId, valorPedido, registadoPor, diaISO) {
    const hoje = Regras.hojeISO();
    const dia = diaISO || hoje;
    let valor = Regras.arredondar(valorPedido);
    if (valor <= 0) return { ok: false, msg: "Indique um valor válido, maior que zero." };
    if (Regras.diasEntre(hoje, dia) > 0) return { ok: false, msg: "A data do pagamento não pode ser depois de hoje." };

    const escolhidaRows = (await DB.consultar(SELECT_PREST + "WHERE p.id = ?", [prestacaoId])).map(lerPrest);
    if (!escolhidaRows.length) return { ok: false, msg: "A prestação já não existe." };
    const primeira = escolhidaRows[0];
    if (primeira.estado === "PAGO") return { ok: false, msg: "Esta prestação já está paga." };

    const minimoR = await DB.consultar(
      "SELECT e.data_aprovacao FROM prestacoes p JOIN emprestimos e ON e.id = p.emprestimo_id WHERE p.id = ?", [prestacaoId]);
    const minimo = minimoR.length ? Regras.dataBase(minimoR[0].data_aprovacao) : null;
    if (minimo && Regras.diasEntre(minimo, dia) < 0)
      return { ok: false, msg: "A data do pagamento não pode ser antes do desembolso do empréstimo (" + Regras.data(minimo) + ")." };

    // A escolhida e as seguintes primeiro; depois alguma anterior ainda por pagar
    const aPagar = (await DB.consultar(SELECT_PREST +
      "WHERE p.emprestimo_id = ? AND p.status='PENDENTE' ORDER BY (p.numero_prestacao < ?), p.numero_prestacao",
      [primeira.emprestimoId, primeira.numero])).map(lerPrest);

    let divida = 0;
    for (const p of aPagar) divida += Regras.emFalta(p, dia);
    divida = Regras.arredondar(divida);
    const excedente = valor > divida + 0.005 ? Regras.arredondar(valor - divida) : 0;

    let restante = valor, pagas = 0;
    const comandos = [];
    const aplicadas = [];   // {id, valor}
    for (const p of aPagar) {
      if (restante <= 0.005) break;
      const falta = Regras.emFalta(p, dia);
      if (restante + 0.005 >= falta) {
        comandos.push({
          sql: "UPDATE prestacoes SET valor_pago=?, multa_congelada=?, status='PAGO', data_pagamento=? WHERE id=?",
          params: [Regras.arredondar(p.valorPago + falta), Regras.multaPrestacao(p, dia), dia, p.id],
        });
        aplicadas.push({ id: p.id, valor: Regras.arredondar(falta) });
        restante = Regras.arredondar(restante - falta);
        pagas++;
      } else {
        comandos.push({
          sql: "UPDATE prestacoes SET valor_pago=? WHERE id=?",
          params: [Regras.arredondar(p.valorPago + restante), p.id],
        });
        aplicadas.push({ id: p.id, valor: Regras.arredondar(restante) });
        restante = 0;
      }
    }

    // Entrada no caixa
    const dataMov = dia !== hoje ? (dia + " " + new Date().toTimeString().slice(0, 8)) : null;
    if (dataMov) {
      comandos.push({
        sql: "INSERT INTO caixa (tipo, valor, justificativa, categoria, emprestimo_id, registado_por, data_movimento) " +
             "VALUES ('ENTRADA', ?, ?, 'PRESTACAO', ?, ?, ?)",
        params: [Regras.arredondar(valor - excedente),
          "Pagamento de Prestação - Empréstimo #" + primeira.emprestimoId + " - " + primeira.nomeCliente,
          primeira.emprestimoId, registadoPor, dataMov],
      });
    } else {
      comandos.push({
        sql: "INSERT INTO caixa (tipo, valor, justificativa, categoria, emprestimo_id, registado_por) " +
             "VALUES ('ENTRADA', ?, ?, 'PRESTACAO', ?, ?)",
        params: [Regras.arredondar(valor - excedente),
          "Pagamento de Prestação - Empréstimo #" + primeira.emprestimoId + " - " + primeira.nomeCliente,
          primeira.emprestimoId, registadoPor],
      });
    }
    for (const a of aplicadas) {
      comandos.push({
        sql: "INSERT INTO pagamentos_aplicados (caixa_id, prestacao_id, valor) " +
             "VALUES (currval(pg_get_serial_sequence('caixa','id')), ?, ?)",
        params: [a.id, a.valor],
      });
    }

    // Excedente -> poupança do cliente
    if (excedente > 0) {
      const desc = "Excedente do pagamento do empréstimo #" + primeira.emprestimoId;
      if (dataMov) {
        comandos.push({
          sql: "INSERT INTO caixa (tipo, valor, justificativa, categoria, registado_por, data_movimento) " +
               "VALUES ('ENTRADA', ?, ?, 'POUPANCA', ?, ?)",
          params: [excedente, "Depósito na poupança - " + primeira.nomeCliente, registadoPor, dataMov],
        });
      } else {
        comandos.push({
          sql: "INSERT INTO caixa (tipo, valor, justificativa, categoria, registado_por) " +
               "VALUES ('ENTRADA', ?, ?, 'POUPANCA', ?)",
          params: [excedente, "Depósito na poupança - " + primeira.nomeCliente, registadoPor],
        });
      }
      comandos.push({
        sql: "INSERT INTO poupanca_clientes (cliente_id, tipo, valor, emprestimo_id, descricao, registado_por, origem_caixa_id) " +
             "VALUES (?, 'DEPOSITO', ?, ?, ?, ?, currval(pg_get_serial_sequence('caixa','id')))",
        params: [primeira.clienteId, excedente, primeira.emprestimoId, desc, registadoPor],
      });
    }

    // Liquidar o empréstimo se já não houver prestações por pagar depois deste lote
    const restamIds = aplicadas.filter((a) => {
      const p = aPagar.find((x) => x.id === a.id);
      return p && Regras.arredondar(p.valorPago + a.valor) + 0.005 < Regras.arredondar(p.valor + Regras.multaPrestacao(p, dia));
    });
    const pendentesDepois = aPagar.filter((p) => !aplicadas.find((a) => a.id === p.id)).length + restamIds.length;
    const liquidado = excedente > 0 || pendentesDepois === 0;
    if (liquidado) {
      comandos.push({ sql: "UPDATE emprestimos SET status='PAGO' WHERE id=?", params: [primeira.emprestimoId] });
    }

    await DB.lote(comandos);

    let msg = "Pagamento de " + Regras.mt(valor) + " registado.";
    if (pagas > 1) msg += " " + pagas + " prestações ficaram pagas.";
    else if (pagas === 0) msg += " Pagamento parcial: a prestação continua por pagar.";
    if (liquidado) msg += " O empréstimo ficou totalmente pago!";
    if (excedente > 0) msg += " Sobraram " + Regras.mt(excedente) + ": ficaram na Poupança do cliente.";
    if (dia !== hoje) msg += " Data do pagamento: " + Regras.data(dia) + ".";
    return { ok: true, msg };
  }

  // ---------- Clientes: escrita ----------
  function codigoAcesso() { return String(Math.floor(Math.random() * 1000000)).padStart(6, "0"); }

  function validarCliente(c) {
    if (!c.nome || c.nome.trim().length < 3) return "Indique o nome completo do cliente.";
    const tel = (c.telefone || "").replace(/ /g, "");
    if (!/^\d{9,12}$/.test(tel)) return "Indique um telefone válido (só números, ex.: 841234567).";
    if (!c.morada || !c.morada.trim()) return "Indique a morada do cliente.";
    if (c.rendaDiaria < 0) return "A renda diária não pode ser negativa.";
    return null;
  }

  async function registarCliente(c, registadoPor) {
    const erro = validarCliente(c);
    if (erro) return { ok: false, msg: erro };
    const telefone = c.telefone.replace(/ /g, "");
    const codigo = codigoAcesso();
    const h = await Regras.hash(codigo);
    try {
      await DB.executar(
        "WITH conta AS (INSERT INTO usuarios (telefone, nome_exibicao, senha_hash, tipo_usuario) VALUES (?, ?, ?, 'CLIENTE') RETURNING id) " +
        "INSERT INTO clientes (usuario_id, nome, morada, renda_diaria, tipo_negocio, local_negocio, coabitantes, classificacao, registado_por) " +
        "SELECT id, ?, ?, ?::numeric, ?, ?, ?, 'NOVO', ? FROM conta",
        [telefone, c.nome.trim(), h, c.nome.trim(), c.morada.trim(), c.rendaDiaria || 0,
         (c.tipoNegocio || "").trim() || "Geral", (c.localNegocio || "").trim(), (c.coabitantes || "").trim(), registadoPor]);
      return { ok: true, msg: "Cliente registado. Código de acesso do cliente: " + codigo, codigo };
    } catch (e) {
      if (e.code && e.code.startsWith("23")) return { ok: false, msg: "Já existe uma conta com o telefone " + telefone + "." };
      return { ok: false, msg: e.message };
    }
  }

  async function atualizarCliente(c) {
    const erro = validarCliente(c);
    if (erro) return { ok: false, msg: erro };
    await DB.executar(
      "UPDATE clientes SET nome=?, morada=?, renda_diaria=?, tipo_negocio=?, local_negocio=?, coabitantes=? WHERE id=?",
      [c.nome.trim(), c.morada.trim(), c.rendaDiaria || 0, (c.tipoNegocio || "").trim(),
       (c.localNegocio || "").trim(), (c.coabitantes || "").trim(), c.id]);
    return { ok: true, msg: "Dados do cliente atualizados." };
  }

  async function novoCodigoAcesso(clienteId, usuarioId) {
    const codigo = codigoAcesso();
    const h = await Regras.hash(codigo);
    const r = await DB.executar("UPDATE usuarios SET senha_hash=? WHERE id=? AND tipo_usuario='CLIENTE'", [h, usuarioId]);
    return r.afetadas === 1 ? { ok: true, msg: "Novo código de acesso: " + codigo, codigo } : { ok: false, msg: "Não foi possível gerar o código." };
  }

  async function eliminarCliente(usuarioId) {
    const r = await DB.executar("DELETE FROM usuarios WHERE id=? AND tipo_usuario='CLIENTE'", [usuarioId]);
    return r.afetadas === 1 ? { ok: true, msg: "Cliente eliminado." } : { ok: false, msg: "Não foi possível eliminar o cliente." };
  }

  async function poupancaSaldo(clienteId) {
    try {
      const r = await DB.consultar(
        "SELECT COALESCE(SUM(CASE WHEN tipo='DEPOSITO' THEN valor ELSE -valor END),0) AS saldo FROM poupanca_clientes WHERE cliente_id=?", [clienteId]);
      return r.length ? Regras.arredondar(Number(r[0].saldo)) : 0;
    } catch (e) { return 0; }
  }

  // ---------- Empréstimos: escrita ----------
  async function clienteTemPendente(clienteId) {
    const r = await DB.consultar("SELECT id FROM emprestimos WHERE cliente_id=? AND status='PENDENTE' LIMIT 1", [clienteId]);
    return r.length ? Number(r[0].id) : 0;
  }

  async function pedirEmprestimo(clienteId, capital, modalidade, bensGarantia, criadoPor) {
    const ev = Regras.validarValor(capital);
    if (ev) return { ok: false, msg: ev };
    if (modalidade !== "PARCELADO" && modalidade !== "UNICO") return { ok: false, msg: "Escolha a modalidade de pagamento." };
    if (!bensGarantia || bensGarantia.trim().length < 3) return { ok: false, msg: "Indique os bens dados como garantia." };
    const pend = await clienteTemPendente(clienteId);
    if (pend) return { ok: false, msg: "Este cliente já tem um pedido à espera de aprovação (nº " + pend + ")." };
    const porPagar = (await listarPorPagar()).filter((p) => p.clienteId === clienteId).length;
    if (porPagar) return { ok: false, msg: "O cliente ainda tem prestações por pagar. Pague toda a dívida antes de um novo crédito." };

    capital = Regras.arredondar(capital);
    const hoje = Regras.hojeISO();
    const r = await DB.executar(
      "INSERT INTO emprestimos (cliente_id, valor_solicitado, taxa_assistencia, valor_total, tipo_pagamento, data_solicitacao, bens_garantia, status, criado_por) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDENTE', ?) RETURNING id",
      [clienteId, capital, Regras.taxaAssistencia(capital), Regras.totalAPagar(capital), modalidade, hoje, bensGarantia.trim(), criadoPor]);
    const id = r.linhas.length ? r.linhas[0][0] : "";
    return { ok: true, msg: "Pedido nº " + id + " enviado! Fica à espera da aprovação (até " + Regras.data(Regras.limiteAprovacao(hoje)) + ")." };
  }

  async function listarPendentes() {
    return (await DB.consultar(SELECT_EMP + "WHERE e.status='PENDENTE' ORDER BY e.data_solicitacao, e.id", [])).map(lerEmp);
  }

  async function aprovar(emp, administrador, capital, modalidade, dataAprovacaoISO) {
    if (emp.estado !== "PENDENTE") return { ok: false, msg: "Este pedido já não está pendente." };
    const hoje = Regras.hojeISO();
    const limite = Regras.limiteAprovacao(emp.dataPedido);
    if (Regras.diasEntre(limite, hoje) > 0) return { ok: false, msg: "O prazo para aprovar este pedido terminou a " + Regras.data(limite) + "." };
    const ev = Regras.validarValor(capital);
    if (ev) return { ok: false, msg: ev };
    capital = Regras.arredondar(capital);
    const divida = (await listarPorPagar()).filter((p) => p.clienteId === emp.clienteId).length;
    if (divida) return { ok: false, msg: "O cliente ainda tem prestações por pagar. Só se aprova um novo crédito depois de pagar toda a dívida." };

    const aprovadosAntes = Number((await DB.consultar(
      "SELECT COUNT(*) AS n FROM emprestimos WHERE cliente_id=? AND status IN ('APROVADO','PAGO')", [emp.clienteId]))[0].n);
    let poupanca = await poupancaSaldo(emp.clienteId);

    const dataAp = dataAprovacaoISO || hoje;
    const horaAgora = new Date().toTimeString().slice(0, 8);
    const comandos = [];
    comandos.push({
      sql: "UPDATE emprestimos SET status='APROVADO', valor_solicitado=?, taxa_assistencia=?, valor_total=?, tipo_pagamento=?, data_aprovacao=?, processado_por=? WHERE id=?",
      params: [capital, Regras.taxaAssistencia(capital), Regras.totalAPagar(capital), modalidade, dataAp, administrador, emp.id],
    });
    comandos.push({
      sql: "INSERT INTO caixa (tipo, valor, justificativa, categoria, emprestimo_id, registado_por, data_movimento) VALUES ('SAIDA', ?, ?, 'DESEMBOLSO', ?, ?, ?)",
      params: [capital, "Desembolso do Empréstimo #" + emp.id + " - Cliente: " + emp.nomeCliente, emp.id, administrador, dataAp + " " + horaAgora],
    });

    let restante = poupanca, usado = 0, quitadas = 0, linhasN = 0;
    const numeros = [];
    for (const linha of Regras.plano(capital, modalidade, emp.dataPedido)) {
      linhasN++;
      const campos = { valor_pago: 0, status: "PENDENTE", multa_congelada: null, data_pagamento: null };
      if (restante > 0.005) {
        const aplicar = Regras.arredondar(Math.min(restante, linha.valor));
        campos.valor_pago = aplicar;
        if (aplicar + 0.005 >= linha.valor) { campos.status = "PAGO"; campos.multa_congelada = 0; campos.data_pagamento = dataAp; quitadas++; }
        restante = Regras.arredondar(restante - aplicar);
        usado = Regras.arredondar(usado + aplicar);
        numeros.push(linha.numero);
      }
      comandos.push({
        sql: "INSERT INTO prestacoes (emprestimo_id, numero_prestacao, data_vencimento, valor_esperado, status, valor_pago, multa_congelada, data_pagamento) VALUES (?,?,?,?,?,?,?,?)",
        params: [emp.id, linha.numero, linha.vencimento, linha.valor, campos.status, campos.valor_pago, campos.multa_congelada, campos.data_pagamento],
      });
    }

    if (usado > 0) {
      const nums = numeros.join(",");
      const det = numeros.map((n) => n + "ª").join(", ");
      const uma = numeros.length === 1;
      const detalhe = (uma ? "" : "prestações ") + det + (uma ? " prestação" : "");
      comandos.push({
        sql: "INSERT INTO poupanca_clientes (cliente_id, tipo, valor, emprestimo_id, prestacao_numero, descricao, registado_por, data_movimento) VALUES (?, 'USO', ?, ?, ?, ?, ?, ?)",
        params: [emp.clienteId, usado, emp.id, nums, "Usado " + (uma ? "na " : "nas ") + detalhe + " do Empréstimo #" + emp.id, administrador, dataAp + " " + horaAgora],
      });
      comandos.push({
        sql: "INSERT INTO caixa (tipo, valor, justificativa, categoria, emprestimo_id, prestacao_numero, registado_por, data_movimento) VALUES ('SAIDA', ?, ?, 'POUPANCA', ?, ?, ?, ?)",
        params: [usado, "Uso da Poupança de Clientes " + (uma ? "na " : "nas ") + detalhe + " - Empréstimo #" + emp.id + " - Cliente: " + emp.nomeCliente, emp.id, nums, administrador, dataAp + " " + horaAgora],
      });
      comandos.push({
        sql: "INSERT INTO caixa (tipo, valor, justificativa, categoria, emprestimo_id, prestacao_numero, registado_por, data_movimento) VALUES ('ENTRADA', ?, ?, 'PRESTACAO', ?, ?, ?, ?)",
        params: [usado, "Pagamento " + (uma ? "da " : "das ") + detalhe + " com a poupança do cliente - Empréstimo #" + emp.id + " - Cliente: " + emp.nomeCliente, emp.id, nums, administrador, dataAp + " " + horaAgora],
      });
      if (quitadas === linhasN) comandos.push({ sql: "UPDATE emprestimos SET status='PAGO' WHERE id=?", params: [emp.id] });
    }

    comandos.push({
      sql: "UPDATE clientes SET classificacao=? WHERE id=?",
      params: [aprovadosAntes >= 2 ? "BOM CLIENTE (ANTIGO)" : "REGULAR", emp.clienteId],
    });

    await DB.lote(comandos);
    let msg = "Pedido nº " + emp.id + " aprovado. Saíram " + Regras.mt(capital) + " do caixa e foram geradas as prestações.";
    if (usado > 0) msg += " O cliente tinha " + Regras.mt(usado) + " na Poupança: foi descontado na 1ª prestação.";
    return { ok: true, msg };
  }

  async function rejeitar(id, administrador) {
    const agora = new Date().toISOString().slice(0, 19).replace("T", " ");
    const r = await DB.executar("UPDATE emprestimos SET status='REJEITADO', processado_por=?, rejeitado_em=? WHERE id=? AND status='PENDENTE'", [administrador, agora, id]);
    return r.afetadas === 1 ? { ok: true, msg: "Pedido nº " + id + " rejeitado. Foi para a Lixeira." } : { ok: false, msg: "Este pedido já não está pendente." };
  }

  async function eliminarPendente(id) {
    const r = await DB.executar("DELETE FROM emprestimos WHERE id=? AND status='PENDENTE'", [id]);
    return r.afetadas === 1 ? { ok: true, msg: "Pedido nº " + id + " eliminado." } : { ok: false, msg: "Só é possível eliminar pedidos pendentes." };
  }

  async function anular(emp, quem) {
    if (emp.estado === "PENDENTE") return { ok: false, msg: 'Este pedido ainda está pendente: use "Eliminar pedido".' };
    if (emp.jaPago > 0) return { ok: false, msg: "Não é possível anular: este empréstimo já tem pagamentos registados." };
    await DB.lote([
      { sql: "INSERT INTO caixa_eliminados (caixa_id, tipo, valor, justificativa, categoria, emprestimo_id, data_movimento, registado_por, eliminado_por) " +
             "SELECT id, tipo, valor, justificativa, categoria, emprestimo_id, data_movimento, registado_por, ? FROM caixa WHERE emprestimo_id=? AND tipo='SAIDA'", params: [quem, emp.id] },
      { sql: "DELETE FROM caixa WHERE emprestimo_id=? AND tipo='SAIDA'", params: [emp.id] },
      { sql: "DELETE FROM prestacoes WHERE emprestimo_id=?", params: [emp.id] },
      { sql: "DELETE FROM emprestimos WHERE id=?", params: [emp.id] },
    ]);
    return { ok: true, msg: "Empréstimo nº " + emp.id + " anulado. O desembolso foi para o Lixo do Caixa." };
  }

  // ---------- Caixa: escrita ----------
  async function registarCaixa(tipo, valor, justificativa, diaISO, registadoPor) {
    valor = Regras.arredondar(valor);
    if (tipo !== "ENTRADA" && tipo !== "SAIDA") return { ok: false, msg: "Tipo de movimento inválido." };
    if (valor <= 0) return { ok: false, msg: "Indique um valor válido, maior que zero." };
    if (!justificativa || !justificativa.trim()) return { ok: false, msg: "Indique a justificação." };
    const data = (diaISO || Regras.hojeISO()) + " " + new Date().toTimeString().slice(0, 8);
    await DB.executar(
      "INSERT INTO caixa (tipo, valor, justificativa, categoria, registado_por, data_movimento) VALUES (?,?,?,?,?,?)",
      [tipo, valor, justificativa.trim(), tipo === "ENTRADA" ? "CAPITAL" : "DESPESA", registadoPor, data]);
    return { ok: true, msg: (tipo === "ENTRADA" ? "Entrada" : "Despesa") + " de " + Regras.mt(valor) + " registada." };
  }

  // ---------- Utilizadores ----------
  async function listarUtilizadores() {
    const principal = await idAdminPrincipal();
    const lista = (await DB.consultar(SELECT_USER + "WHERE u.tipo_usuario <> 'CLIENTE' ORDER BY u.tipo_usuario, u.telefone", [])).map(lerUser);
    for (const u of lista) u.principal = u.id === principal;
    return lista;
  }

  function permissoesParaBase(csv, perfil) {
    if (csv == null) return null;
    return csv.split(",").map((c) => {
      let x = c.trim();
      if (x === "COBRANCAS") x = perfil === "ADMIN" ? "PRESTACOES_DIA" : "COBRANCAS_HOJE";
      else if (x === "UTILIZADORES") x = "AGENTES";
      return x;
    }).filter(Boolean).join(",");
  }

  async function criarUtilizador(utilizador, nome, senha, perfil, permissoesCsv) {
    utilizador = (utilizador || "").trim();
    if (utilizador.length < 3) return { ok: false, msg: "O nome de utilizador deve ter pelo menos 3 caracteres." };
    if (!senha || senha.trim().length < 6) return { ok: false, msg: "A senha deve ter pelo menos 6 caracteres." };
    if (perfil !== "ADMIN" && perfil !== "AGENTE") return { ok: false, msg: "Perfil inválido." };
    const existe = await DB.consultar("SELECT 1 FROM usuarios WHERE LOWER(telefone)=LOWER(?)", [utilizador]);
    if (existe.length) return { ok: false, msg: "Já existe uma conta com esse nome de utilizador." };
    const h = await Regras.hash(senha);
    await DB.executar("INSERT INTO usuarios (telefone, nome_exibicao, senha_hash, tipo_usuario, permissoes) VALUES (?,?,?,?,?)",
      [utilizador, (nome || "").trim(), h, perfil, permissoesParaBase(permissoesCsv, perfil)]);
    return { ok: true, msg: "Utilizador " + utilizador + " criado." };
  }

  async function atualizarUtilizador(id, nome, perfil, ativo, permissoesCsv, novaSenha) {
    if (perfil !== "ADMIN" && perfil !== "AGENTE") return { ok: false, msg: "Perfil inválido." };
    const campos = ["nome_exibicao=?", "tipo_usuario=?", "ativo=?", "permissoes=?"];
    const params = [(nome || "").trim(), perfil, ativo, permissoesParaBase(permissoesCsv, perfil)];
    if (novaSenha && novaSenha.trim()) {
      if (novaSenha.trim().length < 6) return { ok: false, msg: "A senha deve ter pelo menos 6 caracteres." };
      campos.push("senha_hash=?"); params.push(await Regras.hash(novaSenha));
    }
    params.push(id);
    const r = await DB.executar("UPDATE usuarios SET " + campos.join(", ") + " WHERE id=? AND tipo_usuario <> 'CLIENTE'", params);
    return r.afetadas === 1 ? { ok: true, msg: "Utilizador atualizado." } : { ok: false, msg: "Não foi possível atualizar." };
  }

  async function eliminarUtilizador(id) {
    const r = await DB.executar("DELETE FROM usuarios WHERE id=? AND tipo_usuario <> 'CLIENTE'", [id]);
    return r.afetadas === 1 ? { ok: true, msg: "Utilizador eliminado." } : { ok: false, msg: "Não foi possível eliminar." };
  }

  async function alterarSenha(id, atual, nova) {
    if (!nova || nova.trim().length < 6) return { ok: false, msg: "A nova senha deve ter pelo menos 6 caracteres." };
    if (nova.trim() === (atual || "").trim()) return { ok: false, msg: "A nova senha tem de ser diferente da atual." };
    const r = await DB.executar("UPDATE usuarios SET senha_hash=? WHERE id=? AND senha_hash=?",
      [await Regras.hash(nova), id, await Regras.hash(atual || "")]);
    return r.afetadas === 1 ? { ok: true, msg: "Senha alterada." } : { ok: false, msg: "A senha atual não está correta." };
  }

  async function alterarNome(id, nome) {
    await DB.executar("UPDATE usuarios SET nome_exibicao=? WHERE id=?", [(nome || "").trim(), id]);
    return { ok: true, msg: "Nome atualizado." };
  }

  // ---------- Notificações ----------
  async function listarNotificacoes(usuarioId) {
    try {
      return (await DB.consultar(
        "SELECT id, titulo, mensagem, lida, data_criacao, tipo FROM notificacoes WHERE usuario_id=? OR usuario_id IS NULL ORDER BY id DESC LIMIT 50", [usuarioId]))
        .map((r) => ({ id: Number(r.id), titulo: r.titulo, mensagem: r.mensagem, lida: r.lida === "true" || r.lida === "t", data: r.data_criacao, tipo: r.tipo }));
    } catch (e) { return []; }
  }

  return {
    autenticar, idAdminPrincipal, balanco, cobrancasPrevistas, topClientes,
    listarClientes, listarEmprestimos, listarPorPagar, listarCobrancas, listarPorEmprestimo,
    saldoCaixa, ultimosMovimentos, registarPagamento,
    registarCliente, atualizarCliente, novoCodigoAcesso, eliminarCliente, poupancaSaldo,
    pedirEmprestimo, listarPendentes, aprovar, rejeitar, eliminarPendente, anular,
    registarCaixa, listarUtilizadores, criarUtilizador, atualizarUtilizador, eliminarUtilizador,
    alterarSenha, alterarNome, listarNotificacoes,
  };
})();
