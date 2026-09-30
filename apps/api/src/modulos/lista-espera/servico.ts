/**
 * Regras da lista de espera: turno de um horário, compatibilidade e "horário ainda livre".
 */
import type { Prisma, Turno } from '@prisma/client';
import type { DbTenant } from '../../plugins/tenant';
import { ErroNegocio } from '../../utils/erros';
import { partesLocais, validarBloqueio, validarConflito, type ClienteAgenda } from '../agendamentos/servico';

/** manhã < 12:00, tarde 12:00–17:59, noite ≥ 18:00 (fuso da clínica). */
export function turnoDoHorario(inicio: Date, fuso: string): Turno {
  const { minutos } = partesLocais(inicio, fuso);
  if (minutos < 12 * 60) return 'manha';
  if (minutos < 18 * 60) return 'tarde';
  return 'noite';
}

export const selecaoItem = {
  id: true,
  paciente_id: true,
  profissional_id: true,
  dias_semana: true,
  turnos: true,
  observacao: true,
  status: true,
  agendamento_id: true,
  ultima_oferta_em: true,
  criado_por: true,
  criado_em: true,
  atualizado_em: true,
  paciente: { select: { id: true, nome: true, telefone: true, whatsapp: true, aceita_whatsapp: true } },
  profissional: { select: { id: true, nome: true } },
} satisfies Prisma.ListaEsperaSelect;

/** Filtro dos itens compatíveis com um horário (profissional, dia da semana e turno). Mais antigos primeiro. */
export function filtroCompativel(a: {
  profissionalId: string;
  inicio: Date;
  fuso: string;
  ignorarPacienteId?: string;
}): Prisma.ListaEsperaWhereInput {
  const { diaSemana } = partesLocais(a.inicio, a.fuso);
  const turno = turnoDoHorario(a.inicio, a.fuso);
  return {
    status: 'aguardando',
    paciente: { ativo: true },
    ...(a.ignorarPacienteId ? { paciente_id: { not: a.ignorarPacienteId } } : {}),
    AND: [
      { OR: [{ profissional_id: null }, { profissional_id: a.profissionalId }] },
      { OR: [{ dias_semana: { isEmpty: true } }, { dias_semana: { has: diaSemana } }] },
      { OR: [{ turnos: { isEmpty: true } }, { turnos: { has: turno } }] },
    ],
  };
}

export function buscarCompativeis(
  db: Pick<DbTenant, 'listaEspera'>,
  a: Parameters<typeof filtroCompativel>[0],
  take = 50,
) {
  return db.listaEspera.findMany({
    where: filtroCompativel(a),
    select: selecaoItem,
    orderBy: [{ criado_em: 'asc' }],
    take,
  });
}

/** O horário ainda está livre? (futuro, sem bloqueio e sem outro agendamento ocupando.) */
export async function horarioLivre(
  db: ClienteAgenda,
  a: { profissionalId: string; inicio: Date; fim: Date; ignorarId?: string },
): Promise<boolean> {
  if (a.inicio.getTime() <= Date.now()) return false;
  try {
    await validarBloqueio(db, a.profissionalId, a.inicio, a.fim);
    await validarConflito(db, a.profissionalId, a.inicio, a.fim, a.ignorarId);
    return true;
  } catch (e) {
    if (e instanceof ErroNegocio) return false;
    throw e;
  }
}
