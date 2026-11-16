/*
 * Regras do produto de crédito e utilitários — as mesmas da app Android/desktop Kubatsira,
 * para que todos os ecrãs mostrem exatamente os mesmos valores.
 */
const Regras = (() => {
  const TAXA_JUROS = 0.30;
  const MULTA_POR_DIA = 0.02;       // 2% do valor da prestação por dia de atraso

  // Arredonda a 2 casas (HALF_UP, como o BigDecimal do Android).
  function arredondar(v) {
    return Math.round((v + Number.EPSILON) * 100) / 100;
  }

  const TAXA_ASSISTENCIA = 0.01;
  const VALOR_MINIMO = 1000, VALOR_MAXIMO = 35000;
  const PRAZO_APROVACAO_DIAS = 5;
  const NUMERO_PRESTACOES_PARCELADO = 6, DIAS_ENTRE_PRESTACOES = 5, DIAS_PAGAMENTO_UNICO = 30;

  function totalAPagar(capital) { return arredondar(capital + capital * TAXA_JUROS); }
  function taxaAssistencia(capital) { return arredondar(capital * TAXA_ASSISTENCIA); }

  function validarValor(valor) {
    if (valor <= 0) return "Indique um valor de empréstimo válido.";
    if (valor < VALOR_MINIMO || valor > VALOR_MAXIMO)
      return "O valor do empréstimo tem de estar entre " + mt(VALOR_MINIMO) + " e " + mt(VALOR_MAXIMO) + ".";
    return null;
  }

  // Data local -> "YYYY-MM-DD". Não usar toISOString(): converte para UTC e, em Moçambique (UTC+2),
  // a meia-noite local passa a ser 22:00 do dia ANTERIOR (as datas ficavam com um dia a menos).
  function isoLocal(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  // Data e hora local -> "YYYY-MM-DD HH:MM:SS" (para gravar na base, como a app Android)
  function agoraLocal() {
    const d = new Date();
    return isoLocal(d) + " " + d.toTimeString().slice(0, 8);
  }

  function somaDias(iso, n) {
    const d = new Date(iso + "T00:00:00"); d.setDate(d.getDate() + n);
    return isoLocal(d);
  }

  // Calendário de pagamento: PARCELADO = 6 prestações de 5 em 5 dias; UNICO = 1 aos 30 dias.
  function plano(capital, modalidade, dataPedidoISO) {
    const total = totalAPagar(capital), linhas = [];
    if (modalidade === "PARCELADO") {
      const parcela = arredondar(total / NUMERO_PRESTACOES_PARCELADO);
      for (let i = 1; i <= NUMERO_PRESTACOES_PARCELADO; i++) {
        const valor = i === NUMERO_PRESTACOES_PARCELADO
          ? arredondar(total - parcela * (NUMERO_PRESTACOES_PARCELADO - 1)) : parcela;
        linhas.push({ numero: i, vencimento: somaDias(dataPedidoISO, i * DIAS_ENTRE_PRESTACOES), valor });
      }
    } else {
      linhas.push({ numero: 1, vencimento: somaDias(dataPedidoISO, DIAS_PAGAMENTO_UNICO), valor: total });
    }
    return linhas;
  }

  const limiteAprovacao = (dataPedidoISO) => somaDias(dataPedidoISO, PRAZO_APROVACAO_DIAS);

  // ---- Datas (texto da base <-> objeto) ----
  const hojeISO = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  // "YYYY-MM-DD" ou "YYYY-MM-DD HH:MM:SS" -> só a parte da data (YYYY-MM-DD)
  function dataBase(s) {
    if (!s) return null;
    return s.substring(0, 10);
  }

  // Diferença em dias inteiros entre duas datas YYYY-MM-DD (b - a)
  function diasEntre(aISO, bISO) {
    const a = new Date(aISO + "T00:00:00");
    const b = new Date(bISO + "T00:00:00");
    return Math.round((b - a) / 86400000);
  }

  function diasAtraso(vencimentoISO, hoje) {
    if (!vencimentoISO) return 0;
    return Math.max(0, diasEntre(vencimentoISO, hoje || hojeISO()));
  }

  function multa(valor, dias) { return arredondar(valor * MULTA_POR_DIA * dias); }

  // ---- Prestação: multa/em-falta calculados ao momento ----
  // p = {vencimento, valor, valorPago, multaCongelada, estado}
  function multaPrestacao(p, diaISO) {
    if (p.multaCongelada != null) return p.multaCongelada;
    return multa(p.valor, p.estado === "PAGO" ? 0 : diasAtraso(p.vencimento, diaISO));
  }
  function emFalta(p, diaISO) {
    if (p.estado === "PAGO") return 0;
    return Math.max(0, arredondar(p.valor + multaPrestacao(p, diaISO) - p.valorPago));
  }
  function situacaoPrestacao(p) {
    const hoje = hojeISO();
    if (p.estado === "PAGO") return "Paga";
    if (diasAtraso(p.vencimento, hoje) > 0) return "Em atraso";
    if (p.vencimento === hoje) return "Vence hoje";
    return "Por pagar";
  }

  // ---- Empréstimo: situação para mostrar ----
  function situacaoEmprestimo(estado, prestacoesEmAtraso) {
    switch (estado) {
      case "PENDENTE": return "Por aprovar";
      case "APROVADO": return prestacoesEmAtraso > 0 ? "Com atraso" : "Em curso";
      case "PAGO": return "Concluído";
      case "REJEITADO": return "Rejeitado";
      case "CANCELADO": return "Cancelado";
      default: return estado;
    }
  }

  // ---- Formatação ----
  function mt(v) {
    const n = Number(v) || 0;
    const neg = n < 0;
    const partes = Math.abs(n).toFixed(2).split(".");
    partes[0] = partes[0].replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    return (neg ? "-" : "") + partes[0] + "," + partes[1] + " MT";
  }

  function data(iso) {
    const d = dataBase(iso);
    if (!d) return "";
    const [a, m, dd] = d.split("-");
    return `${dd}/${m}/${a}`;
  }

  function dataHora(s) {
    if (!s) return "";
    const d = data(s);
    const h = s.length > 11 ? s.substring(11, 16) : "";
    return h ? `${d} ${h}` : d;
  }

  function iniciais(nome) {
    if (!nome || !nome.trim()) return "?";
    const p = nome.trim().split(/\s+/);
    let r = p[0][0];
    if (p.length > 1) r += p[p.length - 1][0];
    return r.toUpperCase();
  }

  // ---- Senha: SHA-256 em hexadecimal (igual a Seguranca.hash do Android) ----
  async function hash(texto) {
    const dados = new TextEncoder().encode((texto || "").trim());
    const buf = await crypto.subtle.digest("SHA-256", dados);
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  return {
    TAXA_JUROS, MULTA_POR_DIA, TAXA_ASSISTENCIA, VALOR_MINIMO, VALOR_MAXIMO, PRAZO_APROVACAO_DIAS,
    arredondar, totalAPagar, taxaAssistencia, validarValor, plano, limiteAprovacao, somaDias,
    hojeISO, dataBase, diasEntre, diasAtraso, multa, multaPrestacao, emFalta,
    situacaoPrestacao, situacaoEmprestimo, mt, data, dataHora, iniciais, hash,
    isoLocal, agoraLocal,
  };
})();
