# Fase 2 do produto — contratos por módulo

> Fundação entregue em 30/09/2026 (migration `20261001000000_fase2_produto`). Este documento é o
> **contrato** entre os módulos da fase 2, que são implementados em paralelo. Leia também `CLAUDE.md`
> (regras e convenções) e `docs/ARQUITETURA.md` §7 (modelo de dados).

## 0. Regras para quem implementa um módulo

**Arquivos compartilhados são CONGELADOS** (não edite; se faltar algo, registre no relatório):
`apps/api/prisma/schema.prisma`, `prisma/migrations/*`, `prisma/seed.ts`, `src/plugins/*`,
`src/modulos/index.ts`, `src/app.ts`, `src/config/env.ts`, `src/servicos/filas.ts`, `src/workers/index.ts`,
`src/servicos/whatsapp/*` (use, não altere), `src/servicos/configuracaoClinica.ts`,
`src/servicos/financeiroComum.ts`, `src/utils/*`, `apps/web/src/rotas/*`, `componentes/layout/*`,
`componentes/comum/*`, `api/cliente.ts`, `api/tipos.ts`, `api/me.ts`, os dois `package.json`.

Cada módulo **possui** os arquivos listados na sua seção (API e web) e pode criar arquivos novos dentro
das próprias pastas (`src/modulos/<modulo>/*`, `src/paginas/.../<modulo>/*`) e testes `apps/api/test/<modulo>.test.ts`.

Padrões obrigatórios (resumo do `CLAUDE.md`):
- `request.db` (tenant) sempre; valide TODA FK do body com `ou404(await request.db.x.findUnique(...))`.
  Sem nested writes em modelos de clínica. `prisma` cru só em rotas públicas/webhooks/workers/admin.
- Erros com `ErroNegocio`/`erros.*`; validação Zod no `schema` da rota (mensagens em pt-BR; `z.coerce` em query).
- Recurso do plano: o stub já registra `exigirRecurso('<codigo>')` para o módulo inteiro.
- WhatsApp **só** via `enfileirarMensagem` (seção 8), depois do commit da transação.
- Datas com hora em UTC (`DateTime`); datas **sem hora** (`@db.Date`: vencimentos, `movimentacoes.data`,
  `retornos.data_prevista`) trafegam como `'YYYY-MM-DD'` e são gravadas como meia-noite UTC
  (`dataSemHora`/`paraDataIso`/`hojeNoFuso` em `src/servicos/financeiroComum.ts`). "Hoje" = fuso da clínica.
- Valores monetários: body em `number` (reais, 2 casas); respostas `Decimal` saem como string (`"150.00"`).
- Paginação: `?pagina=1&por_pagina=20` ⇒ `{ itens, total, pagina, porPagina }` (tipo `Paginado<T>` do web).
- Front: hooks em `src/api/<modulo>.ts` (chaves já definidas no stub), páginas já roteadas com guard de
  papel e de recurso; `toast` do sonner; `usePodeUsar`/`AvisoLimite` para limites.
- Testes: crie dados com nomes/documentos únicos e apague no fim (veja `test/fase2.test.ts`). Clínica com
  `documentos_clinicos` só pode ser apagada numa transação com `SET LOCAL app.permitir_exclusao_prontuario = 'on'`.

### Decisões de modelagem (fundação)

| Tema | Decisão |
|---|---|
| Configurações da clínica | Tabela `configuracoes_clinica` 1:1 (modelo de clínica), criada **sob demanda** por `obterConfiguracaoClinica(request.db)` / `obterConfiguracaoClinicaPorId(clinicaId)` / `atualizarConfiguracaoClinica(db, dados)` (`src/servicos/configuracaoClinica.ts`). Prefixos: `ao_*` agendamento online, `retorno_*` retornos. |
| Slug | `clinicas.slug` único, **nullable** (criações antigas/testes); preenchido pela migration para as clínicas existentes e no auto-cadastro (`gerarSlugUnico`). Editável em `PUT /me/clinica { slug }` (400 formato, 409 `registro_duplicado`). CHECK de formato no banco. |
| Profissionais visíveis no agendamento online | Coluna `profissionais.agendamento_online` (default `true`), não lista na configuração. |
| Movimentação ↔ título | Coluna `movimentacoes_financeiras.titulo_id` (o "conta_id" do pedido original — renomeado para não confundir com `conta_financeira_id`). |
| Estorno | Nova movimentação de tipo inverso, `origem = 'estorno'`, `estorno_de_id` **único** (1 estorno por movimentação). Nada é apagado. |
| Valor efetivo | Relatórios/KPIs usam `WHERE_MOVIMENTACAO_EFETIVA` (nem estorno, nem estornada). Saldo de conta = saldo_inicial + Σentradas − Σsaídas (tudo). |
| "Vencido" | Derivado: `status = aberto` e `vencimento < hoje` (fuso da clínica). |
| Recorrência idempotente | `titulos` único em `(recorrencia_id, competencia)`; `competencia` = 1º dia do mês de referência. |
| Documentos PDF | `documentos_clinicos` imutável (extensão ⇒ 403 `documento_imutavel`; trigger `documentos_clinicos_imutavel`). PDF gerado sob demanda (não é armazenado). `pdfkit` instalado. |
| Retorno | Um por agendamento de origem (`agendamento_origem_id` único). |
| Solicitação online sem paciente | Paciente só é criado/casado na aprovação. Recusa manda WhatsApp **sem paciente** com `consentimentoExterno` (coluna `mensagens_whatsapp.consentimento_externo`). |
| Cobranças do SaaS | `cobrancas` é de plataforma mas tem `clinica_id`: via `request.db` é **somente leitura e filtrada** pela clínica (a clínica vê as próprias faturas). `gateways_pagamento`/`eventos_gateway` são proibidos via `request.db`. Só um gateway ativo (índice parcial). |
| FKs "Restrict" novas | Usam `NoAction` (checado no fim do comando) para a exclusão em cascata da clínica funcionar. |
| Usuário criador | `criado_por`/`analisado_por` sem FK (auditoria), exceto `movimentacoes.criado_por` e `documentos.autor_id` (com FK). |

### Recursos do plano (catálogo)

| Código | Nome | Módulos |
|---|---|---|
| `financeiro` | Financeiro | financeiro (+ bloco financeiro do dashboard) |
| `agendamento_online` | Agendamento online | agendamento-online |
| `lista_espera` | Lista de espera | lista-espera |
| `documentos_pdf` | Receituário e atestados | documentos |
| `retorno_automatico` | Retorno automático | retornos |
| `dashboard` | Dashboard | dashboard |

Planos do seed ("Teste grátis" e "Profissional"): todos habilitados. Planos criados pelo super admin
receberam as linhas novas **desabilitadas** (migration + seed).

---

## 1. Financeiro — `financeiro`

**Tabelas:** `contas_financeiras`, `categorias_financeiras`, `movimentacoes_financeiras`, `titulos`,
`recorrencias`, `profissionais.percentual_repasse` (0–100, null = sem repasse).
**Arquivos do módulo:** API `src/modulos/financeiro/*`, `src/workers/recorrenciasFinanceiras.ts` (implementar
`processarRecorrencias`); web `src/api/financeiro.ts`, `src/paginas/clinica/financeiro/*`,
`src/paginas/clinica/agenda/RecebimentoConsulta.tsx`.

**Papéis:** admin tudo · recepção: contas (leitura), categorias (leitura), movimentações (listar/criar),
recebimentos, títulos (listar/baixar) — **não** vê relatórios, recorrências, repasses nem configurações ·
profissional: só `GET /financeiro/repasses` (forçado ao próprio) e `GET /financeiro/meus-recebimentos`.

**Categorias padrão** (criadas na primeira chamada de `GET /financeiro/categorias`, `padrao = true`):
receita — Consultas, Procedimentos, Mensalidades, Outras receitas; despesa — Aluguel, Salários, Repasses a
profissionais, Materiais e insumos, Impostos e taxas, Marketing, Outras despesas. A conta "Caixa" pode ser
criada da mesma forma em `GET /financeiro/contas` (se não houver nenhuma).

| Método e rota | Papéis | Body / query | Resposta |
|---|---|---|---|
| `GET /financeiro/contas` | admin, recepção | — | `ContaFinanceira[]` + `saldo_atual` (string) |
| `POST /financeiro/contas` | admin | `{ nome, tipo?, saldo_inicial? }` | 201 conta |
| `PUT /financeiro/contas/:id` | admin | `{ nome?, tipo?, saldo_inicial?, ativo? }` | conta |
| `GET /financeiro/categorias?tipo=receita\|despesa` | admin, recepção | — | `Categoria[]` |
| `POST/PUT /financeiro/categorias[/:id]` | admin | `{ nome, tipo, ativo? }` | categoria |
| `GET /financeiro/movimentacoes` | admin, recepção | `inicio, fim (YYYY-MM-DD), conta_id?, tipo?, origem?, categoria_id?, profissional_id?, paciente_id?, pagina, por_pagina` | `Paginado<Movimentacao> & { totais: { entradas, saidas, saldo } }` |
| `POST /financeiro/movimentacoes` | admin, recepção | `{ tipo, data, valor, conta_financeira_id, forma_pagamento, categoria_id?, descricao?, paciente_id?, profissional_id?, agendamento_id? }` | 201 movimentação (origem `manual`, ou `consulta` se `agendamento_id`) |
| `POST /financeiro/movimentacoes/:id/estorno` | admin | `{ motivo? }` | 201 estorno. 409 `ja_estornada` / `estorno_de_estorno`. Se a original tem `titulo_id`, o título volta a `aberto` (pago_em/valor_pago nulos) |
| `GET /financeiro/recebimentos/agendamento/:agendamentoId` | admin, recepção | — | `{ itens: Movimentacao[], total }` |
| `POST /financeiro/recebimentos` | admin, recepção | `{ agendamento_id, valor, forma_pagamento, conta_financeira_id, categoria_id?, data?, descricao? }` | 201 entrada `origem = consulta` com paciente/profissional do agendamento; 409 se agendamento cancelado |
| `GET /financeiro/titulos` | admin, recepção | `tipo, status? (aberto\|pago\|cancelado\|vencido), inicio?, fim?, paciente_id?, pagina` | `Paginado<Titulo>` (+ `status_exibicao` com `vencido`) |
| `POST /financeiro/titulos` | admin | `{ tipo, descricao, valor, vencimento, categoria_id?, paciente_id?, profissional_id?, fornecedor?, forma_pagamento?, observacoes?, parcelas? (2–48) }` | 201 `Titulo[]` (parcelas mensais com `grupo_parcelas_id`, valor dividido; centavos na última) |
| `PUT /financeiro/titulos/:id` | admin | campos editáveis (só `aberto`) | título |
| `POST /financeiro/titulos/:id/baixa` | admin, recepção | `{ data, conta_financeira_id, forma_pagamento, valor_pago? }` | `{ titulo, movimentacao }` (pagar ⇒ saída; receber ⇒ entrada; origem `titulo`) — transação; 409 se não `aberto` |
| `POST /financeiro/titulos/:id/cancelar` | admin | — | título `cancelado` (só `aberto`) |
| `GET/POST/PUT /financeiro/recorrencias[/:id]` | admin | `{ tipo, descricao, valor, dia_vencimento (1–31), inicio, fim?, categoria_id?, paciente_id?, profissional_id?, fornecedor?, forma_pagamento?, ativo? }` | recorrência (+ títulos gerados na criação) |
| `GET /financeiro/profissionais` | admin | — | `{ id, nome, ativo, percentual_repasse }[]` |
| `PUT /financeiro/profissionais/:id/repasse` | admin | `{ percentual_repasse: number \| null }` | profissional |
| `GET /financeiro/repasses` | admin, profissional | `inicio, fim, profissional_id?` | `{ profissional, percentual, total_entradas, valor_repasse, pago, saldo }[]` |
| `POST /financeiro/repasses/pagamentos` | admin | `{ profissional_id, inicio, fim, valor, data, conta_financeira_id, forma_pagamento, descricao? }` | 201 saída `origem = repasse` |
| `GET /financeiro/meus-recebimentos` | profissional | `inicio, fim` | `{ itens, total_entradas, percentual, valor_repasse, pago }` |
| `GET /financeiro/relatorios/resumo` | admin | `inicio, fim` | `{ receitas, despesas, saldo, por_categoria, por_forma_pagamento, por_dia, a_receber_aberto, a_pagar_aberto, vencidos }` |
| `GET /financeiro/relatorios/fluxo-caixa` | admin | `inicio, fim, conta_id?` | `{ saldo_inicial, dias: [{ data, entradas, saidas, saldo }] }` |

Repasse: `total_entradas` = Σ entradas **efetivas** com `profissional_id` no período; `valor_repasse` =
`total_entradas × percentual / 100`; `pago` = Σ saídas efetivas `origem = repasse` do profissional com
período de referência contido no filtro.

**Chaves TanStack:** `chavesFinanceiro.*` (raiz `['financeiro']`). Registrar recebimento não consome limite.

**Integrações:** agenda (`RecebimentoConsulta` no painel); dashboard lê `movimentacoes_financeiras`/`titulos`
com `WHERE_MOVIMENTACAO_EFETIVA`.

---

## 2. Agendamento online — `agendamento_online`

**Tabelas:** `solicitacoes_agendamento`, `configuracoes_clinica` (`ao_ativo`, `ao_antecedencia_min_horas`,
`ao_dias_a_frente`, `ao_mensagem_boas_vindas`, `ao_max_pendentes_por_telefone`), `clinicas.slug`,
`profissionais.agendamento_online`.
**Arquivos:** API `src/modulos/agendamento-online/*`, `src/workers/solicitacoesAgendamento.ts`
(`expirarSolicitacoes`); web `src/api/agendamentoOnline.ts`, `src/paginas/publico/agendar/*`,
`src/paginas/clinica/solicitacoes/*` (inclui `AvisoTopoSolicitacoes.tsx`),
`src/paginas/clinica/configuracoes/ConfigAgendamentoOnline.tsx`.

**Disponível publicamente** só se: slug existe, clínica `ativa`, `assinaturaEstaAtiva`, recurso habilitado
(`assegurarRecurso`) e `ao_ativo`. Senão 404 `agendamento_indisponivel` (mesma resposta em todos os casos).
Resolva a clínica com prisma cru pelo slug; para a agenda use `const db = criarDbTenant(clinica.id)` e os
serviços de `modulos/agendamentos/servico.ts` (`calcularDisponibilidade`, `travarAgendaProfissional`,
`validarHorario` — agora exportado —, `obterFuso`).

| Rota | Acesso | Body / query | Resposta |
|---|---|---|---|
| `GET /publico/clinicas/:slug` | público (rate limit 60/min/IP) | — | `{ clinica: { nome, slug, telefone, endereco, cidade, uf, fuso_horario }, mensagem_boas_vindas, antecedencia_min_horas, dias_a_frente, profissionais: [{ id, nome, especialidade, duracao_consulta_min }] }` |
| `GET /publico/clinicas/:slug/disponibilidade` | público (60/min) | `profissional_id, data (YYYY-MM-DD)` | `{ data, fuso, horarios: [{ inicio, fim, hora }] }` — sem horários antes de `agora + antecedência`, nem além de `dias_a_frente`, nem com solicitação pendente no mesmo horário |
| `POST /publico/clinicas/:slug/solicitacoes` | público (5/min/IP) | `{ profissional_id, inicio, nome, telefone, email?, cpf?, nascimento?, observacoes?, aceita_whatsapp, website? }` | 201 `{ id, status: 'pendente', inicio, fim, profissional: { nome } }`. Honeypot `website` preenchido ⇒ 201 falso (nada gravado). 409 `horario_indisponivel`; 409 `limite_solicitacoes` (pendentes por telefone) |
| `GET /solicitacoes` | admin, recepção | `status?, pagina, por_pagina` | `Paginado<Solicitacao>` (+ profissional) |
| `GET /solicitacoes/resumo` | admin, recepção | — | `{ pendentes }` |
| `GET /solicitacoes/:id` | admin, recepção | — | solicitação + `pacientes_candidatos: [{ id, nome, cpf, whatsapp, motivo: 'cpf'\|'telefone' }]` |
| `POST /solicitacoes/:id/aprovar` | admin, recepção | `{ paciente_id?, tipo?, convenio_id?, observacoes? }` (sem `paciente_id` ⇒ cria paciente com nome/cpf/whatsapp/e-mail/nascimento e `aceita_whatsapp` da solicitação) | `{ solicitacao, agendamento_id, paciente_id, whatsapp: { enfileirada, erro? } \| null }`. 409 se não pendente; erros normais da agenda (`horario_ocupado`, `limite_atingido`…) |
| `POST /solicitacoes/:id/recusar` | admin, recepção | `{ motivo?, notificar? = true }` | `{ solicitacao, whatsapp }` |
| `GET /agendamento-online/configuracao` | admin | — | `{ ativo, antecedencia_min_horas, dias_a_frente, mensagem_boas_vindas, max_pendentes_por_telefone, slug, link_publico, profissionais: [{ id, nome, ativo, agendamento_online }] }` |
| `PUT /agendamento-online/configuracao` | admin | `{ ativo?, antecedencia_min_horas? (0–168), dias_a_frente? (1–180), mensagem_boas_vindas?, max_pendentes_por_telefone? (1–10), profissionais_visiveis?: uuid[] }` | idem GET |

Aprovação (uma transação): `assegurarLimite(clinicaId, 'max_agendamentos', { tx })` →
`travarAgendaProfissional` → `validarHorario` → cria paciente (se preciso) → cria agendamento
(`criado_por` = usuário que aprovou) → solicitação `aprovada` (+ `paciente_id`, `agendamento_id`,
`analisado_por/em`). Depois do commit: `enfileirarMensagem({ tipo: 'agendamento_confirmado', pacienteId,
agendamentoId, conteudo: textoAgendamentoOnlineConfirmado(...) })`.
Recusa: `enfileirarMensagem({ tipo: 'agendamento_recusado', pacienteId: null, telefone,
consentimentoExterno: solicitacao.aceita_whatsapp, conteudo: textoAgendamentoOnlineRecusado({ ...,
linkAgendamento: `${env.WEB_URL_PUBLICA}/agendar/${slug}` }) })`.

**Chaves:** `chavesAgendamentoOnline.*` (públicas começam com `'publico'`; internas `['solicitacoes']`).
Aprovar invalida também `chavesMe.me` e `['agendamentos']`.

---

## 3. Lista de espera — `lista_espera`

**Tabela:** `lista_espera` (`dias_semana int[]` 0=domingo, `turnos turno[]`, status `aguardando|agendado|removido`).
**Arquivos:** API `src/modulos/lista-espera/*`; web `src/api/listaEspera.ts`, `src/paginas/clinica/lista-espera/*`
(inclui `AvisoTopoListaEspera.tsx`), `src/paginas/clinica/agenda/SugestoesListaEspera.tsx`.
**Papéis:** admin e recepção (profissional: 403).

| Rota | Body / query | Resposta |
|---|---|---|
| `GET /lista-espera` | `status? (padrão aguardando), profissional_id?, pagina, por_pagina` | `Paginado<Item>` com `paciente { id, nome, telefone, whatsapp, aceita_whatsapp }`, `profissional { id, nome } \| null` |
| `POST /lista-espera` | `{ paciente_id, profissional_id?, dias_semana?, turnos?, observacao? }` | 201 item |
| `PUT /lista-espera/:id` | idem (parcial) | item |
| `PATCH /lista-espera/:id/status` | `{ status, agendamento_id? }` | item |
| `GET /lista-espera/sugestoes?agendamento_id` | agendamento `cancelado`/`faltou` | `{ agendamento: { id, inicio, fim, profissional }, horario_livre: boolean, sugestoes: Item[] }` |
| `GET /lista-espera/vagas-recentes` | — | `{ total, itens: [{ agendamento_id, inicio, profissional: { id, nome }, sugestoes: number }] }` (cancelados nos últimos 7 dias, início futuro, horário ainda livre, com ≥ 1 sugestão) |
| `POST /lista-espera/:id/oferecer` | `{ agendamento_id }` | `{ whatsapp: { enfileirada, erro? } }` + `ultima_oferta_em` |

Compatibilidade: `status = aguardando`; `profissional_id` nulo ou igual; `dias_semana` vazio ou contém o dia
(fuso da clínica); `turnos` vazio ou contém o turno (manhã < 12h, tarde 12–18h, noite ≥ 18h). Ordem: mais
antigos primeiro. `horario_livre` via `validarConflito`/`calcularDisponibilidade`.
Oferta: `enfileirarMensagem({ tipo: 'oferta_horario', pacienteId, conteudo: textoOfertaHorario(...) })`.

**Integração com cancelamento:** sem hook no módulo agendamentos — `SugestoesListaEspera` no painel da
agenda (cancelado/faltou) e `AvisoTopoListaEspera` no topo. **Chaves:** `chavesListaEspera.*`.

---

## 4. Documentos PDF — `documentos_pdf`

**Tabela:** `documentos_clinicos` (imutável). **Arquivos:** API `src/modulos/documentos/*`; web
`src/api/documentos.ts`, `src/paginas/clinica/pacientes/abas/AbaDocumentos.tsx` (+ componentes próprios em
`src/paginas/clinica/pacientes/documentos/*` se quiser).
**Papéis:** admin e profissional (`PAPEIS_ROTA.documentos`) com `assegurarAcessoProntuario`; recepção 403.

| Rota | Body | Resposta |
|---|---|---|
| `GET /documentos/pacientes/:pacienteId` | — | `[{ id, tipo, titulo, criado_em, profissional: { id, nome, registro }, autor: { id, nome }, agendamento_id }]` (log `listar`) |
| `GET /documentos/:id` | — | documento completo (log `visualizar`) |
| `POST /documentos` | `{ paciente_id, tipo, conteudo (1–20000), titulo?, agendamento_id?, metadados? }` | 201 documento (log `criar`). `profissional_id = profissionalAutor(request)` |
| `GET /documentos/:id/pdf` | — | `application/pdf` inline, `Content-Disposition: inline; filename="<tipo>-<data>.pdf"` (log `baixar`) |

`metadados` sugeridos: atestado `{ dias?, cid?, exibir_cid? }`; pedido de exame `{ exames: string[] }`;
receita `{ uso?: 'interno'|'externo' }`. PDF (pdfkit, A4): cabeçalho da clínica (nome, CNPJ/CPF, endereço,
telefone), título do tipo, paciente, corpo, cidade/data por extenso (fuso da clínica), assinatura com nome +
registro do profissional, rodapé com o id do documento. Entidade do log: `'documento_clinico'`.
**Chaves:** `chavesDocumentos.*`.

---

## 5. Retornos — `retorno_automatico`

**Tabelas:** `retornos`, `configuracoes_clinica` (`retorno_convite_ativo`, `retorno_dias_antecedencia`).
**Arquivos:** API `src/modulos/retornos/*`, `src/workers/retornos.ts` (`processarRetornos`); web
`src/api/retornos.ts`, `src/paginas/clinica/retornos/*`, `src/paginas/clinica/agenda/DefinirRetorno.tsx`.
**Papéis:** todos (profissional só os da própria agenda); configuração e convite manual: admin (convite também recepção).

| Rota | Body / query | Resposta |
|---|---|---|
| `GET /retornos` | `status?, inicio?, fim? (data_prevista), profissional_id?, pagina, por_pagina` | `Paginado<Retorno>` com paciente, profissional, `agendamento_origem { id, inicio }`, `agendamento_retorno` |
| `GET /retornos/agendamento/:agendamentoId` | — | `Retorno \| null` |
| `POST /retornos` | `{ agendamento_origem_id, dias? (1–730) \| data_prevista?, observacao? }` | 201. 409 `status_invalido` (origem ≠ compareceu/atendido), 409 `retorno_existente` |
| `PUT /retornos/:id` | `{ data_prevista?, observacao? }` | retorno (só pendente/lembrado) |
| `PATCH /retornos/:id/status` | `{ status: 'agendado'\|'cancelado', agendamento_retorno_id? }` | retorno |
| `POST /retornos/:id/convidar` | — | `{ whatsapp }` + `convite_enviado_em`, status `lembrado` |
| `GET/PUT /retornos/configuracao` | `{ convite_ativo?, dias_antecedencia? (0–60) }` | `{ convite_ativo, dias_antecedencia }` |

Job diário (`processarRetornos`): reconcilia `agendado` (agendamento posterior, não cancelado, mesmo
paciente+profissional) e envia convites (`tipo: 'convite_retorno'`, `textoConviteRetorno`, link do
agendamento online se a clínica tiver slug + `ao_ativo` + recurso). **Chaves:** `chavesRetornos.*`.

---

## 6. Dashboard — `dashboard`

**Arquivos:** API `src/modulos/dashboard/*`; web `src/api/dashboard.ts`, `src/paginas/clinica/dashboard/*`.
**Papéis:** todos (profissional forçado ao próprio profissional; recepção sem financeiro).

`GET /dashboard?inicio=YYYY-MM-DD&fim=YYYY-MM-DD&profissional_id?` (padrão: mês corrente; máx. 366 dias) ⇒

```jsonc
{
  "periodo": { "inicio": "2026-10-01", "fim": "2026-10-31", "fuso": "America/Sao_Paulo" },
  "agenda": { "total": 0, "agendados": 0, "confirmados": 0, "compareceram": 0, "atendidos": 0,
              "faltas": 0, "cancelados": 0,
              "taxa_comparecimento": 0.0,   // (compareceu+atendido) / (compareceu+atendido+faltou)
              "taxa_faltas": 0.0, "taxa_cancelamento": 0.0 },
  "por_profissional": [{ "profissional": { "id": "", "nome": "", "cor_agenda": "" }, "total": 0, "atendidos": 0, "faltas": 0, "cancelados": 0 }],
  "por_dia": [{ "data": "2026-10-01", "total": 0, "atendidos": 0, "faltas": 0, "cancelados": 0 }],
  "financeiro": null | { "receitas": "0.00", "despesas": "0.00", "saldo": "0.00",
                         "a_receber": "0.00", "a_pagar": "0.00", "vencidos": 0,
                         "por_categoria": [{ "categoria": "", "tipo": "receita", "total": "0.00" }] },
  "pendencias": { "solicitacoes_pendentes": null | 0, "retornos_pendentes": null | 0, "lista_espera": null | 0 }
}
```

Agendamentos contam pelo `inicio` no período (fuso da clínica). `financeiro` só para admin com recurso
`financeiro` (valores efetivos — `WHERE_MOVIMENTACAO_EFETIVA`). Cada item de `pendencias` é `null` se o
recurso correspondente estiver desligado. **Chaves:** `chavesDashboard.*`.

---

## 7. Cobrança automática do SaaS — super admin

**Tabelas (plataforma):** `gateways_pagamento`, `cobrancas`, `eventos_gateway`, `assinaturas.gateway`,
`cliente_externo_id`, `assinatura_externa_id`, `dia_vencimento` (1–28).
**Arquivos:** API `src/modulos/admin-cobranca/*`, `src/servicos/pagamentos/*` (adaptadores), `src/workers/cobrancas.ts`
(`processarCobrancas`); web `src/api/adminCobranca.ts`, `src/paginas/admin/cobranca/*`.

Segredos: `criptografarJson(credenciais)` em `credenciais_cifradas`, `finalSegredo(principal)` em
`credenciais_final`; idem webhook. As respostas **nunca** trazem segredo (só `credenciais_final`).
Interface dos gateways: `src/servicos/pagamentos/tipos.ts` (`criarCliente`, `criarAssinatura`,
`criarCobranca`, `cancelar`, `validarWebhook`, `interpretarWebhook`); fábrica `obterGateway(provedor)` /
`obterGatewayAtivo()`; testes com `definirFabricaGateway(fake)`.

| Rota | Acesso | Body | Resposta |
|---|---|---|---|
| `GET /admin/cobranca/gateways` | super admin | — | `[{ provedor, nome, configurado, ambiente, ativo, credenciais_final, segredo_webhook_final, dias_tolerancia, metodos, url_webhook }]` (os 3) |
| `PUT /admin/cobranca/gateways/:provedor` | super admin | `{ ambiente?, credenciais?: { api_key } \| { secret_key, publishable_key? } \| { access_token, public_key? }, segredo_webhook?: string \| null, dias_tolerancia? (0–60), metodos? }` | gateway (sem segredos) |
| `POST /admin/cobranca/gateways/:provedor/ativar` · `/desativar` | super admin | — | gateway. 409 `gateway_nao_configurado` |
| `POST /admin/cobranca/gateways/:provedor/testar` | super admin | — | `{ ok, mensagem }` |
| `GET /admin/cobranca/cobrancas` | super admin | `status?, clinica_id?, pagina, por_pagina` | `Paginado<Cobranca & { clinica: { id, nome } }>` |
| `POST /admin/cobranca/clinicas/:clinicaId/cobrancas` | super admin | `{ vencimento, valor? (padrão preço do plano), descricao?, metodo? }` | 201 cobrança (com `link_pagamento`) |
| `POST /admin/cobranca/clinicas/:clinicaId/assinatura` | super admin | `{ dia_vencimento, metodo? }` | assinatura atualizada |
| `POST /admin/cobranca/cobrancas/:id/cancelar` | super admin | — | cobrança |
| `GET /admin/cobranca/eventos` | super admin | `gateway?, pagina` | `Paginado<EventoGateway>` |
| `GET /cobrancas/minhas` | admin da clínica | — | faturas da clínica (sem `payload`) |
| `POST /webhooks/pagamentos/:gateway` | público | corpo do gateway (cru em `request.corpoCru`) | 200 `{ ok }` / `{ duplicado }` / `{ ignorado }`; 401 se não autêntico |

Efeitos: `cobranca_paga` ⇒ cobrança `paga` + `pago_em` e assinatura `ativa` (e `expira_em` null);
`vencida`/`cancelada`/`estornada` ⇒ status da cobrança. Job diário: pendentes vencidas ⇒ `vencida`;
assinatura com cobrança vencida há mais de `dias_tolerancia` ⇒ `vencida` (somente leitura automático via
`statusEfetivo`/`ehSomenteLeitura`). URL do webhook: `${env.API_URL_PUBLICA}/webhooks/pagamentos/<gateway>`
(produção: `https://DOMINIO/api/webhooks/pagamentos/<gateway>`). **Chaves:** `chavesAdminCobranca.*`
(raiz `['admin','cobranca']`; faturas da clínica `['cobrancas','minhas']`).

---

## 8. WhatsApp para outros módulos

```ts
import { enfileirarMensagem } from '../../servicos/whatsapp/envio';
import { textoOfertaHorario } from '../../servicos/whatsapp/mensagens';

const r = await enfileirarMensagem({
  clinicaId,                      // do token (request.clinicaId) ou do job
  pacienteId,                     // string | null
  agendamentoId?,                 // opcional
  tipo,                           // TipoMensagem (abaixo)
  conteudo,                       // texto pronto (templates abaixo)
  telefone?,                      // padrão: pacientes.whatsapp; OBRIGATÓRIO se pacienteId = null
  consentimentoExterno?,          // só com pacienteId = null: consentimento dado fora do cadastro
});
// r = { enfileirada: true, mensagemId } | { enfileirada: false, mensagemId: string | null, erro }
// erros: sem_consentimento, telefone_invalido, paciente_nao_encontrado, assinatura_inativa,
//        recurso_indisponivel (whatsapp), limite_atingido (max_mensagens), fila_indisponivel
```

- Chame **depois** do commit (usa o prisma cru e a própria transação/lock). Não lança erro de negócio:
  confira `r.enfileirada` e devolva `{ enfileirada, erro }` para o front mostrar.
- Consome `max_mensagens`; o envio real é feito pelo worker com intervalo 20–40 s por clínica.

| `tipo` | Uso | Template (`servicos/whatsapp/mensagens.ts`) |
|---|---|---|
| `agendamento_confirmado` | solicitação online aprovada | `textoAgendamentoOnlineConfirmado({ paciente, clinica, profissional, inicio, fuso, endereco? })` |
| `agendamento_recusado` | solicitação online recusada | `textoAgendamentoOnlineRecusado({ paciente, clinica, inicio, fuso, motivo?, linkAgendamento? })` |
| `oferta_horario` | lista de espera | `textoOfertaHorario({ paciente, clinica, profissional, inicio, fuso, telefoneClinica? })` |
| `convite_retorno` | retornos | `textoConviteRetorno({ paciente, clinica, profissional, dataPrevista (@db.Date), linkAgendamento? })` |

Respostas do paciente a esses tipos **não** são interpretadas (o webhook só trata "1"/"2" de lembretes);
ficam gravadas como mensagens de entrada.

## 9. Filas e workers

| Fila (`NOMES_FILAS`) | Arquivo | Agenda | Dono | Função a implementar |
|---|---|---|---|---|
| `FINANCEIRO_RECORRENCIAS` | `workers/recorrenciasFinanceiras.ts` | 06:00 | financeiro | `processarRecorrencias(dados)` |
| `RETORNOS` | `workers/retornos.ts` | 09:30 | retornos | `processarRetornos(dados)` |
| `SOLICITACOES_AGENDAMENTO` | `workers/solicitacoesAgendamento.ts` | :15 de cada hora | agendamento-online | `expirarSolicitacoes(dados)` |
| `COBRANCAS` | `workers/cobrancas.ts` | 07:00 | admin-cobranca | `processarCobrancas(dados)` |

Todos já registrados em `workers/index.ts` (hoje no-op). `dados` = `{ clinicaId?, data? }` (`JobPorClinica`)
ou `{ data? }` (`JobCobrancas`). Exporte a lógica de forma testável (sem Redis) como os lembretes.

## 10. Web — mapa de rotas, menus e pontos de extensão

| Rota | Guard (papéis · recurso) | Página (dono) |
|---|---|---|
| `/dashboard` | todos · `dashboard` | `paginas/clinica/dashboard/Dashboard.tsx` (dashboard) |
| `/solicitacoes` | admin, recepção · `agendamento_online` | `paginas/clinica/solicitacoes/Solicitacoes.tsx` (agendamento-online) |
| `/lista-espera` | admin, recepção · `lista_espera` | `paginas/clinica/lista-espera/ListaEspera.tsx` (lista-espera) |
| `/retornos` | todos · `retorno_automatico` | `paginas/clinica/retornos/Retornos.tsx` (retornos) |
| `/financeiro` (+ `caixa`, `contas-pagar`, `contas-receber`, `recorrencias`, `repasses`, `relatorios`, `configuracoes`) | ver `PAPEIS_ROTA.financeiro*` · `financeiro` | `paginas/clinica/financeiro/*` (financeiro) — `LayoutFinanceiro` + `ABAS_FINANCEIRO` |
| `/admin/cobranca` | super admin | `paginas/admin/cobranca/Cobranca.tsx` (admin-cobranca) |
| `/agendar/:slug` | **público** | `paginas/publico/agendar/AgendamentoOnline.tsx` (agendamento-online) |

Menus: `MENU_CLINICA`/`MENU_ADMIN` em `rotas/navegacao.ts` (item com `recurso` só aparece se habilitado).
`<RotaClinica recurso="...">` mostra `<RecursoIndisponivel />` quando o plano não inclui o recurso.

Pontos de extensão já incluídos (cada dono só implementa o componente):

| Componente | Onde aparece | Quando | Dono |
|---|---|---|---|
| `agenda/RecebimentoConsulta.tsx` | PainelAgendamento | não cancelado · admin/recepção · `financeiro` | financeiro |
| `agenda/DefinirRetorno.tsx` | PainelAgendamento | compareceu/atendido · `retorno_automatico` | retornos |
| `agenda/SugestoesListaEspera.tsx` | PainelAgendamento | cancelado/faltou · admin/recepção · `lista_espera` | lista-espera |
| `pacientes/abas/AbaDocumentos.tsx` | FichaPaciente, aba "Documentos" | admin/profissional · `documentos_pdf` | documentos |
| `configuracoes/ConfigAgendamentoOnline.tsx` | Configurações | admin · `agendamento_online` | agendamento-online |
| `solicitacoes/AvisoTopoSolicitacoes.tsx` | topo do app (ao lado do sino) | admin/recepção · `agendamento_online` | agendamento-online |
| `lista-espera/AvisoTopoListaEspera.tsx` | topo do app | admin/recepção · `lista_espera` | lista-espera |

Tipos/enums compartilhados novos em `api/tipos.ts` (`FormaPagamento`, `StatusTitulo`, `Turno`,
`TipoDocumentoClinico`, `StatusRetorno`, `ProvedorPagamento`… com `ROTULOS_*`); `Me.clinica.slug`.

## 11. Variáveis de ambiente novas

| Variável | Uso | Padrão |
|---|---|---|
| `CHAVE_CRIPTOGRAFIA` | AES-256-GCM dos segredos (64 hex). Obrigatória em produção; dev/teste usam chave fixa com aviso | — |
| `API_URL_PUBLICA` | Base das URLs de webhook dos gateways (`env.API_URL_PUBLICA`, sem barra final) | `http://localhost:3333` |
| `WEB_URL_PUBLICA` | Links enviados ao paciente (`env.WEB_URL_PUBLICA`) | 1ª origem de `WEB_URL` |
