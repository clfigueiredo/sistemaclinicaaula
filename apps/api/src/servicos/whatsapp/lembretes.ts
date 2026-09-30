/**
 * Lembretes de consulta (1 dia antes).
 *
 * selecionarAgendamentosParaLembrete(clinicaId) → agendamentos de AMANHÃ (no fuso da clínica),
 *   status `agendado`, paciente ativo com aceita_whatsapp = true e whatsapp preenchido, sem
 *   lembrete já enviado/pendente (lembrete_enviado_em nulo e sem mensagem de lembrete ativa).
 * processarLembretesClinica(clinicaId) → para uma clínica ativa, com assinatura ativa (não
 *   vencida/cancelada/bloqueada), recurso `whatsapp` e sessão conectada, enfileira um lembrete por agendamento (envio sai pela fila, ver envio.ts).
 * processarLembretesTodasClinicas() → usado pelo job diário (workers/lembretes.ts).
 */
import { addDays, startOfDay } from 'date-fns';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import { env } from '../../config/env';
import { prisma } from '../../lib/prisma';
import { assegurarAssinaturaAtiva, assegurarRecurso } from '../../plugins/recursos';
import { ErroNegocio } from '../../utils/erros';
import { enfileirarMensagem } from './envio';
import { textoLembrete } from './mensagens';

/** [início, fim) de AMANHÃ no fuso informado, em UTC. */
export function janelaDeAmanha(fuso: string, referencia = new Date()): { inicio: Date; fim: Date } {
  const hojeLocal = startOfDay(toZonedTime(referencia, fuso));
  const amanhaLocal = addDays(hojeLocal, 1);
  return { inicio: fromZonedTime(amanhaLocal, fuso), fim: fromZonedTime(addDays(amanhaLocal, 1), fuso) };
}

export async function selecionarAgendamentosParaLembrete(clinicaId: string, referencia = new Date()) {
  const clinica = await prisma.clinica.findUnique({ where: { id: clinicaId }, select: { fuso_horario: true } });
  if (!clinica) return [];
  const { inicio, fim } = janelaDeAmanha(clinica.fuso_horario || env.TZ_PADRAO, referencia);
  return prisma.agendamento.findMany({
    where: {
      clinica_id: clinicaId,
      status: 'agendado',
      inicio: { gte: inicio, lt: fim },
      lembrete_enviado_em: null,
      paciente: { aceita_whatsapp: true, ativo: true, whatsapp: { not: null }, NOT: { whatsapp: '' } },
      // Enviado = lembrete_enviado_em (a agenda zera ao remarcar ⇒ novo lembrete). Aqui só evitamos
      // duplicar um lembrete ainda na fila, ou recriar hoje uma falha por limite do plano.
      mensagens: {
        none: {
          tipo: 'lembrete',
          direcao: 'saida',
          OR: [
            { status: 'pendente' },
            { status: 'falhou', erro: 'limite_atingido', criado_em: { gte: new Date(referencia.getTime() - 20 * 3600_000) } },
          ],
        },
      },
    },
    include: {
      paciente: { select: { id: true, nome: true, whatsapp: true } },
      profissional: { select: { id: true, nome: true } },
    },
    orderBy: { inicio: 'asc' },
  });
}

export type ResultadoLembretes = {
  clinicaId: string;
  selecionados: number;
  enfileirados: number;
  falharam: number;
  /** Motivo quando a clínica foi pulada inteira. */
  ignorada?: 'recurso_indisponivel' | 'sessao_desconectada' | 'clinica_inativa' | 'assinatura_inativa';
  erros: Record<string, number>;
};

export async function processarLembretesClinica(
  clinicaId: string,
  opcoes: { referencia?: Date } = {},
): Promise<ResultadoLembretes> {
  const resultado: ResultadoLembretes = { clinicaId, selecionados: 0, enfileirados: 0, falharam: 0, erros: {} };

  const clinica = await prisma.clinica.findUnique({ where: { id: clinicaId } });
  if (!clinica || clinica.status !== 'ativa') return { ...resultado, ignorada: 'clinica_inativa' };
  try {
    await assegurarAssinaturaAtiva(clinicaId);
  } catch (e) {
    if (e instanceof ErroNegocio) return { ...resultado, ignorada: 'assinatura_inativa' };
    throw e;
  }
  try {
    await assegurarRecurso(clinicaId, 'whatsapp');
  } catch (e) {
    if (e instanceof ErroNegocio) return { ...resultado, ignorada: 'recurso_indisponivel' };
    throw e;
  }
  const sessao = await prisma.whatsappSessao.findUnique({ where: { clinica_id: clinicaId } });
  if (sessao?.status !== 'conectada') return { ...resultado, ignorada: 'sessao_desconectada' };

  const agendamentos = await selecionarAgendamentosParaLembrete(clinicaId, opcoes.referencia);
  resultado.selecionados = agendamentos.length;
  const fuso = clinica.fuso_horario || env.TZ_PADRAO;

  for (const ag of agendamentos) {
    const r = await enfileirarMensagem({
      clinicaId,
      pacienteId: ag.paciente_id,
      agendamentoId: ag.id,
      tipo: 'lembrete',
      conteudo: textoLembrete({
        paciente: ag.paciente.nome,
        clinica: clinica.nome,
        profissional: ag.profissional.nome,
        inicio: ag.inicio,
        fuso,
      }),
    });
    if (r.enfileirada) resultado.enfileirados++;
    else if (r.erro !== 'lembrete_duplicado') {
      resultado.falharam++;
      resultado.erros[r.erro] = (resultado.erros[r.erro] ?? 0) + 1;
    }
  }
  return resultado;
}

/** Job diário: todas as clínicas ativas com sessão conectada (o recurso é conferido em cada uma). */
export async function processarLembretesTodasClinicas(referencia = new Date()): Promise<ResultadoLembretes[]> {
  const sessoes = await prisma.whatsappSessao.findMany({
    where: { status: 'conectada', clinica: { status: 'ativa' } },
    select: { clinica_id: true },
  });
  const resultados: ResultadoLembretes[] = [];
  for (const s of sessoes) {
    try {
      resultados.push(await processarLembretesClinica(s.clinica_id, { referencia }));
    } catch (e) {
      console.error(`Lembretes: falha na clínica ${s.clinica_id}:`, e);
    }
  }
  return resultados;
}
