# Gateway de SMS automático (GitHub Actions + Africa's Talking)

Envia SMS de cobrança **sozinho**, a partir do GitHub (sem telemóvel), às **08h, 12h e 14h** de Moçambique.
Lê a base Neon, escolhe as prestações que vencem hoje ou estão em atraso, compõe a mesma mensagem da app
Android, evita duplicados (tabela `sms_cobranca`) e envia pela API da **Africa's Talking**.

## 1. Criar conta na Africa's Talking
1. Abre conta em africastalking.com e obtém:
   - **Username** (ex.: o teu nome de conta; para testes existe o username `sandbox`).
   - **API Key**.
   - (Opcional) um **Sender ID** / shortcode aprovado (ex.: `Kubatsira`). Sem isto, o SMS sai de um número.
2. Carrega saldo para enviar SMS reais (no sandbox não gasta, mas só entrega a números de teste).

## 2. Pôr as credenciais nos GitHub Secrets
No repositório → **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Valor |
|---|---|
| `NEON_URL` | a ligação **real** `postgresql://…/neondb?sslmode=require` |
| `AT_USERNAME` | o username da Africa's Talking (ou `sandbox`) |
| `AT_API_KEY` | a API Key |
| `AT_FROM` | (opcional) o Sender ID aprovado, ex.: `Kubatsira` |
| `AT_ENV` | (opcional) `sandbox` para testar; deixa vazio para produção |

> Os Secrets **nunca** ficam no código. Só o GitHub Actions os vê.

## 3. Testar sem gastar (simulação)
No repositório → **Actions → "SMS de cobranca Kubatsira" → Run workflow** e marca **dry_run**.
Mostra quem receberia e o texto, **sem enviar nem gravar**. (Em dry-run nem precisa das credenciais AT.)

## 4. Ligar o envio automático
O horário (08h/12h/14h MZ) já está ativo no GitHub, mas **só envia** quando:
1. os Secrets acima estão configurados, **e**
2. o interruptor **Configurações › SMS de cobrança automático** está **ligado** na app (web, telemóvel ou computador).

Para parar, basta desligar o interruptor na app. Correr à mão em **Run workflow** (sem dry_run) é o
"Enviar a todos agora": envia mesmo com o interruptor desligado.

## Importante
- **Escolhe UM só remetente:** ou o telemóvel Android (como até agora) **ou** este gateway — para não enviar/cobrar a dobrar.
  Se usares o gateway, **desliga** o SMS automático na app do telemóvel. A regra `UNIQUE (dia, turno, cliente)` ajuda a evitar duplicados.
- Os números são normalizados para o formato internacional `+258…`.
- Cada cliente recebe **1 SMS por turno**, agrupando as suas prestações em dívida.
