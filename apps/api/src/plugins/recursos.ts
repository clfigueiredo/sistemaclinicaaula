/**
 * ============================================================================
 * RECURSOS E LIMITES DO PLANO
 * ============================================================================
 *
 * Toda ação que consome recurso do plano DEVE passar por aqui no backend
 * (esconder botão no front é só UX).
 *
 * Como usar nas rotas (preHandlers — já autenticam a clínica se preciso):
 *
 *   app.post('/profissionais', {
 *     preHandler: [exigirPapel('admin'), verificarLimite('max_profissionais')],
 *     schema: { body: ... },
 *   }, handler)
 *
 *   app.post('/whatsapp/conectar', { preHandler: [exigirPapel('admin'), exigirRecurso('whatsapp')] }, handler)
 *
 * Ou como função, dentro de uma transação (evita corrida entre duas criações simultâneas —
 * usa pg_advisory_xact_lock por clínica+recurso):
 *
 *   await request.db.$transaction(async (tx) => {
 *     await assegurarLimite(request.clinicaId, 'max_agendamentos', { tx });
 *     return tx.agendamento.create({ data: {...} });
 *   });
 *
 * Em workers (sem request): `await assegurarLimite(clinicaId, 'max_mensagens')`.
 *
 * Ao estourar: ErroNegocio 403
 *   { erro: 'limite_atingido', recurso, limite, uso, mensagem: '... faça upgrade ...' }
 * Recurso desabilitado no plano: 403 { erro: 'recurso_indisponivel', recurso, mensagem }
 *
 * Como o uso é contado (ver contarUso):
 *   max_profissionais   → profissionais com ativo = true (sempre o total atual)
 *   max_recepcionistas  → "usuários de equipe": papel 'recepcao' com ativo = true + admins ativos
 *                          ADICIONAIS. O admin principal (o admin ativo mais antigo — normalmente o do
 *                          auto-cadastro) NÃO conta: uso = recepções ativas + max(0, admins ativos − 1).
 *                          Criar/reativar/promover a admin também passa por assegurarLimite.
 *   max_agendamentos    → agendamentos criados (qualquer status) no período
 *   max_anexos          → anexos criados no período
 *   max_mensagens       → mensagens de SAÍDA com status pendente|enviada no período
 *                          (pendente conta para não enfileirar além do limite)
 * Período: 'total' = desde sempre; 'mensal' = desde o 1º dia do mês corrente no fuso da clínica.
 * ============================================================================
 */
import type { FastifyRequest } from 'fastify';
import type { PeriodoLimite, StatusAssinatura } from '@prisma/client';
import { startOfMonth } from 'date-fns';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import { prisma } from '../lib/prisma';
import { ErroNegocio, erros } from '../utils/erros';

// ----------------------------------------------------------------------------
// Catálogo (fixo no código; o seed espelha na tabela `recursos`)
// ----------------------------------------------------------------------------

export const CATALOGO_RECURSOS = [
  { codigo: 'max_profissionais', nome: 'Profissionais', tipo: 'limite', descricao: 'Profissionais ativos', ordem: 1 },
  {
    codigo: 'max_recepcionistas',
    nome: 'Usuários de equipe',
    tipo: 'limite',
    descricao: 'Recepção e administradores adicionais (o administrador principal não conta)',
    ordem: 2,
  },
  { codigo: 'max_agendamentos', nome: 'Agendamentos', tipo: 'limite', descricao: 'Agendamentos criados', ordem: 3 },
  { codigo: 'max_anexos', nome: 'Anexos', tipo: 'limite', descricao: 'Arquivos de exame anexados', ordem: 4 },
  { codigo: 'whatsapp', nome: 'WhatsApp', tipo: 'booleano', descricao: 'Permite conectar um número de WhatsApp', ordem: 5 },
  { codigo: 'max_mensagens', nome: 'Mensagens WhatsApp', tipo: 'limite', descricao: 'Mensagens de WhatsApp enviadas', ordem: 6 },
  {
    codigo: 'financeiro',
    nome: 'Financeiro',
    tipo: 'booleano',
    descricao: 'Caixa, contas a pagar e a receber, recorrências e repasses',
    ordem: 7,
  },
  {
    codigo: 'agendamento_online',
    nome: 'Agendamento online',
    tipo: 'booleano',
    descricao: 'Página pública para o paciente solicitar horários',
    ordem: 8,
  },
  {
    codigo: 'lista_espera',
    nome: 'Lista de espera',
    tipo: 'booleano',
    descricao: 'Pacientes aguardando vaga, com sugestão quando um horário é liberado',
    ordem: 9,
  },
  {
    codigo: 'documentos_pdf',
    nome: 'Receituário e atestados',
    tipo: 'booleano',
    descricao: 'Receitas, atestados, declarações e pedidos de exame em PDF',
    ordem: 10,
  },
  {
    codigo: 'retorno_automatico',
    nome: 'Retorno automático',
    tipo: 'booleano',
    descricao: 'Controle de retornos com convite pelo WhatsApp',
    ordem: 11,
  },
  { codigo: 'dashboard', nome: 'Dashboard', tipo: 'booleano', descricao: 'Indicadores da agenda e do financeiro', ordem: 12 },
] as const;

export type CodigoRecurso = (typeof CATALOGO_RECURSOS)[number]['codigo'];
export type CodigoLimite = Extract<(typeof CATALOGO_RECURSOS)[number], { tipo: 'limite' }>['codigo'];
export const CODIGOS_RECURSOS = CATALOGO_RECURSOS.map((r) => r.codigo) as CodigoRecurso[];

export function ehRecursoDeLimite(codigo: CodigoRecurso): codigo is CodigoLimite {
  return CATALOGO_RECURSOS.find((r) => r.codigo === codigo)?.tipo === 'limite';
}

// ----------------------------------------------------------------------------
// Assinatura
// ----------------------------------------------------------------------------

const STATUS_SOMENTE_LEITURA: ReadonlySet<StatusAssinatura> = new Set(['vencida', 'cancelada', 'bloqueada']);

/** Status considerando expiração: teste/ativa com expira_em no passado = vencida. */
export function statusEfetivo(assinatura: { status: StatusAssinatura; expira_em: Date | null }): StatusAssinatura {
  if (
    (assinatura.status === 'teste' || assinatura.status === 'ativa') &&
    assinatura.expira_em &&
    assinatura.expira_em.getTime() < Date.now()
  ) {
    return 'vencida';
  }
  return assinatura.status;
}

export function ehSomenteLeitura(status: StatusAssinatura | null | undefined): boolean {
  return !status || STATUS_SOMENTE_LEITURA.has(status);
}

/**
 * Garante que a clínica está ativa e com assinatura que permite escrita (não vencida/cancelada/bloqueada).
 * Usada fora do request HTTP (workers, webhook), onde o bloqueio automático do autenticarClinica não
 * existe: job de lembretes, enfileiramento e envio de WhatsApp, processamento de mensagens recebidas.
 * Lança ErroNegocio 403 `assinatura_inativa` (ou `clinica_inativa`).
 */
export async function assegurarAssinaturaAtiva(clinicaId: string): Promise<void> {
  const clinica = await prisma.clinica.findUnique({
    where: { id: clinicaId },
    select: { status: true, assinatura: { select: { status: true, expira_em: true } } },
  });
  if (!clinica || clinica.status !== 'ativa') {
    throw new ErroNegocio(403, 'clinica_inativa', 'Esta clínica está inativa.');
  }
  const status = clinica.assinatura ? statusEfetivo(clinica.assinatura) : null;
  if (ehSomenteLeitura(status)) {
    throw new ErroNegocio(
      403,
      'assinatura_inativa',
      'A assinatura da clínica está vencida, cancelada ou bloqueada.',
      { status },
    );
  }
}

/** Versão booleana de assegurarAssinaturaAtiva. */
export async function assinaturaEstaAtiva(clinicaId: string): Promise<boolean> {
  try {
    await assegurarAssinaturaAtiva(clinicaId);
    return true;
  } catch (e) {
    if (e instanceof ErroNegocio) return false;
    throw e;
  }
}

/** Assinatura atual com plano e recursos do plano (prisma cru — dado de plataforma). */
export function obterAssinaturaAtual(clinicaId: string) {
  return prisma.assinatura.findUnique({
    where: { clinica_id: clinicaId },
    include: {
      plano: { include: { recursos: true } },
      clinica: { select: { fuso_horario: true } },
    },
  });
}

// ----------------------------------------------------------------------------
// Contagem de uso
// ----------------------------------------------------------------------------

type Contador = { count: (args: { where: Record<string, unknown> }) => PromiseLike<number> };

/**
 * Qualquer client Prisma serve: `prisma`, `request.db`, ou o `tx` de uma transação.
 * (As consultas já filtram clinica_id explicitamente.)
 */
export interface ClienteContagem {
  profissional: Contador;
  usuario: Contador;
  agendamento: Contador;
  anexo: Contador;
  mensagemWhatsapp: Contador;
  $executeRawUnsafe: (query: string, ...values: unknown[]) => PromiseLike<number>;
}

/** Início do período em UTC. 'total' → null (sem filtro de data). */
export function inicioDoPeriodo(periodo: PeriodoLimite, fuso = 'America/Sao_Paulo', agora = new Date()): Date | null {
  if (periodo === 'total') return null;
  const inicioLocal = startOfMonth(toZonedTime(agora, fuso));
  return fromZonedTime(inicioLocal, fuso);
}

export async function contarUso(
  clinicaId: string,
  codigo: CodigoLimite,
  periodo: PeriodoLimite,
  opcoes: { cliente?: ClienteContagem; fuso?: string } = {},
): Promise<number> {
  const db = (opcoes.cliente ?? prisma) as unknown as ClienteContagem;
  const inicio = inicioDoPeriodo(periodo, opcoes.fuso);
  const filtroData = inicio ? { criado_em: { gte: inicio } } : {};

  switch (codigo) {
    case 'max_profissionais':
      return db.profissional.count({ where: { clinica_id: clinicaId, ativo: true } });
    case 'max_recepcionistas': {
      // Sequencial: o cliente pode ser o `tx` de uma transação interativa.
      const recepcao = await db.usuario.count({ where: { clinica_id: clinicaId, papel: 'recepcao', ativo: true } });
      const admins = await db.usuario.count({ where: { clinica_id: clinicaId, papel: 'admin', ativo: true } });
      // O admin principal não conta; os adicionais ocupam vaga de "usuário de equipe".
      return recepcao + Math.max(0, admins - 1);
    }
    case 'max_agendamentos':
      return db.agendamento.count({ where: { clinica_id: clinicaId, ...filtroData } });
    case 'max_anexos':
      return db.anexo.count({ where: { clinica_id: clinicaId, ...filtroData } });
    case 'max_mensagens':
      return db.mensagemWhatsapp.count({
        where: { clinica_id: clinicaId, direcao: 'saida', status: { in: ['pendente', 'enviada'] }, ...filtroData },
      });
  }
}

// ----------------------------------------------------------------------------
// Verificações (funções) — lançam ErroNegocio
// ----------------------------------------------------------------------------

async function carregarRecurso(clinicaId: string, codigo: CodigoRecurso) {
  const assinatura = await obterAssinaturaAtual(clinicaId);
  if (!assinatura) {
    throw new ErroNegocio(403, 'sem_assinatura', 'A clínica não possui assinatura. Entre em contato com o suporte.');
  }
  const pr = assinatura.plano.recursos.find((r) => r.recurso_codigo === codigo);
  return { assinatura, planoRecurso: pr };
}

function erroIndisponivel(codigo: CodigoRecurso) {
  const nome = CATALOGO_RECURSOS.find((r) => r.codigo === codigo)?.nome ?? codigo;
  return new ErroNegocio(
    403,
    'recurso_indisponivel',
    `O recurso "${nome}" não está disponível no seu plano. Faça upgrade para liberar.`,
    { recurso: codigo },
  );
}

/** Garante que o recurso está habilitado no plano da clínica. */
export async function assegurarRecurso(clinicaId: string, codigo: CodigoRecurso): Promise<void> {
  const { planoRecurso } = await carregarRecurso(clinicaId, codigo);
  if (!planoRecurso?.habilitado) throw erroIndisponivel(codigo);
}

/**
 * Garante que há saldo do limite para consumir `quantidade` unidades.
 * Com `tx`, trava (advisory lock) clínica+recurso até o fim da transação e conta dentro dela.
 */
export async function assegurarLimite(
  clinicaId: string,
  codigo: CodigoLimite,
  opcoes: { quantidade?: number; tx?: unknown } = {},
): Promise<{ limite: number | null; uso: number }> {
  const quantidade = opcoes.quantidade ?? 1;
  const { assinatura, planoRecurso } = await carregarRecurso(clinicaId, codigo);
  if (!planoRecurso?.habilitado) throw erroIndisponivel(codigo);

  const cliente = opcoes.tx as ClienteContagem | undefined;
  if (cliente) {
    await cliente.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `${clinicaId}:${codigo}`);
  }
  const uso = await contarUso(clinicaId, codigo, planoRecurso.periodo, {
    cliente,
    fuso: assinatura.clinica.fuso_horario,
  });
  const limite = planoRecurso.limite;
  if (limite !== null && uso + quantidade > limite) {
    const nome = CATALOGO_RECURSOS.find((r) => r.codigo === codigo)?.nome ?? codigo;
    const periodoTxt = planoRecurso.periodo === 'mensal' ? ' neste mês' : '';
    throw new ErroNegocio(
      403,
      'limite_atingido',
      `Você atingiu o limite de ${limite} ${nome.toLowerCase()}${periodoTxt} do seu plano. Faça upgrade para continuar.`,
      { recurso: codigo, limite, uso },
    );
  }
  return { limite, uso };
}

// ----------------------------------------------------------------------------
// preHandlers
// ----------------------------------------------------------------------------

function exigirClinicaAutenticada(request: FastifyRequest): string {
  if (!request.clinicaId) throw erros.naoAutenticado();
  return request.clinicaId;
}

/** preHandler: recurso habilitado no plano (ex.: 'whatsapp'). Requer autenticarClinica antes. */
export function exigirRecurso(codigo: CodigoRecurso) {
  return async function exigirRecursoHandler(request: FastifyRequest) {
    await assegurarRecurso(exigirClinicaAutenticada(request), codigo);
  };
}

/** preHandler: há saldo no limite (ex.: 'max_profissionais'). Requer autenticarClinica antes. */
export function verificarLimite(codigo: CodigoLimite, quantidade = 1) {
  return async function verificarLimiteHandler(request: FastifyRequest) {
    await assegurarLimite(exigirClinicaAutenticada(request), codigo, { quantidade });
  };
}

// ----------------------------------------------------------------------------
// Resumo para o /me
// ----------------------------------------------------------------------------

export type ResumoRecurso = {
  nome: string;
  tipo: 'limite' | 'booleano';
  habilitado: boolean;
  limite: number | null;
  periodo: PeriodoLimite | null;
  uso: number | null;
};

export async function obterUsoERecursos(clinicaId: string) {
  const assinatura = await obterAssinaturaAtual(clinicaId);
  const resumos = await Promise.all(
    CATALOGO_RECURSOS.map(async (r): Promise<[CodigoRecurso, ResumoRecurso]> => {
      const pr = assinatura?.plano.recursos.find((x) => x.recurso_codigo === r.codigo);
      const habilitado = !!pr?.habilitado;
      const ehLimite = r.tipo === 'limite';
      const periodo = ehLimite ? (pr?.periodo ?? 'total') : null;
      const uso = ehLimite
        ? await contarUso(clinicaId, r.codigo as CodigoLimite, periodo ?? 'total', {
            fuso: assinatura?.clinica.fuso_horario,
          })
        : null;
      return [
        r.codigo,
        { nome: r.nome, tipo: r.tipo, habilitado, limite: ehLimite ? (pr?.limite ?? null) : null, periodo, uso },
      ];
    }),
  );
  // Mantém a ordem do catálogo.
  const recursos = Object.fromEntries(resumos) as Record<CodigoRecurso, ResumoRecurso>;

  const status = assinatura ? statusEfetivo(assinatura) : null;
  return {
    assinatura: assinatura
      ? {
          id: assinatura.id,
          status,
          status_cadastrado: assinatura.status,
          inicio: assinatura.inicio,
          expira_em: assinatura.expira_em,
          somente_leitura: ehSomenteLeitura(status),
        }
      : null,
    plano: assinatura
      ? {
          id: assinatura.plano.id,
          nome: assinatura.plano.nome,
          preco: assinatura.plano.preco.toString(),
        }
      : null,
    recursos,
  };
}
