/**
 * Esquemas Zod do módulo admin-email (super admin).
 */
import { StatusEmail, TipoEmail } from '@prisma/client';
import { z } from 'zod';

const email = (mensagem = 'E-mail inválido') =>
  z.string().trim().toLowerCase().max(200, 'E-mail muito longo').pipe(z.email(mensagem));

/** E-mail opcional: '' ou null ⇒ null (limpa o campo); ausente ⇒ mantém. */
const emailOuVazio = z
  .union([z.literal(''), z.null(), email()])
  .transform((v) => (v ? v : null))
  .optional();

export const tipoEmail = z.enum(TipoEmail, { error: 'Tipo de e-mail inválido' });
export const statusEmail = z.enum(StatusEmail, { error: 'Status inválido' });

export const ParamsTipo = z.object({ tipo: tipoEmail });
export const ParamsId = z.object({ id: z.uuid('Identificador inválido') });

export const CorpoConfiguracao = z.object({
  ativo: z.boolean().optional(),
  smtp_host: z
    .string()
    .trim()
    .min(1, 'Informe o servidor SMTP')
    .max(255, 'Servidor muito longo')
    .regex(/^[A-Za-z0-9.-]+$/, 'Servidor SMTP inválido (ex.: smtp.resend.com)')
    .optional(),
  smtp_porta: z.number().int('Use um número inteiro').min(1, 'Porta entre 1 e 65535').max(65535, 'Porta entre 1 e 65535').optional(),
  smtp_seguro: z.boolean().optional(),
  smtp_usuario: z.string().trim().min(1, 'Informe o usuário do SMTP').max(255, 'Usuário muito longo').optional(),
  /** Vazio/ausente = mantém a senha (API key) atual. */
  smtp_senha: z.string().trim().max(1000, 'Senha muito longa').optional(),
  remetente_nome: z
    .string()
    .trim()
    .min(1, 'Informe o nome do remetente')
    .max(100, 'Máximo de 100 caracteres')
    .refine((v) => !/[\r\n<>"]/.test(v), 'O nome do remetente não pode ter quebras de linha, aspas nem < >')
    .optional(),
  remetente_email: emailOuVazio,
  responder_para: emailOuVazio,
});
export type CorpoConfiguracaoT = z.infer<typeof CorpoConfiguracao>;

export const CorpoTestarConfiguracao = z.object({ para: email('Informe um e-mail válido para o teste') });

const assunto = z.string().max(200, 'Assunto: máximo de 200 caracteres');
const corpo = z.string().max(10_000, 'Corpo: máximo de 10.000 caracteres');
const textoBotao = z.string().max(60, 'Texto do botão: máximo de 60 caracteres');

export const CorpoModelo = z.object({
  assunto: assunto.trim().min(1, 'Informe o assunto'),
  corpo: corpo.trim().min(1, 'Informe o corpo do e-mail'),
  texto_botao: textoBotao.trim().min(1, 'Informe o texto do botão'),
  ativo: z.boolean(),
});

/** Pré-visualização: aceita campos vazios (o editor chama enquanto a pessoa digita). */
export const CorpoPrevia = z.object({ assunto, corpo, texto_botao: textoBotao });

export const CorpoTesteModelo = CorpoPrevia.extend({ para: email('Informe um e-mail válido para o teste') });

export const ConsultaEnvios = z.object({
  tipo: tipoEmail.optional(),
  status: statusEmail.optional(),
  busca: z.string().trim().max(200, 'Busca muito longa').optional(),
  pagina: z.coerce.number().int().min(1, 'Página inválida').default(1),
  por_pagina: z.coerce.number().int().min(1).max(100, 'Máximo de 100 por página').default(20),
});
