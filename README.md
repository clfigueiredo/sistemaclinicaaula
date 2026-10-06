# Sistema Clínica

SaaS multi-tenant de gestão para clínicas particulares: agenda, pacientes, prontuário eletrônico com anexos,
lembretes e confirmação pelo WhatsApp, financeiro (caixa, contas a pagar/receber, recorrências, repasses),
agendamento online com aprovação da recepção, lista de espera, retornos, receituário/atestado em PDF e
dashboard. O dono do SaaS gerencia planos, clínicas e a cobrança automática (Asaas, Stripe ou Mercado Pago)
num painel super admin. Cada clínica é totalmente isolada (`clinica_id`).

**Stack:** React 19 + Vite + Tailwind/shadcn (web) · Node + Fastify + Zod (API) · PostgreSQL + Prisma ·
Redis + BullMQ · WPPConnect (WhatsApp) · Docker / Caddy.

**Status:** MVP e Fase 2 concluídos. Pendentes: teste do WhatsApp com celular real, gateways em sandbox com
credenciais reais e o primeiro deploy na VPS.

## Como subir (Windows, desenvolvimento)

Pré-requisitos: Node 20.19+, Docker Desktop.

```powershell
copy .env.example .env
docker compose up -d
npm install
npm run db:migrate
npm run db:seed
npm run dev          # API http://localhost:3333 · Web http://localhost:5173
```

No dia a dia, basta dar duplo clique em **`iniciar-sistema.bat`** (log em `logs\dev.log`).

Logins do seed: super admin `admin@sistema.local` / `admin123` (`/admin/login`); Clínica Demo
`admin@demo.local`, `recepcao@demo.local`, `profissional@demo.local` / `demo123`.

## Documentação

- [`CLAUDE.md`](CLAUDE.md) — guia do projeto: regras, convenções, comandos, decisões de negócio e status
- [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md) — arquitetura, planos e recursos, papéis, modelo de dados e fluxos
- [`docs/FASE2.md`](docs/FASE2.md) — contratos dos módulos da fase 2
- [`docs/SETUP_LOCAL.md`](docs/SETUP_LOCAL.md) — setup local, roteiros de teste manual e solução de problemas
- [`docs/DEPLOY.md`](docs/DEPLOY.md) — deploy em produção na VPS e backup
