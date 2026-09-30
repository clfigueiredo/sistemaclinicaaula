# Sistema Clínica — Arquitetura (rascunho v1)

> Documento vivo. Decisões fechadas na conversa de 29/09/2026.

## 1. Visão geral

SaaS para clínicas particulares. Cada clínica é um **tenant totalmente isolado**: pacientes,
profissionais, usuários, convênios e WhatsApp pertencem a uma única clínica. Um médico que
atende em duas clínicas tem **dois cadastros independentes**.

Dois ambientes dentro do mesmo app React:

| Área | Quem usa | Rotas |
|---|---|---|
| Painel Super Admin | dono do SaaS | `/admin/*` |
| App da Clínica | admin da clínica, recepção, profissional | `/*` |
| Público | visitante | `/cadastro`, `/login` |

## 2. Stack

| Camada | Tecnologia |
|---|---|
| Frontend | React + Vite + TypeScript, React Router, TanStack Query, Tailwind + shadcn/ui |
| Backend | Node + TypeScript + Fastify, Zod |
| Banco | PostgreSQL + Prisma |
| Fila / agendador | Redis + BullMQ |
| WhatsApp | WPPConnect Server (Docker), acessado só via `whatsappService` |
| Infra local | Docker Desktop + docker-compose (Postgres, Redis, WPPConnect); API e Web via `npm run dev` |
| Infra produção | VPS + mesmo docker-compose + Caddy (HTTPS) |

## 3. Multi-tenancy

- Banco único; toda tabela de clínica tem `clinica_id`.
- `clinica_id` vem do token JWT, nunca do corpo da requisição.
- Filtro por `clinica_id` aplicado automaticamente na camada de acesso a dados (extensão do Prisma).
- Futuro: Row Level Security no Postgres como segunda barreira.

## 4. Planos e recursos

### 4.1 Catálogo de recursos (fixo no código)

| Código | Tipo | Conta o quê |
|---|---|---|
| `max_profissionais` | limite | profissionais ativos |
| `max_recepcionistas` | limite | "usuários de equipe": recepções ativas + admins ativos **adicionais** (só o admin principal — o ativo mais antigo, normalmente o do auto-cadastro — **não** conta) |
| `max_agendamentos` | limite | agendamentos criados |
| `max_anexos` | limite | arquivos de exame anexados |
| `whatsapp` | liga/desliga | permite conectar número |
| `max_mensagens` | limite | mensagens WhatsApp enviadas |
| `financeiro` | liga/desliga | fase 2 |
| `agendamento_online` | liga/desliga | fase 2 |

Convenções:
- limite `null` = ilimitado;
- cada limite tem um **período** definido no plano: `total` (conta desde sempre) ou `mensal` (zera todo mês).

### 4.2 Planos (criados pelo super admin, quantos quiser)

- `planos`: nome, preço, ativo, `plano_cadastro` (bool — plano atribuído no auto-cadastro; só um pode estar marcado).
- `plano_recursos`: (plano_id, recurso_codigo, habilitado, limite, periodo `total|mensal`).

Plano de teste grátis — **sem prazo de expiração**, limites **totais**:

| Recurso | Valor | Período |
|---|---|---|
| max_profissionais | 1 | total |
| max_recepcionistas | 1 | total |
| max_agendamentos | 1 | total |
| max_anexos | 1 | total |
| whatsapp | sim | — |
| max_mensagens | 1 | total |

Planos pagos normalmente usam `mensal` para agendamentos e mensagens.

### 4.3 Aplicação

- Backend: `exigirRecurso('codigo')` e `verificarLimite('codigo')` antes da ação. Estourou → HTTP 403 com mensagem de upgrade.
- Frontend: endpoint `/me` devolve recursos e uso atual; menus e botões se adaptam.
- Assinatura com status `teste | ativa | vencida | cancelada | bloqueada`. Vencida/cancelada/bloqueada → acesso somente leitura
  (HTTP) e **nada de WhatsApp**: o job de lembretes pula a clínica, o enfileiramento e o worker marcam a
  mensagem como `falhou/assinatura_inativa` e a resposta do paciente é gravada, mas não altera o agendamento
  nem é respondida (`assegurarAssinaturaAtiva` em `plugins/recursos.ts`).
- Assinatura em `teste` não expira (`expira_em = null`); a conversão acontece quando a clínica bate os limites e faz upgrade.

## 5. Auto-cadastro (teste grátis)

1. Visitante preenche `/cadastro`: nome da clínica, CNPJ/CPF, responsável, e-mail, telefone, senha.
2. Sistema cria, em transação: `clinica` + `usuario` (papel `admin`) + `assinatura` no plano marcado como `plano_cadastro`, status `teste`.
3. Onboarding: cadastrar profissional → grade de horários → convênios → conectar WhatsApp.

## 6. Papéis na clínica

| Papel | Pode |
|---|---|
| admin | tudo na clínica, inclusive usuários, convênios e WhatsApp |
| recepcao | pacientes (dados cadastrais), agenda, convênios — **não vê prontuário** |
| profissional | sua agenda e prontuário/alergias/medicações dos seus pacientes (regra de vínculo abaixo) |

Um usuário `admin` pode estar vinculado a um profissional (dono que também atende).
O admin principal (criado no cadastro) **não conta** no limite de usuários de equipe; admins adicionais
ativos contam junto com a recepção (criar/reativar/promover a admin passa por `assegurarLimite`).

**Vínculo profissional–paciente** (`modulos/prontuario/acesso.ts`) — o profissional só acessa prontuário,
anexos, alergias e medicações do paciente se:
1. existe registro de prontuário dele para o paciente; ou
2. existe agendamento dele com o paciente, não cancelado, **criado por outro usuário** (recepção/admin); ou
3. existe agendamento dele com o paciente com status `compareceu`/`atendido` e início já alcançado.

Agendamentos que o próprio profissional cria só valem depois do atendimento; ele não pode trocar o
paciente de um agendamento (`PUT /agendamentos/:id` ⇒ 403) e ninguém troca o paciente depois de
`agendado`/`confirmado`. Usuário vinculado a profissional **inativo** não lê nem escreve prontuário (403
`profissional_inativo`). O admin lê tudo e só escreve registro se vinculado a profissional ativo.

## 7. Modelo de dados

### Plataforma (sem `clinica_id`)

- `usuarios_plataforma` — super admins
- `planos`, `plano_recursos`
- `clinicas` — nome, documento, telefone, endereço, status
- `assinaturas` — clinica_id, plano_id, status, inicio, expira_em

### Clínica (todas com `clinica_id`)

- `usuarios` — nome, e-mail, senha_hash, papel, profissional_id (opcional), ativo, senha_alterada_em
- `profissionais` — nome, especialidade, registro (CRM/CRO/CRP…), duracao_consulta_min, cor_agenda, ativo
- `profissional_horarios` — profissional_id, dia_semana, hora_inicio, hora_fim
- `bloqueios_agenda` — profissional_id (null = clínica toda), inicio, fim, motivo
- `convenios` — nome, ativo
- `pacientes` — nome, cpf, nascimento, sexo, telefone, whatsapp, email, endereço, convenio_id, numero_carteirinha, contato_emergencia, `aceita_whatsapp`, observacoes
- `agendamentos` — paciente_id, profissional_id, inicio, fim, tipo (`particular|convenio`), convenio_id, status, observacoes, motivo_cancelamento, cancelado_em, criado_por, lembrete_enviado_em
- `prontuario_registros` — paciente_id, profissional_id, agendamento_id, texto, criado_em (**sem update/delete**; correção = novo registro)
- `paciente_alergias` / `paciente_medicacoes`
- `anexos` — paciente_id, registro_id, nome_arquivo, caminho, tamanho, enviado_por
- `whatsapp_sessoes` — status da conexão
- `mensagens_whatsapp` — agendamento_id, paciente_id, telefone, tipo (`lembrete|confirmacao|aviso`), direcao, conteudo, status, id_externo, enviada_em, lida_em (avisos à recepção: nulo = não lido). Índice único parcial `(clinica_id, id_externo)` para mensagens de entrada (idempotência do webhook).
- `logs_acesso` — usuario_id, acao, entidade, entidade_id, ip, criado_em

Status de agendamento: `agendado → confirmado → compareceu → atendido`, além de `cancelado` e `faltou`.

## 8. Fluxo de lembrete WhatsApp

1. Job diário (BullMQ repeatable) seleciona agendamentos de amanhã com status `agendado` e paciente `aceita_whatsapp`.
2. Para cada um: verifica recurso `whatsapp` e `max_mensagens` → enfileira envio na fila da clínica.
3. Worker envia com intervalo aleatório (20–40 s) por sessão.
4. Webhook do WPPConnect recebe resposta: `1` → `confirmado`; `2` → `cancelado` (motivo "Cancelado pelo paciente via WhatsApp") + aviso à recepção (sino no topo do app para admin e recepção).

### Rotas de bloqueios de agenda

O contrato inicial previa `GET /bloqueios`; ficou assim (sem alias):

- `GET/POST /profissionais/bloqueios`, `DELETE /profissionais/bloqueios/:id` — cadastro de bloqueios (tela do profissional; admin e recepção criam/removem).
- `GET /agendamentos/bloqueios?inicio&fim[&profissionalId]` — leitura para a agenda (profissional logado só vê os seus + os da clínica toda).

## 9. LGPD / CFM (mínimo desde o início)

- Consentimento de WhatsApp no cadastro do paciente.
- Log de acesso a prontuário.
- Prontuário imutável (só acréscimo).
- Backup diário do Postgres (`deploy/backup.sh`, ver `docs/DEPLOY.md`).
- Senhas com bcrypt/argon2; HTTPS em produção (Caddy).
- Troca da própria senha exige a senha atual; qualquer troca/redefinição invalida os tokens anteriores
  do usuário (`usuarios.senha_alterada_em` × `iat` do JWT).
- Login com e-mail inexistente roda bcrypt contra um hash falso (sem enumeração por tempo).

## 10. Fases

- **Fase 1 (MVP):** tudo acima.
- **Fase 2:** financeiro simples, lista de espera, receituário/atestado PDF, retorno automático, dashboard, agendamento online, cobrança automática (Asaas/Stripe).
