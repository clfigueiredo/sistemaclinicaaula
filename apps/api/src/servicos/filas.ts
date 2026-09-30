/**
 * Conexão Redis/BullMQ compartilhada e nomes das filas.
 *
 * - A conexão é criada sob demanda (lazy): importar este arquivo não conecta no Redis.
 * - Use `obterFila(NOMES_FILAS.X)` para enfileirar e `criarWorker(NOMES_FILAS.X, processador)`
 *   em src/workers para consumir.
 * - Regra do projeto: envio de WhatsApp SEMPRE pela fila, com intervalo aleatório de 20–40 s por
 *   sessão/clínica (ver INTERVALO_ENVIO_MS). A estratégia de espaçamento é implementada pelo
 *   módulo WhatsApp (fase 2).
 */
import { Queue, Worker, type JobsOptions, type Processor, type WorkerOptions } from 'bullmq';
import { Redis } from 'ioredis';
import { env } from '../config/env';

export const NOMES_FILAS = {
  /** Envio individual de mensagens WhatsApp. Dados do job: JobEnvioWhatsapp. */
  ENVIO_WHATSAPP: 'envio-whatsapp',
  /** Job diário (repeatable) que seleciona agendamentos de amanhã e enfileira lembretes. Dados: JobLembretes. */
  LEMBRETES: 'lembretes',
  // --- Fase 2 do produto (workers em src/workers/, donos em docs/FASE2.md) ---
  /** Financeiro: job diário que gera os títulos do próximo mês das recorrências ativas. Dados: JobPorClinica. */
  FINANCEIRO_RECORRENCIAS: 'financeiro-recorrencias',
  /** Retornos: job diário que envia convites de retorno (N dias antes) e marca `lembrado`. Dados: JobPorClinica. */
  RETORNOS: 'retornos',
  /** Agendamento online: job periódico que expira solicitações pendentes cujo horário já passou. Dados: JobPorClinica. */
  SOLICITACOES_AGENDAMENTO: 'solicitacoes-agendamento',
  /** Cobrança do SaaS: job diário que marca cobranças vencidas e bloqueia após a tolerância. Dados: JobCobrancas. */
  COBRANCAS: 'cobrancas',
} as const;

export type NomeFila = (typeof NOMES_FILAS)[keyof typeof NOMES_FILAS];

/** Intervalo aleatório entre envios da mesma clínica/sessão. */
export const INTERVALO_ENVIO_MS = { minimo: 20_000, maximo: 40_000 } as const;

export type JobEnvioWhatsapp = { clinicaId: string; mensagemId: string };
/** data: data de referência ISO (opcional; padrão = amanhã no fuso da clínica). */
export type JobLembretes = { data?: string };
/** Jobs diários da fase 2: sem clinicaId = todas as clínicas; `data` = referência ISO (testes/reprocesso). */
export type JobPorClinica = { clinicaId?: string; data?: string };
export type JobCobrancas = { data?: string };

export const OPCOES_PADRAO_JOB: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: 1000,
  removeOnFail: 5000,
};

let conexao: Redis | null = null;

/** Conexão Redis compartilhada (maxRetriesPerRequest: null é exigido pelo BullMQ). */
export function obterConexaoRedis(): Redis {
  if (!conexao) {
    conexao = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  }
  return conexao;
}

const filas = new Map<string, Queue>();

export function obterFila<T = unknown>(nome: NomeFila): Queue<T> {
  let fila = filas.get(nome);
  if (!fila) {
    fila = new Queue(nome, { connection: obterConexaoRedis(), defaultJobOptions: OPCOES_PADRAO_JOB });
    filas.set(nome, fila);
  }
  return fila as unknown as Queue<T>;
}

const workers: Worker[] = [];

export function criarWorker<T = unknown, R = unknown>(
  nome: NomeFila,
  processador: Processor<T, R>,
  opcoes: Omit<WorkerOptions, 'connection'> = {},
): Worker<T, R> {
  const worker = new Worker<T, R>(nome, processador, { connection: obterConexaoRedis(), ...opcoes });
  workers.push(worker as unknown as Worker);
  return worker;
}

/** Fecha workers, filas e conexão (shutdown gracioso). */
export async function fecharFilas(): Promise<void> {
  await Promise.all(workers.map((w) => w.close()));
  await Promise.all([...filas.values()].map((f) => f.close()));
  workers.length = 0;
  filas.clear();
  if (conexao) {
    await conexao.quit();
    conexao = null;
  }
}
