# Kubatsira Microcrédito — Web (PWA)

Versão **web** do Kubatsira, para funcionar no **iPhone** (Safari) e também no **Chrome** (Android/PC).
Liga à **mesma base de dados Neon** da app Android e do programa de computador. É um **projeto separado**:
não mexe na app Android (LoanEasyNeon), que continua a funcionar como está.

## Como funciona

- É só HTML/CSS/JavaScript — não precisa de servidor próprio.
- Fala diretamente com a Neon pela API "SQL over HTTP" (porta 443), exatamente como a app Android.
  A Neon aceita pedidos do browser (CORS), por isso funciona no iPhone e no Chrome.
- O **código de ligação** (`KUB1.…`) é colado uma vez em cada aparelho e fica guardado nesse aparelho
  (`localStorage`). É o mesmo código da app Android (ficheiro `Codigo de ligacao Kubatsira (SECRETO).txt`).

> ⚠️ **Segurança:** num browser, quem abrir as Ferramentas de Programador consegue ver o endereço da base.
> Por isso, instale isto apenas no **seu próprio** telemóvel/PC, protegido pelo código de desbloqueio do aparelho.

## Ficheiros

| Ficheiro | O que faz |
|---|---|
| `index.html` | Estrutura da página |
| `styles.css` | Aspeto (tema Kubatsira) |
| `regras.js` | Regras de crédito (juros 30%, multa 2%/dia), datas, SHA-256 da senha |
| `db.js` | Ligação à Neon (HTTP), código de ligação `KUB1.` |
| `dados.js` | Consultas e gravações (login, balanço, clientes, empréstimos, caixa…) |
| `app.js` | Interface e navegação |
| `manifest.webmanifest`, `sw.js`, `icons/` | O que torna a página numa app instalável (PWA) |

## Testar no computador (Chrome)

1. Abrir um terminal nesta pasta e correr um servidor simples:
   ```
   python -m http.server 8777
   ```
2. No Chrome, abrir `http://localhost:8777/`.
3. Colar o código de ligação (o `KUB1.…`, ou uma URL `postgresql://…` para testes com a base demo).
4. Entrar com um utilizador e senha da equipa.

## Instalar no iPhone (e no Android)

O iPhone **não instala APK**. Instala-se como PWA (parece uma app, com ícone no ecrã):

1. Publicar os ficheiros num endereço **https** (ver abaixo).
2. No iPhone, abrir esse endereço no **Safari**.
3. Tocar em **Partilhar** → **Adicionar ao ecrã principal**.
4. Fica um ícone "Kubatsira". Abre em ecrã inteiro, como uma app.

No Android/Chrome: abrir o endereço → menu ⋮ → **Instalar aplicação**.

## Publicar (para o iPhone poder abrir)

Precisa de um endereço https. Opção mais simples e gratuita — **GitHub Pages** (já usado para as atualizações da app):

1. Criar um repositório (pode ser privado com Pages ativo, ou público **sem** segredos — aqui não há segredos no código).
2. Enviar estes ficheiros.
3. Settings → Pages → Branch `main` / `/root`.
4. O endereço fica algo como `https://<conta>.github.io/<repo>/`.

## Funcionalidades

**Incluídas:** entrar (com permissões por perfil), Balanço (indicadores + cobranças previstas + maiores clientes),
Cobranças / Prestações do dia, registar pagamentos (com excedente para a Poupança), Clientes (registar, editar,
novo código de acesso, eliminar, ficha com empréstimos e poupança), Empréstimos (ver, aprovar/rejeitar, anular,
novo pedido com simulação), Fluxo de Caixa (saldo + movimentos + entradas/despesas), Utilizadores e Permissões,
Notificações, alterar nome/senha, ocultar valores, trocar de ligação.

**Não incluídas (são do Android, não existem num browser):**
- Enviar SMS pelo SIM do telemóvel (e o SMS automático em segundo plano).
- Entrada por impressão digital (Android Keystore).
- Trabalhos automáticos em segundo plano.

A app web pode **ver** os SMS enviados (a lista está na base), mas o envio continua a ser feito pelo telemóvel Android.
