/**
 * Serviço dos retornos — compartilhado entre as rotas (modulos/retornos) e o job diário (workers/retornos.ts).
 *
 *   - calcularDataPrevista(origemInicio, fuso, dias)      dia local da origem + N dias (Date @db.Date)
 *   - linkAgendamentoOnline(clinicaId)                     link público se slug + ao_ativo + recurso
 *   - enviarConvite(clinicaId, retorno)                    enfileira o WhatsApp `convite_retorno`
 *   - reconciliarAgendados(clinicaId)                      detecta agendamento posterior ⇒ `agendado`
 *   - enviarConvitesAutomaticos(clinicaId, hoje)           N dias antes, uma única vez, só com consentimento
 *
 * Fora do HTTP usamos `criarDbTenant(clinicaId)` (filtro de clinica_id automático).
 */
import type { StatusRetorno } from '@prisma/client';
import { formatInTimeZone } from 'date-fns-tz';
import { env } from '../../config/env';
import { prisma } from '../../lib/prisma';
import { assegurarRecurso } from '../../plugins/recursos';
import { criarDbTenant } from '../../plugins/tenant';
import { obterConfiguracaoClinicaPorId } from '../../servicos/configuracaoClinica';
import { dataSemHora, paraDataIso } from '../../servicos/financeiroComum';
import { enfileirarMensagem, type ResultadoEnfileirar } from '../../servicos/whatsapp/envio';
import { textoConviteRetorno } from '../../servicos/whatsapp/mensagens';
import { ErroNegocio } from '../../utils/erros';

const DIA_MS = 86_400_000;

/** Status em que o retorno ainda está "em aberto" (aguardando agendamento). */
export const STATUS_ABERTOS: StatusRetorno[] = ['pendente', 'lembrado'];

/**
 * Janela de detecção automática: um agendamento do mesmo paciente+profissional, posterior à consulta de
 * origem e até JANELA_DIAS_APOS dias depois da data prevista, é considerado o retorno.
 */
export const JANELA_DIAS_APOS = 90;

/** Erros de envio que podem se resolver sozinhos (tenta de novo no próximo job). */
const ERROS_TEMPORARIOS = new Set(['limite_atingido', 'recurso_indisponivel', 'assinatura_inativa', 'fila_indisponivel', 'clinica_inativa']);

export function somarDias(data: Date, dias: number): Date {
  return new Date(data.getTime() + dias * DIA_MS);
}

/** Dia local (fuso da clínica) do início da consulta de origem + `dias`, como Date @db.Date. */
export function calcularDataPrevista(origemInicio: Date, fuso: string, dias: number): Date {
  return somarDias(dataSemHora(formatInTimeZone(origemInicio, fuso, 'yyyy-MM-dd')), dias);
}

async function recursoHabilitado(clinicaId: string, codigo: Parameters<typeof assegurarRecurso>[1]) {
  try {
    await assegurarRecurso(clinicaId, codigo);
    return true;
  } catch (e) {
    if (e instanceof ErroNegocio) return false;
    throw e;
  }
}

/** Link da página pública de agendamento, se a clínica tiver slug, agendamento online ativo e o recurso. */
export async function linkAgendamentoOnline(clinicaId: string): Promise<string | null> {
  const clinica = await prisma.clinica.findUnique({ where: { id: clinicaId }, select: { slug: true } });
  if (!clinica?.slug) return null;
  const cfg = await obterConfiguracaoClinicaPorId(clinicaId);
  if (!cfg.ao_ativo) return null;
  if (!(await recursoHabilitado(clinicaId, 'agendamento_online'))) return null;
  return `${env.WEB_URL_PUBLICA}/agendar/${clinica.slug}`;
}

type RetornoParaConvite = {
  id: string;
  paciente_id: string;
  data_prevista: Date;
  paciente: { nome: string };
  profissional: { nome: string };
};

/** Monta o texto e enfileira o convite (não altera o retorno). */
export async function enfileirarConvite(
  clinicaId: string,
  retorno: RetornoParaConvite,
  contexto?: { nomeClinica: string; link: string | null },
): Promise<ResultadoEnfileirar> {
  const nomeClinica =
    contexto?.nomeClinica ??
    (await prisma.clinica.findUnique({ where: { id: clinicaId }, select: { nome: true } }))?.nome ??
    'clínica';
  const link = contexto ? contexto.link : await linkAgendamentoOnline(clinicaId);
  return enfileirarMensagem({
    clinicaId,
    pacienteId: retorno.paciente_id,
    tipo: 'convite_retorno',
    conteudo: textoConviteRetorno({
      paciente: retorno.paciente.nome,
      clinica: nomeClinica,
      profissional: retorno.profissional.nome,
      dataPrevista: retorno.data_prevista,
      linkAgendamento: link,
    }),
  });
}

/**
 * Detecção automática de retornos já agendados (o módulo agendamentos não tem hook):
 *   - `pendente`/`lembrado` com agendamento do mesmo paciente+profissional, não cancelado nem falta, com início
 *     depois da consulta de origem e até JANELA_DIAS_APOS dias após a data prevista ⇒ `agendado` + vínculo.
 *   - `agendado` cujo agendamento de retorno foi cancelado/falta ⇒ volta a `pendente` (ou `lembrado`, se já
 *     convidado) e pode ser religado a outro agendamento na mesma execução.
 */
export async function reconciliarAgendados(clinicaId: string): Promise<{ agendados: number; reabertos: number }> {
  const db = criarDbTenant(clinicaId);
  let reabertos = 0;
  let agendados = 0;

  const comAgendamentoCancelado = await db.retorno.findMany({
    where: { status: 'agendado', agendamento_retorno: { status: { in: ['cancelado', 'faltou'] } } },
    select: { id: true, convite_enviado_em: true },
  });
  for (const r of comAgendamentoCancelado) {
    const { count } = await db.retorno.updateMany({
      where: { id: r.id, status: 'agendado' },
      data: { status: r.convite_enviado_em ? 'lembrado' : 'pendente', agendamento_retorno_id: null },
    });
    reabertos += count;
  }

  const abertos = await db.retorno.findMany({
    where: { status: { in: STATUS_ABERTOS } },
    select: {
      id: true,
      paciente_id: true,
      profissional_id: true,
      agendamento_origem_id: true,
      data_prevista: true,
      agendamento_origem: { select: { inicio: true } },
    },
  });
  for (const r of abertos) {
    const agendamento = await db.agendamento.findFirst({
      where: {
        paciente_id: r.paciente_id,
        profissional_id: r.profissional_id,
        id: { not: r.agendamento_origem_id },
        status: { notIn: ['cancelado', 'faltou'] },
        inicio: { gt: r.agendamento_origem.inicio, lt: somarDias(r.data_prevista, JANELA_DIAS_APOS + 1) },
      },
      orderBy: { inicio: 'asc' },
      select: { id: true },
    });
    if (!agendamento) continue;
    const { count } = await db.retorno.updateMany({
      where: { id: r.id, status: { in: STATUS_ABERTOS } },
      data: { status: 'agendado', agendamento_retorno_id: agendamento.id },
    });
    agendados += count;
  }
  return { agendados, reabertos };
}

/**
 * Convites automáticos: retorno `pendente`, nunca convidado, com data prevista entre hoje e hoje + N dias,
 * de paciente com consentimento (`aceita_whatsapp`) e WhatsApp cadastrado. Cada retorno é "reservado"
 * (convite_enviado_em) ANTES de enfileirar, então execuções repetidas/concorrentes não duplicam.
 * Enviado ⇒ `lembrado`. Erro temporário (limite, recurso, fila…) ⇒ libera a reserva e para a clínica.
 * Erro definitivo (telefone inválido…) ⇒ mantém a reserva (não tenta todo dia) e o status `pendente`.
 */
export async function enviarConvitesAutomaticos(
  clinicaId: string,
  hoje: string,
): Promise<{ enviados: number; falhas: number }> {
  const cfg = await obterConfiguracaoClinicaPorId(clinicaId);
  if (!cfg.retorno_convite_ativo) return { enviados: 0, falhas: 0 };
  if (!(await recursoHabilitado(clinicaId, 'whatsapp'))) return { enviados: 0, falhas: 0 };

  const db = criarDbTenant(clinicaId);
  const inicio = dataSemHora(hoje);
  const limite = somarDias(inicio, cfg.retorno_dias_antecedencia);
  const candidatos = await db.retorno.findMany({
    where: {
      status: 'pendente',
      convite_enviado_em: null,
      data_prevista: { gte: inicio, lte: limite },
      paciente: { aceita_whatsapp: true, whatsapp: { not: null }, ativo: true },
    },
    select: {
      id: true,
      paciente_id: true,
      data_prevista: true,
      paciente: { select: { nome: true } },
      profissional: { select: { nome: true } },
    },
    orderBy: { data_prevista: 'asc' },
  });
  if (!candidatos.length) return { enviados: 0, falhas: 0 };

  const clinica = await prisma.clinica.findUnique({ where: { id: clinicaId }, select: { nome: true } });
  const contexto = { nomeClinica: clinica?.nome ?? 'clínica', link: await linkAgendamentoOnline(clinicaId) };

  let enviados = 0;
  let falhas = 0;
  for (const r of candidatos) {
    const reserva = await db.retorno.updateMany({
      where: { id: r.id, status: 'pendente', convite_enviado_em: null },
      data: { convite_enviado_em: new Date() },
    });
    if (reserva.count === 0) continue; // outro processo pegou

    const resultado = await enfileirarConvite(clinicaId, r, contexto);
    if (resultado.enfileirada) {
      await db.retorno.updateMany({ where: { id: r.id, status: 'pendente' }, data: { status: 'lembrado' } });
      enviados++;
      continue;
    }
    falhas++;
    if (ERROS_TEMPORARIOS.has(resultado.erro)) {
      await db.retorno.updateMany({ where: { id: r.id, status: 'pendente' }, data: { convite_enviado_em: null } });
      break;
    }
  }
  return { enviados, falhas };
}

/** Serializa as datas sem hora do retorno ('YYYY-MM-DD') e calcula `vencido`. */
export function serializarRetorno<T extends { data_prevista: Date; status: StatusRetorno }>(r: T, hoje: string) {
  const data = paraDataIso(r.data_prevista);
  return { ...r, data_prevista: data, vencido: STATUS_ABERTOS.includes(r.status) && data < hoje };
}
