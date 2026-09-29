# CLAUDE.md — Sistema Clínica (SaaS)

## Sobre o projeto

SaaS de gestão para clínicas particulares. Várias clínicas usam o mesmo sistema, cada uma
**totalmente isolada** (multi-tenant por `clinica_id`). O dono do SaaS gerencia planos e
clínicas num painel super admin; cada plano libera/limita recursos do sistema.

Documentação completa da arquitetura e do modelo de dados: **`docs/ARQUITETURA.md`** —
ler antes de implementar qualquer módulo. Setup do ambiente local: **`docs/SETUP_LOCAL.md`**.

## Idioma

- Conversa, comentários, mensagens de commit e textos de interface em **português do Brasil**, com acentuação correta.
- Nomes de tabelas, colunas, rotas e entidades de domínio em português sem acento (`pacientes`, `agendamentos`, `clinica_id`).
- Termos técnicos e bibliotecas mantêm o nome original.

## Stack

- **Frontend:** React + Vite + TypeScript, React Router, TanStack Query, Tailwind + shadcn/ui
- **Backend:** Node 20+ + TypeScript + Fastify, validação com Zod
- **Banco:** PostgreSQL + Prisma
- **Fila/agendador:** Redis + BullMQ
- **WhatsApp:** WPPConnect Server (Docker) — não oficial
- **Local:** Docker Desktop (Postgres, Redis, WPPConnect via docker-compose); API e Web com `npm run dev`
- **Produção:** VPS com o mesmo docker-compose + Caddy (HTTPS)

**Não usar Next.js** — decisão do usuário: React puro com Vite.

## Estrutura planejada (monorepo com npm workspaces)

```
Sistema_Clinica/
├── CLAUDE.md
├── docker-compose.yml        # postgres, redis, wppconnect
├── .env.example
├── docs/
│   ├── ARQUITETURA.md
│   └── SETUP_LOCAL.md
├── apps/
│   ├── api/                  # Fastify + Prisma
│   │   ├── prisma/schema.prisma
│   │   └── src/
│   │       ├── modulos/      # um diretório por domínio (pacientes, agendamentos, planos…)
│   │       ├── plugins/      # auth, tenant, recursos do plano
│   │       ├── servicos/     # whatsappService, filas
│   │       └── workers/      # jobs BullMQ (lembretes)
│   └── web/                  # React + Vite
│       └── src/
│           ├── paginas/
│           │   ├── admin/    # painel super admin (/admin)
│           │   ├── clinica/  # app da clínica
│           │   └── publico/  # login, cadastro
│           ├── componentes/
│           └── api/          # cliente HTTP + hooks TanStack Query
└── package.json
```

## Regras que NÃO podem ser quebradas

1. **Isolamento de tenant:** toda tabela de clínica tem `clinica_id`. O `clinica_id` vem **sempre do token JWT**, nunca do body/query. Toda consulta é filtrada automaticamente (extensão do Prisma). Nunca escrever query de dados de clínica sem esse filtro.
2. **Limites do plano no backend:** toda criação que consome recurso passa por `exigirRecurso()` / `verificarLimite()`. Esconder botão no frontend é só UX, não é segurança.
3. **Prontuário imutável:** `prontuario_registros` não tem update nem delete. Correção = novo registro.
4. **Recepção não vê prontuário:** checar papel no backend.
5. **WhatsApp desacoplado:** o resto do sistema só fala com `whatsappService`; nada de chamar a API do WPPConnect direto de outro módulo (para poder trocar pela API oficial da Meta depois).
6. **Envio de WhatsApp sempre pela fila**, com intervalo aleatório (20–40 s) por sessão/clínica, e só para pacientes com `aceita_whatsapp = true`.
7. **Log de acesso** (`logs_acesso`) ao visualizar/criar registros de prontuário (LGPD).
8. Nunca commitar `.env` nem credenciais.

## Decisões de negócio já tomadas

- Entidade genérica **`profissionais`** (médico é um profissional; campo `registro` serve para CRM/CRO/CRP…).
- **Convênio:** apenas seleção do nome (lista por clínica); sem faturamento TISS. Agendamento é `particular` ou `convenio`.
- **Auto-cadastro** público cria clínica + usuário admin + assinatura no plano marcado como `plano_cadastro`.
- **Teste grátis:** todas as funções, tudo limitado a **1** (profissional, recepcionista, agendamento, anexo, mensagem WhatsApp); limites **totais**, **sem prazo** de expiração.
- O **admin da clínica não conta** no limite de recepcionistas e pode estar vinculado a um profissional.
- Planos ilimitados criados pelo super admin; cada limite tem período `total` ou `mensal`.
- Mesmo profissional em duas clínicas = **dois cadastros independentes**.
- Cada clínica conecta **o próprio número** de WhatsApp (uma sessão WPPConnect por clínica).
- Lembrete enviado **1 dia antes**; resposta `1` confirma, `2` cancela e avisa a recepção.

## Comandos (a definir quando o esqueleto for criado)

```bash
docker compose up -d        # sobe postgres, redis, wppconnect
npm install
npm run dev                 # api + web
npm run db:migrate          # prisma migrate dev
npm run db:seed             # super admin + plano de teste
```

## Status atual

- [x] Levantamento de requisitos e arquitetura (`docs/ARQUITETURA.md`)
- [x] Instalar Docker Desktop (ver `docs/SETUP_LOCAL.md` — instalação por usuário, PATH OK)
- [ ] Esqueleto do monorepo + docker-compose
- [ ] Schema Prisma + seed (super admin, recursos, plano de teste)
- [ ] Auth (login super admin / usuários da clínica) + auto-cadastro
- [ ] Painel admin: planos, recursos, clínicas
- [ ] Clínica: profissionais + grade de horários + convênios
- [ ] Pacientes
- [ ] Agenda
- [ ] Prontuário + anexos
- [ ] WhatsApp: conexão QR, lembrete, confirmação
