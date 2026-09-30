/**
 * Processamento dos eventos do webhook (já normalizados por whatsappService.interpretarWebhook).
 *
 * - status/qrcode → atualiza whatsapp_sessoes da clínica dona da sessão.
 * - mensagem recebida →
 *     1. identifica a clínica pelo nome da sessão (nunca por dado do corpo);
 *     2. idempotência: mesmo id_externo na mesma clínica não é processado de novo
 *        (advisory lock por clínica+id para aguentar webhooks duplicados simultâneos);
 *     3. grava mensagens_whatsapp (entrada, recebida);
 *     4. casa com o lembrete ENVIADO mais recente para aquele telefone NA MESMA CLÍNICA cujo
 *        agendamento ainda é futuro e `agendado`;
 *     5. "1" → agendamento confirmado + resposta; "2" → cancelado + resposta + aviso para a
 *        recepção (mensagem tipo `aviso`, direção entrada, `lida_em` nulo = não lido);
 *        outro texto → responde UMA vez com as instruções; sem lembrete pendente → só registra.
 *   As respostas saem pela fila (enfileirarMensagem), depois do commit.
 */
import { env } from '../../config/env';
import { prisma } from '../../lib/prisma';
import { enfileirarMensagem, type NovaMensagem } from './envio';
import {
  interpretarResposta,
  textoAvisoCancelamento,
  textoCancelado,
  textoConfirmado,
  textoInstrucoes,
  type DadosLembrete,
} from './mensagens';
import { variantesTelefone } from './telefone';
import type { EventoWhatsapp, MensagemRecebida } from './tipos';

export const MOTIVO_CANCELAMENTO_WHATSAPP = 'Cancelado pelo paciente via WhatsApp';

export type ResultadoEvento =
  | { acao: 'ignorado'; motivo: string }
  | { acao: 'status_atualizado'; clinicaId: string }
  | { acao: 'duplicada'; clinicaId: string }
  | { acao: 'registrada' | 'confirmado' | 'cancelado' | 'instrucoes'; clinicaId: string; mensagemId: string };

export async function processarEventoWhatsapp(evento: EventoWhatsapp): Promise<ResultadoEvento> {
  const sessao = await prisma.whatsappSessao.findUnique({ where: { nome_sessao: evento.nomeSessao } });
  if (!sessao) return { acao: 'ignorado', motivo: 'sessao_desconhecida' };
  const clinicaId = sessao.clinica_id;

  if (evento.tipo === 'status') {
    await prisma.whatsappSessao.update({
      where: { id: sessao.id },
      data: { status: evento.status, ...(evento.status === 'desconectada' ? { telefone: null } : {}) },
    });
    return { acao: 'status_atualizado', clinicaId };
  }
  if (evento.tipo === 'qrcode') {
    if (sessao.status !== 'conectada') {
      await prisma.whatsappSessao.update({ where: { id: sessao.id }, data: { status: 'aguardando_qr' } });
    }
    return { acao: 'status_atualizado', clinicaId };
  }
  return processarMensagemRecebida(clinicaId, evento);
}

async function processarMensagemRecebida(clinicaId: string, msg: MensagemRecebida): Promise<ResultadoEvento> {
  const clinica = await prisma.clinica.findUnique({ where: { id: clinicaId } });
  if (!clinica) return { acao: 'ignorado', motivo: 'clinica_inexistente' };
  const fuso = clinica.fuso_horario || env.TZ_PADRAO;
  const telefones = variantesTelefone(msg.telefone);
  const respostas: NovaMensagem[] = [];

  const processarNaTransacao = () =>
    prisma.$transaction(async (tx): Promise<ResultadoEvento> => {
      if (msg.idExterno) {
        await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `webhook:${clinicaId}:${msg.idExterno}`);
        const repetida = await tx.mensagemWhatsapp.findFirst({
          where: { clinica_id: clinicaId, direcao: 'entrada', id_externo: msg.idExterno },
          select: { id: true },
        });
        if (repetida) return { acao: 'duplicada', clinicaId };
      }

      const lembrete = await tx.mensagemWhatsapp.findFirst({
        where: {
          clinica_id: clinicaId,
          tipo: 'lembrete',
          direcao: 'saida',
          status: 'enviada',
          telefone: { in: telefones },
          agendamento: { status: 'agendado', inicio: { gt: new Date() } },
        },
        orderBy: { criado_em: 'desc' },
        include: { agendamento: { include: { paciente: true, profissional: true } } },
      });

      const agendamento = lembrete?.agendamento ?? null;
      const pacienteId =
        agendamento?.paciente_id ??
        (
          await tx.paciente.findFirst({
            where: { clinica_id: clinicaId, whatsapp: { in: telefones } },
            select: { id: true },
            orderBy: { criado_em: 'desc' },
          })
        )?.id ??
        null;

      const entrada = await tx.mensagemWhatsapp.create({
        data: {
          clinica_id: clinicaId,
          agendamento_id: agendamento?.id ?? null,
          paciente_id: pacienteId,
          telefone: msg.telefone,
          tipo: null,
          direcao: 'entrada',
          conteudo: msg.texto.slice(0, 4000),
          status: 'recebida',
          id_externo: msg.idExterno,
          enviada_em: msg.recebidaEm,
        },
      });

      if (!agendamento) return { acao: 'registrada', clinicaId, mensagemId: entrada.id };

      const dados: DadosLembrete = {
        paciente: agendamento.paciente.nome,
        clinica: clinica.nome,
        profissional: agendamento.profissional.nome,
        inicio: agendamento.inicio,
        fuso,
      };
      const base = { clinicaId, pacienteId: agendamento.paciente_id, agendamentoId: agendamento.id, tipo: 'confirmacao' as const };
      const resposta = interpretarResposta(msg.texto);

      if (resposta === 'confirmar' || resposta === 'cancelar') {
        const novoStatus = resposta === 'confirmar' ? 'confirmado' : 'cancelado';
        const { count } = await tx.agendamento.updateMany({
          where: { id: agendamento.id, clinica_id: clinicaId, status: 'agendado' },
          data:
            novoStatus === 'cancelado'
              ? { status: novoStatus, motivo_cancelamento: MOTIVO_CANCELAMENTO_WHATSAPP, cancelado_em: new Date() }
              : { status: novoStatus },
        });
        if (count === 0) return { acao: 'registrada', clinicaId, mensagemId: entrada.id };

        if (resposta === 'confirmar') {
          respostas.push({ ...base, conteudo: textoConfirmado(dados) });
          return { acao: 'confirmado', clinicaId, mensagemId: entrada.id };
        }
        respostas.push({ ...base, conteudo: textoCancelado(dados) });
        await tx.mensagemWhatsapp.create({
          data: {
            clinica_id: clinicaId,
            agendamento_id: agendamento.id,
            paciente_id: agendamento.paciente_id,
            telefone: msg.telefone,
            tipo: 'aviso',
            direcao: 'entrada',
            conteudo: textoAvisoCancelamento(dados),
            // Aviso interno (não é enviado): lida_em nulo = não lido.
            status: 'recebida',
          },
        });
        return { acao: 'cancelado', clinicaId, mensagemId: entrada.id };
      }

      // Resposta não reconhecida: instruções uma única vez por agendamento.
      const jaInstruiu = await tx.mensagemWhatsapp.count({
        where: { clinica_id: clinicaId, agendamento_id: agendamento.id, tipo: 'confirmacao', direcao: 'saida' },
      });
      if (jaInstruiu === 0) {
        respostas.push({ ...base, conteudo: textoInstrucoes() });
        return { acao: 'instrucoes', clinicaId, mensagemId: entrada.id };
      }
      return { acao: 'registrada', clinicaId, mensagemId: entrada.id };
    });

  let resultado: ResultadoEvento;
  try {
    resultado = await processarNaTransacao();
  } catch (e) {
    // Índice único parcial (clinica_id, id_externo) de entrada: segunda barreira contra duplicados.
    if ((e as { code?: string })?.code === 'P2002') return { acao: 'duplicada', clinicaId };
    throw e;
  }

  for (const r of respostas) {
    await enfileirarMensagem(r);
  }
  return resultado;
}
