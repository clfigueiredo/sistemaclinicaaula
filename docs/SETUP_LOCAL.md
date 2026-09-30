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
npm run e2e                 # smoke test E2E no navegador (com `npm run dev` rodando)
```

O smoke test E2E usa Playwright (`apps/web/e2e/smoke/*.spec.ts`). Na primeira vez instale o browser:
`cd apps/web && npx playwright install chromium`. Ele percorre os fluxos do super admin, do auto-cadastro
(teste grátis e limites), da clínica demo como admin (agenda, pacientes, prontuário, anexo, WhatsApp) e
dos papéis recepção/profissional (inclusive em 390 px). Screenshots e `relatorio.txt` com erros de console
e respostas HTTP 4xx/5xx inesperadas ficam em `apps/web/e2e/capturas/`. Cada execução cria uma clínica
de teste nova (auto-cadastro) e alguns pacientes/agendamentos na Clínica Demo — rode `npm run db:seed`
depois de `docker compose down -v` se quiser um banco limpo.

## Teste manual do WhatsApp com celular real

Pré-requisitos: containers de pé (`docker compose ps` mostra `clinica-wppconnect`), `npm run dev` rodando
com `EXECUTAR_WORKERS=true` (padrão) e o `WEBHOOK_TOKEN` do `.env` igual ao usado pelo container (o
compose lê o mesmo `.env`; se mudar o token, rode `docker compose up -d` de novo). Use um número de
WhatsApp de teste — a integração é **não oficial** (WPPConnect) e há risco de banimento em uso abusivo.

1. **Conectar o número da clínica**: entre como `admin@demo.local` → menu **WhatsApp** → **Conectar**.
   Em alguns segundos aparece o QR code. No celular da clínica: WhatsApp → *Aparelhos conectados* →
   *Conectar um aparelho* → aponte para o QR. A tela passa para **Conectado** e mostra o número.
2. **Paciente de teste**: em **Pacientes → Novo paciente**, cadastre você mesmo com o **seu** celular
   (outro número, diferente do conectado) no campo **WhatsApp** e marque o **consentimento** para
   mensagens de WhatsApp (sem consentimento o lembrete não é enviado).
3. **Agendamento para amanhã**: na **Agenda**, crie um agendamento para esse paciente **amanhã**, em um
   horário da grade (status *Agendado*).
4. **Disparar o lembrete**: na tela **WhatsApp**, clique **Enviar lembretes de amanhã agora** (o job
   automático roda todo dia às 09:00 no fuso `TZ_PADRAO`). O envio passa pela fila com intervalo
   aleatório de 20–40 s por clínica — espere até ~1 min. A mensagem aparece em **Histórico de mensagens**
   como *Enviada* e chega no seu celular.
5. **Responder**:
   - `1` → o agendamento fica **Confirmado** na agenda e o paciente recebe a confirmação.
   - `2` → o agendamento fica **Cancelado** (motivo "Cancelado pelo paciente via WhatsApp", visível no
     painel do agendamento), o paciente recebe a confirmação do cancelamento e a recepção recebe um
     **aviso**: o sino no topo (admin e recepção) mostra o contador de não lidos (atualiza a cada 60 s),
     com links para o agendamento e o paciente e o botão de marcar como lido.
   - Qualquer outro texto → o paciente recebe as instruções (uma única vez por agendamento).
   Para testar as duas respostas, crie dois agendamentos (ou repita os passos 3–5).
6. **Desconectar** (opcional): **WhatsApp → Desconectar**.

Se a resposta não for processada: confira nos logs da API se chegou `POST /webhooks/whatsapp` (401 =
token diferente entre `.env` e o container) e se o container alcança o host (`host.docker.internal:3333`).
No plano **Teste grátis** só 1 mensagem é permitida no total (`max_mensagens` = 1).

### Problemas comuns

- **`EPERM ... symlink` no npm install**: não use `npm install -w ...` / workspaces; instale por app:
  `npm install <pacote> --prefix apps/api`.
- **API demora a subir / reiniciar**: leitura de arquivos pelo SMB; aguarde ~30–90 s.
- **Proxy do Vite dá `ECONNREFUSED`** logo após `npm run dev`: a API ainda está subindo.
- **Acentos corrompidos em `curl` no Git Bash**: envie o corpo por arquivo UTF-8 (`--data-binary @arquivo.json`).
- **Resetar o banco**: `docker compose down -v` (apaga os volumes) e repita os passos 2 e 4.
