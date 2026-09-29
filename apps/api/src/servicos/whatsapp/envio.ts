/**
 * ============================================================================
 * Envio de WhatsApp — SEMPRE pela fila (regra 6 do CLAUDE.md).
 * ============================================================================
 *
 *   enfileirarMensagem(...)  → grava mensagens_whatsapp (pendente) e coloca um job na fila
 *                              NOMES_FILAS.ENVIO_WHATSAPP (jobId = id da mensagem ⇒ sem job duplicado).
 *                              Verifica consentimento (aceita_whatsapp), recurso `whatsapp` e o limite
 *                              `max_mensagens` (com advisory lock por clínica). Se não puder, grava a
 *                              mensagem como `falhou` (erro = código) e NÃO enfileira.
 *   processarEnvio(id)       → executado pelo worker. Revalida consentimento/recurso/limite, espera a
 *                              vez da clínica (intervalo aleatório 20–40 s, ver reservarVezDaClinica)
 *                              e chama whatsappService.enviarMensagem. pendente → enviada | falhou.
 *
 * Intervalo por clínica: uma chave Redis por clínica (`whatsapp:proximo-envio:<clinicaId>`) guarda o
 * instante a partir do qual a clínica pode enviar de novo. Um script Lua atômico reserva a vez; se a
 * clínica ainda não pode, o job é adiado (moveToDelayed) para aquele instante. Clínicas diferentes
 * não se bloqueiam (o worker tem concorrência > 1), e o espaçamento vale mesmo com vários processos.
 *
 * Idempotência: só mensagens `pendente` são enviadas. Antes de chamar o provedor gravamos
 * erro = 'enviando'; se um retry encontrar esse marcador (processo morreu no meio do envio), a
 * mensagem vira `falhou/envio_incerto` em vez de ser reenviada (no máximo uma vez).
 * ============================================================================
 */
import type { TipoMensagem } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { assegurarLimite, assegurarRecurso } from '../../plugins/recursos';
import { ErroNegocio } from '../../utils/erros';
import { INTERVALO_ENVIO_MS, NOMES_FILAS, obterConexaoRedis, obterFila, type JobEnvioWhatsapp } from '../filas';
import { normalizarTelefone } from './telefone';
import { ErroProvedorWhatsapp } from './tipos';
import { whatsappService } from './whatsappService';

// ----------------------------------------------------------------------------
// Enfileirador (injetável nos testes)
// ----------------------------------------------------------------------------

export type Enfileirador = (job: JobEnvioWhatsapp) => Promise<void>;

const enfileiradorPadrao: Enfileirador = async (job) => {
  await obterFila<JobEnvioWhatsapp>(NOMES_FILAS.ENVIO_WHATSAPP).add('enviar', job, { jobId: job.mensagemId });
};

let enfileirador: Enfileirador = enfileiradorPadrao;

/** Troca o enfileirador (testes). null = volta ao BullMQ. */
export function definirEnfileirador(novo: Enfileirador | null): void {
  enfileirador = novo ?? enfileiradorPadrao;
}

// ----------------------------------------------------------------------------
// Enfileirar
// ----------------------------------------------------------------------------

export type NovaMensagem = {
  clinicaId: string;
  pacienteId: string;
  agendamentoId?: string | null;
  tipo: TipoMensagem;
  conteudo: string;
  /** Padrão: whatsapp do paciente. */
  telefone?: string | null;
};

export type ResultadoEnfileirar =
  | { enfileirada: true; mensagemId: string }
  | { enfileirada: false; mensagemId: string | null; erro: string };

/** Lock por clínica (o mesmo usado por assegurarLimite('max_mensagens')). */
function travarClinica(tx: { $executeRawUnsafe: (q: string, ...v: unknown[]) => Promise<number> }, clinicaId: string) {
  return tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `${clinicaId}:max_mensagens`);
}

export async function enfileirarMensagem(nova: NovaMensagem): Promise<ResultadoEnfileirar> {
  const { clinicaId } = nova;

  const resultado = await prisma.$transaction(async (tx) => {
    await travarClinica(tx, clinicaId);

    const paciente = await tx.paciente.findFirst({ where: { id: nova.pacienteId, clinica_id: clinicaId } });
    if (!paciente) return { mensagem: null, erro: 'paciente_nao_encontrado' };

    // Lembrete: no máximo um ativo por agendamento (evita duplicar em execuções concorrentes).
    if (nova.tipo === 'lembrete' && nova.agendamentoId) {
      const ag = await tx.agendamento.findFirst({
        where: { id: nova.agendamentoId, clinica_id: clinicaId },
        select: { lembrete_enviado_em: true },
      });
      const pendente = await tx.mensagemWhatsapp.findFirst({
        where: {
          clinica_id: clinicaId,
          agendamento_id: nova.agendamentoId,
          tipo: 'lembrete',
          direcao: 'saida',
          status: 'pendente',
        },
        select: { id: true },
      });
      if (!ag || ag.lembrete_enviado_em || pendente) return { mensagem: null, erro: 'lembrete_duplicado' };
    }

    const telefone = normalizarTelefone(nova.telefone ?? paciente.whatsapp);
    let erro: string | null = null;
    if (!paciente.aceita_whatsapp) erro = 'sem_consentimento';
    else if (!telefone) erro = 'telefone_invalido';
    else {
      try {
        await assegurarRecurso(clinicaId, 'whatsapp');
        await assegurarLimite(clinicaId, 'max_mensagens', { tx });
      } catch (e) {
        if (e instanceof ErroNegocio) erro = e.codigo;
        else throw e;
      }
    }

    const mensagem = await tx.mensagemWhatsapp.create({
      data: {
        clinica_id: clinicaId,
        paciente_id: paciente.id,
        agendamento_id: nova.agendamentoId ?? null,
        telefone: telefone ?? String(nova.telefone ?? paciente.whatsapp ?? ''),
        tipo: nova.tipo,
        direcao: 'saida',
        conteudo: nova.conteudo,
        status: erro ? 'falhou' : 'pendente',
        erro,
      },
    });
    return { mensagem, erro };
  });

  if (!resultado.mensagem || resultado.erro) {
    return { enfileirada: false, mensagemId: resultado.mensagem?.id ?? null, erro: resultado.erro ?? 'desconhecido' };
  }

  try {
    await enfileirador({ clinicaId, mensagemId: resultado.mensagem.id });
  } catch (e) {
    // Sem fila (Redis fora do ar): não deixa a mensagem "pendente" para sempre consumindo o limite.
    await prisma.mensagemWhatsapp.update({
      where: { id: resultado.mensagem.id },
      data: { status: 'falhou', erro: `fila_indisponivel: ${(e as Error).message}`.slice(0, 500) },
    });
    return { enfileirada: false, mensagemId: resultado.mensagem.id, erro: 'fila_indisponivel' };
  }
  return { enfileirada: true, mensagemId: resultado.mensagem.id };
}

// ----------------------------------------------------------------------------
// Intervalo por clínica (Redis)
// ----------------------------------------------------------------------------

/** Lançado quando a clínica ainda não pode enviar: o worker adia o job por `ms`. */
export class AguardarVez extends Error {
  constructor(public readonly ms: number) {
    super(`Aguardando a vez da clínica (${ms} ms).`);
    this.name = 'AguardarVez';
  }
}

const SCRIPT_RESERVAR_VEZ = `
local agora = tonumber(ARGV[1])
local intervalo = tonumber(ARGV[2])
local proximo = tonumber(redis.call('GET', KEYS[1]) or '0')
if agora >= proximo then
  redis.call('SET', KEYS[1], tostring(agora + intervalo), 'PX', intervalo + 60000)
  return 0
end
return proximo - agora
`;

export function intervaloAleatorioMs(): number {
  const { minimo, maximo } = INTERVALO_ENVIO_MS;
  return minimo + Math.floor(Math.random() * (maximo - minimo + 1));
}

/**
 * Reserva a vez da clínica para enviar AGORA. Se ainda não pode, lança AguardarVez(ms).
 * Depois de um envio, a próxima mensagem da mesma clínica só sai após 20–40 s (aleatório).
 */
export async function reservarVezDaClinica(clinicaId: string): Promise<void> {
  const espera = Number(
    await obterConexaoRedis().eval(
      SCRIPT_RESERVAR_VEZ,
      1,
      `whatsapp:proximo-envio:${clinicaId}`,
      String(Date.now()),
      String(intervaloAleatorioMs()),
    ),
  );
  if (espera > 0) throw new AguardarVez(espera + Math.floor(Math.random() * 500));
}

// ----------------------------------------------------------------------------
// Processar (worker)
// ----------------------------------------------------------------------------

export type OpcoesProcessarEnvio = {
  /** Última tentativa do job: erro temporário vira `falhou` em vez de relançar. */
  ultimaTentativa?: boolean;
  /** Chamado logo antes do envio (o worker usa reservarVezDaClinica). */
  antesDeEnviar?: () => Promise<void>;
};

export type ResultadoProcessarEnvio =
  | { status: 'enviada'; idExterno: string | null }
  | { status: 'falhou'; erro: string }
  | { status: 'ignorada'; motivo: string };

async function marcarFalha(id: string, erro: string): Promise<ResultadoProcessarEnvio> {
  await prisma.mensagemWhatsapp.update({ where: { id }, data: { status: 'falhou', erro: erro.slice(0, 500) } });
  return { status: 'falhou', erro };
}

export async function processarEnvio(
  mensagemId: string,
  opcoes: OpcoesProcessarEnvio = {},
): Promise<ResultadoProcessarEnvio> {
  const msg = await prisma.mensagemWhatsapp.findUnique({
    where: { id: mensagemId },
    include: { paciente: true, agendamento: true },
  });
  if (!msg) return { status: 'ignorada', motivo: 'mensagem_inexistente' };
  if (msg.direcao !== 'saida' || msg.status !== 'pendente') return { status: 'ignorada', motivo: `status_${msg.status}` };
  if (msg.erro === 'enviando') return marcarFalha(msg.id, 'envio_incerto');

  const clinicaId = msg.clinica_id;
  if (!msg.paciente || !msg.paciente.aceita_whatsapp) return marcarFalha(msg.id, 'sem_consentimento');
  if (msg.tipo === 'lembrete' && msg.agendamento && msg.agendamento.status !== 'agendado') {
    return marcarFalha(msg.id, 'agendamento_alterado');
  }
  try {
    await assegurarRecurso(clinicaId, 'whatsapp');
    // A própria mensagem pendente já conta no uso: quantidade 0 ⇒ só barra se o uso passou do limite
    // (ex.: plano reduzido depois de enfileirar).
    await assegurarLimite(clinicaId, 'max_mensagens', { quantidade: 0 });
  } catch (e) {
    if (e instanceof ErroNegocio) return marcarFalha(msg.id, e.codigo);
    throw e;
  }

  if (opcoes.antesDeEnviar) await opcoes.antesDeEnviar(); // pode lançar AguardarVez

  await prisma.mensagemWhatsapp.update({ where: { id: msg.id }, data: { erro: 'enviando' } });
  try {
    const { idExterno } = await whatsappService.enviarMensagem(clinicaId, msg.telefone, msg.conteudo);
    const agora = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.mensagemWhatsapp.update({
        where: { id: msg.id },
        data: { status: 'enviada', erro: null, enviada_em: agora, id_externo: idExterno },
      });
      if (msg.tipo === 'lembrete' && msg.agendamento_id) {
        await tx.agendamento.updateMany({
          where: { id: msg.agendamento_id, clinica_id: clinicaId },
          data: { lembrete_enviado_em: agora },
        });
      }
    });
    return { status: 'enviada', idExterno };
  } catch (e) {
    const temporario = e instanceof ErroProvedorWhatsapp ? e.temporario : true;
    const texto = (e as Error).message ?? 'erro_desconhecido';
    if (temporario && !opcoes.ultimaTentativa) {
      // Mantém pendente (sem o marcador 'enviando') para o retry do BullMQ.
      await prisma.mensagemWhatsapp.update({ where: { id: msg.id }, data: { erro: texto.slice(0, 500) } });
      throw e;
    }
    return marcarFalha(msg.id, texto);
  }
}
