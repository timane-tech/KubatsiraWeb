# -*- coding: utf-8 -*-
"""
Gateway de SMS de cobrança do Kubatsira (corre no GitHub Actions, 3x/dia).

Lê a base Neon (prestações que vencem hoje ou em atraso), compõe a mesma mensagem da app Android,
evita duplicados (tabela sms_cobranca, UNIQUE dia+turno+cliente), envia pela API da Africa's Talking
e regista o envio. NÃO precisa de telemóvel.

Variáveis de ambiente (vêm dos GitHub Secrets — nunca ficam no código):
  NEON_URL      postgresql://...  (base REAL)
  AT_USERNAME   utilizador da Africa's Talking (use "sandbox" para testes)
  AT_API_KEY    chave da API
  AT_FROM       (opcional) sender ID / shortcode registado (ex.: "Kubatsira")
  AT_ENV        (opcional) "sandbox" para o ambiente de testes; senão produção
  TURNO         (opcional) 8, 12 ou 14 (como a app: o número da hora); 0 = envio manual "a todos agora"
  DRY_RUN       (opcional) "1" = só mostra quem receberia e o texto; não envia nem grava
  EVENTO        "schedule" (horário automático) ou "workflow_dispatch" (à mão)

Regras (iguais à app Android, SmsCobranca):
  - O horário automático SÓ envia se o "SMS de cobrança automático" estiver LIGADO nas Configurações
    (configuracoes_sistema.sms_automatico = '1') e a hora já for depois de o terem ligado.
  - Correr à mão (Actions -> Run workflow) é o "Enviar a todos agora": envia mesmo com o interruptor desligado.
  - Sem as credenciais ainda configuradas, termina sem erro (não envia nada).
"""
import os, sys, json, datetime, decimal, urllib.request, urllib.parse, urllib.error

NEON_URL = os.environ.get("NEON_URL", "").strip()
AT_USERNAME = os.environ.get("AT_USERNAME", "").strip()
AT_API_KEY = os.environ.get("AT_API_KEY", "").strip()
AT_FROM = os.environ.get("AT_FROM", "").strip()
AT_ENV = os.environ.get("AT_ENV", "").strip().lower()
DRY_RUN = os.environ.get("DRY_RUN", "").strip() == "1"
EVENTO = os.environ.get("EVENTO", "").strip()
CRON = os.environ.get("CRON", "").strip()            # o horário (cron) que disparou esta corrida
CRON_COBRANCA = "0 6,10,12 * * *"                     # 08:00, 12:00 e 14:00 em Moçambique

MARCA = "Kubatsira Microcredito"
MULTA_DIA = decimal.Decimal("0.02")

def q2(v):
    return decimal.Decimal(str(v)).quantize(decimal.Decimal("0.01"), rounding=decimal.ROUND_HALF_UP)

def mt(v):
    v = q2(v)
    neg = v < 0
    inteiro, _, cent = str(abs(v)).partition(".")
    cent = (cent + "00")[:2]
    # separador de milhares com espaço
    grupos = []
    while len(inteiro) > 3:
        grupos.insert(0, inteiro[-3:]); inteiro = inteiro[:-3]
    grupos.insert(0, inteiro)
    return ("-" if neg else "") + " ".join(grupos) + "," + cent + " MT"

# ---------- Neon (SQL over HTTP) ----------
def neon_host():
    import urllib.parse as up
    return up.urlparse(NEON_URL).hostname

def neon(sql, params=None):
    host = neon_host()
    body = json.dumps({"query": sql, "params": [None if p is None else str(p) for p in (params or [])]}).encode("utf-8")
    req = urllib.request.Request("https://" + host + "/sql", data=body, method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("Neon-Connection-String", NEON_URL)
    req.add_header("Neon-Raw-Text-Output", "true")
    req.add_header("Neon-Array-Mode", "true")
    with urllib.request.urlopen(req, timeout=30) as r:
        j = json.loads(r.read().decode("utf-8"))
    cols = [f["name"] for f in j.get("fields", [])]
    return [dict(zip(cols, row)) for row in j.get("rows", [])]

# ---------- Datas / multa ----------
# Hora de Moçambique (UTC+2): o GitHub corre em UTC, e às 00h-02h o "hoje" seria o dia anterior
AGORA_MZ = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None) + datetime.timedelta(hours=2)
HOJE = AGORA_MZ.date()
def d(s):
    return datetime.date.fromisoformat(s[:10]) if s else None
def dias_atraso(venc):
    return max(0, (HOJE - venc).days) if venc else 0
def multa_prest(p):
    if p["multa_congelada"] is not None:
        return q2(p["multa_congelada"])
    return q2(decimal.Decimal(p["valor"]) * MULTA_DIA * dias_atraso(p["venc"]))
def em_falta(p):
    if p["status"] == "PAGO":
        return decimal.Decimal("0.00")
    return max(decimal.Decimal("0.00"), q2(decimal.Decimal(p["valor"]) + multa_prest(p) - decimal.Decimal(p["pago"])))

# ---------- Carregar prestações ----------
JA_COBERTA = "(p.multa_congelada IS NOT NULL AND COALESCE(p.valor_pago,0)+0.005 >= p.valor_esperado + p.multa_congelada)"
SELECT = ("SELECT p.id, p.emprestimo_id, p.numero_prestacao, p.data_vencimento, p.valor_esperado, p.valor_pago, "
          "p.multa_congelada, p.status, c.id AS cliente_id, c.nome, u.telefone "
          "FROM prestacoes p JOIN emprestimos e ON e.id=p.emprestimo_id "
          "JOIN clientes c ON c.id=e.cliente_id JOIN usuarios u ON u.id=c.usuario_id ")

def carregar(cond):
    out = []
    for r in neon(SELECT + cond):
        out.append({
            "id": int(r["id"]), "emp": int(r["emprestimo_id"]), "numero": int(r["numero_prestacao"]),
            "venc": d(r["data_vencimento"]), "valor": r["valor_esperado"], "pago": r["valor_pago"] or "0",
            "multa_congelada": r["multa_congelada"], "status": r["status"],
            "cliente_id": int(r["cliente_id"]), "nome": (r["nome"] or "").strip(), "tel": (r["telefone"] or "").strip(),
        })
    return out

# ---------- Mensagem (fiel à app Android) ----------
def saldos_poupanca():
    """cliente_id -> saldo da poupança (só quem tem saldo). Se a tabela não existir, fica vazio."""
    try:
        rows = neon("SELECT cliente_id, SUM(CASE WHEN tipo='DEPOSITO' THEN valor ELSE -valor END) AS saldo "
                    "FROM poupanca_clientes GROUP BY cliente_id "
                    "HAVING SUM(CASE WHEN tipo='DEPOSITO' THEN valor ELSE -valor END) > 0.005")
        return {int(r["cliente_id"]): decimal.Decimal(str(r["saldo"])) for r in rows}
    except Exception:
        return {}

def mensagem(prest, divida_total, poupanca=decimal.Decimal("0")):
    prest = sorted(prest, key=lambda p: (p["venc"] or HOJE, p["numero"]))
    total = decimal.Decimal("0.00"); multas = decimal.Decimal("0.00")
    atraso = False; linhas = []; n = 0
    for p in prest:
        n += 1
        m = multa_prest(p); falta = em_falta(p); dd = dias_atraso(p["venc"])
        total += falta; multas += m
        if dd > 0: atraso = True
        if n > 3: continue
        linha = f"- {p['numero']}a prest. (emp. {p['emp']}), "
        if dd > 0: linha += f"venceu {p['venc'].strftime('%d/%m')} ({dd} dia{'s' if dd != 1 else ''} atraso)"
        elif p["venc"] == HOJE: linha += "vence HOJE"
        else: linha += f"vence {p['venc'].strftime('%d/%m')}"
        linha += ": " + mt(falta)
        if m > 0: linha += " c/ multa " + mt(m)
        linhas.append(linha)
    if n > 3: linhas.append(f"- e mais {n-3} valor(es) em atraso")
    qt = len(prest)
    txt = f"Caro(a) {prest[0]['nome']},\n{MARCA} informa que tem {'1 prestacao' if qt==1 else str(qt)+' prestacoes'} em divida:\n"
    txt += "\n".join(linhas) + "\n"
    txt += "TOTAL A PAGAR: " + mt(total)
    if multas > 0: txt += " (inclui multas de " + mt(multas) + ")"
    txt += "\n"
    if divida_total > total + decimal.Decimal("0.5"):
        txt += "Divida total (com prestacoes por vencer): " + mt(divida_total) + "\n"
    if poupanca and poupanca > decimal.Decimal("0.005"):
        txt += "Tem " + mt(poupanca) + " guardados na sua poupanca.\n"
    txt += "Regularize o pagamento o mais breve possivel. Obrigado." if atraso else "Obrigado."
    return txt

# ---------- Telefone ----------
def telefone_internacional(tel):
    t = "".join(ch for ch in tel if ch.isdigit())
    if not t: return None
    if t.startswith("258"): return "+" + t
    return "+258" + t

# ---------- Africa's Talking ----------
def enviar_at(para, texto):
    host = "api.sandbox.africastalking.com" if AT_ENV == "sandbox" else "api.africastalking.com"
    dados = {"username": AT_USERNAME, "to": para, "message": texto}
    if AT_FROM: dados["from"] = AT_FROM
    req = urllib.request.Request("https://" + host + "/version1/messaging",
                                 data=urllib.parse.urlencode(dados).encode("utf-8"), method="POST")
    req.add_header("apiKey", AT_API_KEY)
    req.add_header("Accept", "application/json")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            j = json.loads(r.read().decode("utf-8"))
        rec = j.get("SMSMessageData", {}).get("Recipients", [])
        if rec and rec[0].get("status") == "Success":
            return True, rec[0].get("status", "")
        return False, (rec[0].get("status") if rec else j.get("SMSMessageData", {}).get("Message", "sem resposta"))
    except urllib.error.HTTPError as e:
        return False, "HTTP %s: %s" % (e.code, e.read().decode("utf-8", "replace")[:150])
    except Exception as e:
        return False, str(e)[:150]

# ---------- Registo em sms_cobranca (evita duplicados) ----------
def reservar(cliente_id, turno, nome, tel, valor, texto, agora):
    # ON CONFLICT DO NOTHING: se já há linha para (dia,turno,cliente), não envia outra vez
    r = neon(
        "INSERT INTO sms_cobranca (dia, turno, cliente_id, nome, telefone, valor, texto, enviado_em, enviado_por, automatico, estado) "
        "VALUES (?::date, ?::smallint, ?::int, ?, ?, ?::numeric, ?, ?::timestamp, 'gateway', TRUE, 'A_ENVIAR') "
        "ON CONFLICT (dia, turno, cliente_id) DO NOTHING RETURNING id",
        [HOJE.isoformat(), turno, cliente_id, nome, tel, str(q2(valor)), texto, agora])
    return int(r[0]["id"]) if r else None

def marcar(id_sms, estado, erro=None):
    neon("UPDATE sms_cobranca SET estado=?, erro=? WHERE id=?", [estado, erro, id_sms])

# ---------- Principal ----------
HORAS = (8, 12, 14)   # como a app Android (SmsCobranca.HORAS); 0 = envio manual

def turno_atual():
    if os.environ.get("TURNO", "").strip() != "":
        return int(os.environ["TURNO"])
    if EVENTO != "schedule":
        return 0                       # à mão = "Enviar a todos agora" (SmsCobrancaDao.MANUAL)
    h = AGORA_MZ.hour
    return 8 if h < 11 else (12 if h < 13 else 14)

def config(chave):
    try:
        r = neon("SELECT valor FROM configuracoes_sistema WHERE chave = ?", [chave])
        return r[0]["valor"] if r else None
    except Exception:
        return None

def registar_acesso(detalhe):
    # Fica no Controlo de Acesso, como o envio feito pelo telemóvel
    try:
        neon("INSERT INTO registo_acessos (data_hora, utilizador, usuario_id, perfil, evento, dispositivo, aparelho, detalhe) "
             "VALUES (?::timestamp, 'gateway', NULL, NULL, 'MENSAGEM', 'COMPUTADOR', 'Gateway de SMS (Internet)', ?)",
             [AGORA_MZ.replace(microsecond=0).isoformat(sep=" "), detalhe[:255]])
    except Exception:
        pass

# ---------- Fila (sms_fila): recados aos clientes e pedidos "cobrança a todos" feitos na web ou no computador ----------
def texto_recado(nome, recado):
    # Igual à app Android (SmsCobranca.textoRecado)
    return "Caro(a) %s,\n%s\n%s" % ((nome or "").strip(), (recado or "").strip(), MARCA)

def tratar_fila(agora):
    """Envia os recados pendentes. Devolve True se alguém pediu "cobrança a todos" (corre a cobrança à mão)."""
    try:
        fila = neon("UPDATE sms_fila SET estado = 'A_ENVIAR', tratado_em = ?::timestamp WHERE id IN "
                    "(SELECT id FROM sms_fila WHERE estado = 'PENDENTE' ORDER BY id LIMIT 300 FOR UPDATE SKIP LOCKED) "
                    "RETURNING id, tipo, nome, telefone, texto", [agora])
    except Exception as e:
        print("Fila de SMS indisponível: %s" % str(e)[:150]); return False
    pediu_cobranca = False; enviados = falhados = 0
    for r in fila:
        if r["tipo"] == "COBRANCA":
            pediu_cobranca = True
            neon("UPDATE sms_fila SET estado = 'ENVIADO', tratado_em = ?::timestamp WHERE id = ?::int", [agora, r["id"]]); continue
        tel = telefone_internacional(r["telefone"] or "")
        if not tel:
            neon("UPDATE sms_fila SET estado = 'SEM_NUMERO', tratado_em = ?::timestamp WHERE id = ?::int", [agora, r["id"]]); continue
        ok, info = enviar_at(tel, texto_recado(r["nome"], r["texto"]))
        neon("UPDATE sms_fila SET estado = ?, tratado_em = ?::timestamp WHERE id = ?::int", ["ENVIADO" if ok else "FALHOU", agora, r["id"]])
        if ok:
            enviados += 1; print("  RECADO OK  %s" % (r["nome"] or tel))
        else:
            falhados += 1; print("  RECADO FALHOU %s: %s" % (r["nome"] or tel, info))
    if fila:
        print("Fila: %d recado(s) enviado(s), %d falhado(s)%s." % (enviados, falhados, ", pedido de cobrança a todos" if pediu_cobranca else ""))
    if enviados:
        registar_acesso("Recados por SMS enviados: %d cliente(s)" % enviados)
    return pediu_cobranca

def main():
    if not NEON_URL:
        print("Ainda não configurado: falta o Secret NEON_URL. Nada enviado."); return
    if not DRY_RUN and (not AT_USERNAME or not AT_API_KEY):
        print("Ainda não configurado: faltam os Secrets AT_USERNAME/AT_API_KEY. Nada enviado."); return
    agora = AGORA_MZ.replace(microsecond=0).isoformat(sep=" ")
    # 1) A fila (recados e pedidos "cobrança a todos"): em todas as corridas
    pediu_cobranca = False if DRY_RUN else tratar_fila(agora)
    # 2) A cobrança: só nas corridas das 08/12/14, à mão (Run workflow) ou se alguém a pediu pela fila
    so_fila = EVENTO == "schedule" and CRON != "" and CRON != CRON_COBRANCA
    if so_fila and not pediu_cobranca:
        return
    turno = 0 if so_fila else turno_atual()
    # O horário automático respeita o interruptor das Configurações (web, telemóvel ou computador)
    if turno in HORAS and not DRY_RUN:
        if config("sms_automatico") != "1":
            print("SMS de cobrança automático DESLIGADO nas Configurações. Nada enviado."); return
        desde = config("sms_automatico_desde")
        try:
            if desde and datetime.datetime.fromisoformat(desde.replace(" ", "T")) > AGORA_MZ.replace(hour=turno, minute=59, second=59):
                print("Ligado depois das %02d:00 de hoje: este horário não é enviado." % turno); return
        except ValueError:
            pass
    print("Turno %s · dia %s · %s" % (turno, HOJE, "DRY_RUN" if DRY_RUN else "envio real"))

    # Prestações que vencem hoje ou em atraso (candidatas a cobrança)
    cobrancas = carregar("WHERE p.status='PENDENTE' AND e.status='APROVADO' AND p.data_vencimento <= '%s' AND NOT %s "
                         "ORDER BY p.data_vencimento, c.nome" % (HOJE.isoformat(), JA_COBERTA))
    # Dívida total por cliente (todas as prestações por pagar, mesmo as por vencer)
    todas = carregar("WHERE p.status='PENDENTE' AND e.status='APROVADO' AND NOT %s" % JA_COBERTA)
    divida = {}
    for p in todas:
        divida[p["cliente_id"]] = divida.get(p["cliente_id"], decimal.Decimal("0.00")) + em_falta(p)

    # Agrupar por cliente
    por_cliente = {}
    for p in cobrancas:
        por_cliente.setdefault(p["cliente_id"], []).append(p)

    poupanca = saldos_poupanca()
    enviados = falhados = pulados = 0
    for cid, prest in por_cliente.items():
        nome = prest[0]["nome"]; tel = telefone_internacional(prest[0]["tel"])
        total_cliente = sum((em_falta(p) for p in prest), decimal.Decimal("0.00"))
        texto = mensagem(prest, divida.get(cid, total_cliente), poupanca.get(cid, decimal.Decimal("0")))
        if not tel:
            print("  SEM TELEFONE: %s" % nome); continue
        if DRY_RUN:
            print("\n--- %s (%s) ---\n%s" % (nome, tel, texto)); enviados += 1; continue
        id_sms = reservar(cid, turno, nome, tel, total_cliente, texto, agora)
        if id_sms is None:
            pulados += 1; continue   # já recebeu neste turno
        ok, info = enviar_at(tel, texto)
        if ok:
            marcar(id_sms, "ENVIADO"); enviados += 1; print("  OK  %s" % nome)
        else:
            marcar(id_sms, "FALHOU", str(info)[:200]); falhados += 1; print("  FALHOU %s: %s" % (nome, info))

    print("\nResumo: %d enviado(s), %d falhado(s), %d ja tinham recebido." % (enviados, falhados, pulados))
    if enviados and not DRY_RUN:
        registar_acesso(("SMS de cobrança automático das %02d:00: " % turno if turno in HORAS else "SMS de cobrança a todos: ")
                        + "%d cliente(s)" % enviados)

if __name__ == "__main__":
    main()
