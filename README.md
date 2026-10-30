# Casa de Leilões

Casa de leilões do desafio Elite Dev / Verzel: API NestJS, PostgreSQL e um frontend em React. Nesta etapa dá para entrar, buscar um livro na Open Library e publicar um lote com a ficha salva no banco. Carteira, lances e deploy ainda não fazem parte.

## O que você precisa

- Node.js 22 ou mais recente
- Docker, com o Docker Desktop em execução

## Variáveis de ambiente

Copie o exemplo e mantenha o arquivo fora do Git:

```bash
copy .env.example .env
```

No PowerShell o comando é o mesmo `copy`. As variáveis obrigatórias são:

| Variável | Uso |
| --- | --- |
| `DATABASE_URL` | Postgres da aplicação. No Compose local: `postgresql://market:market@localhost:5432/market` |
| `DATABASE_URL_TEST` | Banco dos testes: `postgresql://market:market@localhost:5432/market_test` |
| `JWT_SECRET` | Segredo do token de acesso. A API não sobe com menos de 32 caracteres |
| `AUDIT_HMAC_SECRET` | Segredo da âncora do lote. Pelo menos 32 caracteres e diferente de `JWT_SECRET`. A API não sobe sem ele |
| `WEB_ORIGIN` | Origem permitida no CORS. Em desenvolvimento: `http://localhost:5173` |
| `PORT` | Porta da API. O padrão é `3000` |
| `SETTLEMENT_INTERVAL_MS` | Intervalo do ciclo que liquida lotes vencidos. O padrão é `5000`. O atraso máximo é um intervalo |

O arquivo `.env.example` traz valores só para a máquina local. Troque `JWT_SECRET` e `AUDIT_HMAC_SECRET` antes de qualquer ambiente compartilhado. Os dois segredos precisam ser diferentes.

## Banco de dados

Suba o Postgres. O script `docker/init.sql` cria o banco `market_test` na primeira inicialização do volume.

```bash
docker compose up postgres
```

Em outro terminal, na raiz do repositório:

```bash
npm install
npm run migrate
```

`npm run migrate` aplica as migrations em `apps/api/prisma` usando `DATABASE_URL`. O banco de desenvolvimento se chama `market`. O de teste se chama `market_test`. Os dois ficam no mesmo servidor Postgres.

Usuário e senha locais do Compose: `market` / `market`.

## API e frontend

```bash
npm run dev:api
npm run dev:web
```

- API: `http://localhost:3000`
- Frontend: `http://localhost:5173`

Abra exatamente `http://localhost:5173`. O Vite também anuncia `127.0.0.1`, mas o CORS só aceita o valor de `WEB_ORIGIN`.

Abra o frontend, cadastre um leiloeiro ou um licitante e entre. Recarregar a página mantém a sessão. Sair volta para o login.

A vitrine fica em `/`. O leiloeiro usa **Painel** para buscar uma obra, escolher uma edição e publicar um lote. Dá para criar um lote que já está ao vivo e outro que ainda vai começar. Cancelar, no painel, vale para lote sem lances.

Para subir Postgres e API juntos, com a migration aplicada na inicialização do container:

```bash
docker compose up postgres api
```

O frontend continua no comando `npm run dev:web`. O container da API usa `DATABASE_URL` apontando para o serviço `postgres`.

## Testes

Com o Postgres no ar:

```bash
npm test
```

A suíte cria `market_test` se ele ainda não existir, aplica as migrations e roda os testes nesse banco. A suíte não chama a Open Library. Para uma consulta real, fora da suíte padrão:

```bash
cd apps/api
set OPEN_LIBRARY_LIVE=1
npx jest --config ./test/jest-e2e.json --runInBand test/catalog.client.spec.ts -t "live call"
```

No PowerShell, a variável é `$env:OPEN_LIBRARY_LIVE=1`.

## O que esta etapa faz

- `POST /api/auth/register` cria a pessoa e uma carteira com saldo zero, na mesma transação. O papel é `SELLER` (leiloeiro) ou `BIDDER` (licitante).
- `POST /api/auth/login` devolve um JWT de 12 horas.
- `GET /api/auth/me` exige o header `Authorization: Bearer`.
- E-mail duplicado responde `409`. Campo desconhecido responde `400`. Senha errada ou sessão ausente respondem `401`.
- A resposta não inclui o hash da senha.
- O leiloeiro busca obras em `GET /api/catalog/search`, vê até 20 edições e cria o lote com `POST /api/auctions`. O servidor busca a edição de novo. Título enviado pelo navegador não entra no lote.
- A ficha e, quando cabe, a capa ficam no PostgreSQL. Vitrine, detalhe e capa continuam no ar se a Open Library cair. Falha da ficha impede só a criação. Falha da capa deixa o lote sem imagem.
- `GET /api/auctions?status=live|scheduled|ended` separa a vitrine pelo relógio do banco. Lote cancelado não entra. `GET /api/auctions/mine` lista os lotes do leiloeiro, inclusive cancelados.
- `POST /api/auctions/:id/cancel` cancela lote aberto e sem lances. O lote nasce com uma âncora HMAC de histórico vazio; o cancelamento só regrava essa âncora se ela ainda confere.

## Limitações desta etapa

- A lista de edições para em 20. Data, ISBN e capa da Open Library variam bastante; um lote pode nascer sem algum desses dados.
- A liquidação roda na própria API, cerca de a cada 5 segundos (`SETTLEMENT_INTERVAL_MS`). Um lote pode ficar encerrado e ainda aberto por até um intervalo. Reiniciar o processo não perde esse lote: o próximo ciclo relê o banco.
- Cancelar um lote com lances, antes da liquidação, libera o saldo comprometido do líder. O total da carteira não aumenta.
- A sala usa Socket.IO no mesmo processo da API, sem Redis. O lance continua em `POST /api/auctions/:id/bids`. Se o aviso se perder, a sala aberta busca o lote de novo ao voltar para a aba e, no máximo, a cada 20 segundos. Duas réplicas não compartilham esses avisos.
- Ainda não há seed demonstrável, busca avançada, dark mode nem deploy.
