import { z } from 'zod';
import { CODIGOS_RECURSOS, type CodigoRecurso } from '../../plugins/recursos';

export const ParamsId = z.object({ id: z.uuid('Identificador inválido') });

const codigoRecurso = z.enum(CODIGOS_RECURSOS as [CodigoRecurso, ...CodigoRecurso[]], {
  error: 'Recurso desconhecido',
});

export const ConfigRecurso = z.object({
  codigo: codigoRecurso,
  habilitado: z.boolean({ error: 'Informe se o recurso está habilitado' }),
  /** null = ilimitado. Ignorado para recursos liga/desliga. */
  limite: z
    .number({ error: 'Limite inválido' })
    .int('O limite deve ser um número inteiro')
    .min(0, 'O limite não pode ser negativo')
    .max(1_000_000_000, 'Limite grande demais')
    .nullable()
    .optional(),
  periodo: z.enum(['total', 'mensal'], { error: 'Período inválido (use total ou mensal)' }).optional(),
});

const ListaRecursos = z
  .array(ConfigRecurso)
  .max(CODIGOS_RECURSOS.length, 'Recursos demais')
  .refine((l) => new Set(l.map((r) => r.codigo)).size === l.length, 'Recurso repetido na lista');

const nome = z.string().trim().min(2, 'Informe o nome do plano (mín. 2 caracteres)').max(80, 'Nome muito longo');
const descricao = z.string().trim().max(500, 'Descrição muito longa').nullable();
const preco = z.coerce
  .number({ error: 'Preço inválido' })
  .min(0, 'O preço não pode ser negativo')
  .max(1_000_000, 'Preço muito alto')
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, 'Use no máximo 2 casas decimais no preço');

export const CorpoCriarPlano = z.object({
  nome,
  descricao: descricao.optional(),
  preco: preco.default(0),
  ativo: z.boolean().default(true),
  plano_cadastro: z.boolean().default(false),
  contratavel: z.boolean().default(false),
  exibir_landing: z.boolean().default(false),
  recursos: ListaRecursos.default([]),
});

export const CorpoEditarPlano = z
  .object({
    nome: nome.optional(),
    descricao: descricao.optional(),
    preco: preco.optional(),
    ativo: z.boolean().optional(),
    plano_cadastro: z.boolean().optional(),
    contratavel: z.boolean().optional(),
    exibir_landing: z.boolean().optional(),
    recursos: ListaRecursos.optional(),
  })
  .refine((d) => Object.values(d).some((v) => v !== undefined), 'Nada para atualizar');

export const CorpoAtivo = z.object({ ativo: z.boolean({ error: 'Informe ativo (true/false)' }) });
