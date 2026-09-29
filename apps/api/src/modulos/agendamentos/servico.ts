/**
 * Regras da agenda: fuso da clínica, grade de horários, bloqueios, conflitos, transições de status
 * e cálculo de disponibilidade. Tudo recebe um client com escopo de tenant (`request.db` ou o `tx`
 * de uma transação dele), então as consultas já são filtradas por clinica_id.
 */
import type { StatusAgendamento } from '@prisma/client';
import { addMinutes } from 'date-fns';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import type { DbTenant } from '../../plugins/tenant';
import { ErroNegocio } from '../../utils/erros';

/** `request.db` ou o `tx` de `request.db.$transaction`. */
export type ClienteAgenda = Pick<
  DbTenant,
  'agendamento' | 'bloqueioAgenda' | 'profissionalHorario' | 'clinica' | '$executeRawUnsafe'
>;

export const FUSO_PADRAO = 'America/Sao_Paulo';

/** Status que NÃO ocupam o horário (liberam o slot para outro agendamento). */
export const STATUS_LIVRES: StatusAgendamento[] = ['cancelado', 'faltou'];

/** Status em que ainda é possível remarcar (mudar data/hora/profissional). */
export const STATUS_REMARCAVEIS: StatusAgendamento[] = ['agendado', 'confirmado'];

/** Transições de status permitidas. Cancelado/faltou/atendido são finais (cancelado não reabre). */
export const TRANSICOES: Record<StatusAgendamento, StatusAgendamento[]> = {
  agendado: ['confirmado', 'compareceu', 'cancelado', 'faltou'],
  confirmado: ['compareceu', 'cancelado', 'faltou'],
  compareceu: ['atendido'],
  atendido: [],
  cancelado: [],
  faltou: [],
};

export async function obterFuso(db: Pick<DbTenant, 'clinica'>, clinicaId: string): Promise<string> {
  const c = await db.clinica.findUnique({ where: { id: clinicaId }, select: { fuso_horario: true } });
  return c?.fuso_horario || FUSO_PADRAO;
}

/** "HH:mm" → minutos desde 00:00. */
export function paraMinutos(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Dia da semana (0 = domingo), data local (yyyy-MM-dd) e minutos do dia no fuso da clínica. */
export function partesLocais(data: Date, fuso: string) {
  return {
    dia: formatInTimeZone(data, fuso, 'yyyy-MM-dd'),
    diaSemana: Number(formatInTimeZone(data, fuso, 'i')) % 7, // ISO 1=seg…7=dom → 0=dom
    minutos: paraMinutos(formatInTimeZone(data, fuso, 'HH:mm')),
  };
}

/** Converte data local da clínica ("yyyy-MM-dd") + "HH:mm" em instante UTC. */
export function instanteLocal(dia: string, hhmm: string, fuso: string): Date {
  return fromZonedTime(`${dia}T${hhmm}:00`, fuso);
}

/** Travamento por profissional até o fim da transação (evita dois agendamentos no mesmo horário). */
export async function travarAgendaProfissional(tx: ClienteAgenda, clinicaId: string, profissionalId: string) {
  await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `${clinicaId}:agenda:${profissionalId}`);
}

/** O intervalo [inicio, fim) precisa caber inteiro numa faixa da grade do dia da semana. */
export async function validarGrade(db: ClienteAgenda, profissionalId: string, inicio: Date, fim: Date, fuso: string) {
  const a = partesLocais(inicio, fuso);
  const b = partesLocais(fim, fuso);
  // fim exatamente à meia-noite do dia seguinte conta como 24:00 do mesmo dia
  const minutosFim = b.dia === a.dia ? b.minutos : b.minutos === 0 && fim.getTime() - inicio.getTime() <= 86_400_000 ? 1440 : -1;
  const horarios = await db.profissionalHorario.findMany({
    where: { profissional_id: profissionalId, dia_semana: a.diaSemana },
  });
  const cabe =
    minutosFim >= 0 &&
    horarios.some((h) => paraMinutos(h.hora_inicio) <= a.minutos && minutosFim <= paraMinutos(h.hora_fim));
  if (!cabe) {
    throw new ErroNegocio(
      400,
      'fora_da_grade',
      horarios.length === 0
        ? 'O profissional não atende neste dia da semana.'
        : 'O horário está fora da grade de atendimento do profissional.',
      { faixas: horarios.map((h) => `${h.hora_inicio}–${h.hora_fim}`) },
    );
  }
}

/** Bloqueios (do profissional ou da clínica toda) que se sobrepõem ao intervalo. */
export function buscarBloqueios(db: ClienteAgenda, profissionalId: string | undefined, inicio: Date, fim: Date) {
  return db.bloqueioAgenda.findMany({
    where: {
      inicio: { lt: fim },
      fim: { gt: inicio },
      ...(profissionalId ? { OR: [{ profissional_id: profissionalId }, { profissional_id: null }] } : {}),
    },
    orderBy: { inicio: 'asc' },
  });
}

export async function validarBloqueio(db: ClienteAgenda, profissionalId: string, inicio: Date, fim: Date) {
  const [bloqueio] = await buscarBloqueios(db, profissionalId, inicio, fim);
  if (bloqueio) {
    throw new ErroNegocio(
      409,
      'horario_bloqueado',
      `A agenda está bloqueada neste horário${bloqueio.motivo ? ` (${bloqueio.motivo})` : ''}.`,
      { bloqueio_id: bloqueio.id },
    );
  }
}

export async function validarConflito(
  db: ClienteAgenda,
  profissionalId: string,
  inicio: Date,
  fim: Date,
  ignorarId?: string,
) {
  const conflito = await db.agendamento.findFirst({
    where: {
      profissional_id: profissionalId,
      status: { notIn: STATUS_LIVRES },
      inicio: { lt: fim },
      fim: { gt: inicio },
      ...(ignorarId ? { id: { not: ignorarId } } : {}),
    },
    select: { id: true, inicio: true, fim: true },
  });
  if (conflito) {
    throw new ErroNegocio(409, 'horario_ocupado', 'Já existe um agendamento deste profissional neste horário.', {
      agendamento_id: conflito.id,
    });
  }
}

/**
 * Horários livres de um profissional num dia (data local da clínica), em slots de `duracaoMin`
 * dentro da grade, sem bloqueios, sem agendamentos ocupando e sem horários já passados.
 */
export async function calcularDisponibilidade(
  db: ClienteAgenda,
  opcoes: { profissionalId: string; dia: string; duracaoMin: number; fuso: string; ignorarId?: string; agora?: Date },
) {
  const { profissionalId, dia, duracaoMin, fuso } = opcoes;
  const agora = opcoes.agora ?? new Date();
  const inicioDia = instanteLocal(dia, '00:00', fuso);
  const diaSemana = partesLocais(addMinutes(inicioDia, 12 * 60), fuso).diaSemana;
  const fimDia = addMinutes(inicioDia, 24 * 60 + 120); // folga para dias com mudança de horário

  const [horarios, bloqueios, ocupados] = await Promise.all([
    db.profissionalHorario.findMany({
      where: { profissional_id: profissionalId, dia_semana: diaSemana },
      orderBy: { hora_inicio: 'asc' },
    }),
    buscarBloqueios(db, profissionalId, inicioDia, fimDia),
    db.agendamento.findMany({
      where: {
        profissional_id: profissionalId,
        status: { notIn: STATUS_LIVRES },
        inicio: { lt: fimDia },
        fim: { gt: inicioDia },
        ...(opcoes.ignorarId ? { id: { not: opcoes.ignorarId } } : {}),
      },
      select: { inicio: true, fim: true },
    }),
  ]);

  const sobrepoe = (a: Date, b: Date, x: { inicio: Date; fim: Date }) => x.inicio < b && x.fim > a;
  const slots: { inicio: string; fim: string; hora: string }[] = [];
  const vistos = new Set<number>();

  for (const h of horarios) {
    const limite = paraMinutos(h.hora_fim);
    for (let m = paraMinutos(h.hora_inicio); m + duracaoMin <= limite; m += duracaoMin) {
      const hora = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
      const inicio = instanteLocal(dia, hora, fuso);
      const fim = addMinutes(inicio, duracaoMin);
      if (vistos.has(inicio.getTime())) continue;
      if (inicio < agora) continue;
      if (bloqueios.some((b) => sobrepoe(inicio, fim, b))) continue;
      if (ocupados.some((o) => sobrepoe(inicio, fim, o))) continue;
      vistos.add(inicio.getTime());
      slots.push({ inicio: inicio.toISOString(), fim: fim.toISOString(), hora });
    }
  }
  slots.sort((a, b) => a.inicio.localeCompare(b.inicio));
  return slots;
}
