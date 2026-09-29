# Setup do ambiente local (Windows 11)

> Passo a passo para subir o projeto: ver a seção **"Subir o projeto do zero"** no fim deste arquivo.

## Já instalado (verificado em 29/09/2026)

- Node v24.14.0 / npm 11.9.0
- Git 2.53
- winget 1.29
- WSL com versão padrão 2

- **Docker Desktop instalado e testado** (29/09/2026): Docker 29.8.1, Compose v5.5.1, `hello-world` OK
  - Instalação **por usuário** em `C:\Users\clffi\AppData\Local\Programs\DockerDesktop`
  - CLI em `...\DockerDesktop\resources\bin` — já está no PATH do usuário (confirmado). Terminais abertos antes da instalação precisam ser reabertos.
- Portas livres: 5432 (Postgres), 6379 (Redis), 21465 (WPPConnect), 3333 (API), 5173 (Web/Vite)

## Instalar o Docker Desktop

### Opção A — instalador

1. Baixar em <https://www.docker.com/products/docker-desktop/> (Windows – AMD64).
2. Executar o instalador e manter marcada a opção **"Use WSL 2 instead of Hyper-V"**.
3. Reiniciar o computador quando pedir.
4. Abrir o Docker Desktop, aceitar os termos (não precisa criar conta — pode clicar em *Skip*).
5. Esperar o ícone da baleia ficar verde ("Engine running").

### Opção B — pelo terminal (PowerShell como administrador)

```powershell
winget install -e --id Docker.DockerDesktop
```

Depois reiniciar o computador e abrir o Docker Desktop uma vez.

### Se aparecer erro de WSL

```powershell
wsl --install          # como administrador, depois reiniciar
wsl --update
```

Se reclamar de virtualização: entrar na BIOS e habilitar **Intel VT-x** / **AMD-V (SVM)**.

## Testar

```powershell
docker --version
docker compose version
docker run --rm hello-world
```

Se o `hello-world` imprimir "Hello from Docker!", está tudo pronto.

---

## Subir o projeto do zero

> Tudo é executado na **raiz** do projeto (`Sistema_Clinica/`). O disco Z: é de rede (SMB):
> `npm install` e a primeira subida da API são lentos (minutos) — é normal.

### 1. Variáveis de ambiente

```powershell
copy .env.example .env      # e ajuste JWT_SECRET / WPPCONNECT_SECRET_KEY / WEBHOOK_TOKEN
```

Existe um **único `.env` na raiz**, lido pelo docker compose, pela API, pelo Prisma e pelos testes.

### 2. Infraestrutura (Docker)

```powershell
docker compose up -d
docker compose ps           # postgres e redis devem ficar "healthy"
```

| Serviço | Porta | Observação |
|---|---|---|
| Postgres 16 | 5432 | usuário/senha/banco `clinica` (volume nomeado `postgres_dados`) |
| Redis 7 | 6379 | filas BullMQ (volume `redis_dados`) |
| WPPConnect Server | 21465 | imagem `wppconnect/server-cli`; Swagger em http://localhost:21465/api-docs; webhook → `http://host.docker.internal:3333/webhooks/whatsapp?token=WEBHOOK_TOKEN` |

Volumes **nomeados** (não bind mount) porque o disco do projeto é de rede.

### 3. Dependências

```powershell
npm install
```

Instala a raiz e, no `postinstall`, `apps/api` e `apps/web` (cada app tem o próprio `node_modules` —
**não usamos npm workspaces** porque o compartilhamento SMB não permite symlinks). O `prisma generate`
roda automaticamente.

### 4. Banco

```powershell
npm run db:migrate          # aplica as migrations (prisma migrate dev)
npm run db:seed             # super admin, recursos, planos e clínica demo (idempotente)
```

### 5. Rodar

```powershell
npm run dev                 # API em http://localhost:3333 + Web em http://localhost:5173
```

Acesse http://localhost:5173 — credenciais do seed:

- Super admin (`/admin/login`): `admin@sistema.local` / `admin123`
- Clínica Demo: `admin@demo.local`, `recepcao@demo.local`, `profissional@demo.local` — senha `demo123`

Os workers BullMQ rodam dentro da API em dev (`EXECUTAR_WORKERS=true`). Para rodá-los separados:
`EXECUTAR_WORKERS=false` no `.env` e `npm run dev:worker` em outro terminal.

### 6. Verificações

```powershell
npm run typecheck           # TypeScript da API e do Web
npm test                    # vitest da API (cria/migra o banco clinica_teste sozinho)
npm run build               # build de produção dos dois apps
```

### Problemas comuns

- **`EPERM ... symlink` no npm install**: não use `npm install -w ...` / workspaces; instale por app:
  `npm install <pacote> --prefix apps/api`.
- **API demora a subir / reiniciar**: leitura de arquivos pelo SMB; aguarde ~30–90 s.
- **Proxy do Vite dá `ECONNREFUSED`** logo após `npm run dev`: a API ainda está subindo.
- **Acentos corrompidos em `curl` no Git Bash**: envie o corpo por arquivo UTF-8 (`--data-binary @arquivo.json`).
- **Resetar o banco**: `docker compose down -v` (apaga os volumes) e repita os passos 2 e 4.
