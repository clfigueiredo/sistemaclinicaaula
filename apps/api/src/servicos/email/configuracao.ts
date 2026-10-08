/**
 * Configuração do envio de e-mail (linha única de `configuracao_email`, id = 1) e modelos editáveis.
 * Acesso só pelo prisma cru (tabelas de plataforma).
 */
import type { ConfiguracaoEmail, ModeloEmail, TipoEmail } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { descriptografar } from '../../utils/cripto';
import { CATALOGO_EMAILS } from './modelosPadrao';
import type { ConteudoModelo } from './renderizar';
import type { ConfigSmtp } from './tipos';

export const ID_CONFIGURACAO_EMAIL = 1;

export async function obterConfiguracaoEmail(): Promise<ConfiguracaoEmail> {
  return prisma.configuracaoEmail.upsert({
    where: { id: ID_CONFIGURACAO_EMAIL },
    create: { id: ID_CONFIGURACAO_EMAIL },
    update: {},
  });
}

/** Converte a linha do banco em ConfigSmtp. null = incompleta (sem senha ou sem remetente). */
export function paraConfigSmtp(c: ConfiguracaoEmail): ConfigSmtp | null {
  if (!c.smtp_senha_cifrada || !c.remetente_email || !c.smtp_host) return null;
  return {
    host: c.smtp_host,
    porta: c.smtp_porta,
    seguro: c.smtp_seguro,
    usuario: c.smtp_usuario,
    senha: descriptografar(c.smtp_senha_cifrada),
    remetenteNome: c.remetente_nome,
    remetenteEmail: c.remetente_email,
    responderPara: c.responder_para,
  };
}

/** Config pronta para enviar, ou null se o envio estiver desligado/incompleto. */
export async function configSmtpAtiva(): Promise<ConfigSmtp | null> {
  const c = await prisma.configuracaoEmail.findUnique({ where: { id: ID_CONFIGURACAO_EMAIL } });
  if (!c || !c.ativo) return null;
  return paraConfigSmtp(c);
}

export type ModeloEfetivo = ConteudoModelo & { ativo: boolean; personalizado: boolean; atualizado_em: Date | null };

function efetivo(tipo: TipoEmail, linha: ModeloEmail | null): ModeloEfetivo {
  const definicao = CATALOGO_EMAILS[tipo];
  if (!linha) return { ...definicao.padrao, ativo: true, personalizado: false, atualizado_em: null };
  return {
    assunto: linha.assunto,
    corpo: linha.corpo,
    texto_botao: linha.texto_botao,
    // Modelo que não pode ser desligado fica sempre ativo, mesmo se o banco disser o contrário.
    ativo: definicao.desligavel ? linha.ativo : true,
    personalizado: true,
    atualizado_em: linha.atualizado_em,
  };
}

/** Modelo em uso: o editado no painel ou, se não houver, o padrão do código. */
export async function obterModeloEmail(tipo: TipoEmail): Promise<ModeloEfetivo> {
  return efetivo(tipo, await prisma.modeloEmail.findUnique({ where: { tipo } }));
}

export async function listarModelosEmail(): Promise<Array<ModeloEfetivo & { tipo: TipoEmail }>> {
  const linhas = await prisma.modeloEmail.findMany();
  const porTipo = new Map(linhas.map((l) => [l.tipo, l]));
  return (Object.keys(CATALOGO_EMAILS) as TipoEmail[]).map((tipo) => ({ tipo, ...efetivo(tipo, porTipo.get(tipo) ?? null) }));
}
