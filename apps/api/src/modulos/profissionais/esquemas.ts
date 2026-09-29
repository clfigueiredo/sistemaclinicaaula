/**
 * Esquemas Zod e regras puras do módulo profissionais (grade de horários, bloqueios).
 */
import { z } from 'zod';
import { erros } from '../../utils/erros';

/** Paleta padrão de cores da agenda (usada em rodízio quando a cor não é informada). */
export const PALETA_CORES_AGENDA = [
  '#0d9488',
  '#2563eb',
  '#7c3aed',
  '#db2777',
  '#ea580c',
  '#16a34a',
  '#ca8a04',
  '#0891b2',
  '#dc2626',
  '#4f46e5',
] as const;

/** Texto opcional: '' / null viram null; undefined continua undefined (não altera no update). */
export const textoOpcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Máximo de ${max} caracteres`)
    .nullish()
    .transform((v) => (v === undefined ? undefined : v ? v : null));

export const corAgenda = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Cor inválida (use o formato #RRGGBB)')
  .transform((v) => v.toLowerCase());

/** Campos editáveis do profissional (todos opcionais; o create exige `nome`). */
export const camposProfissional = z.object({
  nome: z.string().trim().min(2, 'Informe o nome do profissional').max(150, 'Máximo de 150 caracteres'),
  especialidade: textoOpcional(100),
  registro: textoOpcional(50),
  telefone: textoOpcional(20),
  email: z
    .union([z.literal(''), z.null(), z.string().trim().toLowerCase().pipe(z.email('E-mail inválido'))])
    .optional()
    .transform((v) => (v === undefined ? undefined : v ? v : null)),
  duracao_consulta_min: z.coerce
    .number({ error: 'Informe a duração da consulta' })
    .int('Use minutos inteiros')
    .min(5, 'Mínimo de 5 minutos')
    .max(480, 'Máximo de 480 minutos'),
  cor_agenda: corAgenda,
});

export const corpoCriarProfissional = camposProfissional.partial().extend({ nome: camposProfissional.shape.nome });
export const corpoEditarProfissional = camposProfissional.partial().extend({ ativo: z.boolean().optional() });

// ----------------------------------------------------------------------------
// Grade de horários
// ----------------------------------------------------------------------------

const hora = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora inválida (use HH:mm)');

export const intervaloHorario = z.object({
  dia_semana: z.coerce.number().int().min(0, 'Dia da semana entre 0 e 6').max(6, 'Dia da semana entre 0 e 6'),
  hora_inicio: hora,
  hora_fim: hora,
});
export type IntervaloHorario = z.infer<typeof intervaloHorario>;

/** Aceita a lista pura ou `{ horarios: [...] }`. */
export const corpoGrade = z
  .union([z.array(intervaloHorario), z.object({ horarios: z.array(intervaloHorario) })])
  .transform((v) => (Array.isArray(v) ? v : v.horarios))
  .refine((v) => v.length <= 70, 'Intervalos demais na grade');

const NOMES_DIAS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

/**
 * Valida a grade: início < fim e sem sobreposição no mesmo dia (intervalos encostados são permitidos).
 * Devolve a grade ordenada por dia e hora. Lança 400 com código específico.
 */
export function validarGrade(grade: IntervaloHorario[]): IntervaloHorario[] {
  for (const g of grade) {
    if (g.hora_inicio >= g.hora_fim) {
      throw erros.invalido(
        `Na ${NOMES_DIAS[g.dia_semana]}, o horário ${g.hora_inicio}–${g.hora_fim} deve terminar depois de começar.`,
        'horario_invalido',
      );
    }
  }
  const ordenada = [...grade].sort(
    (a, b) => a.dia_semana - b.dia_semana || a.hora_inicio.localeCompare(b.hora_inicio),
  );
  for (let i = 1; i < ordenada.length; i++) {
    const ant = ordenada[i - 1]!;
    const atual = ordenada[i]!;
    if (ant.dia_semana === atual.dia_semana && atual.hora_inicio < ant.hora_fim) {
      throw erros.invalido(
        `Na ${NOMES_DIAS[atual.dia_semana]}, os intervalos ${ant.hora_inicio}–${ant.hora_fim} e ${atual.hora_inicio}–${atual.hora_fim} se sobrepõem.`,
        'horarios_sobrepostos',
      );
    }
  }
  return ordenada;
}

// ----------------------------------------------------------------------------
// Bloqueios
// ----------------------------------------------------------------------------

export const corpoBloqueio = z
  .object({
    /** null/ausente = clínica toda (feriado, recesso…). */
    profissional_id: z.uuid('Profissional inválido').nullish(),
    inicio: z.coerce.date({ error: 'Data/hora de início inválida' }),
    fim: z.coerce.date({ error: 'Data/hora de fim inválida' }),
    motivo: textoOpcional(200),
  })
  .refine((b) => b.fim.getTime() > b.inicio.getTime(), {
    path: ['fim'],
    message: 'O fim do bloqueio deve ser depois do início',
  });

export const filtroBloqueios = z.object({
  inicio: z.coerce.date().optional(),
  fim: z.coerce.date().optional(),
  /** Filtra por profissional (inclui também os bloqueios da clínica toda). */
  profissionalId: z.uuid().optional(),
  /** true = só bloqueios da clínica toda (profissional_id null). */
  somenteClinica: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});
