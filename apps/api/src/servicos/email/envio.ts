/**
 * ============================================================================
 * Envio de e-mail — SEMPRE pela fila (mesmo princípio do WhatsApp).
 * ============================================================================
 *
 *   enfileirarEmail(...)     → monta o e-mail com o modelo em uso, grava `emails_enviados` (pendente) e põe um job na
 *                              fila NOMES_FILAS.EMAILS (jobId = id do registro). NUNCA lança: devolve o resultado.
 *                              Chame DEPOIS do commit da transação do seu módulo — e-mail nunca derruba o fluxo principal.
 *                              - (tipo, referencia, destinatario) já existe ⇒ `duplicado` (webhook repetido não reenvia);
 *                              - modelo desligado no painel ⇒ grava `ignorado` (erro `modelo_desligado`);
 *                              - envio desligado/incompleto em /admin/email ⇒ grava `ignorado` (erro `email_desativado`).
 *   processarEnvioEmail(id)  → executado pelo worker. pendente → enviado | falhou. Falha temporária lança (o BullMQ
 *                              tenta de novo, até 5 vezes); definitiva ou última tentativa ⇒ `falhou` com o motivo.
 *
 * Idempotência: antes de chamar o provedor gravamos erro = 'enviando'; se um retry encontrar esse marcador (o processo
 * morreu no meio do envio), o registro vira `falhou/envio_incerto` em vez de reenviar.
 * ============================================================================
 */
import { Prisma, type StatusEmail, type TipoEmail } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { NOMES_FILAS, obterFila, type JobEnvioEmail } from '../filas';
import { configSmtpAtiva, obterConfiguracaoEmail, obterModeloEmail } from './configuracao';
import { emailService } from './emailService';
import { CATALOGO_EMAILS } from './modelosPadrao';
import { montarEmail } from './renderizar';
import { ErroProvedorEmail } from './tipos';

export const TENTATIVAS_EMAIL = 5;

/**
 * Links com `token=` (ex.: redefinição de senha) não ficam legíveis no histórico: o conteúdo real só existe enquanto
 * o e-mail está `pendente`; ao virar enviado/falhou/ignorado o token é mascarado (o banco guarda só o hash do token).
 */
export function mascararTokensConteudo(texto: string): string {
  return texto.replace(/([?&](?:amp;)?token=)[A-Za-z0-9_\-%.~]+/g, '$1••••');
}

function conteudoMascarado(email: { html: string; texto: string }): { html: string; texto: string } | Record<string, never> {
  const html = mascararTokensConteudo(email.html);
  const texto = mascararTokensConteudo(email.texto);
  return html === email.html && texto === email.texto ? {} : { html, texto };
}
const MARCADOR_ENVIANDO = 'enviando';

// ----------------------------------------------------------------------------
// Enfileirador (injetável nos testes)
// ----------------------------------------------------------------------------

export type EnfileiradorEmail = (job: JobEnvioEmail) => Promise<void>;

/** A conexão Redis espera reconectar para sempre (maxRetriesPerRequest: null): sem limite, um Redis fora do ar
 * penduraria o webhook do gateway e o job de cobranças. */
const TIMEOUT_ENFILEIRAR_MS = 5_000;

const enfileiradorPadrao: EnfileiradorEmail = async (job) => {
  let temporizador: NodeJS.Timeout | undefined;
  const limite = new Promise<never>((_, rejeitar) => {
    temporizador = setTimeout(() => rejeitar(new Error('Redis não respondeu a tempo')), TIMEOUT_ENFILEIRAR_MS);
  });
  try {
    await Promise.race([
      obterFila<JobEnvioEmail>(NOMES_FILAS.EMAILS).add('enviar', job, {
        jobId: job.emailId,
        attempts: TENTATIVAS_EMAIL,
        backoff: { type: 'exponential', delay: 60_000 },
      }),
      limite,
    ]);
  } finally {
    clearTimeout(temporizador);
  }
};

let enfileirador: EnfileiradorEmail = enfileiradorPadrao;

/** Troca o enfileirador (testes). null = volta ao BullMQ. */
export function definirEnfileiradorEmail(novo: EnfileiradorEmail | null): void {
  enfileirador = novo ?? enfileiradorPadrao;
}

// ----------------------------------------------------------------------------
// Enfileirar
// ----------------------------------------------------------------------------

export type NovoEmail = {
  tipo: TipoEmail;
  para: string;
  /** Valores das variáveis do modelo (ver CATALOGO_EMAILS[tipo].variaveis). */
  variaveis: Record<string, string>;
  /** Chave de idempotência (id da cobrança, do usuário, do token…). Sem ela não há controle de duplicidade. */
  referencia?: string | null;
  clinicaId?: string | null;
};

export type ResultadoEnfileirar =
  | { status: 'enfileirado'; id: string }
  | { status: 'ignorado'; id: string; motivo: string }
  | { status: 'duplicado' }
  | { status: 'erro'; motivo: string };

async function gravar(dados: NovoEmail, montado: { assunto: string; html: string; texto: string }, status: StatusEmail, erro?: string) {
  return prisma.emailEnviado.create({
    data: {
      tipo: dados.tipo,
      referencia: dados.referencia ?? null,
      clinica_id: dados.clinicaId ?? null,
      destinatario: dados.para.trim().toLowerCase(),
      assunto: montado.assunto,
      // Registro que já nasce ignorado nunca vai ser enviado: guarda o conteúdo sem tokens.
      html: status === 'pendente' ? montado.html : mascararTokensConteudo(montado.html),
      texto: status === 'pendente' ? montado.texto : mascararTokensConteudo(montado.texto),
      status,
      erro: erro ?? null,
    },
  });
}

export async function enfileirarEmail(dados: NovoEmail): Promise<ResultadoEnfileirar> {
  try {
    if (!dados.para || !dados.para.includes('@')) return { status: 'erro', motivo: 'destinatario_invalido' };
    const [config, modelo] = await Promise.all([obterConfiguracaoEmail(), obterModeloEmail(dados.tipo)]);
    const montado = montarEmail(dados.tipo, modelo, dados.variaveis, config.remetente_nome);

    let motivoIgnorado: string | null = null;
    if (!modelo.ativo && CATALOGO_EMAILS[dados.tipo].desligavel) motivoIgnorado = 'modelo_desligado';
    else if (!config.ativo || !config.smtp_senha_cifrada || !config.remetente_email) motivoIgnorado = 'email_desativado';

    const registro = await gravar(dados, montado, motivoIgnorado ? 'ignorado' : 'pendente', motivoIgnorado ?? undefined);
    if (motivoIgnorado) return { status: 'ignorado', id: registro.id, motivo: motivoIgnorado };

    try {
      await enfileirador({ emailId: registro.id });
    } catch (erro) {
      await prisma.emailEnviado.update({
        where: { id: registro.id },
        data: { status: 'falhou', erro: `fila_indisponivel: ${(erro as Error).message}`.slice(0, 500) },
      });
      return { status: 'erro', motivo: 'fila_indisponivel' };
    }
    return { status: 'enfileirado', id: registro.id };
  } catch (erro) {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002') return { status: 'duplicado' };
    console.error(`[email] Falha ao enfileirar e-mail ${dados.tipo}:`, (erro as Error).message);
    return { status: 'erro', motivo: (erro as Error).message };
  }
}

// ----------------------------------------------------------------------------
// Processar (worker)
// ----------------------------------------------------------------------------

export type ResultadoProcessamento = { status: StatusEmail | 'nada'; erro?: string };

/**
 * Envia um e-mail pendente. `ultimaTentativa` = o BullMQ não vai tentar de novo (falha temporária ⇒ `falhou`).
 * Lança ErroProvedorEmail temporário quando ainda há tentativas (o worker repassa ao BullMQ).
 */
export async function processarEnvioEmail(emailId: string, ultimaTentativa = true): Promise<ResultadoProcessamento> {
  const email = await prisma.emailEnviado.findUnique({ where: { id: emailId } });
  if (!email || email.status !== 'pendente') return { status: 'nada' };

  if (email.erro === MARCADOR_ENVIANDO) {
    await prisma.emailEnviado.update({
      where: { id: email.id },
      data: { status: 'falhou', erro: 'envio_incerto', ...conteudoMascarado(email) },
    });
    return { status: 'falhou', erro: 'envio_incerto' };
  }

  let config: Awaited<ReturnType<typeof configSmtpAtiva>>;
  try {
    config = await configSmtpAtiva();
  } catch {
    // Senha do SMTP ilegível (CHAVE_CRIPTOGRAFIA trocada): não adianta tentar de novo.
    await prisma.emailEnviado.update({
      where: { id: email.id },
      data: { status: 'falhou', erro: 'senha_ilegivel', ...conteudoMascarado(email) },
    });
    return { status: 'falhou', erro: 'senha_ilegivel' };
  }
  if (!config) {
    await prisma.emailEnviado.update({
      where: { id: email.id },
      data: { status: 'ignorado', erro: 'email_desativado', ...conteudoMascarado(email) },
    });
    return { status: 'ignorado', erro: 'email_desativado' };
  }

  await prisma.emailEnviado.update({
    where: { id: email.id },
    data: { erro: MARCADOR_ENVIANDO, tentativas: { increment: 1 } },
  });
  try {
    const { idExterno } = await emailService.enviar(config, {
      para: email.destinatario,
      assunto: email.assunto,
      html: email.html,
      texto: email.texto,
    });
    await prisma.emailEnviado.update({
      where: { id: email.id },
      data: { status: 'enviado', erro: null, id_externo: idExterno, enviado_em: new Date(), ...conteudoMascarado(email) },
    });
    return { status: 'enviado' };
  } catch (erro) {
    const temporaria = erro instanceof ErroProvedorEmail ? erro.temporaria : true;
    const mensagem = ((erro as Error).message || 'falha_envio').slice(0, 500);
    if (temporaria && !ultimaTentativa) {
      await prisma.emailEnviado.update({ where: { id: email.id }, data: { erro: mensagem } });
      throw erro;
    }
    await prisma.emailEnviado.update({
      where: { id: email.id },
      data: { status: 'falhou', erro: mensagem, ...conteudoMascarado(email) },
    });
    return { status: 'falhou', erro: mensagem };
  }
}
