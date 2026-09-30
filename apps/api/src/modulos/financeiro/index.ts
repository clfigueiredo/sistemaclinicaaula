/**
 * Módulo financeiro — caixa, contas a pagar/receber, recorrências, repasses e relatórios.   [STUB — fase 2]
 *
 * Contrato completo (payloads, respostas, chaves do front): docs/FASE2.md §1.
 * Recurso do plano: `financeiro` (exigirRecurso em TODAS as rotas). Tabelas: contas_financeiras,
 * categorias_financeiras, movimentacoes_financeiras, titulos, recorrencias, profissionais.percentual_repasse.
 *
 * Rotas (prefixo "/financeiro"):
 *   GET    /financeiro/contas                         admin, recepção   contas + saldo_atual
 *   POST   /financeiro/contas                         admin
 *   PUT    /financeiro/contas/:id                     admin             (nome, tipo, ativo, saldo_inicial)
 *   GET    /financeiro/categorias?tipo                admin, recepção   cria as categorias padrão na 1ª chamada
 *   POST   /financeiro/categorias                     admin
 *   PUT    /financeiro/categorias/:id                 admin
 *   GET    /financeiro/movimentacoes?inicio&fim&conta_id&tipo&origem&categoria_id&profissional_id&paciente_id&pagina&por_pagina
 *                                                     admin, recepção   Paginado + totais { entradas, saidas, saldo }
 *   POST   /financeiro/movimentacoes                  admin, recepção   entrada/saída manual (origem manual)
 *   POST   /financeiro/movimentacoes/:id/estorno      admin             nova movimentação inversa (origem estorno);
 *                                                                        se a original veio de título ⇒ título volta a `aberto`
 *   GET    /financeiro/recebimentos/agendamento/:agendamentoId   admin, recepção   recebimentos da consulta + total
 *   POST   /financeiro/recebimentos                   admin, recepção   entrada origem `consulta` (agendamento+paciente+profissional)
 *   GET    /financeiro/titulos?tipo&status&inicio&fim&paciente_id&pagina   admin, recepção   (status `vencido` é derivado)
 *   POST   /financeiro/titulos                        admin             { ..., parcelas? } gera N títulos com grupo_parcelas_id
 *   PUT    /financeiro/titulos/:id                    admin             só `aberto`
 *   POST   /financeiro/titulos/:id/baixa              admin, recepção   status pago + movimentação (origem titulo), numa transação
 *   POST   /financeiro/titulos/:id/cancelar           admin             só `aberto`
 *   GET    /financeiro/recorrencias                   admin
 *   POST   /financeiro/recorrencias                   admin             gera os títulos do mês corrente/próximo
 *   PUT    /financeiro/recorrencias/:id               admin             (ativo=false encerra; não apaga títulos gerados)
 *   GET    /financeiro/profissionais                  admin             profissionais + percentual_repasse
 *   PUT    /financeiro/profissionais/:id/repasse      admin             { percentual_repasse: number 0–100 | null }
 *   GET    /financeiro/repasses?inicio&fim&profissional_id   admin; profissional (forçado ao próprio)
 *   POST   /financeiro/repasses/pagamentos            admin             saída origem `repasse` (repasse_inicio/fim)
 *   GET    /financeiro/meus-recebimentos?inicio&fim   profissional      entradas vinculadas a ele + resumo do repasse
 *   GET    /financeiro/relatorios/resumo?inicio&fim   admin             receitas/despesas efetivas, por categoria/forma/dia, títulos
 *   GET    /financeiro/relatorios/fluxo-caixa?inicio&fim&conta_id   admin
 *
 * Regras:
 *   - Movimentação NUNCA é apagada nem tem valor/tipo alterado: estorno = inversa com `estorno_de_id` (único).
 *   - Valores: body em number (reais, 2 casas, > 0); respostas Decimal serializadas como string ("150.00").
 *   - Datas @db.Date: 'YYYY-MM-DD' ⇔ servicos/financeiroComum.ts (dataSemHora/paraDataIso/hojeNoFuso).
 *   - Totais de relatório usam WHERE_MOVIMENTACAO_EFETIVA (servicos/financeiroComum.ts) — o dashboard usa a mesma regra.
 *   - Valide TODAS as FKs do body pelo request.db (conta, categoria, paciente, profissional, agendamento, título).
 *   - Recepção: não acessa relatórios, recorrências, repasses nem configura contas/categorias.
 *   - Profissional: só /repasses (dele) e /meus-recebimentos.
 *   - Worker: workers/recorrenciasFinanceiras.ts (fila FINANCEIRO_RECORRENCIAS) — implementar `processarRecorrencias`.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { autenticarClinica } from '../../plugins/auth';
import { exigirRecurso } from '../../plugins/recursos';

export const prefixo = '/financeiro';

const modulo: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', autenticarClinica);
  app.addHook('preHandler', exigirRecurso('financeiro'));
  // TODO(financeiro): implementar as rotas acima (arquivos auxiliares nesta pasta).
};

export default modulo;
