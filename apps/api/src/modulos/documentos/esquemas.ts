/**
 * Esquemas Zod do módulo documentos (corpo da emissão/pré-visualização) + tipos dos metadados por tipo.
 *
 * metadados por tipo:
 *   receita       { uso?: 'interno' | 'externo', itens?: [{ medicamento, posologia?, quantidade? }] }
 *   atestado      { dias?: 1–365, cid?, exibir_cid?: boolean }  — CID só com exibir_cid = true (autorização do paciente)
 *   declaracao    { data?: 'YYYY-MM-DD', hora_inicio?: 'HH:mm', hora_fim?: 'HH:mm' }
 *   pedido_exame  { exames: string[] (1–50), indicacao_clinica? }
 * O servidor acrescenta `conteudo_gerado: true` quando o texto foi montado a partir dos itens/exames.
 */
import { z } from 'zod';

const texto = (max: number, msg: string) => z.string().trim().max(max, msg);
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

export const MetadadosReceita = z.object({
  uso: z.enum(['interno', 'externo'], 'Uso inválido').nullish(),
  itens: z
    .array(
      z.object({
        medicamento: z.string().trim().min(1, 'Informe o medicamento').max(200, 'Nome do medicamento muito longo'),
        posologia: texto(1000, 'Posologia muito longa').nullish(),
        quantidade: texto(100, 'Quantidade muito longa').nullish(),
      }),
    )
    .max(50, 'No máximo 50 itens por receita')
    .optional(),
});

export const MetadadosAtestado = z
  .object({
    dias: z.number().int('Dias deve ser inteiro').min(1, 'Mínimo de 1 dia').max(365, 'Máximo de 365 dias').nullish(),
    cid: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]\d{2}(\.?\d{1,2})?$/, 'CID inválido (ex.: J11 ou J11.1)')
      .nullish()
      .or(z.literal('').transform(() => null)),
    exibir_cid: z.boolean().optional(),
  })
  .refine((m) => !m.cid || m.exibir_cid === true, {
    message: 'O CID só pode constar no atestado com a autorização do paciente.',
    path: ['exibir_cid'],
  });

export const MetadadosDeclaracao = z.object({
  data: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida (AAAA-MM-DD)')
    .nullish(),
  hora_inicio: z.string().regex(HORA, 'Horário inválido (HH:mm)').nullish(),
  hora_fim: z.string().regex(HORA, 'Horário inválido (HH:mm)').nullish(),
});

export const MetadadosPedidoExame = z.object({
  exames: z
    .array(z.string().trim().min(1, 'Informe o exame').max(300, 'Nome do exame muito longo'))
    .min(1, 'Informe ao menos um exame')
    .max(50, 'No máximo 50 exames por pedido'),
  indicacao_clinica: texto(1000, 'Indicação clínica muito longa').nullish(),
});

const base = {
  paciente_id: z.uuid('Paciente inválido'),
  titulo: texto(120, 'Título muito longo').nullish(),
  conteudo: texto(20_000, 'Conteúdo muito longo (máx. 20.000 caracteres)').optional(),
  agendamento_id: z.uuid('Agendamento inválido').nullish(),
};

export const CorpoDocumento = z.discriminatedUnion('tipo', [
  z.object({ ...base, tipo: z.literal('receita'), metadados: MetadadosReceita.nullish() }),
  z.object({ ...base, tipo: z.literal('atestado'), metadados: MetadadosAtestado.nullish() }),
  z.object({ ...base, tipo: z.literal('declaracao'), metadados: MetadadosDeclaracao.nullish() }),
  z.object({ ...base, tipo: z.literal('pedido_exame'), metadados: MetadadosPedidoExame }),
]);

export type CorpoDocumento = z.infer<typeof CorpoDocumento>;
export type MetadadosReceita = z.infer<typeof MetadadosReceita>;
export type MetadadosAtestado = z.infer<typeof MetadadosAtestado>;
export type MetadadosDeclaracao = z.infer<typeof MetadadosDeclaracao>;
export type MetadadosPedidoExame = z.infer<typeof MetadadosPedidoExame>;
