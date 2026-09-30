/**
 * Regras do agendamento online (usadas pelas rotas públicas, internas e pelo worker).
 *
 * - `resolverClinicaPublica(slug)`: devolve a clínica + config + `db` (tenant) SÓ se o agendamento online está
 *   disponível (clínica ativa, assinatura ativa, recurso no plano e `ao_ativo`). Senão 404
 *   `agendamento_indisponivel` — mesma resposta em todos os casos (não revela o motivo).
 * - `horariosPublicos(...)`: horários livres da agenda (grade − bloqueios − agendamentos − passado) respeitando
 *   antecedência mínima, dias à frente e as solicitações PENDENTES no mesmo horário.
 */
import type { ConfiguracaoClinica, Prisma } from '@prisma/client';
import { addMinutes } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { prisma } from '../../lib/prisma';
import { assegurarRecurso, assinaturaEstaAtiva } from '../../plugins/recursos';
import { criarDbTenant, type DbTenant } from '../../plugins/tenant';
import { obterConfiguracaoClinicaPorId } from '../../servicos/configuracaoClinica';
import { ErroNegocio } from '../../utils/erros';
import { chaveIp } from '../../utils/ip';
import { calcularDisponibilidade, instanteLocal, FUSO_PADRAO, type ClienteAgenda } from '../agendamentos/servico';

export const erroIndisponivel = () =>
  new ErroNegocio(
    404,
    'agendamento_indisponivel',
    'O agendamento online não está disponível para este endereço. Entre em contato com a clínica.',
  );

export type ClinicaPublica = {
  clinica: {
    id: string;
    nome: string;
    slug: string;
    telefone: string | null;
    endereco: string | null;
    cidade: string | null;
    uf: string | null;
    fuso_horario: string;
  };
  config: ConfiguracaoClinica;
  db: DbTenant;
  fuso: string;
};

/** Verifica se a clínica pode receber solicitações online (sem lançar). */
export async function agendamentoOnlineDisponivel(clinicaId: string): Promise<boolean> {
  if (!(await assinaturaEstaAtiva(clinicaId))) return false;
  try {
    await assegurarRecurso(clinicaId, 'agendamento_online');
  } catch (e) {
    if (e instanceof ErroNegocio) return false;
    throw e;
  }
  return true;
}

export async function resolverClinicaPublica(slug: string): Promise<ClinicaPublica> {
  const s = slug.trim().toLowerCase();
  if (!s || s.length > 100) throw erroIndisponivel();
  const clinica = await prisma.clinica.findUnique({
    where: { slug: s },
    select: {
      id: true,
      nome: true,
      slug: true,
      telefone: true,
      endereco: true,
      cidade: true,
      uf: true,
      fuso_horario: true,
      status: true,
    },
  });
  if (!clinica || !clinica.slug || clinica.status !== 'ativa') throw erroIndisponivel();
  if (!(await agendamentoOnlineDisponivel(clinica.id))) throw erroIndisponivel();
  const config = await obterConfiguracaoClinicaPorId(clinica.id);
  if (!config.ao_ativo) throw erroIndisponivel();
  const { status: _status, ...dados } = clinica;
  return {
    clinica: { ...dados, slug: clinica.slug },
    config,
    db: criarDbTenant(clinica.id),
    fuso: clinica.fuso_horario || FUSO_PADRAO,
  };
}

/** Profissionais que aparecem na página pública (ativos, marcados e com grade cadastrada). */
export function profissionaisPublicos(db: Pick<DbTenant, 'profissional'>, id?: string) {
  return db.profissional.findMany({
    where: { ativo: true, agendamento_online: true, horarios: { some: {} }, ...(id ? { id } : {}) },
    select: { id: true, nome: true, especialidade: true, duracao_consulta_min: true },
    orderBy: { nome: 'asc' },
  });
}

/** "yyyy-MM-dd" + n dias (aritmética de calendário, sem fuso). */
export function somarDias(dia: string, n: number): string {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function hojeNoFuso(fuso: string, agora = new Date()): string {
  return formatInTimeZone(agora, fuso, 'yyyy-MM-dd');
}

type ClientePublico = ClienteAgenda & Pick<DbTenant, 'solicitacaoAgendamento'>;

/**
 * Horários livres para a página pública. Sem dados de pacientes: só { inicio, fim, hora }.
 * `agora` injetável (testes).
 */
export async function horariosPublicos(
  db: ClientePublico,
  a: {
    profissionalId: string;
    duracaoMin: number;
    dia: string;
    fuso: string;
    config: Pick<ConfiguracaoClinica, 'ao_antecedencia_min_horas' | 'ao_dias_a_frente'>;
    agora?: Date;
  },
): Promise<{ inicio: string; fim: string; hora: string }[]> {
  const agora = a.agora ?? new Date();
  const hoje = hojeNoFuso(a.fuso, agora);
  const ultimoDia = somarDias(hoje, a.config.ao_dias_a_frente);
  if (a.dia < hoje || a.dia > ultimoDia) return [];

  const minimo = new Date(agora.getTime() + a.config.ao_antecedencia_min_horas * 3_600_000);
  const limite = instanteLocal(somarDias(ultimoDia, 1), '00:00', a.fuso);
  const slots = await calcularDisponibilidade(db, {
    profissionalId: a.profissionalId,
    dia: a.dia,
    duracaoMin: a.duracaoMin,
    fuso: a.fuso,
    agora: minimo,
  });
  if (slots.length === 0) return [];

  const inicioDia = instanteLocal(a.dia, '00:00', a.fuso);
  const fimDia = addMinutes(inicioDia, 24 * 60 + 120);
  const pendentes = await db.solicitacaoAgendamento.findMany({
    where: {
      profissional_id: a.profissionalId,
      status: 'pendente',
      inicio: { lt: fimDia },
      fim: { gt: inicioDia },
    } satisfies Prisma.SolicitacaoAgendamentoWhereInput,
    select: { inicio: true, fim: true },
  });
  return slots.filter((s) => {
    const ini = new Date(s.inicio);
    const fim = new Date(s.fim);
    if (ini >= limite) return false;
    return !pendentes.some((p) => p.inicio < fim && p.fim > ini);
  });
}

// ----------------------------------------------------------------------------- anti-abuso

/**
 * Limites fixos contra esgotamento da agenda por solicitações falsas (além do limite por telefone, que é
 * configurável em `ao_max_pendentes_por_telefone`). Só contam solicitações `pendente` com horário futuro.
 * - por IP (IPv4 inteiro / prefixo /64 do IPv6 — `chaveIp`), por clínica;
 * - por profissional por dia (dia local da clínica): acima disso o dia não aceita novas solicitações até a
 *   recepção analisar as pendentes.
 */
export const MAX_PENDENTES_POR_IP = 3;
export const MAX_PENDENTES_PROFISSIONAL_DIA = 10;

type ClienteTx = Pick<DbTenant, 'solicitacaoAgendamento' | '$executeRawUnsafe'>;

/** Advisory lock até o fim da transação (serializa contagem + criação para a mesma chave). */
export async function travarChaveSolicitacao(tx: Pick<DbTenant, '$executeRawUnsafe'>, clinicaId: string, chave: string) {
  await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `${clinicaId}:solicitacao:${chave}`);
}

/** Pendentes futuras vindas da mesma chave de IP (ver `chaveIp`). */
export async function contarPendentesPorIp(tx: ClienteTx, chave: string, agora = new Date()): Promise<number> {
  const ehV6 = chave.endsWith('::/64');
  const linhas = await tx.solicitacaoAgendamento.findMany({
    where: {
      status: 'pendente',
      inicio: { gte: agora },
      ip: ehV6 ? { contains: ':' } : chave === 'desconhecido' ? null : { in: [chave, `::ffff:${chave}`] },
    },
    select: { ip: true },
  });
  if (!ehV6) return linhas.length;
  return linhas.filter((l) => chaveIp(l.ip) === chave).length;
}

/** Pendentes futuras do profissional no dia local `dia` (yyyy-MM-dd). */
export function contarPendentesProfissionalDia(
  tx: ClienteTx,
  a: { profissionalId: string; dia: string; fuso: string; agora?: Date },
): Promise<number> {
  const inicioDia = instanteLocal(a.dia, '00:00', a.fuso);
  const fimDia = instanteLocal(somarDias(a.dia, 1), '00:00', a.fuso);
  const agora = a.agora ?? new Date();
  return tx.solicitacaoAgendamento.count({
    where: {
      profissional_id: a.profissionalId,
      status: 'pendente',
      inicio: { gte: inicioDia > agora ? inicioDia : agora, lt: fimDia },
    },
  });
}

// ----------------------------------------------------------------------------- worker

/**
 * Expira solicitações `pendente` cujo início já passou (idempotente). Só age em clínicas com assinatura
 * ativa e recurso habilitado (as demais ficam para a próxima execução, quando voltarem a ficar ativas).
 */
export async function expirarSolicitacoesPendentes(opcoes: { clinicaId?: string; agora?: Date } = {}) {
  const agora = opcoes.agora ?? new Date();
  const grupos = await prisma.solicitacaoAgendamento.groupBy({
    by: ['clinica_id'],
    where: { status: 'pendente', inicio: { lt: agora }, ...(opcoes.clinicaId ? { clinica_id: opcoes.clinicaId } : {}) },
  });
  let processadas = 0;
  for (const g of grupos) {
    if (!(await agendamentoOnlineDisponivel(g.clinica_id))) continue;
    const r = await prisma.solicitacaoAgendamento.updateMany({
      where: { clinica_id: g.clinica_id, status: 'pendente', inicio: { lt: agora } },
      data: { status: 'expirada', analisado_em: agora },
    });
    processadas += r.count;
  }
  return { processadas };
}
