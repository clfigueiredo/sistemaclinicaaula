# Sistema Clínica — Arquitetura

> Documento vivo. Decisões iniciais fechadas em 29/09/2026; atualizado em 06/10/2026 com o MVP e a Fase 2 do
> produto concluídos. Convenções de código e regras invioláveis: `CLAUDE.md`. Contratos detalhados dos módulos
> da fase 2 (rotas, payloads, erros): `docs/FASE2.md`.

## 1. Visão geral

SaaS para clínicas particulares. Cada clínica é um **tenant totalmente isolado**: pacientes,
profissionais, usuários, convênios, financeiro e WhatsApp pertencem a uma única clínica. Um médico que
atende em duas clínicas tem **dois cadastros independentes**.

Três áreas dentro do mesmo app React:

| Área | Quem usa | Rotas |
|---|---|---|
| Painel Super Admin | dono do SaaS | `/admin` (dashboard), `/admin/planos[/:id]`, `/admin/clinicas[/:id]`, `/admin/cobranca`, `/admin/login` |
| App da Clínica | admin da clínica, recepção, profissional | `/dashboard`, `/agenda`, `/solicitacoes`, `/pacientes[/:id]`, `/lista-espera`, `/retornos`, `/financeiro/*`, `/profissionais[/:id]`, `/convenios`, `/usuarios`, `/whatsapp`, `/configuracoes`, `/onboarding` (`/` redireciona para `/agenda`) |
| Público | visitante / paciente | `/login`, `/cadastro`, `/agendar/:slug` (agendamento online) |

Abas do financeiro: `/financeiro/caixa`, `contas-pagar`, `contas-receber`, `recorrencias`, `repasses`,
`relatorios`, `configuracoes`. Links profundos da agenda: `/agenda?agendamento=<id>` (abre o painel do
agendamento) e `/agenda?novo=1&paciente_id=&profissional_id=&data=YYYY-MM-DD` (abre o diálogo de novo
agendamento preenchido — usado por Retornos e Lista de espera).

Menus e papéis por rota: `apps/web/src/rotas/navegacao.ts` (`MENU_CLINICA`, `MENU_ADMIN`, `ABAS_FINANCEIRO`,
`PAPEIS_ROTA`). Item com recurso do plano desligado não aparece; a rota mostra "recurso indisponível".

## 2. Stack

| Camada | Tecnologia |
|---|---|
| Frontend | React 19 + Vite + TypeScript, React Router 7, TanStack Query, Tailwind 4 + shadcn/ui, FullCalendar 6 |
| Backend | Node 20+ + TypeScript + Fastify 5, Zod 4 |
| Banco | PostgreSQL 16 + Prisma 6 |
| Fila / agendador | Redis 7 (com senha) + BullMQ |
| WhatsApp | WPPConnect Server (Docker, não oficial), acessado só via `whatsappService` |
| PDF | `pdfkit` (documentos clínicos gerados sob demanda) |
| Pagamentos do SaaS | Asaas, Stripe e Mercado Pago via adaptadores em `servicos/pagamentos` (um gateway ativo) |
| Infra local | Docker Desktop + `docker-compose.yml` (Postgres, Redis, WPPConnect); API e Web via `npm run dev` ou `iniciar-sistema.bat` |
| Infra produção | VPS + `docker-compose.prod.yml` (+ API, worker, Caddy com HTTPS) — `docs/DEPLOY.md` |

## 3. Multi-tenancy

- Banco único; toda tabela de clínica tem `clinica_id` (default do banco = `current_setting('app.clinica_id')`).
- `clinica_id` vem do token JWT, nunca do corpo da requisição.
- Filtro por `clinica_id` aplicado automaticamente na camada de acesso a dados (extensão do Prisma —
  `request.db`, `plugins/tenant.ts`); fora do HTTP, `criarDbTenant(clinicaId)`.
- `cobrancas` (plataforma, com `clinica_id`) é lida pela clínica via `request.db` em modo somente leitura;
  `gateways_pagamento` e `eventos_gateway` são proibidos via `request.db`.
- Futuro: Row Level Security no Postgres como segunda barreira.

## 4. Planos e recursos

### 4.1 Catálogo de recursos (fixo no código — `CATALOGO_RECURSOS` em `plugins/recursos.ts`, espelhado na tabela `recursos`)

| Código | Tipo | Conta o quê / libera |
|---|---|---|
| `max_profissionais` | limite | profissionais ativos |
| `max_recepcionistas` | limite | "usuários de equipe": recepções ativas + admins ativos **adicionais** (só o admin principal — o ativo mais antigo, normalmente o do auto-cadastro — **não** conta) |
| `max_agendamentos` | limite | agendamentos criados (inclui aprovações do agendamento online) |
| `max_anexos` | limite | arquivos de exame anexados |
| `whatsapp` | liga/desliga | permite conectar número |
| `max_mensagens` | limite | mensagens WhatsApp de saída (`pendente`/`enviada`) |
| `financeiro` | liga/desliga | caixa, contas a pagar/receber, recorrências, repasses, relatórios |
| `agendamento_online` | liga/desliga | página pública `/agendar/:slug` + solicitações |
| `lista_espera` | liga/desliga | lista de espera + sugestões ao cancelar |
| `documentos_pdf` | liga/desliga | receituário, atestado, declaração, pedido de exame em PDF |
| `retorno_automatico` | liga/desliga | retornos com convite pelo WhatsApp |
| `dashboard` | liga/desliga | KPIs da agenda, do financeiro e pendências |

Convenções:
- limite `null` = ilimitado;
- cada limite tem um **período** definido no plano: `total` (conta desde sempre) ou `mensal` (zera todo mês, no fuso da clínica).

### 4.2 Planos (criados pelo super admin, quantos quiser)

- `planos`: nome, descrição, preço, ativo, `plano_cadastro` (bool — plano atribuído no auto-cadastro; só um pode estar marcado, índice único parcial).
- `plano_recursos`: (plano_id, recurso_codigo, habilitado, limite, periodo `total|mensal`).
- Planos criados pelo super admin recebem os recursos da fase 2 **desabilitados** até ele liberar.

Planos do seed:

| Recurso | Teste grátis (`plano_cadastro`, R$ 0) | Profissional (exemplo pago, R$ 199,90) |
|---|---|---|
| max_profissionais | 1 (total) | 10 (total) |
| max_recepcionistas | 1 (total) | 5 (total) |
| max_agendamentos | 1 (total) | 2000 (mensal) |
| max_anexos | 1 (total) | 1000 (total) |
| whatsapp | sim | sim |
| max_mensagens | **3** (total) | 2000 (mensal) |
| financeiro, agendamento_online, lista_espera, documentos_pdf, retorno_automatico, dashboard | sim | sim |

O teste grátis **não tem prazo de expiração**; 3 mensagens cabem um lembrete + a confirmação/cancelamento.

### 4.3 Aplicação

- Backend: `exigirRecurso('codigo')` e `verificarLimite('codigo')` (preHandlers) ou `assegurarLimite`/
  `assegurarRecurso` (dentro de transação, com trava por clínica+recurso). Estourou → HTTP 403
  `limite_atingido` / `recurso_indisponivel` com mensagem de upgrade.
- Frontend: endpoint `/me` devolve recursos e uso atual; menus, rotas e botões se adaptam (`usePodeUsar`).
- Assinatura com status `teste | ativa | vencida | cancelada | bloqueada`. `teste`/`ativa` com `expira_em` no
  passado = `vencida` (`statusEfetivo`). Vencida/cancelada/bloqueada → **acesso suspenso** (HTTP: 403
  `assinatura_inativa` em tudo, menos `GET /me` e `GET /cobrancas/minhas`; o front mostra só a tela de pagamento)
  e **nada de WhatsApp**: o job de lembretes pula a clínica, o
  enfileiramento e o worker marcam a mensagem como `falhou/assinatura_inativa` e a resposta do paciente é
  gravada, mas não altera o agendamento nem é respondida (`assegurarAssinaturaAtiva` em `plugins/recursos.ts`).
  Os jobs da fase 2 e o agendamento online público também exigem assinatura ativa.
- Assinatura em `teste` não expira (`expira_em = null`). Com cobrança automática, `expira_em` acompanha o ciclo
  pago (ver §9).

## 5. Auto-cadastro (teste grátis)

1. Visitante preenche `/cadastro`: nome da clínica, CNPJ/CPF, responsável, e-mail, telefone, senha.
2. Sistema cria, em transação: `clinica` (com `slug` único gerado do nome) + `usuario` (papel `admin`) +
   `assinatura` no plano marcado como `plano_cadastro`, status `teste`.
3. Onboarding (`/onboarding`): cadastrar profissional → grade de horários → convênios → conectar WhatsApp.

## 6. Papéis na clínica

| Papel | Pode |
|---|---|
| admin | tudo na clínica, inclusive usuários, convênios, WhatsApp, configurações e todo o financeiro |
| recepcao | pacientes (dados cadastrais), agenda, convênios, solicitações online, lista de espera, retornos (incl. convite), caixa/recebimentos/baixa de títulos — **não vê prontuário, documentos, relatórios, recorrências, repasses nem configurações financeiras** |
| profissional | sua agenda, prontuário/alergias/medicações/documentos dos seus pacientes (regra de vínculo abaixo), seus retornos, seus recebimentos/repasses, dashboard da própria agenda |

Um usuário `admin` pode estar vinculado a um profissional (dono que também atende).
O admin principal (criado no cadastro) **não conta** no limite de usuários de equipe; admins adicionais
ativos contam junto com a recepção (criar/reativar/promover a admin passa por `assegurarLimite`).

**Vínculo profissional–paciente** (`modulos/prontuario/acesso.ts`) — o profissional só acessa prontuário,
anexos, alergias, medicações e documentos do paciente se:
1. existe registro de prontuário dele para o paciente; ou
2. existe agendamento dele com o paciente, não cancelado, **criado por outro usuário** (recepção/admin); ou
3. existe agendamento dele com o paciente com status `compareceu`/`atendido` e início já alcançado.

Agendamentos que o próprio profissional cria só valem depois do atendimento; ele não pode trocar o
paciente de um agendamento (`PUT /agendamentos/:id` ⇒ 403) e ninguém troca o paciente depois de
`agendado`/`confirmado`. Usuário vinculado a profissional **inativo** não lê nem escreve prontuário (403
`profissional_inativo`). O admin lê tudo e só escreve registro/emite documento se vinculado a profissional ativo.

## 7. Modelo de dados

Fonte da verdade: `apps/api/prisma/schema.prisma`. Migrations (`apps/api/prisma/migrations/`):
`inicial`, `regras_banco` (índices parciais, triggers), `prontuario_restrict`, `clinica_id_default`,
`whatsapp_sessao_default`, `ajustes_integracao`, `senha_alterada_em`, `fase2_produto`, `ajustes_fase2`,
`seguranca_fase2`. Todas as tabelas têm `id` (uuid), `criado_em` e, quando editáveis, `atualizado_em`.

### Plataforma (sem `clinica_id`)

- `usuarios_plataforma` — super admins: nome, email (único), senha_hash, ativo
- `recursos` — catálogo (codigo, nome, descricao, tipo `limite|booleano`, ordem), sincronizado pelo seed
- `planos`, `plano_recursos` — ver §4.2 (+ `contratavel`: a clínica contrata em `/planos`; `exibir_landing`: aparece na landing)
- `clinicas` — nome, documento (único), responsavel, email, telefone, endereco, cidade, uf, cep,
  `fuso_horario` (padrão `America/Sao_Paulo`), `slug` (único; URL pública `/agendar/:slug`), status `ativa|inativa`
- `assinaturas` — clinica_id (1:1), plano_id, status, inicio, expira_em; cobrança automática: `gateway`
  (`asaas|stripe|mercado_pago`), `cliente_externo_id`, `assinatura_externa_id`, `dia_vencimento` (1–28),
  `metodo_cobranca` (`pix|boleto|cartao`, preferido pelo worker)
- `gateways_pagamento` — provedor (único), ambiente `sandbox|producao`, ativo (só um — índice parcial),
  `credenciais_cifradas` / `segredo_webhook_cifrado` (AES-256-GCM, `CHAVE_CRIPTOGRAFIA`), `credenciais_final` /
  `segredo_webhook_final` (últimos 4), `dias_tolerancia` (padrão 5), `metodos` (padrão pix + boleto),
  `dia_vencimento_padrao` (1–28, padrão 10), `descricao_cobranca` (modelo com `{plano}`/`{competencia}`)
- `cobrancas` — clinica_id, assinatura_id, gateway, id_externo (único por gateway), descricao, valor,
  vencimento (data), status `pendente|paga|vencida|cancelada|estornada`, metodo, link_pagamento, pago_em,
  `ambiente` (`sandbox|producao`, gravado na geração), `plano_contratado_id` (contratação pela clínica: plano
  liberado quando paga), payload
- `eventos_gateway` — webhooks recebidos: gateway, id_evento, tipo, payload, processado_em, erro;
  idempotência por `(gateway, id_evento)`

### Clínica (todas com `clinica_id`)

**Cadastros e agenda**

- `usuarios` — nome, e-mail (único na clínica), senha_hash, papel `admin|recepcao|profissional`,
  profissional_id (opcional, único), ativo, ultimo_acesso_em, senha_alterada_em
- `profissionais` — nome, especialidade, registro (CRM/CRO/CRP…), telefone, email, duracao_consulta_min
  (padrão 30), cor_agenda, ativo, `percentual_repasse` (0–100, null = sem repasse), `agendamento_online`
  (visível na página pública, padrão true)
- `profissional_horarios` — profissional_id, dia_semana (0 = domingo), hora_inicio, hora_fim (`"HH:mm"`, fuso da clínica)
- `bloqueios_agenda` — profissional_id (null = clínica toda), inicio, fim, motivo
- `convenios` — nome (único na clínica), ativo
- `pacientes` — nome, cpf (único na clínica), nascimento, sexo, telefone, whatsapp, email, endereco,
  convenio_id, numero_carteirinha, contato_emergencia, `aceita_whatsapp` (consentimento LGPD), observacoes, ativo
- `agendamentos` — paciente_id, profissional_id, inicio, fim, tipo (`particular|convenio`), convenio_id, status,
  observacoes, motivo_cancelamento, cancelado_em, criado_por, lembrete_enviado_em
- `configuracoes_clinica` (1:1, criada sob demanda) — agendamento online (`ao_ativo` false,
  `ao_antecedencia_min_horas` 2, `ao_dias_a_frente` 30, `ao_mensagem_boas_vindas`, `ao_max_pendentes_por_telefone`
  2) e retorno (`retorno_convite_ativo` true, `retorno_dias_antecedencia` 7)

Status de agendamento: `agendado → confirmado → compareceu → atendido`, além de `cancelado` e `faltou`
(cancelado/faltou liberam o horário; sem DELETE).

**Dados clínicos (LGPD)**

- `prontuario_registros` — paciente_id, profissional_id, agendamento_id, autor_id, texto, corrige_registro_id
  (**sem update/delete** — extensão + trigger; correção = novo registro)
- `paciente_alergias` (descricao, gravidade) / `paciente_medicacoes` (nome, dosagem, frequencia, observacoes)
- `anexos` — paciente_id, registro_id, nome_arquivo, caminho (relativo a `UPLOAD_DIR`), mime_tipo, tamanho, enviado_por
- `documentos_clinicos` — tipo `receita|atestado|declaracao|pedido_exame`, paciente, profissional, agendamento,
  autor, titulo, conteudo, metadados (json). **Imutável** (extensão + trigger); PDF gerado sob demanda
- `logs_acesso` — usuario_id, acao, entidade, entidade_id, ip, user_agent, criado_em

**WhatsApp**

- `whatsapp_sessoes` — 1 por clínica: nome_sessao (único), token, status
  `desconectada|iniciando|aguardando_qr|conectada|erro`, telefone
- `mensagens_whatsapp` — agendamento_id, paciente_id, telefone, tipo (`lembrete|confirmacao|aviso|
  agendamento_confirmado|agendamento_recusado|oferta_horario|convite_retorno`), direcao `entrada|saida`,
  conteudo, status `pendente|enviada|falhou|recebida`, erro, id_externo, enviada_em, lida_em (avisos à recepção:
  nulo = não lido), `consentimento_externo` (mensagem sem paciente cadastrado, consentimento dado no formulário
  público). Índice único parcial `(clinica_id, id_externo)` para mensagens de entrada (idempotência do webhook).

**Fase 2 — operação**

- `solicitacoes_agendamento` — pedidos da página pública: profissional, inicio/fim, status
  `pendente|aprovada|recusada|expirada`, nome, telefone, email, cpf, nascimento, observacoes, aceita_whatsapp,
  paciente_id / agendamento_id (único, na aprovação), motivo_recusa, analisado_por/em, ip, user_agent
- `lista_espera` — paciente, profissional (opcional = qualquer), dias_semana (int[]), turnos
  (`manha|tarde|noite`[]), observacao, status `aguardando|agendado|removido`, agendamento_id, ultima_oferta_em, criado_por
- `retornos` — paciente, profissional, agendamento_origem_id (único), data_prevista (data), status
  `pendente|lembrado|agendado|cancelado`, agendamento_retorno_id, observacao, convite_enviado_em, criado_por

**Fase 2 — financeiro**

- `contas_financeiras` — nome (único na clínica), tipo `caixa|banco|carteira_digital|outro`, saldo_inicial, ativo
- `categorias_financeiras` — nome, tipo `receita|despesa`, padrao, ativo (único por clínica+tipo+nome)
- `movimentacoes_financeiras` — tipo `entrada|saida`, origem `manual|consulta|titulo|repasse|estorno`, data
  (dia), valor (> 0), conta_financeira_id, categoria_id, forma_pagamento (`dinheiro|pix|cartao_credito|
  cartao_debito|boleto|transferencia|convenio|outro`), descricao, agendamento_id, paciente_id, profissional_id,
  titulo_id, `estorno_de_id` (único), repasse_inicio/fim, criado_por. **Sem exclusão**: estorno = movimentação inversa
- `titulos` — contas a pagar/receber: tipo `pagar|receber`, descricao, valor, vencimento, status
  `aberto|pago|cancelado` ("vencido" é derivado), categoria, paciente, profissional, fornecedor (texto),
  forma_pagamento, parcela_numero/total + grupo_parcelas_id, recorrencia_id + competencia (único — geração
  idempotente), `agendamento_id` (consulta de convênio a receber), observacoes, pago_em, valor_pago, cancelado_em, criado_por
- `recorrencias` — modelo que gera títulos: tipo, descricao, valor, dia_vencimento (1–31), frequencia (só
  `mensal`), inicio, fim, ativo, categoria/paciente/profissional/fornecedor, forma_pagamento, ultima_competencia, criado_por

## 8. Fluxos de WhatsApp

Regras gerais: todo envio passa por `enfileirarMensagem` (`servicos/whatsapp/envio.ts`) → fila
`envio-whatsapp` → worker com intervalo aleatório de 20–40 s por clínica. Só para quem tem consentimento
(`pacientes.aceita_whatsapp` ou, sem paciente cadastrado, o consentimento do formulário público). Cada envio
consome `max_mensagens`; assinatura inativa bloqueia tudo. Templates em `servicos/whatsapp/mensagens.ts`.

### 8.1 Lembrete e confirmação (MVP)

1. Job diário às **09:00** (`TZ_PADRAO`) seleciona agendamentos de amanhã (fuso de cada clínica) com status
   `agendado` e paciente `aceita_whatsapp`, das clínicas com sessão conectada e recurso `whatsapp`. Também há o
   botão "Enviar lembretes de amanhã agora" na tela WhatsApp (`POST /whatsapp/lembretes/executar`).
2. Para cada um: verifica recurso e limite → enfileira o lembrete.
3. Webhook do WPPConnect (`POST /webhooks/whatsapp?token=...`, clínica identificada pelo nome da sessão,
   idempotente) recebe a resposta: `1` → `confirmado` + resposta; `2` → `cancelado` (motivo "Cancelado pelo
   paciente via WhatsApp") + resposta + **aviso à recepção** (sino no topo para admin e recepção); outro texto →
   instruções uma única vez. Respostas a outros tipos de mensagem só são gravadas.

### 8.2 Agendamento online (fase 2)

1. Paciente abre `/agendar/:slug`, escolhe profissional (visíveis), dia e horário livre (respeitando
   antecedência mínima e dias à frente) e envia nome/telefone/consentimento → solicitação **`pendente`** (não
   consome limite). Disponível só com clínica ativa, assinatura ativa, recurso `agendamento_online` e `ao_ativo`.
2. Anti-abuso: rate limit por IP (60/min leitura, 5/min envio; IPv6 por /64), honeypot, máx. de pendentes por
   telefone (configurável), **3** pendentes futuras por IP e **10** por profissional/dia.
3. A recepção vê o aviso no topo e a tela **Solicitações**: **aprovar** (casa paciente pelo CPF ou cria;
   consome `max_agendamentos`; valida horário) → WhatsApp `agendamento_confirmado` (paciente novo ⇒ telefone
   da solicitação; existente ⇒ WhatsApp do cadastro; telefone divergente ⇒ aviso `telefone_divergente`), ou
   **recusar** → `agendamento_recusado` com link para escolher outro horário.
4. Job de hora em hora (minuto 15) marca como `expirada` a pendente cujo horário passou.

### 8.3 Lista de espera (fase 2)

Paciente entra na lista com profissional/dias/turnos preferidos. Quando um agendamento é cancelado ou vira
falta, o painel da agenda e o aviso no topo sugerem os compatíveis; a recepção pode **oferecer** o horário
(`oferta_horario`) ou agendar direto. Respostas do paciente não são interpretadas.

### 8.4 Retornos (fase 2)

Após `compareceu`/`atendido`, o profissional/recepção define "retorno em X dias". Job diário às **09:30**:
reconcilia retornos com agendamentos posteriores do mesmo paciente+profissional (até 90 dias após a data
prevista) e envia **convite** (`convite_retorno`, com link do agendamento online quando disponível) para os
pendentes dentro da antecedência configurada. Criar um agendamento compatível marca o retorno como `agendado`
na hora.

## 9. Cobrança do SaaS (fase 2)

- Super admin configura os gateways em `/admin/cobranca` (credenciais cifradas; nunca devolvidas pela API) e
  **ativa um**. URL de webhook: `${API_URL_PUBLICA}/webhooks/pagamentos/<asaas|stripe|mercado_pago>`.
- Atribuir plano **pago** a uma clínica com gateway ativo liga a **cobrança automática** (cliente no gateway +
  dia de vencimento + método). Também é possível ligar/desligar e gerar cobrança avulsa no detalhe da clínica.
- Job diário às **07:00**: pendentes vencidas ⇒ `vencida`; gera a cobrança do próximo ciclo (até 10 dias antes,
  no máximo uma por mês — o **nosso** worker, não a assinatura nativa do gateway); dívida em aberto além de
  `dias_tolerancia` ⇒ assinatura `ativa` → `vencida` (acesso suspenso).
- Webhook `cobranca_paga` ⇒ cobrança `paga`, assinatura volta a `ativa` (se não restar outra dívida além da
  tolerância) e `expira_em` avança até o fim do ciclo pago + tolerância (nunca recua no pagamento). Estorno/
  chargeback de cobrança paga recalcula `expira_em` pelo último ciclo ainda pago; `estornada` conta como dívida
  até o super admin cancelá-la (perdão). Pagamento de cobrança cancelada não reativa; pagamento de cobrança
  sandbox com o gateway já em produção é ignorado. Eventos idempotentes em `eventos_gateway`.
- A clínica vê as faturas em **Configurações → Faturas do sistema** (`GET /cobrancas/minhas`).
- **Contratação pela clínica** (plano gratuito ⇒ plano pago marcado `contratavel`): `/planos` gera a cobrança e leva à
  fatura do gateway; o plano só muda quando o pagamento é confirmado. Planos com `exibir_landing` aparecem na landing.
- Assinatura inativa ⇒ **acesso suspenso** (tela de pagamento); super admin acompanha em **Cobranças**
  (`/admin/cobrancas`: a vencer, em atraso, inadimplentes, pagas, canceladas; "bloqueia em"; baixa manual).

Detalhes e decisões: `docs/FASE2.md` §7, §12 e §13.

## 10. Rotas de bloqueios de agenda

O contrato inicial previa `GET /bloqueios`; ficou assim (sem alias):

- `GET/POST /profissionais/bloqueios`, `DELETE /profissionais/bloqueios/:id` — cadastro de bloqueios (tela do profissional; admin e recepção criam/removem).
- `GET /agendamentos/bloqueios?inicio&fim[&profissionalId]` — leitura para a agenda (profissional logado só vê os seus + os da clínica toda).

## 11. Módulos da API (prefixos)

| Módulo | Rotas |
|---|---|
| `auth` | `/auth/admin/login`, `/auth/login`, `/auth/cadastro` |
| `me` | `/me`, `/me/onboarding`, `/me/clinica`, `/admin/me` |
| `admin-planos` | `/admin/recursos`, `/admin/planos*` |
| `admin-clinicas` | `/admin/dashboard`, `/admin/clinicas*` (inclui `PUT /admin/clinicas/:id/assinatura`) |
| `admin-cobranca` | `/admin/cobranca/*` (+ `cobrancas/:id/pagar-manual`), `/cobrancas/minhas`, `POST /webhooks/pagamentos/:gateway` |
| `contratacao` | `GET /publico/planos` (público), `GET/POST /contratacao` (admin da clínica) |
| `profissionais` | `/profissionais*` (+ `/horarios`, `/profissionais/bloqueios*`) |
| `convenios` | `/convenios*` |
| `usuarios` | `/usuarios*` (+ `/usuarios/:id/senha`) |
| `pacientes` | `/pacientes*` (+ alergias e medicações) |
| `prontuario` | `/prontuario/pacientes/:id[/anexos]`, `/prontuario/anexos/:id/download` |
| `agendamentos` | `/agendamentos*` (+ `/disponibilidade`, `/profissionais`, `/bloqueios`, `/:id/status`) |
| `whatsapp` | `/whatsapp/*`, `POST /webhooks/whatsapp` |
| `financeiro` | `/financeiro/*` |
| `agendamento-online` | `/publico/clinicas/:slug*` (público), `/solicitacoes*`, `/agendamento-online/configuracao` |
| `lista-espera` | `/lista-espera*` |
| `documentos` | `/documentos*` |
| `retornos` | `/retornos*` |
| `dashboard` | `/dashboard` |

Além disso: `GET /saude` (health check). Cada `modulos/<nome>/index.ts` descreve no cabeçalho as rotas,
papéis e regras. No front, todas são chamadas com o prefixo `/api` (proxy do Vite em dev, Caddy em produção).

## 12. Workers (BullMQ)

| Fila | Agenda (`TZ_PADRAO`) | Função |
|---|---|---|
| `envio-whatsapp` | sob demanda | envia mensagens com intervalo 20–40 s por clínica |
| `lembretes` | 09:00 | enfileira lembretes de amanhã |
| `financeiro-recorrencias` | 06:00 | gera títulos das recorrências (mês corrente e próximo) |
| `cobrancas` | 07:00 | vence cobranças, gera as do próximo ciclo, aplica tolerância |
| `retornos` | 09:30 | reconcilia retornos e envia convites |
| `solicitacoes-agendamento` | minuto 15 de cada hora | expira solicitações pendentes cujo horário passou |

Em dev rodam no processo da API (`EXECUTAR_WORKERS=true`); em produção, no container `worker`.

## 13. LGPD / CFM (mínimo desde o início)

- Consentimento de WhatsApp no cadastro do paciente (e no formulário público do agendamento online).
- Log de acesso a prontuário, anexos e documentos clínicos (`logs_acesso`; inclusive prévia de documento).
- Prontuário e documentos clínicos imutáveis (só acréscimo).
- Backup diário do Postgres + anexos (`deploy/backup.sh`, ver `docs/DEPLOY.md`).
- Senhas com bcrypt; HTTPS em produção (Caddy); segredos de gateway cifrados (AES-256-GCM).
- Troca da própria senha exige a senha atual; qualquer troca/redefinição invalida os tokens anteriores
  do usuário (`usuarios.senha_alterada_em` × `iat` do JWT).
- Login com e-mail inexistente roda bcrypt contra um hash falso (sem enumeração por tempo).
- Exportações CSV protegidas contra CSV injection.

## 14. Fases

- **Fase 1 (MVP) — concluída:** cadastros, agenda, prontuário + anexos, WhatsApp (lembrete/confirmação),
  planos e limites, painel super admin, auto-cadastro, auditoria de segurança.
- **Fase 2 do produto — concluída:** financeiro (caixa, contas a pagar/receber, recorrências, repasses,
  relatórios), agendamento online com aprovação pela recepção, lista de espera, receituário/atestado PDF,
  retorno automático, dashboard da clínica e cobrança automática do SaaS (Asaas, Stripe e Mercado Pago),
  com auditoria de segurança (`docs/FASE2.md`).
- **Pendente (operacional):** teste do WhatsApp com celular real, teste dos gateways em sandbox com credenciais
  reais + túnel, primeiro deploy na VPS.
- **Ideias futuras (não implementadas):** Row Level Security; API oficial do WhatsApp (Meta); assinatura digital
  de documentos clínicos; faturamento TISS; nota fiscal da cobrança do SaaS.
