# CLAUDE.md — Sistema Clínica (SaaS)

## Sobre o projeto

SaaS de gestão para clínicas particulares. Várias clínicas usam o mesmo sistema, cada uma
**totalmente isolada** (multi-tenant por `clinica_id`). O dono do SaaS gerencia planos e
clínicas num painel super admin; cada plano libera/limita recursos do sistema.

**MVP e Fase 2 do produto estão concluídos** (ver "Status atual" no fim). Documentação:

| Documento | Conteúdo |
|---|---|
| `docs/ARQUITETURA.md` | visão geral, planos/recursos, papéis, **modelo de dados completo**, fluxos (WhatsApp, agendamento online, cobrança) — ler antes de mexer em qualquer módulo |
| `docs/FASE2.md` | contratos (rotas, payloads, regras) dos módulos da fase 2: financeiro, agendamento online, lista de espera, documentos PDF, retornos, dashboard e cobrança do SaaS; §13 contratação; §14 e-mails transacionais |
| `docs/SETUP_LOCAL.md` | subir do zero no Windows, roteiros de teste manual, solução de problemas |
| `docs/DEPLOY.md` | produção na VPS (compose de produção, Caddy, segredos, webhooks, backup) |
| `README.md` | resumo de uma página |

## Idioma

- Conversa, comentários, mensagens de commit e textos de interface em **português do Brasil**, com acentuação correta.
- Nomes de tabelas, colunas, rotas e entidades de domínio em português sem acento (`pacientes`, `agendamentos`, `clinica_id`).
- Termos técnicos e bibliotecas mantêm o nome original.

## Stack

- **Frontend:** React + Vite + TypeScript, React Router, TanStack Query, Tailwind + shadcn/ui
- **Backend:** Node 20+ + TypeScript + Fastify, validação com Zod
- **Banco:** PostgreSQL + Prisma
- **Fila/agendador:** Redis + BullMQ
- **E-mail:** SMTP genérico (nodemailer) — provedor **Resend**, configurado no painel do super admin (`/admin/email`); Mailpit no dev
- **WhatsApp:** WPPConnect Server (Docker) — não oficial
- **Local:** Docker Desktop (Postgres, Redis, WPPConnect via docker-compose); API e Web com `npm run dev`
- **Produção:** VPS com o mesmo docker-compose + Caddy (HTTPS), três domínios: landing (`DOMINIO_SITE`),
  painel da clínica (`DOMINIO_APP`) e painel do super admin (`DOMINIO_ADMIN`, só `/admin/*`) — `docs/DEPLOY.md`

**Não usar Next.js** — decisão do usuário: React puro com Vite.

## Estrutura (monorepo)

> **Sem npm workspaces**: o projeto fica num disco de rede (SMB) que não permite symlinks/junctions,
> e o npm exige symlinks para workspaces. Cada app tem o **próprio `node_modules`**; o `package.json`
> da raiz orquestra tudo via `npm --prefix` (e o `npm install` da raiz instala os dois apps no postinstall).
> Para instalar uma dependência nova: `npm install <pacote> --prefix apps/api` (ou `apps/web`).

```
Sistema_Clinica/
├── CLAUDE.md / README.md
├── iniciar-sistema.bat       # atalho Windows: docker compose up -d + npm run dev, log em logs/dev.log
├── docker-compose.yml        # DEV: postgres 16, redis 7 (com senha), wppconnect — portas só em 127.0.0.1
├── docker-compose.prod.yml   # PRODUÇÃO: + api, worker, caddy; sem portas internas; segredos obrigatórios
├── deploy/                   # Dockerfile.api, Dockerfile.web (build do web + Caddy), Caddyfile, backup.sh,
│                             # instalar-vps.sh (instalador: só pede os 3 domínios), acessos.sh + inicializar-producao.cjs
├── landing/                  # landing page de teste (produção: DOMINIO_SITE; Caddy templates — {{env "DOMINIO_APP"}})
├── .env.example / .env       # ÚNICO .env, na raiz (lido por compose, API, Prisma e testes)
├── package.json              # scripts orquestradores (dev, build, typecheck, test, db:*)
├── docs/ (ARQUITETURA.md, SETUP_LOCAL.md, DEPLOY.md, FASE2.md)
├── apps/api/                 # Fastify 5 + Zod 4 + Prisma 6 (ESM, TypeScript estrito, tsx watch / tsup)
│   ├── prisma/schema.prisma  # modelo de dados completo + migrations + seed.ts
│   ├── test/                 # vitest (banco clinica_teste) — 23 arquivos, um por módulo + tenant/recursos/segurança + e-mails
│   └── src/
│       ├── app.ts            # buildApp() — exportado para testes (app.inject)
│       ├── server.ts         # sobe a API (+ workers se EXECUTAR_WORKERS=true)
│       ├── worker.ts         # processo só de workers (produção)
│       ├── config/env.ts     # envs validadas com Zod → `env`
│       ├── lib/prisma.ts     # prisma CRU (só admin/auth/workers/seed)
│       ├── plugins/          # auth.ts, tenant.ts, recursos.ts, erros.ts
│       ├── utils/            # erros.ts (ErroNegocio, ou404), logAcesso.ts, senha.ts, documento.ts,
│       │                     # cripto.ts (AES-256-GCM), slug.ts, ip.ts (chave de IP; IPv6 por /64)
│       ├── servicos/         # filas.ts (BullMQ/Redis), whatsapp/* (service, adapters, envio, mensagens,
│       │                     # respostas, lembretes), pagamentos/* (Asaas, Stripe, Mercado Pago + fábrica),
│       │                     # email/* (smtpAdapter, modelos, renderizar, envio), configuracaoClinica.ts, financeiroComum.ts
│       ├── workers/          # index.ts registra: envio WhatsApp, lembretes (09:00), recorrências (06:00),
│       │                     # cobranças (07:00), retornos (09:30), expirar solicitações (:15 de cada hora), e-mails
│       └── modulos/<nome>/index.ts   # um plugin por domínio (registrados em modulos/index.ts)
│           # MVP: auth, me, admin-planos, admin-clinicas, profissionais, convenios, usuarios, pacientes,
│           #      prontuario, agendamentos, whatsapp
│           # Fase 2: financeiro, agendamento-online, lista-espera, documentos, retornos, dashboard, admin-cobranca
│           # + contratacao (planos na landing e contratação pela clínica — docs/FASE2.md §13)
│           # + admin-email (configuração SMTP, modelos editáveis e histórico de e-mails — docs/FASE2.md §14)
└── apps/web/                 # React 19 + Vite + Tailwind 4 + shadcn/ui + TanStack Query + React Router 7
    ├── e2e/smoke/            # Playwright: 8 specs / 13 testes (01-* a 04-* MVP, 05-* a 08-* fase 2)
    └── src/
        ├── main.tsx          # providers (QueryClient, AuthProvider, Tooltip, Toaster)
        ├── rotas/            # index.tsx (router COMPLETO, lazy) + navegacao.ts (menus e papéis)
        ├── api/              # cliente.ts, sessao.ts, tipos.ts, me.ts, auth.ts + um arquivo por módulo
        ├── contextos/AuthContext.tsx
        ├── componentes/ui/   # shadcn/ui gerados
        ├── componentes/comum/    # CabecalhoPagina, Carregando, EstadoVazio, AvisoLimite, UsoRecurso…
        ├── componentes/layout/   # LayoutAdmin, LayoutClinica, Guardas (RotaClinica/RotaAdmin)
        ├── lib/              # utils.ts (cn), formatos.ts (máscaras, CPF/CNPJ, datas, moeda)
        └── paginas/{admin,clinica,publico}/
```

## Regras que NÃO podem ser quebradas

1. **Isolamento de tenant:** toda tabela de clínica tem `clinica_id`. O `clinica_id` vem **sempre do token JWT**, nunca do body/query. Toda consulta é filtrada automaticamente (extensão do Prisma). Nunca escrever query de dados de clínica sem esse filtro.
2. **Limites do plano no backend:** toda criação que consome recurso passa por `exigirRecurso()` / `verificarLimite()`. Esconder botão no frontend é só UX, não é segurança.
3. **Prontuário imutável:** `prontuario_registros` não tem update nem delete. Correção = novo registro.
4. **Recepção não vê prontuário:** checar papel no backend. **Profissional só vê dados clínicos (prontuário,
   anexos, alergias, medicações) de pacientes vinculados a ele** — use `assegurarAcessoProntuario` /
   `podeVerDadosClinicos` de `modulos/prontuario/acesso.ts` (regra de vínculo abaixo).
5. **WhatsApp desacoplado:** o resto do sistema só fala com `whatsappService`; nada de chamar a API do WPPConnect direto de outro módulo (para poder trocar pela API oficial da Meta depois).
6. **Envio de WhatsApp sempre pela fila**, com intervalo aleatório (20–40 s) por sessão/clínica, e só para pacientes com `aceita_whatsapp = true`.
7. **Log de acesso** (`logs_acesso`) ao visualizar/criar registros de prontuário, baixar anexos e listar/ver/emitir/baixar documentos clínicos (LGPD).
8. Nunca commitar `.env` nem credenciais.

## Decisões de negócio já tomadas

- Entidade genérica **`profissionais`** (médico é um profissional; campo `registro` serve para CRM/CRO/CRP…).
- **Convênio:** apenas seleção do nome (lista por clínica); sem faturamento TISS. Agendamento é `particular` ou `convenio`.
- **Auto-cadastro** público cria clínica + usuário admin + assinatura no plano marcado como `plano_cadastro`.
- **Teste grátis** (plano do seed marcado como `plano_cadastro`): todas as funções, inclusive as seis da fase 2,
  limitado a **1** profissional, 1 usuário de equipe, 1 agendamento e 1 anexo, e **3** mensagens WhatsApp
  (lembrete + confirmação/cancelamento cabem no teste); limites **totais**, **sem prazo** de expiração
  (`expira_em = null`). A conversão acontece pela própria clínica (**Planos** → pagamento online) ou pelo super
  admin trocando o plano.
- **Contratação pela clínica** (módulo `contratacao`, página `/planos` do admin da clínica): só clínica em plano
  **gratuito** contrata; aparecem os planos ativos com `planos.contratavel` (só pagos). Gera uma cobrança no gateway
  ativo com `cobrancas.plano_contratado_id` (vencimento hoje) e redireciona para a fatura; o plano **só muda quando
  o pagamento é confirmado** (webhook ⇒ troca o plano, `ativa`, `expira_em`, liga a cobrança mensal no dia da
  cobrança, máx. 28). Contratação em aberto não conta como dívida. Troca entre planos pagos continua com o super
  admin. `planos.exibir_landing` ⇒ o plano aparece na landing (`GET /publico/planos`, proxy só dessa rota no Caddy
  do `DOMINIO_SITE`); `/cadastro?plano=<id>` leva para `/planos?plano=<id>` depois do cadastro.
- Planos criados pelo super admin nascem com os recursos da fase 2 **desligados** até ele liberar.
- **Limite de equipe** (`max_recepcionistas`, "usuários de equipe"): recepções ativas + admins ativos
  **adicionais**. Só o **admin principal** (o admin ativo mais antigo — o do auto-cadastro) não conta.
  Admin pode estar vinculado a um profissional.
- **Vínculo profissional–paciente** (`prontuario/acesso.ts`): vale se houver registro de prontuário do
  profissional para o paciente, OU agendamento dele com o paciente não cancelado **criado por outro usuário**,
  OU agendamento dele com o paciente `compareceu`/`atendido` com início já alcançado. Agendamento criado
  pelo próprio profissional não dá acesso antes do atendimento. Profissional **não troca o paciente** de um
  agendamento (403); ninguém troca fora de `agendado`/`confirmado` (409). Vinculado a profissional
  **inativo** ⇒ 403 `profissional_inativo` no prontuário/anexos.
- **Assinatura inativa** (vencida/cancelada/bloqueada): **acesso suspenso** (a API recusa tudo com 403
  `assinatura_inativa`, menos `GET /me` e `GET /cobrancas/minhas`; o front mostra só a tela `AcessoSuspenso` com as
  faturas para o admin pagar, liberando sozinho quando o webhook confirmar) e WhatsApp parado
  (`assegurarAssinaturaAtiva` em lembretes, enfileiramento, worker e webhook de respostas).
- Planos ilimitados criados pelo super admin; cada limite tem período `total` ou `mensal`.
- Mesmo profissional em duas clínicas = **dois cadastros independentes**.
- Cada clínica conecta **o próprio número** de WhatsApp (uma sessão WPPConnect por clínica).
- Lembrete enviado **1 dia antes**; resposta `1` confirma, `2` cancela e avisa a recepção.
- **Agendamento online** (`/agendar/:slug`, público): o paciente só **solicita**; a solicitação fica `pendente`
  até a recepção/admin **aprovar** (cria paciente se preciso + agendamento, consome `max_agendamentos`) ou
  recusar; pendentes cujo horário passou viram `expirada` (job de hora em hora). Paciente é casado pelo **CPF**;
  telefone é só sugestão. **Anti-abuso:** honeypot, rate limit, limite por telefone (configurável, padrão 2),
  máx. **3** pendentes futuras por IP (IPv6 por /64, `utils/ip.ts` — mesma chave do rate limit) e **10** por
  profissional/dia; contagens sob advisory lock. **Confirmação da aprovação:** paciente novo ⇒ telefone da
  solicitação; paciente existente ⇒ WhatsApp **do cadastro**; o telefone da solicitação só recebe se for o mesmo
  do cadastro; senão, aviso `telefone_divergente` à recepção.
- **Lista de espera / retornos:** oferta de horário e convite de retorno saem pelo WhatsApp (só com
  consentimento); agendar de fato é sempre pela agenda normal (`/agenda?novo=1&...`). Retorno vira `agendado`
  automaticamente ao criar agendamento do mesmo paciente+profissional na janela.
- **Financeiro:** movimentação **nunca é apagada** nem tem valor/tipo/data/conta alterados — correção é
  **estorno** (movimentação inversa, uma por original); "vencido" é derivado; data futura só como título.
  **Recepção** lança, recebe e dá baixa, mas **não vê relatórios, recorrências, repasses nem configurações**
  (nem movimentações de repasse); profissional vê só os próprios recebimentos/repasses.
- **Cobrança do SaaS** (super admin): **um gateway ativo** por vez (Asaas, Stripe ou Mercado Pago), credenciais
  cifradas. O **nosso worker** gera uma cobrança avulsa por mês (até 10 dias antes do vencimento; não usamos a
  assinatura nativa do gateway); atribuir plano pago com gateway ativo liga a cobrança automática. Cobrança em
  aberto além de `dias_tolerancia` ⇒ assinatura **`vencida`** (acesso suspenso); o pagamento (webhook) volta a
  `ativa` e **avança `expira_em`** até o fim do ciclo pago + tolerância. **Estorno/chargeback** de cobrança paga
  recalcula `expira_em` pelo último ciclo ainda pago (sem nenhum ⇒ `vencida`) e `estornada` conta como dívida
  até o super admin **cancelá-la** (perdão). Pagar cobrança cancelada não reativa. `cobrancas.ambiente` guarda
  sandbox/produção — pagamento de cobrança sandbox com gateway já em produção é ignorado. `bloqueada` é só
  manual. Detalhes em `docs/FASE2.md` §7 e §12.

## Comandos

Jeito mais simples (Windows): **duplo clique em `iniciar-sistema.bat`** — sobe os containers e roda
`npm run dev` numa janela "Sistema Clinica - DEV" (não feche), com log em `logs/dev.log`. Acesse
http://localhost:5173 depois de 1–2 min.

Todos na **raiz** do projeto (passo a passo completo em `docs/SETUP_LOCAL.md`):

```bash
docker compose up -d        # (ou npm run docker:up) postgres (5432), redis (6379, com senha), wppconnect (21465), mailpit (1025/8025) — só em 127.0.0.1
npm install                 # raiz + apps/api + apps/web (postinstall) + prisma generate
npm run db:migrate          # prisma migrate dev (cria/aplica migrations)
npm run db:seed             # seed idempotente (super admin, recursos, planos, clínica demo)
npm run dev                 # API (http://localhost:3333) + Web (http://localhost:5173)
npm run dev:api | dev:web   # só um dos dois
npm run dev:worker          # workers em processo separado (use com EXECUTAR_WORKERS=false)
npm run typecheck           # tsc da API e do Web
npm run build               # tsup (apps/api/dist) + vite build (apps/web/dist)
npm test                    # vitest da API (banco clinica_teste, criado/migrado automaticamente) — ~15 min no SMB
npx vitest run test/x.test.ts   # (em apps/api, com `npx dotenv -e ../../.env --`) um arquivo só
npm run e2e                 # smoke test E2E (Playwright, apps/web/e2e/smoke) — exige `npm run dev` rodando
npm run db:deploy           # aplica migrations sem o `migrate dev` (útil quando ele trava no SMB)
npm run db:generate         # prisma generate (com a API PARADA — ver dicas abaixo)
npm run db:studio           # Prisma Studio
```

Última execução registrada da suíte inteira: **243 testes em 18 arquivos** (vitest) e **13 testes E2E** em 8 specs, todos
passando. Em 08/10/2026 rodaram só `contratacao` (novo), `cobranca` e `admin` (43 testes, todos passando); `recursos` e
`financeiro` foram ajustados ao bloqueio total mas não rodaram. Os 4 arquivos de e-mails (`email-servico`, `admin-email`,
`esqueci-senha`, `emails-cobranca`, 08/10/2026) foram escritos mas **ainda não rodaram** — rode a suíte inteira num
ambiente de dev.
**Na VPS de homologação não rode o vitest** sem o usuário pedir (ele cria o banco `clinica_teste` no Postgres da VPS).

### Dicas do ambiente (disco de rede SMB)

- O web chama a API por `/api/*` (proxy do Vite remove o `/api`). Rotas da API **não** têm prefixo `/api`.
- No disco de rede a API leva ~30–90 s para subir em dev (e para reiniciar no `tsx watch`). É normal.
- Nova migration: edite `schema.prisma` e rode `npm run db:migrate -- --name <nome>`. Índices parciais
  e triggers vão em SQL manual na própria migration (use `--create-only`, edite e rode `db:migrate` de novo).
  O default de `clinica_id` no schema precisa ser exatamente `dbgenerated("(current_setting('app.clinica_id'::text))::uuid")`
  (forma normalizada pelo Postgres); do contrário o `migrate dev` detecta drift e pede uma migration nova a cada execução.
  Se o `migrate dev` travar no SMB: gere o SQL com `npx prisma migrate diff --from-url "$DATABASE_URL"
  --to-schema-datamodel prisma/schema.prisma --script`, grave em `prisma/migrations/<timestamp>_<nome>/migration.sql`,
  rode `npm run db:deploy` e confira drift com o mesmo `migrate diff ... --exit-code` ("No difference detected").
- `prisma generate` falha com `EPERM ... query_engine-windows.dll.node` se a API estiver rodando (a DLL fica
  travada): pare o `npm run dev`, gere e suba de novo.
- `tsx watch` reinicia a API a cada arquivo salvo; editando muitos arquivos seguidos ela fica reiniciando em
  loop (cada subida ~30–90 s). Termine as edições e espere, ou pare o dev e suba de novo no fim.
- Se o usuário estiver com o sistema rodando (janela "Sistema Clinica - DEV"), **não mate processos** nem rode
  migrations/`prisma generate` sem combinar antes.
- E2E: na primeira vez instale o browser: `cd apps/web && npx playwright install chromium`.
  Screenshots e `relatorio.txt` (erros de console e HTTP 4xx/5xx) em `apps/web/e2e/capturas/` (ignorado no git).
  Na primeira carga o Vite no SMB é lento (1–2 min por página nova) — os timeouts do Playwright já consideram isso.
  Artefatos do Playwright vão para `%TEMP%/sistema-clinica-e2e` (fora do SMB); a pasta antiga
  `apps/web/e2e/resultados/` ficou com ACL travada — é ignorada pelo git e pelo Playwright, não tente apagá-la.

### Credenciais do seed (apenas desenvolvimento)

| Área | E-mail | Senha |
|---|---|---|
| Super admin (`/admin/login`) | admin@sistema.local | admin123 |
| Clínica Demo — admin | admin@demo.local | demo123 |
| Clínica Demo — recepção | recepcao@demo.local | demo123 |
| Clínica Demo — profissional (Dra. Ana Souza) | profissional@demo.local | demo123 |

A Clínica Demo (slug `clinica-demo`, agendamento online ligado) está no plano **Profissional** (assinatura
ativa, limites altos, fase 2 habilitada). Para testar o **Teste grátis** (1 de cada + 3 mensagens), crie uma
clínica nova em `/cadastro`. O seed é idempotente e **nunca** deve rodar em produção.

## Convenções para módulos

### API — onde fica cada coisa

- Cada domínio é um diretório `apps/api/src/modulos/<nome>/` com `index.ts` exportando
  `default` (plugin `FastifyPluginAsyncZod`) e `prefixo`. **Todos já estão registrados** em
  `src/modulos/index.ts` (só mexa ao criar um módulo novo). Crie arquivos auxiliares na própria pasta
  (`rotas.ts`, `servico.ts`, `esquemas.ts`…).
- Módulos do MVP (implementados): `auth`, `me` (+ `GET /me/onboarding` e `PUT /me/clinica` — admin edita os
  dados cadastrais da própria clínica, inclusive o `slug` público; documento e status só pelo super admin),
  `admin-planos`, `admin-clinicas`, `profissionais` (+ horários e bloqueios), `convenios`, `usuarios`,
  `pacientes` (+ alergias/medicações), `prontuario` (+ anexos), `agendamentos`, `whatsapp` (+ webhook
  `POST /webhooks/whatsapp`). Cada `index.ts` traz no topo as rotas, guards e regras.
- Módulos da fase 2 do produto (implementados, contrato e adições em `docs/FASE2.md`): `financeiro`,
  `agendamento-online` (+ rotas públicas `/publico/clinicas/:slug*`), `lista-espera`, `documentos`, `retornos`,
  `dashboard`, `admin-cobranca` (+ webhooks `POST /webhooks/pagamentos/:gateway` e `GET /cobrancas/minhas`).
- Depois da fase 2: `contratacao` (`GET /publico/planos`, `GET/POST /contratacao` — `docs/FASE2.md` §13) e
  `admin-email` (`/admin/email/*` — `docs/FASE2.md` §14). "Esqueci minha senha" fica no `auth`
  (`POST /auth/esqueci-senha`, `GET /auth/redefinir-senha/validar`, `POST /auth/redefinir-senha`).
- Integrações entre módulos da fase 2 (sem hooks genéricos — chamadas diretas a serviços exportados):
  criar agendamento (`POST /agendamentos` e aprovação online) chama `vincularRetornoAoNovoAgendamento`
  (`modulos/retornos/servico.ts`); trocar para plano pago (`PUT /admin/clinicas/:id/assinatura`) chama
  `ativarCobrancaAutomatica` (`modulos/admin-cobranca/servico.ts`) se houver gateway ativo. Esses serviços nunca
  devem fazer a operação principal falhar.
- Título ↔ consulta: `titulos.agendamento_id` (FK). Opções do gateway em colunas
  (`gateways_pagamento.dia_vencimento_padrao`, `descricao_cobranca`); o JSON cifrado guarda só credenciais.
- Criar agendamento fora do módulo agendamentos (ex.: aprovação do agendamento online): na mesma transação,
  `assegurarLimite('max_agendamentos', { tx })` + `travarAgendaProfissional` + `validarHorario`
  (`modulos/agendamentos/servico.ts`). Fora do HTTP, `criarDbTenant(clinicaId)` dá o client com escopo.
- Bloqueios de agenda: cadastro em `/profissionais/bloqueios` (GET/POST/DELETE); leitura para a agenda em
  `GET /agendamentos/bloqueios` (profissional logado só vê os seus + os da clínica). Não existe `/bloqueios`.
- Cancelamento de agendamento grava `motivo_cancelamento` + `cancelado_em` (não mexe em `observacoes`);
  pelo WhatsApp o motivo é `MOTIVO_CANCELAMENTO_WHATSAPP` ("Cancelado pelo paciente via WhatsApp").
- Arquivos compartilhados (`plugins/`, `utils/`, `app.ts`, `schema.prisma`, `rotas/index.tsx`,
  `api/cliente.ts`…) afetam todos os módulos: mudanças neles pedem testes da suíte inteira.

### API — autenticação e papéis (`src/plugins/auth.ts`)

```ts
import { autenticarClinica, autenticarAdmin, exigirPapel } from '../../plugins/auth';

const modulo: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', autenticarClinica);                  // todas as rotas do módulo
  app.get('/', async (request) => request.db.convenio.findMany({ orderBy: { nome: 'asc' } }));
  app.post('/', { preHandler: exigirPapel('admin', 'recepcao'), schema: { body: Corpo } }, handler);
};
```

- Tokens: plataforma `{ tipo: 'plataforma', usuarioId }`; clínica `{ tipo: 'clinica', usuarioId, clinicaId, papel, profissionalId }`.
- `autenticarClinica` recarrega o usuário do banco (papel/ativo atuais) e preenche:
  `request.usuarioClinica` `{ id, nome, email, papel, profissionalId, clinicaId }`, `request.clinicaId`,
  `request.db`, `request.assinatura` `{ status, somenteLeitura }`. Assinatura vencida/cancelada/bloqueada
  ⇒ acesso suspenso: 403 `assinatura_inativa` em toda rota da clínica, menos `ROTAS_COM_ACESSO_SUSPENSO`
  (`GET /me`, `GET /cobrancas/minhas`). Fora do HTTP (workers/webhook) use
  `assegurarAssinaturaAtiva(clinicaId)` / `assinaturaEstaAtiva` de `plugins/recursos.ts`.
- Tokens emitidos antes de `usuarios.senha_alterada_em` são recusados (401). `PUT /usuarios/:id/senha`:
  própria senha exige `senha_atual` (inclusive admin) e devolve `{ token }` novo; admin redefinindo a de
  outro usuário não exige (204).
- `autenticarAdmin` preenche `request.adminPlataforma` `{ id, nome, email }`. Módulos `admin-*` usam o **prisma cru**.
- `exigirPapel(...papeis)` autentica (se preciso) e exige o papel. Recepção **nunca** acessa prontuário.

### API — isolamento de tenant (`request.db`, `src/plugins/tenant.ts`)

- `request.db` é o Prisma com filtro automático de `clinica_id` (leitura, escrita, count, aggregate,
  groupBy, updateMany, deleteMany, upsert…). Em `create` **não passe `clinica_id`** (é injetado do token;
  se vier, é sobrescrito). `update` não consegue trocar `clinica_id`.
- `findUnique` de registro de outra clínica retorna `null`; `update/delete` dão 404 (P2025).
- `request.db.$transaction(async (tx) => …)` — o `tx` também é filtrado.
- **Não use nested writes** em modelos de clínica (`data: { alergias: { create: [...] } }`): crie em
  chamadas separadas dentro de uma transação.
- **Valide FKs recebidas no body** buscando pelo `request.db` antes de gravar:
  `ou404(await request.db.paciente.findUnique({ where: { id: body.paciente_id } }), 'Paciente não encontrado.')`.
- SQL cru (`$queryRaw`) não é filtrado — filtre `clinica_id = request.clinicaId` manualmente.
- `prisma` cru (`src/lib/prisma.ts`) só em admin, auth, workers, webhooks, rotas públicas (`/publico/*`) e seed. Um `create` de modelo
  de clínica pelo prisma cru **sem** `clinica_id` falha no banco (falha fechada).
- `prontuario_registros` é imutável: update/delete lançam `prontuario_imutavel` (extensão) e o banco
  tem trigger. Correção = novo registro com `corrige_registro_id`. `documentos_clinicos` (fase 2) idem, com
  `documento_imutavel`. Apagar uma clínica que tenha esses registros exige, na transação,
  `SET LOCAL app.permitir_exclusao_prontuario = 'on'`.
- `cobrancas` (plataforma, com `clinica_id`) é somente leitura e filtrada pela clínica via `request.db`;
  `gateways_pagamento` e `eventos_gateway` são proibidos via `request.db` (use o prisma cru no admin).
- `configuracoes_clinica` (1:1) é criada sob demanda: use sempre `obterConfiguracaoClinica(request.db)` /
  `obterConfiguracaoClinicaPorId(clinicaId)` (`src/servicos/configuracaoClinica.ts`).

### API — limites do plano (`src/plugins/recursos.ts`)

```ts
import { exigirRecurso, verificarLimite, assegurarLimite, assegurarRecurso } from '../../plugins/recursos';

// preHandlers (autenticam antes, se usados com exigirPapel/autenticarClinica)
app.post('/', { preHandler: [exigirPapel('admin'), verificarLimite('max_profissionais')] }, handler);
app.post('/conectar', { preHandler: [exigirPapel('admin'), exigirRecurso('whatsapp')] }, handler);

// dentro de transação (trava por clínica+recurso, evita corrida) — recomendado para agendamentos/anexos
await request.db.$transaction(async (tx) => {
  await assegurarLimite(request.clinicaId, 'max_agendamentos', { tx });
  return tx.agendamento.create({ data: {...} });
});
// workers: await assegurarLimite(clinicaId, 'max_mensagens')
```

- Códigos: `max_profissionais`, `max_recepcionistas`, `max_agendamentos`, `max_anexos`, `whatsapp`,
  `max_mensagens`, `financeiro`, `agendamento_online`, `lista_espera`, `documentos_pdf`, `retorno_automatico`,
  `dashboard` (os seis últimos são liga/desliga da fase 2; habilitados nos planos do seed, desabilitados nos
  planos criados pelo super admin até ele liberar).
- Contagem: profissionais **ativos**; usuários `recepcao` **ativos** + admins ativos − 1 (o admin principal não conta); agendamentos e
  anexos **criados** no período; mensagens de **saída** com status `pendente|enviada` no período.
  Período `mensal` = desde o dia 1 do mês no fuso da clínica.
- Ao reativar profissional/recepcionista/admin ou mudar papel para `recepcao`/`admin`, chame `assegurarLimite` também
  (em usuários, só quando o usuário passa a ocupar vaga — ver `ocupaVagaEquipe` em `modulos/usuarios`).
- Estouro ⇒ 403 `{ erro: 'limite_atingido', recurso, limite, uso, mensagem }`; recurso desligado ⇒
  403 `{ erro: 'recurso_indisponivel', recurso, mensagem }`.
- `obterUsoERecursos(clinicaId)` devolve `{ assinatura, plano, recursos }` (usado no `/me` e útil no admin).

### API — erros, validação e LGPD

- Erros de negócio: `throw new ErroNegocio(status, 'codigo', 'Mensagem em pt-BR.', extras?)`
  ⇒ `{ erro: 'codigo', mensagem, ...extras }`. Atalhos: `erros.naoEncontrado()`, `erros.proibido()`,
  `erros.conflito(msg)`, `erros.invalido(msg)`, `ou404(valor, msg)` (`src/utils/erros.ts`).
- Validação: schemas Zod no `schema` da rota (`body`, `params`, `querystring`, `response` opcional). Falha
  ⇒ 400 `{ erro: 'validacao', mensagem, detalhes: [{ campo: 'body.nome', mensagem }] }`. Use
  `z.coerce` em querystring; `z.uuid()` em ids; mensagens de validação em pt-BR.
- Prisma P2002 ⇒ 409 `registro_duplicado`; P2025 ⇒ 404; P2003 ⇒ 409 `registro_vinculado` (automático).
- LGPD: `await logAcesso(request, 'visualizar' | 'criar' | 'baixar', 'prontuario', id)` ao ver/criar
  prontuário e baixar anexos (`src/utils/logAcesso.ts`). Prévia de documento clínico: ação `previa`.
- CSV: células de texto começando com `= + - @`/TAB/CR recebem `'` (anti CSV injection) — ver `celula` em
  `modulos/financeiro/rotasRelatorios.ts`; números saem como número.
- Uploads: `@fastify/multipart` já registrado (`await request.file()`, limite `UPLOAD_MAX_MB`); salve
  em `env.UPLOAD_DIR_ABS/<clinicaId>/...` e grave o caminho relativo em `anexos.caminho`. Nunca sirva a
  pasta como estática — download só por rota autenticada.
- Datas: armazenadas em UTC (`DateTime`); fuso da clínica em `clinicas.fuso_horario`
  (`date-fns-tz`). Grade de horários em `"HH:mm"` no fuso da clínica; `dia_semana` 0 = domingo.

### API — WhatsApp e filas

- `src/servicos/whatsapp/whatsappService.ts`: interface `WhatsappService` com `iniciarSessao(clinicaId)`,
  `obterQrCode(clinicaId)`, `status(clinicaId)`, `desconectar(clinicaId)`,
  `enviarMensagem(clinicaId, telefone, texto)`, `interpretarWebhook(corpo)` + `nomeSessao(clinicaId)`.
  Implementação atual: `wppconnectAdapter.ts` (fetch nativo); `fakeAdapter.ts` nos testes. Nenhum outro módulo chama o WPPConnect.
- Avisos à recepção (resposta "2"): `mensagens_whatsapp` com `tipo = 'aviso'`, direção entrada, `lida_em`
  nulo = não lido (`GET /whatsapp/avisos`, `POST /whatsapp/avisos/:id/lido`). Webhook idempotente por
  advisory lock + índice único parcial `(clinica_id, id_externo)` das mensagens de entrada.
- Outros módulos enviam WhatsApp com `enfileirarMensagem({ clinicaId, pacienteId | null, agendamentoId?, tipo,
  conteudo, telefone?, consentimentoExterno? })` (`servicos/whatsapp/envio.ts`) e os templates de
  `servicos/whatsapp/mensagens.ts`. Tipos novos: `agendamento_confirmado`, `agendamento_recusado`,
  `oferta_horario`, `convite_retorno`. Sem paciente cadastrado: `pacienteId: null` + `telefone` +
  `consentimentoExterno: true` (grava `mensagens_whatsapp.consentimento_externo`). Detalhes em `docs/FASE2.md` §8.
- `src/servicos/filas.ts`: `NOMES_FILAS.ENVIO_WHATSAPP` / `NOMES_FILAS.LEMBRETES` (+ fase 2:
  `FINANCEIRO_RECORRENCIAS`, `RETORNOS`, `SOLICITACOES_AGENDAMENTO`, `COBRANCAS`), `obterFila(nome)`,
  `criarWorker(nome, processador)`, `obterConexaoRedis()`, `INTERVALO_ENVIO_MS` (20–40 s),
  tipos `JobEnvioWhatsapp`/`JobLembretes`, `fecharFilas()`.
- Workers: registrar em `src/workers/index.ts` (`iniciarWorkers`). Em dev rodam no processo da API
  (`EXECUTAR_WORKERS=true`); em produção, processo separado (`npm run start:worker`).
- Webhook: `POST /webhooks/whatsapp?token=WEBHOOK_TOKEN` (o docker-compose já aponta o WPPConnect para
  `http://host.docker.internal:3333/webhooks/whatsapp?token=...`). O logger mascara `token=` na URL
  (`serializarRequisicao` em `app.ts`).

### API — e-mails transacionais (`src/servicos/email`)

- Outros módulos enviam e-mail **só** com `enfileirarEmail({ tipo, para, variaveis, referencia, clinicaId })`
  (`servicos/email/index.ts`), **depois do commit**. Ela nunca lança; `(tipo, referencia, destinatario)` é único
  (evento repetido não reenvia). Tipos: `boas_vindas`, `redefinir_senha`, `pagamento_confirmado`, `aviso_renovacao`,
  `pagamento_renovado`; variáveis e textos padrão em `modelosPadrao.ts` (`CATALOGO_EMAILS`) — tipo novo = enum
  `TipoEmail` + entrada no catálogo. Links: `linksSistema()`; formatos: `formatoEmail`.
- Configuração SMTP e modelos ficam no banco (`configuracao_email`, `modelos_email`), editados em `/admin/email`;
  envio desligado ⇒ registro `ignorado`. Tabelas de e-mail são **proibidas via `request.db`** (prisma cru).
- **Nunca** mande senha por e-mail. Testes: `definirProvedorEmail(criarAdaptadorEmailFake())` + `definirEnfileiradorEmail`.

### Variáveis de ambiente de segurança

- `REDIS_PASSWORD` (compose sobe o Redis com `--requirepass`) e `REDIS_URL=redis://:SENHA@host:6379`.
- `TRUST_PROXY`: `false` (padrão/dev — ignora `X-Forwarded-For`); produção atrás do Caddy: `1`.
- `HOST`: interface da API (dev `0.0.0.0` para o webhook do WPPConnect via `host.docker.internal`).
- Com `NODE_ENV=production` a API não sobe se `JWT_SECRET`/`WEBHOOK_TOKEN`/`WPPCONNECT_SECRET_KEY`
  tiverem < 32 caracteres ou contiverem `troque`/`exemplo`/`changeme`, se a `REDIS_URL` não tiver senha ou se
  `CHAVE_CRIPTOGRAFIA` não tiver 64 hex (ou for a chave de dev) (`config/env.ts`, `problemasDeSeguranca`);
  em dev só avisa. Deploy: `docs/DEPLOY.md`.
- Fase 2: `CHAVE_CRIPTOGRAFIA` (AES-256-GCM dos segredos no banco — `utils/cripto.ts`: `criptografar`,
  `descriptografar`, `criptografarJson`, `mascararSegredo`, `finalSegredo`; em dev/teste, sem a variável, usa
  uma chave fixa de desenvolvimento; **não troque** a chave depois de gravar segredos), `API_URL_PUBLICA`
  (URLs de webhook dos gateways) e `WEB_URL_PUBLICA` (links para o paciente; padrão = `WEB_URL`).

### Web — padrões

- **Cliente HTTP** (`src/api/cliente.ts`): `api.get<T>(caminho, parametros?)`, `api.post/put/patch<T>(caminho, corpo)`,
  `api.delete`, `api.upload(caminho, formData)`, `api.baixar(caminho)` → `Blob`. Caminhos iguais aos da API
  (sem `/api`). Rotas `/admin*` usam o token do super admin; as demais, o da clínica. 401 ⇒ logout + login;
  403 `limite_atingido`/`recurso_indisponivel`/`assinatura_inativa` ⇒ toast automático. Erros são
  `ErroApi { status, codigo, mensagem, dados, detalhes }`; `mensagemDeErro(e)` para toasts.
- **Hooks por módulo** em `src/api/<modulo>.ts`: objeto de
  chaves (`chavesX.todos/lista/detalhe`), `useQuery` para leitura, `useMutation` com
  `invalidateQueries` no `onSuccess`. Se a ação consome recurso do plano, invalide também
  `chavesMe.me`. Chaves do super admin começam com `'admin'`.
- **Sessão/plano**: `useAuth()` (`tokenClinica`, `tokenAdmin`, `entrarClinica`, `sairClinica`, `entrarAdmin`, `sairAdmin`);
  `useMe()` → `Me` (`usuario`, `papel`, `clinica`, `assinatura`, `plano`, `recursos`); `useAdminMe()`;
  `usePodeUsar(codigo)` → `{ pode, motivo, mensagem, limite, uso, restante }` para desabilitar botões
  (`<Button disabled={!pode} title={mensagem}>`). Tipos compartilhados em `src/api/tipos.ts`.
- **Página**: arquivo em `src/paginas/...` (declarado no router `rotas/index.tsx`, lazy, com guard de papel) exportando
  `default`. Estrutura: `<CabecalhoPagina titulo descricao acoes />` + conteúdo; `<Carregando />`,
  `<EstadoVazio />`, `<AvisoLimite codigo />`, `<UsoRecurso codigo />` de `@/componentes/comum`.
  Formulários: `react-hook-form` + `zodResolver` + `Form/FormField/...` de `@/componentes/ui/form`;
  feedback com `toast` do `sonner`. Diálogos com `Dialog`/`Sheet`. Máscaras/validações/datas em `@/lib/formatos`.
- **Papéis no front**: `PAPEIS_ROTA` em `src/rotas/navegacao.ts` (ex.: `PAPEIS_ROTA.prontuario` para
  esconder abas de prontuário da recepção). Só UX — o backend é quem garante. Profissional vê
  Profissionais em modo somente leitura (edição só admin; bloqueios admin e recepção).
- **Recursos no front**: item de menu com `recurso` só aparece se `me.recursos[codigo].habilitado`
  (`itensPermitidos(itens, papel, me.recursos)`); `<RotaClinica recurso="financeiro">` mostra
  `<RecursoIndisponivel />` quando o plano não inclui; `recursoHabilitado(me, codigo)` para blocos.
- **Topo do app da clínica**: `Estrutura` aceita `acoesTopo`; o `LayoutClinica` coloca ali o
  `SinoAvisos` (admin e recepção, se o plano tiver `whatsapp`): contador de não lidos com polling de 60 s,
  popover com a lista, "marcar como lido" e links para `/agenda?agendamento=<id>` (abre o painel e vai
  até a data) e para a ficha do paciente.
- **Guards**: `RotaPublica` redireciona o usuário já logado para o mesmo destino que a página usaria
  (`/cadastro` → `/onboarding`; login → `state.de` ou `/agenda`), porque ela re-renderiza antes do `navigate()`.
- **Tailwind 4 + `space-y-*`**: o espaçamento vira `margin-bottom` nos filhos; não passe `mb-0`/`mb-*`
  para um filho de `space-y` (anula o espaço). Em `AlertDescription` (grid), envolva texto com
  `<strong>`/`<Link>` num único `<p>` para não quebrar em linhas.
- **UI**: componentes shadcn em `@/componentes/ui/*` (button, input, label, card, table, dialog,
  dropdown-menu, select, textarea, badge, tabs, sonner, form, checkbox, switch, calendar, popover,
  alert, skeleton, separator, sheet, avatar, tooltip, scroll-area). Ícones `lucide-react`. Cores via
  tokens (`bg-primary`, `text-muted-foreground`, `bg-success`, `bg-warning`, `bg-destructive`).
- **Agenda**: FullCalendar 6 (`@fullcalendar/react`, `core`, `daygrid`, `timegrid`, `interaction`;
  locale `@fullcalendar/core/locales/pt-br`). As variáveis CSS do FullCalendar já seguem o tema em `index.css`.
  Links para a agenda: `/agenda?agendamento=<id>` (abre o painel) e
  `/agenda?novo=1&paciente_id=&profissional_id=&data=YYYY-MM-DD` (abre o diálogo de novo agendamento preenchido).
- **Fase 2 no front**: pontos de extensão no painel da agenda (`RecebimentoConsulta`, `DefinirRetorno`,
  `SugestoesListaEspera`), na ficha do paciente (`AbaDocumentos`), em Configurações (`ConfigAgendamentoOnline`,
  `MinhasFaturas`) e no detalhe da clínica do super admin (`BlocoCobrancaClinica`) — mapa completo em
  `docs/FASE2.md` §10. Gráficos do dashboard e dos relatórios são SVG/CSS próprios (sem biblioteca de gráficos).

## Status atual (08/10/2026)

**Concluído e commitado** (`git log --oneline`):

- [x] **MVP:** monorepo, schema + seed, auth + auto-cadastro, plugins (tenant, recursos/limites, erros,
      LGPD), painel super admin (planos, recursos, clínicas, dashboard), profissionais + grade + bloqueios,
      convênios, usuários, pacientes, agenda, prontuário + anexos, WhatsApp (QR, lembrete, confirmação/
      cancelamento, avisos à recepção), onboarding, edição dos dados da clínica, QA E2E.
- [x] **Auditoria de segurança do MVP:** vínculo profissional–paciente, WhatsApp parado com assinatura inativa,
      limite de equipe com admins adicionais, segredos obrigatórios em produção, `TRUST_PROXY`, troca de senha
      com invalidação de tokens, compose de produção + Caddy + backup (`docs/DEPLOY.md`).
- [x] **Fase 2 do produto:** financeiro, agendamento online, lista de espera, documentos PDF, retornos,
      dashboard e cobrança automática do SaaS (Asaas/Stripe/Mercado Pago) com workers diários — migrations
      `fase2_produto`, `ajustes_fase2` e `seguranca_fase2`; QA E2E `05-*` a `08-*`; auditoria de segurança da
      fase 2 (resumo em `docs/FASE2.md` §12).
- [x] Teste grátis com 3 mensagens WhatsApp e atalho `iniciar-sistema.bat`.
- [x] Contratação de plano pela clínica (`/planos`, pagamento online — migration `contratacao_planos`), planos na
      landing page, bloqueio total com assinatura inativa e tela **Cobranças** do super admin (`/admin/cobrancas`:
      filtros a vencer / em atraso / inadimplentes / pagas / canceladas, "bloqueia em", baixa manual); os gateways
      ficaram em `/admin/cobranca`. Fluxo Asaas sandbox testado de ponta a ponta na VPS de homologação (08/10/2026).
- [x] **E-mails transacionais** (migration `emails_transacionais`): boas-vindas, esqueci minha senha, pagamento
      confirmado, aviso de renovação (2 dias antes) e recibo da mensalidade com nº da parcela; menu **E-mails** do
      super admin com SMTP (Resend), modelos editáveis, histórico e tutorial (`docs/FASE2.md` §14).

**Pendências reais** (nada disso exige código novo a princípio):

- [ ] Teste manual do WhatsApp com **celular real** (roteiro em `docs/SETUP_LOCAL.md`).
- [ ] E-mails: criar a conta no **Resend**, verificar o subdomínio de envio no DNS (Hostinger) e configurar em
      `/admin/email` (tutorial na tela; `docs/DEPLOY.md` §5). Até lá os e-mails ficam `ignorado`.
- [x] **Deploy na VPS de homologação** (`/opt/sistema-clinica`, `docker-compose.prod.yml` + `.env.prod`; domínios
      `noitedeouro.com` / `sistema.` / `admin.`). Ainda **não** é produção: o usuário edita, faz deploy e testa ali.
- [x] Asaas **sandbox** na VPS: webhook `https://sistema.noitedeouro.com/api/webhooks/pagamentos/asaas`, contratação
      paga com cartão de teste ⇒ plano liberado pelo webhook (08/10/2026).
- [ ] Asaas sandbox: testar **Pix** (cadastrar chave Pix na conta sandbox), **boleto**, cobrança mensal gerada pelo
      worker (dia 8 de cada mês para a "Clinica Fórum Telecom"), vencimento ⇒ bloqueio total ⇒ pagamento ⇒ libera, e
      **estorno**. Stripe e Mercado Pago ainda não testados com credenciais reais.
- [ ] Rodar a suíte vitest inteira (inclui os 4 arquivos novos de e-mails) e o E2E num ambiente de dev (o E2E ainda não cobre `/planos`, `/admin/cobrancas`, `/admin/email`, esqueci a senha
      nem a tela de acesso suspenso).
- [ ] Antes de virar produção: trocar o gateway para **produção**, rever planos/preços e as clínicas de teste.

**Ideias futuras** (não existem no código): Row Level Security no Postgres como segunda barreira; API oficial
do WhatsApp (Meta) como alternativa ao WPPConnect (trocar só o adapter de `whatsappService`); assinatura de
documentos clínicos com certificado digital; faturamento TISS de convênios (hoje fora do escopo); notas fiscais
da cobrança do SaaS.
