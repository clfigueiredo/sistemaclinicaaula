/**
 * Módulo dashboard — KPIs da clínica (agenda e financeiro).   [STUB — fase 2]
 *
 * Contrato completo: docs/FASE2.md §6. Recurso do plano: `dashboard`. SOMENTE LEITURA
 * (agendamentos, movimentacoes_financeiras, titulos, solicitacoes_agendamento, retornos, lista_espera).
 *
 * Rotas (prefixo "/dashboard"; autenticarClinica + exigirRecurso('dashboard')):
 *   GET /dashboard?inicio=YYYY-MM-DD&fim=YYYY-MM-DD&profissional_id   todos os papéis
 *     { periodo, agenda, por_profissional, por_dia, financeiro | null, pendencias }
 *
 * Regras:
 *   - Período máximo 366 dias; padrão = mês corrente no fuso da clínica.
 *   - Profissional: tudo forçado ao próprio profissional_id; nunca vê `financeiro`.
 *   - Recepção: agenda + pendências; `financeiro` = null.
 *   - Admin: `financeiro` só se o recurso `financeiro` estiver habilitado (assegurarRecurso/obterUsoERecursos);
 *     totais com WHERE_MOVIMENTACAO_EFETIVA (servicos/financeiroComum.ts) — mesma regra do módulo financeiro.
 *   - `pendencias` só inclui blocos cujo recurso está habilitado (solicitações online, retornos, lista de espera).
 *   - Use groupBy/count do request.db (filtrado por tenant). SQL cru só com clinica_id = request.clinicaId.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { autenticarClinica } from '../../plugins/auth';
import { exigirRecurso } from '../../plugins/recursos';

export const prefixo = '/dashboard';

const modulo: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', autenticarClinica);
  app.addHook('preHandler', exigirRecurso('dashboard'));
  // TODO(dashboard): implementar GET /dashboard.
};

export default modulo;
