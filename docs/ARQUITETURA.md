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
| Público | visitante | `/cadastro`, `/login`, `/agendar/:slug` (agendamento online, fase 2) |

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
| `financeiro` | liga/desliga | caixa, contas a pagar/receber, recorrências, repasses (fase 2) |
| `agendamento_online` | liga/desliga | página pública de solicitação de horários (fase 2) |
| `lista_espera` | liga/desliga | lista de espera + sugestões ao cancelar (fase 2) |
| `documentos_pdf` | liga/desliga | receituário, atestado, declaração, pedido de exame em PDF (fase 2) |
| `retorno_automatico` | liga/desliga | retornos com convite pelo WhatsApp (fase 2) |
| `dashboard` | liga/desliga | KPIs da agenda e do financeiro (fase 2) |

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
| max_mensagens | 3 | total |

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
- `clinicas` — nome, documento, telefone, endereço, status, `slug` (único; URL pública `/agendar/:slug`)
- `assinaturas` — clinica_id, plano_id, status, inicio, expira_em; cobrança automática: `gateway`
  (`asaas|stripe|mercado_pago`), `cliente_externo_id`, `assinatura_externa_id`, `dia_vencimento` (1–28)
- `gateways_pagamento` — provedor (único), ambiente `sandbox|producao`, ativo (só um — índice parcial),
  `credenciais_cifradas` / `segredo_webhook_cifrado` (AES-256-GCM, `CHAVE_CRIPTOGRAFIA`), `*_final` (últimos 4),
  dias_tolerancia, metodos (`pix|boleto|cartao`)
- `cobrancas` — clinica_id, assinatura_id, gateway, id_externo (único por gateway), valor, vencimento, status
  `pendente|paga|vencida|cancelada|estornada`, metodo, link_pagamento, pago_em, payload. Plataforma, mas a
  clínica lê as próprias via `request.db` (somente leitura, filtrada)
- `eventos_gateway` — webhooks recebidos; idempotência por `(gateway, id_evento)`

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
- `mensagens_whatsapp` — agendamento_id, paciente_id, telefone, tipo (`lembrete|confirmacao|aviso` + fase 2:
  `agendamento_confirmado|agendamento_recusado|oferta_horario|convite_retorno`), direcao, conteudo, status,
  id_externo, enviada_em, lida_em (avisos à recepção: nulo = não lido), `consentimento_externo` (mensagem sem
  paciente cadastrado, com consentimento dado no formulário público). Índice único parcial `(clinica_id, id_externo)`
  para mensagens de entrada (idempotência do webhook).
- `logs_acesso` — usuario_id, acao, entidade, entidade_id, ip, criado_em

#### Fase 2 do produto (contratos em `docs/FASE2.md`)

- `profissionais` + `percentual_repasse` (0–100, null = sem repasse) e `agendamento_online` (visível na página pública)
- `configuracoes_clinica` (1:1, criada sob demanda) — agendamento online (`ao_ativo`, `ao_antecedencia_min_horas`,
  `ao_dias_a_frente`, `ao_mensagem_boas_vindas`, `ao_max_pendentes_por_telefone`) e retorno
  (`retorno_convite_ativo`, `retorno_dias_antecedencia`)
- `contas_financeiras` — nome (único na clínica), tipo `caixa|banco|carteira_digital|outro`, saldo_inicial, ativo
- `categorias_financeiras` — nome, tipo `receita|despesa`, padrao, ativo
- `movimentacoes_financeiras` — tipo `entrada|saida`, origem `manual|consulta|titulo|repasse|estorno`, data
  (dia), valor (> 0), conta_financeira_id, categoria_id, forma_pagamento (`dinheiro|pix|cartao_credito|
  cartao_debito|boleto|transferencia|convenio|outro`), descricao, agendamento_id, paciente_id, profissional_id,
  titulo_id, `estorno_de_id` (único), repasse_inicio/fim, criado_por. **Sem exclusão**: estorno = movimentação inversa
- `titulos` — contas a pagar/receber: tipo `pagar|receber`, descricao, valor, vencimento, status
  `aberto|pago|cancelado` ("vencido" é derivado), categoria, paciente, profissional, fornecedor (texto),
  parcela_numero/total + grupo_parcelas_id, recorrencia_id + competencia (único — geração idempotente),
  pago_em, valor_pago, cancelado_em
- `recorrencias` — modelo mensal que gera títulos: tipo, descricao, valor, dia_vencimento (1–31), inicio, fim,
  ativo, categoria/paciente/profissional/fornecedor, ultima_competencia (job diário + geração ao criar)
- `solicitacoes_agendamento` — pedidos da página pública: profissional, inicio/fim, status
  `pendente|aprovada|recusada|expirada`, nome, telefone, email, cpf, nascimento, observacoes, aceita_whatsapp,
  paciente_id/agendamento_id (na aprovação), motivo_recusa, analisado_por/em, ip, user_agent
- `lista_espera` — paciente, profissional (opcional), dias_semana (int[]), turnos (`manha|tarde|noite`[]),
  observacao, status `aguardando|agendado|removido`, agendamento_id, ultima_oferta_em
- `documentos_clinicos` — tipo `receita|atestado|declaracao|pedido_exame`, paciente, profissional, agendamento,
  autor, titulo, conteudo, metadados (json). **Imutável** (extensão + trigger, como o prontuário); PDF gerado
  sob demanda com `pdfkit`; log de acesso LGPD
- `retornos` — paciente, profissional, agendamento_origem_id (único), data_prevista, status
  `pendente|agendado|lembrado|cancelado`, agendamento_retorno_id, observacao, convite_enviado_em

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
- **Fase 2 do produto (em andamento):** financeiro (caixa, contas a pagar/receber, recorrências, repasses),
  agendamento online com aprovação pela recepção, lista de espera, receituário/atestado PDF, retorno
  automático, dashboard da clínica e cobrança automática do SaaS (Asaas, Stripe e Mercado Pago). Fundação
  (schema, migration `fase2_produto`, stubs, rotas, contratos) pronta — ver `docs/FASE2.md`.
