# Setup do ambiente local (Windows 11)

> Do zero até logar: seções 1 a 3. Roteiros de teste manual: seção 4. Problemas comuns: seção 5.
> O projeto fica num **disco de rede (Z:, SMB)** — `npm install`, a subida da API e a primeira carga do Vite
> são lentos (minutos). É normal.

## 1. Pré-requisitos

| Ferramenta | Versão usada | Observação |
|---|---|---|
| Node.js / npm | v24.14 / 11.9 (mínimo Node 20.19) | `node -v` |
| Git | 2.53 | |
| Docker Desktop | 29.8 (Compose v5) | backend WSL 2 |

Portas que precisam estar livres: **5432** (Postgres), **6379** (Redis), **21465** (WPPConnect), **3333** (API),
**5173** (Web/Vite).

### Instalar o Docker Desktop (se ainda não tiver)

Nesta máquina ele foi instalado **por usuário** em `C:\Users\clffi\AppData\Local\Programs\DockerDesktop`
(CLI em `...\resources\bin`, já no PATH). Para instalar em outra máquina:

1. Baixe em <https://www.docker.com/products/docker-desktop/> (Windows – AMD64) ou, no PowerShell como
   administrador, `winget install -e --id Docker.DockerDesktop`.
2. Mantenha marcada a opção **"Use WSL 2 instead of Hyper-V"** e reinicie o computador.
3. Abra o Docker Desktop, aceite os termos (pode pular o login) e espere "Engine running".
4. Teste: `docker --version`, `docker compose version`, `docker run --rm hello-world`.

Erro de WSL: `wsl --install` e `wsl --update` (como administrador) e reinicie. Erro de virtualização: habilite
**Intel VT-x / AMD-V (SVM)** na BIOS.

## 2. Primeira instalação

Tudo na **raiz** do projeto (`Sistema_Clinica/`).

### 2.1 Variáveis de ambiente

```powershell
copy .env.example .env
```

Existe um **único `.env` na raiz**, lido pelo docker compose, pela API, pelo Prisma e pelos testes. Em dev os
valores do exemplo funcionam (a API só **avisa** que os segredos são fracos). Se trocar `REDIS_PASSWORD`, troque
também a senha dentro da `REDIS_URL`. `CHAVE_CRIPTOGRAFIA` vazia = chave fixa de desenvolvimento (ok em dev;
defina uma de verdade antes de salvar credenciais reais de gateway — ver 4.4).

### 2.2 Infraestrutura (Docker)

```powershell
docker compose up -d
docker compose ps           # postgres e redis devem ficar "healthy"
```

| Serviço | Porta (só 127.0.0.1) | Observação |
|---|---|---|
| Postgres 16 | 5432 | usuário/senha/banco `clinica` (volume nomeado `postgres_dados`) |
| Redis 7 | 6379 | filas BullMQ (volume `redis_dados`), com senha `REDIS_PASSWORD` |
| Mailpit | 1025 (SMTP) / 8025 (web) | pega todos os e-mails do sistema sem enviar — veja em http://localhost:8025 (§4.5) |
| WPPConnect Server | 21465 | Swagger em http://localhost:21465/api-docs; webhook → `http://host.docker.internal:3333/webhooks/whatsapp?token=WEBHOOK_TOKEN` |

Volumes **nomeados** (não bind mount) porque o disco do projeto é de rede.

### 2.3 Dependências

```powershell
npm install
```

Instala a raiz e, no `postinstall`, `apps/api` e `apps/web` (cada app tem o próprio `node_modules` —
**não usamos npm workspaces** porque o compartilhamento SMB não permite symlinks). O `prisma generate`
roda automaticamente. Dependência nova: `npm install <pacote> --prefix apps/api` (ou `apps/web`).

### 2.4 Banco

```powershell
npm run db:migrate          # aplica as migrations (prisma migrate dev)
npm run db:seed             # super admin, recursos, planos e Clínica Demo (idempotente)
```

Se o `migrate dev` travar no SMB, use `npm run db:deploy` (aplica as migrations existentes).

## 3. Rodar no dia a dia

**Jeito simples:** duplo clique em **`iniciar-sistema.bat`** (raiz). Ele sobe os containers e roda
`npm run dev` numa janela **"Sistema Clinica - DEV"** — não feche a janela enquanto usa o sistema. O log
completo vai para `logs\dev.log`. Aguarde 1–2 minutos e acesse http://localhost:5173.

**Pelo terminal:**

```powershell
docker compose up -d
npm run dev                 # API em http://localhost:3333 + Web em http://localhost:5173
```

Credenciais do seed (apenas desenvolvimento):

| Área | E-mail | Senha |
|---|---|---|
| Super admin (`/admin/login`) | admin@sistema.local | admin123 |
| Clínica Demo — admin | admin@demo.local | demo123 |
| Clínica Demo — recepção | recepcao@demo.local | demo123 |
| Clínica Demo — profissional (Dra. Ana Souza) | profissional@demo.local | demo123 |

A Clínica Demo usa o plano **Profissional** (fase 2 habilitada, agendamento online ligado em
`/agendar/clinica-demo`). Para ver o **Teste grátis** (1 profissional, 1 usuário de equipe, 1 agendamento,
1 anexo, 3 mensagens), crie uma clínica em `/cadastro`.

Os workers BullMQ rodam dentro da API em dev (`EXECUTAR_WORKERS=true`). Para rodá-los separados:
`EXECUTAR_WORKERS=false` no `.env` e `npm run dev:worker` em outro terminal.

### Verificações

```powershell
npm run typecheck           # TypeScript da API e do Web
npm test                    # vitest da API (cria/migra o banco clinica_teste sozinho) — ~15 min no SMB
npm run build               # build de produção dos dois apps
npm run e2e                 # smoke test E2E no navegador (com `npm run dev` rodando)
```

Última execução registrada: **243 testes em 18 arquivos** e **13 testes E2E**, todos passando.

O E2E usa Playwright (`apps/web/e2e/smoke/*.spec.ts`, 8 specs). Na primeira vez instale o browser:
`cd apps/web && npx playwright install chromium`. Ele percorre super admin, auto-cadastro (teste grátis e
limites), clínica demo como admin (agenda, pacientes, prontuário, anexo, WhatsApp), papéis recepção/profissional
(inclusive em 390 px) e, da fase 2 (`05-*` a `08-*`), cobrança do super admin, agendamento online, financeiro,
documentos, retornos, lista de espera e dashboard. Screenshots e `relatorio.txt` (erros de console e HTTP
4xx/5xx inesperados) ficam em `apps/web/e2e/capturas/`; traces/artefatos do Playwright em
`%TEMP%\sistema-clinica-e2e`. Cada execução cria uma clínica de teste nova e alguns pacientes/agendamentos na
Clínica Demo — para um banco limpo: `docker compose down -v`, `docker compose up -d`, `npm run db:migrate`,
`npm run db:seed`.

## 4. Roteiros de teste manual

### 4.1 WhatsApp com celular real

Pré-requisitos: containers de pé (`docker compose ps` mostra `clinica-wppconnect`), `npm run dev` rodando
com `EXECUTAR_WORKERS=true` (padrão) e o `WEBHOOK_TOKEN` do `.env` igual ao usado pelo container (o
compose lê o mesmo `.env`; se mudar o token, rode `docker compose up -d` de novo). Use um número de
WhatsApp de teste — a integração é **não oficial** (WPPConnect) e há risco de banimento em uso abusivo.

1. **Conectar o número da clínica**: entre como `admin@demo.local` → menu **WhatsApp** → **Conectar**.
   Em alguns segundos aparece o QR code. No celular da clínica: WhatsApp → *Aparelhos conectados* →
   *Conectar um aparelho* → aponte para o QR. A tela passa para **Conectado** e mostra o número.
2. **Paciente de teste**: em **Pacientes → Novo paciente**, cadastre você mesmo com o **seu** celular
   (outro número, diferente do conectado) no campo **WhatsApp** e marque o **consentimento** para
   mensagens de WhatsApp (sem consentimento nada é enviado).
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
6. **Fase 2 pelo WhatsApp** (opcional): aprove uma solicitação do agendamento online (4.2), ofereça um horário
   da lista de espera ou convide um retorno — cada um gera uma mensagem para o paciente.
7. **Desconectar** (opcional): **WhatsApp → Desconectar**.

Se a resposta não for processada: confira nos logs da API (`logs\dev.log`) se chegou `POST /webhooks/whatsapp`
(401 = token diferente entre `.env` e o container) e se o container alcança o host (`host.docker.internal:3333`
— por isso `HOST=0.0.0.0` no `.env`). No plano **Teste grátis** só **3** mensagens são permitidas no total
(`max_mensagens` = 3): um lembrete + a confirmação/cancelamento cabem.

### 4.2 Agendamento online

1. Como `admin@demo.local`: **Configurações → Agendamento online** — ligue o agendamento online, ajuste
   antecedência/dias à frente/limite por telefone e escolha os profissionais visíveis. O link público aparece ali
   (`http://localhost:5173/agendar/clinica-demo`; o slug é editável em **Configurações → Editar**).
2. Numa janela anônima (ou no celular na mesma rede, trocando `localhost` pelo IP do PC), abra o link, escolha
   profissional, dia e horário, preencha nome/telefone (e o consentimento de WhatsApp) e envie. Aparece a
   confirmação de solicitação recebida — o horário ainda **não** está reservado.
3. Como `recepcao@demo.local`: o aviso no topo mostra as solicitações pendentes; em **Solicitações online**, abra a
   solicitação e **Aprove** (cria o paciente, ou use um candidato com o mesmo CPF/telefone) — o agendamento
   aparece na **Agenda**. **Recusar** grava o motivo. Com WhatsApp conectado e consentimento, o paciente recebe a
   confirmação/recusa (paciente já cadastrado recebe no WhatsApp do cadastro; se o telefone informado for
   diferente, a tela mostra o aviso de telefone divergente).
4. Anti-abuso: a partir da 4ª solicitação pendente do mesmo IP (ou além do limite por telefone) o formulário
   recusa com "limite de solicitações". Solicitações cujo horário passou viram **expiradas** (job de hora em hora).

### 4.3 Financeiro, lista de espera, retornos, documentos e dashboard

1. Como admin: **Financeiro → Caixa** — lance uma entrada e uma saída (a conta "Caixa" e as categorias padrão são
   criadas no primeiro acesso) e estorne uma delas (o estorno é uma movimentação inversa; nada é apagado e o
   valor não pode ser editado).
2. **Contas a pagar/receber**: crie um título (parcelado em N vezes, se quiser) e dê baixa; **Recorrências**:
   crie uma mensalidade/aluguel (gera os títulos do mês; o job das 06:00 gera os próximos).
3. **Repasses**: defina o percentual de um profissional e registre o pagamento do repasse de um período.
4. **Relatórios**: resumo, gráficos e exportação CSV. **Configurações**: contas e categorias.
5. Na **Agenda**, no painel de um agendamento: **Registrar recebimento** (particular ⇒ entrada no caixa;
   convênio ⇒ título a receber do convênio).
6. Papéis: a recepção lança e dá baixa, mas não vê relatórios/recorrências/repasses/configurações; o profissional
   vê só os próprios recebimentos e repasses.
7. **Lista de espera**: inclua um paciente; cancele um agendamento compatível e veja as sugestões no painel da
   agenda e o aviso no topo; ofereça o horário ou agende direto.
8. **Retornos**: marque um agendamento como *Compareceu*/*Atendido* e defina "retorno em X dias" no painel; em
   **Retornos**, use "Agendar na agenda" (abre `/agenda?novo=1&...` preenchido) ou a ação de convidar pelo WhatsApp.
9. **Documentos**: na ficha do paciente (admin vinculado a profissional ou profissional), aba **Documentos** —
   pré-visualize e emita receita/atestado/declaração/pedido de exame em PDF (imutável depois de emitido).
10. **Dashboard**: indicadores do período; a recepção não vê o bloco financeiro e o profissional vê só a própria agenda.

### 4.4 Cobrança do SaaS (gateway em sandbox + túnel)

A cobrança automática é do **super admin** (`/admin/cobranca`). Para testar com um gateway de verdade use sempre
o ambiente **sandbox** (Asaas sandbox, Stripe em modo teste `sk_test_...`, Mercado Pago com credenciais de teste).
Os webhooks precisam alcançar a API pela internet — em dev, com um túnel:

```powershell
# 1. Túnel HTTPS para a API (Cloudflare, sem conta):
winget install --id Cloudflare.cloudflared      # uma vez
cloudflared tunnel --url http://localhost:3333  # anote a URL https://<algo>.trycloudflare.com (muda a cada execução)

# 2. No .env da raiz:
#    API_URL_PUBLICA=https://<algo>.trycloudflare.com
#    CHAVE_CRIPTOGRAFIA=<64 hex — openssl rand -hex 32; NÃO troque depois de salvar credenciais>
# 3. Reinicie o `npm run dev` / iniciar-sistema.bat (as variáveis só são lidas na subida da API).
```

1. `/admin/cobranca` → **Gateways**: escolha o gateway, ambiente **sandbox**, cole a chave de teste, defina o
   segredo do webhook, tolerância, métodos, dia de vencimento padrão e a descrição. **Testar conexão** deve dar ok.
   **Ativar** (só um gateway fica ativo; em sandbox com clínicas já em cobrança automática a tela pede
   confirmação "Ativar em sandbox").
2. No painel do gateway, cadastre o webhook com a **URL do webhook** mostrada no card
   (`<API_URL_PUBLICA>/webhooks/pagamentos/<gateway>`) e o mesmo segredo.
3. Em **Clínicas → (clínica) → Cobrança**, ligue a **cobrança automática** (dia de vencimento e método) ou
   **gere uma cobrança** avulsa. Atribuir um plano pago a uma clínica já liga a cobrança automática.
4. Pague a cobrança pelo link (sandbox). O webhook marca a cobrança como paga, a assinatura fica ativa e
   `expira_em` avança até o fim do ciclo + tolerância. Os eventos recebidos ficam na aba **Eventos**.
5. A clínica vê as faturas em **Configurações → Faturas do sistema** (admin).
6. Opcional: simule um estorno/chargeback no painel do gateway — a cobrança vira `estornada` e a assinatura é
   recalculada; o super admin pode **cancelar** a estornada para perdoar a dívida.

Sem túnel dá para testar tudo menos a confirmação automática de pagamento. Sem gateway ativo nada é gerado.
Se a URL do túnel mudar, atualize `API_URL_PUBLICA`, reinicie a API e o cadastro do webhook no gateway.

### 4.5 E-mails (Mailpit)

1. Super admin → **E-mails → Configuração**: host `127.0.0.1`, porta `1025`, **TLS implícito desligado**, usuário e
   senha quaisquer (ex.: `dev`/`dev`), e-mail do remetente qualquer (ex.: `nao-responda@clinica.local`). Salve, clique
   em **Enviar e-mail de teste** e ligue **Envio ativo**.
2. Abra http://localhost:8025 — o teste aparece lá.
3. Cadastre uma clínica em `/cadastro` ⇒ e-mail de boas-vindas. No login, **Esqueci minha senha** ⇒ e-mail com o
   link; abra o link e troque a senha (as sessões abertas desse usuário caem).
4. Pagamentos (§4.4): contratação paga ⇒ "Pagamento confirmado"; mensalidade paga ⇒ recibo com o nº da parcela;
   mensalidade pendente vencendo em 2 dias ⇒ aviso no job das 07:00.
5. **E-mails → Modelos**: edite um texto, veja a pré-visualização, "Enviar teste para mim" e "Restaurar texto padrão".
   **Envios**: histórico, conteúdo e reenvio dos que falharam.

## 5. Problemas comuns

| Sintoma | Causa / solução |
|---|---|
| API **reiniciando em loop** enquanto arquivos são editados | O `tsx watch` reinicia a cada arquivo salvo e cada subida leva ~30–90 s no SMB. Termine as edições e aguarde; se não estabilizar, feche a janela/`Ctrl+C` e suba de novo. |
| API demora a subir; Vite mostra `ECONNREFUSED` no proxy | A API ainda está subindo (leitura pelo SMB). Aguarde ~30–90 s e recarregue. |
| `EADDRINUSE` / **porta ocupada** (3333 ou 5173) | Ficou um `npm run dev` antigo aberto (outra janela "Sistema Clinica - DEV"). Feche-a, ou descubra o processo: `netstat -ano \| findstr :3333` e `taskkill /PID <pid> /F`. Para 5432/6379/21465, veja se há outro Postgres/Redis local rodando. |
| `prisma generate` falha com `EPERM ... query_engine-windows.dll.node` | A API em execução trava a DLL. Pare o `npm run dev`, rode `npm run db:generate` e suba de novo. |
| `NOAUTH Authentication required` / `WRONGPASS` no Redis | A `REDIS_URL` não tem a senha ou ela difere de `REDIS_PASSWORD`. Formato: `redis://:SENHA@localhost:6379`. Depois de mudar a senha rode `docker compose up -d` (recria o Redis) e reinicie a API. |
| `docker compose up` reclama de `REDIS_PASSWORD` | Variável obrigatória no `.env` (o compose sobe o Redis com `--requirepass`). |
| `npm install` muito lento / `EPERM ... symlink` | Disco de rede. Não use workspaces nem `npm install -w`; instale por app (`--prefix apps/api`). |
| `prisma migrate dev` trava | Use `npm run db:deploy`. Para criar migration nova sem o `migrate dev`, veja o procedimento com `prisma migrate diff` no `CLAUDE.md`. |
| Testes (`npm test`) levam ~15 min | Normal no SMB; para um arquivo só: em `apps/api`, `npx dotenv -e ../../.env -- npx vitest run test/<arquivo>.test.ts`. |
| Pasta `apps/web/e2e/resultados` não apaga ("acesso negado") | Ficou com ACL travada no SMB numa execução antiga. Está no `.gitignore` e o Playwright não a usa mais (artefatos em `%TEMP%\sistema-clinica-e2e`) — pode ignorar; para apagar, tome posse pelo Windows Explorer/servidor de arquivos. |
| Primeira carga das páginas muito lenta | O Vite compila sob demanda pelo SMB (1–2 min na primeira visita a cada página). |
| Acentos corrompidos em `curl` no Git Bash | Envie o corpo por arquivo UTF-8 (`--data-binary @arquivo.json`). |
| Webhook do WhatsApp com 401 | `WEBHOOK_TOKEN` do `.env` diferente do usado pelo container: `docker compose up -d` para recriar. |
| Resetar o banco | `docker compose down -v` (apaga os volumes, inclusive a sessão do WhatsApp) e repita 2.2 e 2.4. |
