/**
 * Módulo dashboard — KPIs da clínica (agenda, financeiro e pendências operacionais).
 *
 * Contrato: docs/FASE2.md §6. Recurso do plano: `dashboard`. SOMENTE LEITURA
 * (agendamentos, pacientes, movimentacoes_financeiras, titulos, solicitacoes_agendamento, retornos, lista_espera).
 * Cálculos em ./servico.ts.
 *
 * Rotas (prefixo "/dashboard"; autenticarClinica + exigirRecurso('dashboard')):
 *   GET /dashboard?inicio=YYYY-MM-DD&fim=YYYY-MM-DD&profissional_id (ou profissionalId)   todos os papéis
 *     {
 *       periodo { inicio, fim, fuso, dias, hoje }, periodo_anterior { inicio, fim },
 *       escopo { papel, profissional_id, profissional_forcado },
 *       agenda { total, agendados, confirmados, compareceram, atendidos, faltas, cancelados, realizados_base,
 *                taxa_comparecimento, taxa_faltas, taxa_confirmacao, taxa_cancelamento, novos_pacientes },
 *       agenda_anterior { ...mesmos campos, período anterior de mesma duração },
 *       por_profissional[], por_dia[], por_dia_semana[], por_hora[], hoje[],
 *       financeiro: null | { receitas, despesas, saldo, anterior, a_receber, a_pagar, vencidos, receber_vencido,
 *                           receber_proximos_7_dias, pagar_vencido, pagar_proximos_7_dias, ticket_medio,
 *                           atendimentos_recebidos, por_categoria[], receita_por_profissional[] },
 *       pendencias { solicitacoes_pendentes, lista_espera, retornos_pendentes, retornos_vencidos }  (null = recurso off)
 *     }
 *
 * Regras:
 *   - Período máximo 366 dias; padrão = mês corrente no fuso da clínica. Agendamentos contam pelo `inicio`.
 *   - Taxas: comparecimento = (compareceu + atendido) / não cancelados com início já alcançado; faltas = faltou /
 *     mesma base; confirmação = (confirmado + compareceu + atendido) / não cancelados; cancelamento = cancelado /
 *     total. `null` quando a base é zero.
 *   - Profissional: tudo forçado ao próprio profissional_id (ignora o da query); nunca vê `financeiro`, nem
 *     solicitações/lista de espera (telas de admin/recepção).
 *   - Recepção: agenda + pendências; `financeiro` = null.
 *   - Admin: `financeiro` só se o recurso `financeiro` estiver habilitado. Valores da CLÍNICA inteira (não
 *     filtrados por profissional), efetivos (WHERE_MOVIMENTACAO_EFETIVA — estornos e estornadas fora).
 *   - SQL cru sempre com `clinica_id = request.clinicaId`.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { autenticarClinica } from '../../plugins/auth';
import { exigirRecurso, obterAssinaturaAtual } from '../../plugins/recursos';
import { hojeNoFuso } from '../../servicos/financeiroComum';
import { erros, ou404 } from '../../utils/erros';
import { obterFuso } from '../agendamentos/servico';
import {
  agendaDeHoje,
  blocoFinanceiro,
  diasEntre,
  distribuicaoHorarios,
  intervaloUtc,
  novosPacientes,
  pendencias,
  porProfissional,
  resumoAgenda,
  serieDiaria,
  somarDias,
  type Escopo,
} from './servico';

export const prefixo = '/dashboard';

const MAX_DIAS = 366;

const DataIso = (rotulo: string) =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, `${rotulo} deve estar no formato AAAA-MM-DD.`)
    .refine((v) => !Number.isNaN(new Date(`${v}T00:00:00Z`).getTime()) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v), `${rotulo} inválida.`);

const Filtro = z
  .object({
    inicio: DataIso('Data inicial').optional(),
    fim: DataIso('Data final').optional(),
    profissional_id: z.uuid('Profissional inválido.').optional(),
    profissionalId: z.uuid('Profissional inválido.').optional(),
  })
  .refine((f) => !!f.inicio === !!f.fim, { message: 'Informe a data inicial e a final.', path: ['inicio'] })
  .refine((f) => !f.inicio || !f.fim || f.fim >= f.inicio, {
    message: 'A data final deve ser igual ou posterior à inicial.',
    path: ['fim'],
  })
  .refine((f) => !f.inicio || !f.fim || diasEntre(f.inicio, f.fim) < MAX_DIAS, {
    message: `O período máximo é de ${MAX_DIAS} dias.`,
    path: ['fim'],
  });

/** 1º e último dia do mês de `hoje` ('YYYY-MM-DD'). */
function mesCorrente(hoje: string) {
  const [a, m] = hoje.split('-').map(Number) as [number, number];
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, '0');
  return { inicio: `${a}-${mm}-01`, fim: `${a}-${mm}-${String(ultimo).padStart(2, '0')}` };
}

const modulo: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', autenticarClinica);
  app.addHook('preHandler', exigirRecurso('dashboard'));

  app.get('/', { schema: { querystring: Filtro } }, async (request) => {
    const u = request.usuarioClinica!;
    const db = request.db;
    const clinicaId = request.clinicaId;
    const agora = new Date();

    // ---- escopo (profissional sempre forçado ao próprio)
    let profissionalId: string | null;
    if (u.papel === 'profissional') {
      if (!u.profissionalId) {
        throw erros.proibido('Seu usuário não está vinculado a um profissional. Fale com o administrador.');
      }
      profissionalId = u.profissionalId;
    } else {
      profissionalId = request.query.profissional_id ?? request.query.profissionalId ?? null;
      if (profissionalId) {
        ou404(
          await db.profissional.findUnique({ where: { id: profissionalId }, select: { id: true } }),
          'Profissional não encontrado.',
        );
      }
    }

    // ---- período
    const [fuso, assinatura] = await Promise.all([obterFuso(db, clinicaId), obterAssinaturaAtual(clinicaId)]);
    const hoje = hojeNoFuso(fuso, agora);
    const { inicio, fim } =
      request.query.inicio && request.query.fim ? { inicio: request.query.inicio, fim: request.query.fim } : mesCorrente(hoje);
    const dias = diasEntre(inicio, fim) + 1;
    const anterior = { inicio: somarDias(inicio, -dias), fim: somarDias(inicio, -1) };
    const { de, ate } = intervaloUtc(inicio, fim, fuso);
    const antUtc = intervaloUtc(anterior.inicio, anterior.fim, fuso);

    const habilitado = (codigo: string) =>
      !!assinatura?.plano.recursos.find((r) => r.recurso_codigo === codigo)?.habilitado;
    const verFinanceiro = u.papel === 'admin' && habilitado('financeiro');

    const e: Escopo = { clinicaId, fuso, profissionalId };
    const [agenda, agendaAnt, novos, novosAnt, porDia, horarios, profissionais, deHoje, financeiro, pend] =
      await Promise.all([
        resumoAgenda(db, e, de, ate, agora),
        resumoAgenda(db, e, antUtc.de, antUtc.ate, agora),
        novosPacientes(db, e, de, ate),
        novosPacientes(db, e, antUtc.de, antUtc.ate),
        serieDiaria(db, e, inicio, fim, de, ate),
        distribuicaoHorarios(db, e, de, ate),
        porProfissional(db, e, de, ate),
        agendaDeHoje(db, e, hoje),
        verFinanceiro ? blocoFinanceiro(db, clinicaId, inicio, fim, anterior, hoje) : Promise.resolve(null),
        pendencias(
          db,
          {
            agendamento_online: habilitado('agendamento_online'),
            lista_espera: habilitado('lista_espera'),
            retorno_automatico: habilitado('retorno_automatico'),
          },
          { profissionalId, ehProfissional: u.papel === 'profissional', hoje },
        ),
      ]);

    return {
      periodo: { inicio, fim, fuso, dias, hoje },
      periodo_anterior: anterior,
      escopo: { papel: u.papel, profissional_id: profissionalId, profissional_forcado: u.papel === 'profissional' },
      agenda: { ...agenda, novos_pacientes: novos },
      agenda_anterior: { ...agendaAnt, novos_pacientes: novosAnt },
      por_profissional: profissionais,
      por_dia: porDia,
      por_dia_semana: horarios.porDiaSemana,
      por_hora: horarios.porHora,
      hoje: deHoje,
      financeiro,
      pendencias: pend,
    };
  });
};

export default modulo;
