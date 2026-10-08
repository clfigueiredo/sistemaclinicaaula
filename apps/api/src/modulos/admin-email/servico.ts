/**
 * Regras do módulo admin-email: visão da configuração (sem segredo), validação de variáveis dos modelos,
 * envio DIRETO de e-mails de teste (sem fila) e reenfileiramento de envios que falharam.
 * Tabelas de plataforma ⇒ prisma cru.
 */
import type { ConfiguracaoEmail, Prisma, TipoEmail } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import {
  CATALOGO_EMAILS,
  emailService,
  ErroProvedorEmail,
  linksSistema,
  montarEmail,
  obterConfiguracaoEmail,
  paraConfigSmtp,
  type ConfigSmtp,
  type MensagemEmail,
} from '../../servicos/email';
import type { ModeloEfetivo } from '../../servicos/email/configuracao';
import { TENTATIVAS_EMAIL } from '../../servicos/email/envio';
import type { ConteudoModelo } from '../../servicos/email/renderizar';
import { NOMES_FILAS, obterFila, type JobEnvioEmail } from '../../servicos/filas';
import { criptografar, ErroCripto, finalSegredo } from '../../utils/cripto';
import { ErroNegocio } from '../../utils/erros';
import type { CorpoConfiguracaoT } from './esquemas';

// ----------------------------------------------------------------------------- configuração

/** Configuração para o painel. A senha (API key) NUNCA volta: só se existe e os últimos 4 caracteres. */
export function visaoConfiguracao(c: ConfiguracaoEmail) {
  const senhaDefinida = !!c.smtp_senha_cifrada;
  return {
    ativo: c.ativo,
    smtp_host: c.smtp_host,
    smtp_porta: c.smtp_porta,
    smtp_seguro: c.smtp_seguro,
    smtp_usuario: c.smtp_usuario,
    senha_definida: senhaDefinida,
    senha_mascarada: senhaDefinida ? `••••${c.smtp_senha_final ?? ''}` : '',
    remetente_nome: c.remetente_nome,
    remetente_email: c.remetente_email,
    responder_para: c.responder_para,
    /** Tem tudo o que é preciso para enviar (senha + remetente). */
    completa: senhaDefinida && !!c.remetente_email && !!c.smtp_host,
    atualizado_em: c.atualizado_em,
  };
}

export async function salvarConfiguracao(corpo: CorpoConfiguracaoT) {
  const atual = await obterConfiguracaoEmail();
  const novaSenha = corpo.smtp_senha && corpo.smtp_senha.length ? corpo.smtp_senha : null;
  const remetenteEmail = corpo.remetente_email !== undefined ? corpo.remetente_email : atual.remetente_email;
  const ativo = corpo.ativo ?? atual.ativo;

  // Trocar o servidor sem digitar a senha de novo mandaria a API key salva para outro host (ex.: token de super admin
  // roubado apontando o SMTP para um servidor do atacante e clicando em "testar").
  const servidorMudou =
    (corpo.smtp_host !== undefined && corpo.smtp_host !== atual.smtp_host) ||
    (corpo.smtp_porta !== undefined && corpo.smtp_porta !== atual.smtp_porta) ||
    (corpo.smtp_usuario !== undefined && corpo.smtp_usuario !== atual.smtp_usuario);
  if (servidorMudou && !novaSenha && atual.smtp_senha_cifrada) {
    throw new ErroNegocio(
      400,
      'senha_obrigatoria',
      'Ao trocar o servidor, a porta ou o usuário do SMTP, informe a senha (API key) de novo.',
    );
  }

  if (ativo) {
    const faltando: string[] = [];
    if (!novaSenha && !atual.smtp_senha_cifrada) faltando.push('a senha (API key) do SMTP');
    if (!remetenteEmail) faltando.push('o e-mail do remetente');
    if (faltando.length) {
      throw new ErroNegocio(
        400,
        'configuracao_incompleta',
        `Para ativar o envio de e-mails, informe ${faltando.join(' e ')}.`,
      );
    }
  }

  const dados: Prisma.ConfiguracaoEmailUpdateInput = {
    ativo,
    ...(corpo.smtp_host !== undefined && { smtp_host: corpo.smtp_host }),
    ...(corpo.smtp_porta !== undefined && { smtp_porta: corpo.smtp_porta }),
    ...(corpo.smtp_seguro !== undefined && { smtp_seguro: corpo.smtp_seguro }),
    ...(corpo.smtp_usuario !== undefined && { smtp_usuario: corpo.smtp_usuario }),
    ...(corpo.remetente_nome !== undefined && { remetente_nome: corpo.remetente_nome }),
    ...(corpo.remetente_email !== undefined && { remetente_email: corpo.remetente_email }),
    ...(corpo.responder_para !== undefined && { responder_para: corpo.responder_para }),
    ...(novaSenha && { smtp_senha_cifrada: criptografar(novaSenha), smtp_senha_final: finalSegredo(novaSenha) || null }),
  };
  return prisma.configuracaoEmail.update({ where: { id: atual.id }, data: dados });
}

/** Config SALVA pronta para um envio de teste (mesmo com o envio desativado). Incompleta ⇒ 409. */
export async function configParaTeste(): Promise<{ config: ConfigSmtp; remetenteNome: string }> {
  const linha = await obterConfiguracaoEmail();
  let config: ConfigSmtp | null;
  try {
    config = paraConfigSmtp(linha);
  } catch (e) {
    if (e instanceof ErroCripto) {
      throw new ErroNegocio(
        409,
        'senha_ilegivel',
        'Não foi possível decifrar a senha salva (a CHAVE_CRIPTOGRAFIA mudou?). Informe a senha (API key) novamente.',
      );
    }
    throw e;
  }
  if (!config) {
    throw new ErroNegocio(
      409,
      'configuracao_incompleta',
      'Salve a senha (API key) do SMTP e o e-mail do remetente antes de enviar um teste.',
    );
  }
  return { config, remetenteNome: linha.remetente_nome };
}

/** Envia direto pelo provedor (sem fila nem histórico). Falha do SMTP ⇒ 422 `falha_smtp`. */
export async function enviarDireto(config: ConfigSmtp, mensagem: MensagemEmail, verificarAntes = false): Promise<void> {
  try {
    if (verificarAntes) await emailService.verificar(config);
    await emailService.enviar(config, mensagem);
  } catch (e) {
    const texto = e instanceof ErroProvedorEmail ? e.message : `Falha no SMTP: ${(e as Error).message ?? 'erro desconhecido'}`;
    throw new ErroNegocio(422, 'falha_smtp', texto.slice(0, 500));
  }
}

/** E-mail do botão "Enviar e-mail de teste" da configuração (layout padrão, texto próprio). */
export function montarEmailDeTesteConfiguracao(remetenteNome: string) {
  const modelo: ConteudoModelo = {
    assunto: 'Teste de envio de e-mail — {remetente}',
    corpo: [
      'Olá!',
      'Este é um **e-mail de teste** enviado pelo painel do super admin para conferir a configuração do SMTP.',
      'Se você recebeu esta mensagem na caixa de entrada (e não no spam), está tudo certo.',
    ].join('\n\n'),
    texto_botao: 'Acessar o sistema',
  };
  return montarEmail('boas_vindas', modelo, { remetente: remetenteNome, link_acesso: linksSistema().acesso }, remetenteNome);
}

// ----------------------------------------------------------------------------- modelos

const RE_VARIAVEL = /\{([A-Za-z0-9_]+)\}/g;

/** Nomes de `{variavel}` usados nos textos que não existem para o tipo. */
export function variaveisDesconhecidas(tipo: TipoEmail, textos: string[]): string[] {
  const validas = new Set(CATALOGO_EMAILS[tipo].variaveis.map((v) => v.nome));
  const invalidas = new Set<string>();
  for (const texto of textos) {
    for (const m of texto.matchAll(RE_VARIAVEL)) {
      if (!validas.has(m[1]!)) invalidas.add(m[1]!);
    }
  }
  return [...invalidas];
}

export function assegurarVariaveisValidas(tipo: TipoEmail, modelo: ConteudoModelo): void {
  const invalidas = variaveisDesconhecidas(tipo, [modelo.assunto, modelo.corpo, modelo.texto_botao]);
  if (invalidas.length) {
    throw new ErroNegocio(
      400,
      'variavel_desconhecida',
      `Variável(is) desconhecida(s) neste e-mail: ${invalidas.map((v) => `{${v}}`).join(', ')}. Use só as variáveis listadas.`,
      { variaveis: invalidas },
    );
  }
}

export function visaoModelo(tipo: TipoEmail, efetivo: ModeloEfetivo) {
  const d = CATALOGO_EMAILS[tipo];
  return {
    tipo,
    nome: d.nome,
    descricao: d.descricao,
    desligavel: d.desligavel,
    variaveis: d.variaveis,
    variavelLink: d.variavelLink,
    assunto: efetivo.assunto,
    corpo: efetivo.corpo,
    texto_botao: efetivo.texto_botao,
    ativo: efetivo.ativo,
    personalizado: efetivo.personalizado,
    atualizado_em: efetivo.atualizado_em,
    padrao: d.padrao,
  };
}

// ----------------------------------------------------------------------------- reenvio

export type ReenfileiradorEmail = (emailId: string) => Promise<void>;

/** jobId diferente do original (o job com id = emailId já existe/existiu no BullMQ). */
const reenfileiradorPadrao: ReenfileiradorEmail = async (emailId) => {
  await obterFila<JobEnvioEmail>(NOMES_FILAS.EMAILS).add(
    'enviar',
    { emailId },
    { jobId: `${emailId}-r${Date.now()}`, attempts: TENTATIVAS_EMAIL, backoff: { type: 'exponential', delay: 60_000 } },
  );
};

let reenfileirador: ReenfileiradorEmail = reenfileiradorPadrao;

/** Troca o reenfileirador (testes). null = volta ao BullMQ. */
export function definirReenfileiradorEmail(novo: ReenfileiradorEmail | null): void {
  reenfileirador = novo ?? reenfileiradorPadrao;
}

export async function reenviarEmail(id: string) {
  const email = await prisma.emailEnviado.findUnique({ where: { id }, select: { id: true, status: true, tipo: true } });
  if (!email) throw new ErroNegocio(404, 'nao_encontrado', 'E-mail não encontrado.');
  if (email.tipo === 'redefinir_senha') {
    throw new ErroNegocio(
      409,
      'reenvio_indisponivel',
      'Links de redefinição de senha não são reenviados (o link é de uso único e o histórico guarda só a versão mascarada). Peça ao usuário para usar "Esqueci minha senha" de novo.',
    );
  }
  if (email.status !== 'falhou' && email.status !== 'ignorado') {
    throw new ErroNegocio(409, 'status_invalido', 'Só é possível reenviar e-mails com falha ou ignorados.');
  }
  const linha = await obterConfiguracaoEmail();
  if (!linha.ativo || !linha.smtp_senha_cifrada || !linha.remetente_email) {
    throw new ErroNegocio(
      409,
      'email_desativado',
      'O envio de e-mails está desativado ou incompleto. Ative-o na aba Configuração antes de reenviar.',
    );
  }
  // Condicional no status: dois cliques seguidos não enfileiram duas vezes.
  const { count } = await prisma.emailEnviado.updateMany({
    where: { id, status: { in: ['falhou', 'ignorado'] } },
    data: { status: 'pendente', erro: null },
  });
  if (count === 0) throw new ErroNegocio(409, 'status_invalido', 'Este e-mail já está sendo reenviado.');
  try {
    await reenfileirador(id);
  } catch (e) {
    await prisma.emailEnviado.update({
      where: { id },
      data: { status: 'falhou', erro: `fila_indisponivel: ${(e as Error).message}`.slice(0, 500) },
    });
    throw new ErroNegocio(503, 'fila_indisponivel', 'Não foi possível colocar o e-mail na fila de envio. Tente de novo em instantes.');
  }
}
