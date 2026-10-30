# Casa de Leilões

Casa de leilões do desafio Elite Dev / Verzel: API NestJS, PostgreSQL e um frontend em React. Leiloeiros publicam livros buscados na Open Library; licitantes depositam saldo simulado e dão lances ao vivo; o vencedor recebe um comprovante público, e qualquer pessoa audita o histórico de lances.

- Frontend: `https://SEU-FRONTEND.vercel.app` (preencher após o deploy)
- API: `https://SUA-API.vercel.app` (preencher após o deploy)

## Funcionalidades

- Cadastro e login com papel de **leiloeiro** (`SELLER`) ou **licitante** (`BIDDER`). JWT de 12 horas; a sessão sobrevive ao recarregar a página.
- O leiloeiro busca uma obra na Open Library, escolhe uma das até 20 edições e publica um lote com lance inicial, incremento mínimo, início e fim. O servidor busca a edição de novo; o título enviado pelo navegador não entra no lote. Ficha e capa ficam no PostgreSQL.
- Vitrine com abas **ao vivo**, **agendados** e **encerrados**, e busca pelo título.
- Carteira com saldo simulado: depósito, total, comprometido e disponível.
- Sala do lote com lances em tempo real, contagem regressiva e anti-sniping.
- Liquidação automática: o vencedor é debitado, o leiloeiro é creditado e um comprovante público é emitido.
- Página "Minhas participações" (ganhando, superado, arrematado, perdido, cancelado) e total recebido pelo leiloeiro.
- Auditoria pública de cada lote, com cadeia de hashes HMAC e veredito `INTEGRO`, `ADULTERADO` ou `INDETERMINADO`.
- Cancelamento de lote aberto pelo leiloeiro.
- Tema claro e escuro.

## Credenciais de demonstração

Senha única: `leilao-demo-2026`.

| Conta | Papel | Identificador público |
| --- | --- | --- |
| `leiloeiro@demo.local` | Leiloeiro | `DEMVEND000` |
| `ana@demo.local` | Licitante | `DEMANA0000` |
| `bruno@demo.local` | Licitante | `DEMBRVN000` |

| Lote | Situação |
| --- | --- |
| *O Alienista* | Ao vivo por 24 horas. Bruno deu R$ 10,00 e Ana R$ 15,00; Ana começa ganhando |
| *Dom Casmurro* | Agendado para daqui a 7 dias, sem lances |
| *Memórias póstumas de Brás Cubas* | Encerrado e liquidado. Bruno arrematou por R$ 25,00. Comprovante: `/comprovantes/demo-arremate-bras-cubas` |
| *Grande Sertão: Veredas* | Encerrado sem lances, sem vencedor |

Ana e Bruno recebem R$ 5.000,00 uma única vez. Depois do seed, a carteira de Ana mostra total R$ 5.000,00, comprometido R$ 15,00 (ela lidera *O Alienista*) e disponível R$ 4.985,00. A de Bruno mostra total R$ 4.975,00 (pagou R$ 25,00 no *Brás Cubas*), comprometido R$ 0,00 (foi superado em *O Alienista*) e disponível R$ 4.975,00.

Para testar um lance ao vivo, abra *O Alienista* em duas janelas (uma anônima), entre como Bruno numa e Ana na outra, e cubra o lance.

## Arquitetura

- `apps/api`: monólito NestJS com Prisma. Módulos de autenticação, catálogo (Open Library), lotes, carteira, lances, auditoria, liquidação, tempo real e demonstração.
- `apps/web`: React + Vite + Tailwind, servido como site estático.
- PostgreSQL é a única fonte de verdade. Não há Redis nem fila: a concorrência é resolvida com locks de linha no próprio Postgres.
- Em produção: dois projetos na **Vercel** (a API como uma Vercel Function, o frontend como site estático) e o banco no **Neon PostgreSQL**. Nenhum outro serviço é usado.

## Regras de negócio

- Dinheiro em centavos, `INTEGER`, com teto de R$ 20.000.000,00 (`2000000000` centavos) garantido por `CHECK` no banco. Passar do teto é uma recusa de domínio (`AMOUNT_OVERFLOW`), não um erro interno.
- **Comprometido** não é uma coluna: é a soma dos lances em que a pessoa lidera lotes ainda abertos. Disponível = total − comprometido. Ser superado libera o comprometido na hora.
- Um lance trava primeiro o lote e depois a carteira (`SELECT ... FOR UPDATE`), sempre nessa ordem. O horário do lance é lido do relógio do banco **depois** dos locks; uma espera na fila não usa um relógio antigo.
- Primeiro lance ≥ lance inicial; os seguintes ≥ lance atual + incremento mínimo. O leiloeiro não dá lance; quem já lidera não cobre o próprio lance.
- **Anti-sniping**: lance com 120 s ou menos para o fim soma 120 s ao fim. É repetível e sem teto, então o tempo restante pode passar de dois minutos.
- **Liquidação** trava o lote, confere a integridade HMAC e, nas carteiras em ordem de `userId`, debita o vencedor, credita o leiloeiro e cria o comprovante na mesma transação. Lote sem lances fecha como `UNSOLD`. Repetir a liquidação devolve `ALREADY_FINAL`: nunca há dois débitos ou dois comprovantes.
- Na liquidação, o disponível do vencedor não muda: total e comprometido caem juntos.
- **Cancelamento** só vale para lote aberto e íntegro. Se já houver lances, ele libera o comprometido do líder; o total não aumenta, porque nada tinha sido debitado.
- **HMAC**: cada lance encadeia o hash do anterior, e o estado do lote (líder interno, `sellerId`, `bidderId`, valores, horários e versão) é assinado com `AUDIT_HMAC_SECRET`. A auditoria detecta edição de lance, troca de `bidderId`, de líder interno ou de `sellerId`. `INDETERMINADO` aparece quando a API não tem a chave da versão usada no lote, então não dá para conferir. Não detecta a restauração de um snapshot antigo e válido do banco inteiro, nem o vazamento do segredo. A página pública não mostra UUID interno, só identificadores públicos.
- **Open Library**: a criação do lote depende dela; vitrine, detalhe e capa não. A capa pode faltar. O seed não chama a Open Library.

## Liquidação e tempo real na Vercel

Uma Vercel Function não roda continuamente entre requisições, então o scheduler de 5 segundos do Nest não serve lá. A API faz as duas coisas:

- **Local e Docker**: o scheduler roda a cada `SETTLEMENT_INTERVAL_MS` (5 s por padrão).
- **Vercel** (`VERCEL=1`, definida pela própria plataforma): o intervalo não é registrado. Antes de responder, as leituras liquidam o que já venceu. O detalhe, a auditoria e a lista de lances de um lote conferem só aquele lote; vitrine, "meus lotes", total recebido, carteira e participações varrem uma página de lotes vencidos. Isso também vale localmente, a menos que `SETTLE_ON_READ=false`.
- A liquidação na leitura usa a mesma transação com locks da liquidação agendada. Duas leituras simultâneas em instâncias diferentes produzem um débito e um comprovante. Lote adulterado continua aberto e a leitura responde normalmente.
- Não há Cron Job: o plano Hobby não permite cron frequente, e a leitura já resolve.

Consequência visível: um lote vencido continua `OPEN` no banco até a próxima leitura relevante, mas ninguém consegue vê-lo aberto, porque ver é ler. Novos lances são recusados pelo relógio do banco assim que o fim passa, com ou sem liquidação.

**Socket.IO**: a Vercel aceita WebSocket em Functions (GA em outubro de 2026). O cliente usa só o transporte `websocket`. Cada conexão fica presa a uma instância e cai na duração máxima da Function (300 s no Hobby); o cliente reconecta sozinho, entra na sala de novo e refaz o `GET`. Não há memória compartilhada entre instâncias: um lance processado em outra instância pode não chegar por socket. A sala recupera o estado pelo polling REST que já existia: ao voltar para a aba, ao reconectar e, no máximo, a cada 20 segundos. A carteira é relida ao abrir a página.

## Rodar localmente

Requisitos: Node.js 22 ou mais recente e Docker Desktop em execução.

```bash
copy .env.example .env
docker compose up postgres
```

Em outro terminal, na raiz:

```bash
npm install
npm run migrate
npm run seed
npm run dev:api
npm run dev:web
```

- API: `http://localhost:3000`
- Frontend: `http://localhost:5173` (abra exatamente esse endereço; o CORS só aceita o que está em `WEB_ORIGIN`)

O script `docker/init.sql` cria o banco `market_test` na primeira inicialização do volume. Usuário e senha do Compose: `market` / `market`.

### Tudo em Docker

```bash
docker compose up --build
docker compose exec api npm run seed --workspace=api
```

- Frontend: `http://localhost:8080`, servido pelo nginx, que encaminha `/api` e `/socket.io` para a API.
- A API continua em `http://localhost:3000` e aplica as migrations ao subir.

## Variáveis de ambiente

Os segredos não estão no Git: `.env` está no `.gitignore`.

| Variável | Uso |
| --- | --- |
| `DATABASE_URL` | Conexão da aplicação. Local: `postgresql://market:market@localhost:5432/market`. No Neon: a URL **pooled** (host com `-pooler`) |
| `DIRECT_URL` | Conexão usada pelo `prisma migrate`. Local: igual a `DATABASE_URL`. No Neon: a URL **direta** (host sem `-pooler`) |
| `DATABASE_URL_TEST` | Banco dos testes, com nome terminado em `_test` |
| `JWT_SECRET` | Segredo do JWT. Mínimo de 32 caracteres |
| `AUDIT_HMAC_SECRET` | Segredo do HMAC da auditoria. Mínimo de 32 caracteres e diferente de `JWT_SECRET`. Trocar depois invalida a auditoria dos lotes existentes |
| `WEB_ORIGIN` | Origens aceitas no CORS e no Socket.IO, separadas por vírgula, sem barra no fim |
| `PORT` | Porta da API. Padrão `3000` |
| `SETTLEMENT_INTERVAL_MS` | Intervalo do scheduler local. Padrão `5000`. Ignorado na Vercel |
| `SETTLE_ON_READ` | `false` desliga a liquidação na leitura. Padrão: ligada |
| `SEED_ON_BOOT` | `true` roda o seed a cada subida do processo. Padrão `false`. Na Vercel, deixe `false` |
| `DEMO_ENSURE` | `true` renova os lotes de demonstração: no scheduler local, a cada ciclo; na Vercel, na leitura, no máximo uma vez por minuto por instância |
| `VITE_API_URL` | (frontend, no build) URL pública da API, sem barra no fim. Vazio significa mesma origem (usado pelo nginx do Docker) |

## Deploy: Vercel + Neon

### 1. Banco no Neon

1. Crie um projeto no Neon (PostgreSQL 16 ou mais recente) e um banco, por exemplo `market`.
2. Em **Connect**, copie duas strings:
   - **pooled** (host com `-pooler`), para `DATABASE_URL`: acrescente `&pgbouncer=true&connection_limit=5&connect_timeout=15` depois de `?sslmode=require`;
   - **direta** (desligue "Connection pooling"), para `DIRECT_URL`: só com `?sslmode=require`.
   - Se o Prisma recusar o parâmetro `channel_binding=require` que o Neon às vezes inclui, remova-o das duas.
3. No plano gratuito, o Neon suspende o compute após alguns minutos ocioso. A primeira requisição depois disso demora cerca de um segundo a mais.

### 2. Migrations e seed (da sua máquina, contra o Neon)

No PowerShell, na raiz do repositório, com as dependências instaladas:

```powershell
$env:DATABASE_URL="<URL pooled do Neon>"
$env:DIRECT_URL="<URL direta do Neon>"
$env:JWT_SECRET="<o mesmo valor da Vercel>"
$env:AUDIT_HMAC_SECRET="<o mesmo valor da Vercel>"
$env:WEB_ORIGIN="https://SEU-FRONTEND.vercel.app"
npm run migrate
npm run seed
```

As variáveis do terminal têm prioridade sobre o `.env` local. O seed precisa do **mesmo** `AUDIT_HMAC_SECRET` da API publicada, senão a auditoria dos lotes de demonstração dá `ADULTERADO`. Rodar o seed de novo é seguro. Feche o terminal (ou remova as variáveis) antes de voltar ao banco local.

Para uma nova migration no futuro: `npx prisma migrate dev` só no banco local; no Neon, sempre `npm run migrate` (`prisma migrate deploy`).

### 3. Projeto Vercel da API

| Campo | Valor |
| --- | --- |
| Root Directory | `apps/api` |
| Framework Preset | NestJS |
| Install Command | `cd ../.. && npm ci` |
| Build Command | padrão do preset (sem override) |
| Output Directory | padrão do preset (sem override) |
| "Include files outside the root directory" | ligado (padrão) |

Variáveis: `DATABASE_URL`, `DIRECT_URL`, `JWT_SECRET`, `AUDIT_HMAC_SECRET`, `WEB_ORIGIN`, `DEMO_ENSURE=true`, `SEED_ON_BOOT=false`.

A Vercel detecta `src/main.ts`, compila o Nest e publica tudo numa Function com Fluid compute. O `postinstall` gera o Prisma Client; o `apps/api/vercel.json` inclui as fixtures do seed no pacote da Function.

### 4. Projeto Vercel do frontend

| Campo | Valor |
| --- | --- |
| Root Directory | `apps/web` |
| Framework Preset | Vite |
| Install Command | `cd ../.. && npm ci` |
| Build Command | `npm run build` |
| Output Directory | `dist` |

Variável: `VITE_API_URL=https://SUA-API.vercel.app`. Ela entra no build: depois de mudar, faça um redeploy.

O `apps/web/vercel.json` reescreve qualquer rota para `index.html`, então recarregar `/lotes/:id`, `/auditoria/:id` ou `/comprovantes/:token` funciona.

### 5. Ligar os dois

Depois do primeiro deploy do frontend, coloque a URL dele em `WEB_ORIGIN` na API e faça redeploy da API. Para aceitar também uma URL de preview, separe por vírgula.

## Exemplos de API

```bash
API=https://SUA-API.vercel.app

# login
curl -s -X POST $API/api/auth/login -H "Content-Type: application/json" \
  -d '{"email":"ana@demo.local","password":"leilao-demo-2026"}'

# lotes ao vivo (exige token)
curl -s "$API/api/auctions?status=live" -H "Authorization: Bearer $TOKEN"

# lance de R$ 20,00 (2000 centavos)
curl -s -X POST $API/api/auctions/$ID/bids -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"amountCents":2000}'

# auditoria pública e comprovante público (sem token)
curl -s $API/api/auctions/$ID/audit
curl -s $API/api/receipts/demo-arremate-bras-cubas
```

Para criar um lote, o leiloeiro chama `GET /api/catalog/search?q=...`, `GET /api/catalog/works/:workId/editions` e `POST /api/auctions` com `editionId`, `startingBidCents`, `minIncrementCents`, `startsAt` e `endsAt`.

## Testes

Com o Postgres local no ar:

```bash
npm test
```

A suíte cria `market_test` se faltar, aplica as migrations e roda os testes ali. Ela recusa rodar num banco cujo nome não termine em `_test` ou que seja o mesmo de `DATABASE_URL`. Não chama a Open Library. Cobre autenticação, catálogo, lances concorrentes, carteira, HMAC e adulteração, liquidação (inclusive concorrente), liquidação na leitura em modo Vercel, tempo real e seed. O GitHub Actions roda a mesma suíte.

Para uma consulta real à Open Library, fora da suíte padrão (no PowerShell, `$env:OPEN_LIBRARY_LIVE=1`):

```bash
cd apps/api
set OPEN_LIBRARY_LIVE=1
npx jest --config ./test/jest-e2e.json --runInBand test/catalog.client.spec.ts -t "live call"
```

## Comportamentos que podem surpreender

- A prorrogação soma 120 s a cada lance no fim, então o tempo restante pode passar de dois minutos.
- Localmente, um lote vencido pode continuar aberto por até um intervalo do scheduler; na Vercel, até a próxima leitura.
- Capa é opcional: algumas edições da Open Library não têm.
- Se a Open Library cair, criar lote falha; o resto do site continua.
- Na liquidação, o disponível do vencedor não muda; total e comprometido caem.
- Cancelar um lote com lances não credita o total: só libera o comprometido.
- Quando o lote ao vivo da demonstração encerra, o próximo seed (ou o `DEMO_ENSURE`) publica outro e mantém o antigo, que é liquidado normalmente.
- Se um aviso em tempo real se perder, a contagem e o lance atual podem atrasar até 20 s; na Vercel isso é mais comum, porque as instâncias não compartilham sockets.
- A busca usa `ILIKE`: acentos contam ("memorias" não encontra "Memórias").
- O tema fica no `localStorage`; sem escolha salva, segue o sistema.

## Limitações e fora do escopo

- Sem Redis: na Vercel, os eventos de tempo real só chegam a quem está na mesma instância; o polling REST garante a convergência.
- A auditoria não tem ancoragem externa; rollback de um snapshot válido do banco não é detectado.
- Fora do escopo: nota fiscal, revenda, app nativo, recuperação de senha e pagamentos reais.

## Uso de IA

Este projeto foi desenvolvido com auxílio de IA. Usei o **ChatGPT** e o **Cursor** (incluindo o agente de IA do Cursor) na análise do enunciado, no planejamento, na escrita e revisão de código, nos testes e nesta documentação. As regras de lance, concorrência, dinheiro e HMAC foram revisadas por mim, e os testes automatizados foram executados localmente antes da entrega.
