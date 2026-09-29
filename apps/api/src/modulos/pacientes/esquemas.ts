/**
 * Esquemas Zod e normalizações do módulo pacientes.
 */
import { z } from 'zod';
import { somenteDigitos, validarCpf } from '../../utils/documento';

/**
 * Normaliza telefone brasileiro para dígitos com DDI 55 (formato usado pelo módulo WhatsApp).
 *   "(11) 99999-8888" → "5511999998888";  "551133334444" → "551133334444".
 * Retorna null se vazio e undefined se inválido.
 */
export function normalizarTelefone(valor: string | null | undefined): string | null | undefined {
  const d = somenteDigitos(valor ?? '');
  if (!d) return null;
  if (d.length === 10 || d.length === 11) return `55${d}`;
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) return d;
  return undefined;
}

/** Texto opcional: string vazia vira null. */
const textoOpcional = (max = 500) =>
  z
    .string()
    .trim()
    .max(max, `Máximo de ${max} caracteres`)
    .nullish()
    .transform((v) => (v ? v : null));

const telefoneOpcional = z
  .string()
  .nullish()
  .transform((v, ctx) => {
    const n = normalizarTelefone(v);
    if (n === undefined) {
      ctx.addIssue({ code: 'custom', message: 'Telefone inválido (use DDD + número)' });
      return z.NEVER;
    }
    return n;
  });

const cpfOpcional = z
  .string()
  .nullish()
  .transform((v, ctx) => {
    const d = somenteDigitos(v ?? '');
    if (!d) return null;
    if (!validarCpf(d)) {
      ctx.addIssue({ code: 'custom', message: 'CPF inválido' });
      return z.NEVER;
    }
    return d;
  });

export const CorpoPaciente = z
  .object({
    nome: z.string().trim().min(2, 'Informe o nome do paciente').max(200, 'Nome muito longo'),
    cpf: cpfOpcional,
    nascimento: z.iso
      .date('Data de nascimento inválida (use AAAA-MM-DD)')
      .nullish()
      .or(z.literal(''))
      .transform((v) => (v ? v : null)),
    sexo: z.enum(['feminino', 'masculino', 'outro']).nullish().transform((v) => v ?? null),
    telefone: telefoneOpcional,
    whatsapp: telefoneOpcional,
    email: z
      .string()
      .trim()
      .toLowerCase()
      .nullish()
      .transform((v) => (v ? v : null))
      .refine((v) => v === null || z.email().safeParse(v).success, 'E-mail inválido'),
    endereco: textoOpcional(500),
    convenio_id: z.uuid('Convênio inválido').nullish().or(z.literal('')).transform((v) => (v ? v : null)),
    numero_carteirinha: textoOpcional(60),
    contato_emergencia: textoOpcional(200),
    /** Consentimento LGPD explícito para receber mensagens de WhatsApp. */
    aceita_whatsapp: z.boolean().default(false),
    observacoes: textoOpcional(2000),
    ativo: z.boolean().optional(),
  })
  .superRefine((d, ctx) => {
    if (d.aceita_whatsapp && !d.whatsapp) {
      ctx.addIssue({
        code: 'custom',
        path: ['whatsapp'],
        message: 'Informe o número de WhatsApp para registrar o consentimento de mensagens.',
      });
    }
    if (d.nascimento && new Date(`${d.nascimento}T00:00:00Z`).getTime() > Date.now()) {
      ctx.addIssue({ code: 'custom', path: ['nascimento'], message: 'A data de nascimento não pode estar no futuro' });
    }
  });
export type CorpoPaciente = z.infer<typeof CorpoPaciente>;

export const FiltrosLista = z.object({
  busca: z.string().trim().max(100).optional(),
  pagina: z.coerce.number().int().min(1).default(1),
  porPagina: z.coerce.number().int().min(1).max(100).default(20),
  /** "true" inclui pacientes inativos. */
  inativos: z.enum(['true', 'false']).optional(),
});

export const ParamsId = z.object({ id: z.uuid('Paciente inválido') });

export const CorpoAlergia = z.object({
  descricao: z.string().trim().min(2, 'Descreva a alergia').max(300),
  gravidade: textoOpcional(60),
});

export const CorpoMedicacao = z.object({
  nome: z.string().trim().min(2, 'Informe o medicamento').max(200),
  dosagem: textoOpcional(100),
  frequencia: textoOpcional(100),
  observacoes: textoOpcional(500),
});

export const ParamsAlergia = z.object({ id: z.uuid(), alergiaId: z.uuid() });
export const ParamsMedicacao = z.object({ id: z.uuid(), medicacaoId: z.uuid() });
