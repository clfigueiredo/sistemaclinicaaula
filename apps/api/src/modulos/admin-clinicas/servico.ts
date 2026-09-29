/**
 * Serviço de clínicas/assinaturas e dashboard do super admin (plataforma — prisma cru).
 */
import type { Prisma, StatusAssinatura } from '@prisma/client';
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { prisma } from '../../lib/prisma';
import {
  CATALOGO_RECURSOS,
  inicioDoPeriodo,
  obterUsoERecursos,
  statusEfetivo,
  type CodigoLimite,
} from '../../plugins/recursos';
import { ou404 } from '../../utils/erros';

export const STATUS_ASSINATURA: StatusAssinatura[] = ['teste', 'ativa', 'vencida', 'cancelada', 'bloqueada'];

/** Filtro por status EFETIVO (teste/ativa com expira_em no passado contam como vencida). */
export function filtroStatusAssinatura(status: StatusAssinatura | 'sem_assinatura'): Prisma.ClinicaWhereInput {
  const agora = new Date();
  if (status === 'sem_assinatura') return { assinatura: { is: null } };
  if (status === 'vencida') {
    return {
      assinatura: {
        is: {
          OR: [{ status: 'vencida' }, { status: { in: ['teste', 'ativa'] }, expira_em: { lt: agora } }],
        },
      },
    };
  }
  if (status === 'teste' || status === 'ativa') {
    return { assinatura: { is: { status, OR: [{ expira_em: null }, { expira_em: { gte: agora } }] } } };
  }
  return { assinatura: { is: { status } } };
}

export type FiltrosLista = {
  busca?: string;
  status?: StatusAssinatura | 'sem_assinatura';
  planoId?: string;
  situacao?: 'ativa' | 'inativa';
  pagina: number;
  porPagina: number;
};

export async function listarClinicas(f: FiltrosLista) {
  const e: Prisma.ClinicaWhereInput[] = [];
  const busca = f.busca?.trim();
  if (busca) {
    const digitos = busca.replace(/\D/g, '');
    e.push({
      OR: [
        { nome: { contains: busca, mode: 'insensitive' } },
        { email: { contains: busca, mode: 'insensitive' } },
        { responsavel: { contains: busca, mode: 'insensitive' } },
        { cidade: { contains: busca, mode: 'insensitive' } },
        ...(digitos.length >= 3 ? [{ documento: { contains: digitos } }] : []),
      ],
    });
  }
  if (f.status) e.push(filtroStatusAssinatura(f.status));
  if (f.planoId) e.push({ assinatura: { is: { plano_id: f.planoId } } });
  if (f.situacao) e.push({ status: f.situacao });
  const where: Prisma.ClinicaWhereInput = e.length ? { AND: e } : {};

  const [total, clinicas] = await Promise.all([
    prisma.clinica.count({ where }),
    prisma.clinica.findMany({
      where,
      orderBy: { criado_em: 'desc' },
      skip: (f.pagina - 1) * f.porPagina,
      take: f.porPagina,
      include: {
        assinatura: { include: { plano: { select: { id: true, nome: true, preco: true } } } },
        _count: {
          select: {
            usuarios: { where: { ativo: true } },
            profissionais: { where: { ativo: true } },
            pacientes: true,
            agendamentos: true,
          },
        },
      },
    }),
  ]);

  return {
    itens: clinicas.map((c) => ({
      id: c.id,
      nome: c.nome,
      documento: c.documento,
      responsavel: c.responsavel,
      email: c.email,
      telefone: c.telefone,
      cidade: c.cidade,
      uf: c.uf,
      status: c.status,
      criado_em: c.criado_em,
      assinatura: c.assinatura
        ? {
            status: statusEfetivo(c.assinatura),
            status_cadastrado: c.assinatura.status,
            expira_em: c.assinatura.expira_em,
            plano: {
              id: c.assinatura.plano.id,
              nome: c.assinatura.plano.nome,
              preco: c.assinatura.plano.preco.toString(),
            },
          }
        : null,
      contadores: {
        usuarios: c._count.usuarios,
        profissionais: c._count.profissionais,
        pacientes: c._count.pacientes,
        agendamentos: c._count.agendamentos,
      },
    })),
    total,
    pagina: f.pagina,
    porPagina: f.porPagina,
  };
}

export async function obterDetalheClinica(id: string) {
  const clinica = ou404(
    await prisma.clinica.findUnique({
      where: { id },
      include: {
        usuarios: {
          orderBy: [{ papel: 'asc' }, { nome: 'asc' }],
          select: {
            id: true,
            nome: true,
            email: true,
            papel: true,
            ativo: true,
            profissional_id: true,
            ultimo_acesso_em: true,
            criado_em: true,
          },
        },
        whatsapp_sessao: { select: { status: true, telefone: true } },
        _count: { select: { pacientes: true, agendamentos: true, profissionais: true, prontuario_registros: true } },
      },
    }),
    'Clínica não encontrada.',
  );
  const resumo = await obterUsoERecursos(id);
  const { usuarios, whatsapp_sessao, _count, ...dados } = clinica;
  return {
    clinica: dados,
    ...resumo,
    usuarios,
    whatsapp: whatsapp_sessao,
    contadores: {
      pacientes: _count.pacientes,
      agendamentos: _count.agendamentos,
      profissionais: _count.profissionais,
      registros_prontuario: _count.prontuario_registros,
    },
  };
}

// ----------------------------------------------------------------------------
// Dashboard
// ----------------------------------------------------------------------------

type LinhaUso = { clinica_id: string; total: number };
const contar = (l: { clinica_id: string; _count: { _all: number } }[]): LinhaUso[] =>
  l.map((x) => ({ clinica_id: x.clinica_id, total: x._count._all }));

/**
 * Conta o uso de um recurso de limite para várias clínicas de uma vez (groupBy), com a mesma
 * regra de contarUso (src/plugins/recursos.ts). `desde` null = total.
 */
async function contarUsoEmLote(codigo: CodigoLimite, clinicaIds: string[], desde: Date | null) {
  if (!clinicaIds.length) return new Map<string, number>();
  const base = { clinica_id: { in: clinicaIds } };
  const data = desde ? { criado_em: { gte: desde } } : {};
  let linhas: LinhaUso[];
  switch (codigo) {
    case 'max_profissionais': {
      const r = await prisma.profissional.groupBy({
        by: ['clinica_id'],
        where: { ...base, ativo: true },
        _count: { _all: true },
      });
      linhas = contar(r);
      break;
    }
    case 'max_recepcionistas': {
      const r = await prisma.usuario.groupBy({
        by: ['clinica_id'],
        where: { ...base, papel: 'recepcao', ativo: true },
        _count: { _all: true },
      });
      linhas = contar(r);
      break;
    }
    case 'max_agendamentos': {
      const r = await prisma.agendamento.groupBy({
        by: ['clinica_id'],
        where: { ...base, ...data },
        _count: { _all: true },
      });
      linhas = contar(r);
      break;
    }
    case 'max_anexos': {
      const r = await prisma.anexo.groupBy({
        by: ['clinica_id'],
        where: { ...base, ...data },
        _count: { _all: true },
      });
      linhas = contar(r);
      break;
    }
    case 'max_mensagens': {
      const r = await prisma.mensagemWhatsapp.groupBy({
        by: ['clinica_id'],
        where: { ...base, ...data, direcao: 'saida', status: { in: ['pendente', 'enviada'] } },
        _count: { _all: true },
      });
      linhas = contar(r);
      break;
    }
  }
  return new Map(linhas.map((l) => [l.clinica_id, l.total]));
}

const CODIGOS_LIMITE = CATALOGO_RECURSOS.filter((r) => r.tipo === 'limite').map((r) => r.codigo) as CodigoLimite[];
const USO_POR_PERIODO: ReadonlySet<CodigoLimite> = new Set(['max_agendamentos', 'max_anexos', 'max_mensagens']);

/** Clínicas ativas com alguma métrica com uso >= limite (candidatas a upsell). */
async function clinicasNoLimite() {
  const assinaturas = await prisma.assinatura.findMany({
    where: { clinica: { status: 'ativa' } },
    include: {
      clinica: { select: { id: true, nome: true, fuso_horario: true } },
      plano: {
        select: {
          id: true,
          nome: true,
          recursos: { where: { habilitado: true, limite: { not: null } } },
        },
      },
    },
  });
  const comLimite = assinaturas.filter((a) => a.plano.recursos.length > 0);
  if (!comLimite.length) return [];

  // Uso por código e por (período, fuso). Clínicas agrupadas por fuso para o início do mês.
  const usos = new Map<string, Map<string, number>>(); // chave `${codigo}|${periodo}|${fuso}`
  for (const codigo of CODIGOS_LIMITE) {
    const grupos = new Map<string, string[]>();
    for (const a of comLimite) {
      const pr = a.plano.recursos.find((r) => r.recurso_codigo === codigo);
      if (!pr) continue;
      const periodo = USO_POR_PERIODO.has(codigo) ? pr.periodo : 'total';
      const chave = `${codigo}|${periodo}|${periodo === 'mensal' ? a.clinica.fuso_horario : ''}`;
      grupos.set(chave, [...(grupos.get(chave) ?? []), a.clinica_id]);
    }
    for (const [chave, ids] of grupos) {
      const [, periodo, fuso] = chave.split('|');
      const desde = periodo === 'mensal' ? inicioDoPeriodo('mensal', fuso || undefined) : null;
      usos.set(chave, await contarUsoEmLote(codigo, ids, desde));
    }
  }

  const resultado = [];
  for (const a of comLimite) {
    const estourados = [];
    for (const pr of a.plano.recursos) {
      const codigo = pr.recurso_codigo as CodigoLimite;
      if (!CODIGOS_LIMITE.includes(codigo) || pr.limite === null) continue;
      const periodo = USO_POR_PERIODO.has(codigo) ? pr.periodo : 'total';
      const chave = `${codigo}|${periodo}|${periodo === 'mensal' ? a.clinica.fuso_horario : ''}`;
      const uso = usos.get(chave)?.get(a.clinica_id) ?? 0;
      if (uso >= pr.limite) {
        const nome = CATALOGO_RECURSOS.find((r) => r.codigo === codigo)?.nome ?? codigo;
        estourados.push({ codigo, nome, uso, limite: pr.limite, periodo: pr.periodo });
      }
    }
    if (estourados.length) {
      resultado.push({
        id: a.clinica.id,
        nome: a.clinica.nome,
        plano: { id: a.plano.id, nome: a.plano.nome },
        status: statusEfetivo(a),
        recursos: estourados,
      });
    }
  }
  return resultado.sort((x, y) => y.recursos.length - x.recursos.length || x.nome.localeCompare(y.nome, 'pt-BR'));
}

const FUSO_PLATAFORMA = 'America/Sao_Paulo';

export async function montarDashboard() {
  const agora = new Date();
  const desde = new Date(agora.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [totalClinicas, clinicasAtivas, assinaturas, planos, recentes, semAssinatura, noLimite] = await Promise.all([
    prisma.clinica.count(),
    prisma.clinica.count({ where: { status: 'ativa' } }),
    prisma.assinatura.findMany({ select: { status: true, expira_em: true, plano_id: true } }),
    prisma.plano.findMany({ select: { id: true, nome: true, preco: true, ativo: true }, orderBy: { preco: 'asc' } }),
    prisma.clinica.findMany({ where: { criado_em: { gte: desde } }, select: { criado_em: true } }),
    prisma.clinica.count({ where: { assinatura: { is: null } } }),
    clinicasNoLimite(),
  ]);

  const porStatus = Object.fromEntries(STATUS_ASSINATURA.map((s) => [s, 0])) as Record<StatusAssinatura, number>;
  const porPlanoMapa = new Map<string, number>();
  for (const a of assinaturas) {
    porStatus[statusEfetivo(a)]++;
    porPlanoMapa.set(a.plano_id, (porPlanoMapa.get(a.plano_id) ?? 0) + 1);
  }

  // Série diária dos últimos 30 dias (inclui hoje), no fuso da plataforma.
  const contagemDia = new Map<string, number>();
  for (const c of recentes) {
    const dia = format(toZonedTime(c.criado_em, FUSO_PLATAFORMA), 'yyyy-MM-dd');
    contagemDia.set(dia, (contagemDia.get(dia) ?? 0) + 1);
  }
  const serie = [];
  for (let i = 29; i >= 0; i--) {
    const dia = format(toZonedTime(new Date(agora.getTime() - i * 24 * 60 * 60 * 1000), FUSO_PLATAFORMA), 'yyyy-MM-dd');
    serie.push({ data: dia, total: contagemDia.get(dia) ?? 0 });
  }

  // Receita mensal estimada (assinaturas ativas × preço do plano).
  const precoPlano = new Map(planos.map((p) => [p.id, Number(p.preco)]));
  const receitaMensal = assinaturas
    .filter((a) => statusEfetivo(a) === 'ativa')
    .reduce((soma, a) => soma + (precoPlano.get(a.plano_id) ?? 0), 0);

  return {
    total_clinicas: totalClinicas,
    clinicas_ativas: clinicasAtivas,
    clinicas_inativas: totalClinicas - clinicasAtivas,
    sem_assinatura: semAssinatura,
    por_status: porStatus,
    por_plano: planos.map((p) => ({
      plano_id: p.id,
      nome: p.nome,
      ativo: p.ativo,
      preco: p.preco.toString(),
      total: porPlanoMapa.get(p.id) ?? 0,
    })),
    cadastros_30_dias: serie,
    novos_30_dias: recentes.length,
    receita_mensal_estimada: receitaMensal.toFixed(2),
    clinicas_no_limite: noLimite,
  };
}
