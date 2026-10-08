/**
 * E-mails transacionais da cobrança do SaaS (montagem das variáveis + destinatários). Chamado pelo servico.ts:
 *
 *   - `pagamento_confirmado`: primeira confirmação de uma cobrança de CONTRATAÇÃO (`plano_contratado_id`) que de fato
 *     liberou o plano (assinatura não estava `cancelada`/`bloqueada` manualmente). Webhook ou baixa manual.
 *   - `pagamento_renovado`: primeira confirmação de uma MENSALIDADE (sem `plano_contratado_id`). É um recibo: sai
 *     mesmo se a assinatura continuar vencida por OUTRA dívida ou estiver com status manual. Não sai para cobrança
 *     CANCELADA nem para pagamento sandbox ignorado (o servico.ts retorna antes de confirmar).
 *     `{parcela}` = nº de cobranças `paga` da clínica (inclui a contratação) com ordem (vencimento, criado_em) ≤ a
 *     desta — calculado no envio; estornadas não contam.
 *   - `aviso_renovacao`: job diário de cobranças (`enfileirarAvisosRenovacao`), mensalidades `pendente` com link
 *     que vencem em DIAS_AVISO_RENOVACAO dias. `data_bloqueio` = vencimento + tolerância do gateway da cobrança.
 *
 * Destinatários: admin principal da clínica (admin ativo mais antigo — o mesmo critério do limite de equipe em
 * plugins/recursos.ts) + `clinicas.email`, se diferente (sem diferenciar maiúsculas). Um enfileiramento por
 * destinatário, com `referencia` = id da cobrança ⇒ idempotente (webhook repetido / job rodando 2× não duplica).
 *
 * Tudo aqui roda DEPOIS do commit e NUNCA lança: e-mail não derruba webhook, baixa manual nem o job.
 */
import type { TipoEmail } from '@prisma/client';
import { env } from '../../config/env';
import { prisma } from '../../lib/prisma';
import { dataSemHora, paraDataIso } from '../../servicos/financeiroComum';
import { enfileirarEmail, formatoEmail, linksSistema } from '../../servicos/email';
import { proximoVencimento, somarDias, TOLERANCIA_PADRAO_DIAS } from './servico';

/** Antecedência (em dias) do aviso de renovação em relação ao vencimento da mensalidade. */
export const DIAS_AVISO_RENOVACAO = 2;

const SEM_VALOR = '—';

export type TipoEmailCobranca = Extract<TipoEmail, 'pagamento_confirmado' | 'pagamento_renovado'>;
/** E-mail a disparar depois do commit da confirmação de pagamento. */
export type EmailCobranca = { cobrancaId: string; tipo: TipoEmailCobranca };

type Log = { info: (msg: string) => void; warn: (msg: string) => void };

// ----------------------------------------------------------------------------- dados comuns

type ClinicaEmail = { id: string; nome: string; responsavel: string | null; email: string | null; fuso_horario: string };

type Destinatarios = { emails: string[]; responsavel: string };

/** Admin principal (admin ativo mais antigo) + e-mail cadastral da clínica, sem repetir. */
async function destinatariosDaClinica(clinica: ClinicaEmail): Promise<Destinatarios> {
  const admin = await prisma.usuario.findFirst({
    where: { clinica_id: clinica.id, papel: 'admin', ativo: true },
    orderBy: [{ criado_em: 'asc' }, { id: 'asc' }],
    select: { nome: true, email: true },
  });
  const candidatos = [admin?.email, clinica.email].map((e) => e?.trim()).filter((e): e is string => !!e && e.includes('@'));
  const emails = candidatos.filter((e, i) => candidatos.findIndex((o) => o.toLowerCase() === e.toLowerCase()) === i);
  const responsavel = clinica.responsavel?.trim() || admin?.nome?.trim() || clinica.nome;
  return { emails, responsavel };
}

/** Data de coluna @db.Date ('YYYY-MM-DD' ou Date em UTC 00:00) em pt-BR. */
function dataCivil(d: Date | string): string {
  return formatoEmail.data(typeof d === 'string' ? dataSemHora(d) : d);
}

/** Próxima mensalidade: o dia de vencimento da assinatura no mês seguinte ao vencimento pago. */
function proximaMensalidade(vencimentoPago: Date, diaVencimento: number | null): string {
  if (!diaVencimento) return SEM_VALOR;
  return dataCivil(proximoVencimento(somarDias(paraDataIso(vencimentoPago), 1), diaVencimento));
}

/** Nº da parcela: cobranças pagas da clínica com ordem (vencimento, criado_em) ≤ a desta. */
async function numeroDaParcela(c: { clinica_id: string; vencimento: Date; criado_em: Date }): Promise<number> {
  return prisma.cobranca.count({
    where: {
      clinica_id: c.clinica_id,
      // Parcela = posição do ciclo: conta as pagas e as mensalidades ainda em aberto (pagar janeiro depois de fevereiro
      // não repete número). Contratação não paga, canceladas e estornadas não contam.
      AND: [
        { OR: [{ status: 'paga' }, { status: { in: ['pendente', 'vencida'] }, plano_contratado_id: null }] },
        { OR: [{ vencimento: { lt: c.vencimento } }, { vencimento: c.vencimento, criado_em: { lte: c.criado_em } }] },
      ],
    },
  });
}

async function enfileirarParaTodos(
  tipo: TipoEmail,
  clinicaId: string,
  referencia: string,
  emails: string[],
  variaveis: Record<string, string>,
): Promise<number> {
  let enfileirados = 0;
  for (const para of emails) {
    const r = await enfileirarEmail({ tipo, para, variaveis, referencia, clinicaId });
    if (r.status === 'enfileirado') enfileirados++;
    else if (r.status === 'erro') console.warn(`[cobrancas] E-mail ${tipo} da cobrança ${referencia} não enfileirado: ${r.motivo}`);
  }
  return enfileirados;
}

// ----------------------------------------------------------------------------- confirmação de pagamento

async function dispararEmailCobranca({ cobrancaId, tipo }: EmailCobranca): Promise<void> {
  const cobranca = await prisma.cobranca.findUnique({
    where: { id: cobrancaId },
    include: {
      clinica: {
        select: {
          id: true,
          nome: true,
          responsavel: true,
          email: true,
          fuso_horario: true,
          assinatura: { include: { plano: { select: { nome: true } } } },
        },
      },
      plano_contratado: { select: { nome: true } },
    },
  });
  if (!cobranca || cobranca.status !== 'paga') return;
  const { clinica } = cobranca;
  const assinatura = clinica.assinatura;
  const { emails, responsavel } = await destinatariosDaClinica(clinica);
  if (!emails.length) return;

  const comuns = {
    responsavel,
    clinica: clinica.nome,
    valor: formatoEmail.moeda(cobranca.valor),
    data_pagamento: formatoEmail.data(cobranca.pago_em ?? new Date(), clinica.fuso_horario),
    // expira_em é o fim do dia no fuso padrão da plataforma (fimDoCicloPago): formatado nesse fuso.
    expira_em: assinatura?.expira_em ? formatoEmail.data(assinatura.expira_em, env.TZ_PADRAO) : SEM_VALOR,
    proximo_vencimento: proximaMensalidade(cobranca.vencimento, assinatura?.dia_vencimento ?? null),
    link_acesso: linksSistema().acesso,
  };
  const planoAtual = assinatura?.plano.nome ?? SEM_VALOR;
  const variaveis =
    tipo === 'pagamento_confirmado'
      ? { ...comuns, plano: cobranca.plano_contratado?.nome ?? planoAtual }
      : { ...comuns, plano: planoAtual, parcela: String(await numeroDaParcela(cobranca)) };
  await enfileirarParaTodos(tipo, clinica.id, cobranca.id, emails, variaveis);
}

/** Dispara (enfileira) os e-mails das confirmações de pagamento. Chamar DEPOIS do commit. Nunca lança. */
export async function dispararEmailsCobranca(lista: readonly EmailCobranca[]): Promise<void> {
  for (const item of lista) {
    try {
      await dispararEmailCobranca(item);
    } catch (e) {
      console.error(`[cobrancas] Falha ao enfileirar e-mail ${item.tipo} da cobrança ${item.cobrancaId}:`, (e as Error).message);
    }
  }
}

// ----------------------------------------------------------------------------- aviso de renovação (job diário)

/**
 * Enfileira o `aviso_renovacao` das mensalidades pendentes (com link) que vencem em hoje + DIAS_AVISO_RENOVACAO.
 * Idempotente (referencia = id da cobrança). Devolve quantos e-mails foram enfileirados agora. Nunca lança.
 */
export async function enfileirarAvisosRenovacao(hoje: string, log: Log = console): Promise<number> {
  try {
    const vencimento = somarDias(hoje, DIAS_AVISO_RENOVACAO);
    const [cobrancas, gateways] = await Promise.all([
      prisma.cobranca.findMany({
        where: {
          status: 'pendente',
          plano_contratado_id: null,
          link_pagamento: { not: null },
          vencimento: dataSemHora(vencimento),
          clinica: { status: 'ativa' },
        },
        include: {
          clinica: {
            select: {
              id: true,
              nome: true,
              responsavel: true,
              email: true,
              fuso_horario: true,
              assinatura: { select: { plano: { select: { nome: true } } } },
            },
          },
        },
      }),
      prisma.gatewayPagamento.findMany({ select: { provedor: true, dias_tolerancia: true } }),
    ]);
    const tolerancias = new Map(gateways.map((g) => [g.provedor, g.dias_tolerancia]));

    let enfileirados = 0;
    for (const c of cobrancas) {
      if (!c.link_pagamento?.trim()) continue;
      try {
        const { emails, responsavel } = await destinatariosDaClinica(c.clinica);
        const tolerancia = tolerancias.get(c.gateway) ?? TOLERANCIA_PADRAO_DIAS;
        enfileirados += await enfileirarParaTodos('aviso_renovacao', c.clinica.id, c.id, emails, {
          responsavel,
          clinica: c.clinica.nome,
          plano: c.clinica.assinatura?.plano.nome ?? SEM_VALOR,
          valor: formatoEmail.moeda(c.valor),
          vencimento: dataCivil(c.vencimento),
          data_bloqueio: dataCivil(somarDias(paraDataIso(c.vencimento), tolerancia)),
          link_fatura: c.link_pagamento,
        });
      } catch (e) {
        log.warn(`[cobrancas] Falha no aviso de renovação da cobrança ${c.id}: ${(e as Error).message}`);
      }
    }
    if (enfileirados) log.info(`[cobrancas] ${enfileirados} aviso(s) de renovação enfileirado(s).`);
    return enfileirados;
  } catch (e) {
    log.warn(`[cobrancas] Falha ao buscar mensalidades para o aviso de renovação: ${(e as Error).message}`);
    return 0;
  }
}
