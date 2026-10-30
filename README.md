# Casa de Leilões

Fundação do desafio Elite Dev / Verzel: API NestJS com cadastro e login, PostgreSQL e uma tela mínima para ver a sessão. Lotes, lances e deploy ainda não fazem parte desta etapa.

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
| `WEB_ORIGIN` | Origem permitida no CORS. Em desenvolvimento: `http://localhost:5173` |
| `PORT` | Porta da API. O padrão é `3000` |

O arquivo `.env.example` traz valores só para a máquina local. Troque `JWT_SECRET` antes de qualquer ambiente compartilhado.

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

A suíte cria `market_test` se ele ainda não existir, aplica as migrations e roda os testes HTTP de autenticação nesse banco.

## O que esta etapa faz

- `POST /api/auth/register` cria a pessoa e uma carteira com saldo zero, na mesma transação. O papel é `SELLER` (leiloeiro) ou `BIDDER` (licitante).
- `POST /api/auth/login` devolve um JWT de 12 horas.
- `GET /api/auth/me` exige o header `Authorization: Bearer`.
- E-mail duplicado responde `409`. Campo desconhecido responde `400`. Senha errada ou sessão ausente respondem `401`.
- A resposta não inclui o hash da senha.

Ainda não há lotes, lances, carteira utilizável na tela, tempo real nem deploy.
