/**
 * Módulo admin-email — configuração do envio, modelos editáveis e histórico de e-mails (super admin).
 *
 * Dados de PLATAFORMA (prisma cru): configuracao_email (linha única), modelos_email, emails_enviados.
 * Envio sempre por servicos/email (o resto do sistema usa `enfileirarEmail`; aqui só os botões de TESTE
 * chamam o `emailService` direto, sem fila nem histórico). Senha/API key cifrada (utils/cripto.ts) e nunca
 * devolvida — só `senha_mascarada` ('••••1234').
 *
 * SUPER ADMIN (autenticarAdmin):
 *   GET    /admin/email/configuracao                 config sem a senha (+ senha_definida, senha_mascarada, completa)
 *   PUT    /admin/email/configuracao                 { ativo?, smtp_host?, smtp_porta?, smtp_seguro?, smtp_usuario?, smtp_senha?,
 *                                                      remetente_nome?, remetente_email?, responder_para? }
 *                                                      smtp_senha vazio/ausente = mantém; '' ou null em e-mail opcional = limpa.
 *                                                      ativo: true sem senha ou sem remetente_email ⇒ 400 configuracao_incompleta
 *   POST   /admin/email/configuracao/testar          { para } usa a config SALVA (mesmo desativada, desde que completa):
 *                                                      verifica a conexão e envia um e-mail de teste ⇒ { ok: true }
 *                                                      | 422 falha_smtp | 409 configuracao_incompleta. Rate limit 5/min.
 *   GET    /admin/email/modelos                      os 5 tipos (texto em uso + padrão + variáveis)
 *   PUT    /admin/email/modelos/:tipo                { assunto, corpo, texto_botao, ativo } ⇒ upsert. Não desligável ⇒ ativo
 *                                                      forçado true. Variável {x} desconhecida ⇒ 400 variavel_desconhecida
 *   DELETE /admin/email/modelos/:tipo                volta ao texto padrão ⇒ 204
 *   POST   /admin/email/modelos/:tipo/previa         { assunto, corpo, texto_botao } ⇒ { assunto, html, texto } (variáveis de exemplo)
 *   POST   /admin/email/modelos/:tipo/teste          { para, assunto, corpo, texto_botao } ⇒ envia direto com "[Teste] " no assunto.
 *                                                      Rate limit 5/min.
 *   GET    /admin/email/envios?tipo&status&busca&pagina&por_pagina   histórico paginado (sem html/texto), mais recentes primeiro
 *   GET    /admin/email/envios/:id                   detalhe com html e texto
 *   POST   /admin/email/envios/:id/reenviar          só falhou/ignorado ⇒ pendente + novo job na fila. Envio desativado ⇒ 409
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { autenticarAdmin } from '../../plugins/auth';
import {
  CATALOGO_EMAILS,
  listarModelosEmail,
  montarEmail,
  obterConfiguracaoEmail,
  obterModeloEmail,
  variaveisDeExemplo,
} from '../../servicos/email';
import { ou404 } from '../../utils/erros';
import { mascararTokensConteudo } from '../../servicos/email';
import {
  ConsultaEnvios,
  CorpoConfiguracao,
  CorpoModelo,
  CorpoPrevia,
  CorpoTesteModelo,
  CorpoTestarConfiguracao,
  ParamsId,
  ParamsTipo,
} from './esquemas';
import {
  assegurarVariaveisValidas,
  configParaTeste,
  enviarDireto,
  montarEmailDeTesteConfiguracao,
  reenviarEmail,
  salvarConfiguracao,
  visaoConfiguracao,
  visaoModelo,
} from './servico';

export const prefixo = '/admin/email';

const LIMITE_TESTE = { rateLimit: { max: 5, timeWindow: '1 minute' } };
const PREFIXO_TESTE = '[Teste] ';

const modulo: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', autenticarAdmin);

  // ---------------------------------------------------------------- configuração

  app.get('/configuracao', async () => visaoConfiguracao(await obterConfiguracaoEmail()));

  app.put('/configuracao', { schema: { body: CorpoConfiguracao } }, async (request) => {
    const salva = await salvarConfiguracao(request.body);
    request.log.info(
      { admin: request.adminPlataforma?.id, ativo: salva.ativo, senha_alterada: !!request.body.smtp_senha },
      'Configuração de e-mail alterada',
    );
    return visaoConfiguracao(salva);
  });

  app.post(
    '/configuracao/testar',
    { config: LIMITE_TESTE, schema: { body: CorpoTestarConfiguracao } },
    async (request) => {
      const { config, remetenteNome } = await configParaTeste();
      const montado = montarEmailDeTesteConfiguracao(remetenteNome);
      await enviarDireto(config, { para: request.body.para, ...montado }, true);
      request.log.info({ admin: request.adminPlataforma?.id }, 'E-mail de teste da configuração enviado');
      return { ok: true as const };
    },
  );

  // ---------------------------------------------------------------- modelos

  app.get('/modelos', async () => {
    const modelos = await listarModelosEmail();
    return modelos.map((m) => visaoModelo(m.tipo, m));
  });

  app.put('/modelos/:tipo', { schema: { params: ParamsTipo, body: CorpoModelo } }, async (request) => {
    const { tipo } = request.params;
    const { assunto, corpo, texto_botao, ativo } = request.body;
    assegurarVariaveisValidas(tipo, { assunto, corpo, texto_botao });
    // Modelo que não pode ser desligado (ex.: redefinição de senha) fica sempre ativo.
    const dados = { assunto, corpo, texto_botao, ativo: CATALOGO_EMAILS[tipo].desligavel ? ativo : true };
    await prisma.modeloEmail.upsert({ where: { tipo }, create: { tipo, ...dados }, update: dados });
    request.log.info({ admin: request.adminPlataforma?.id, tipo }, 'Modelo de e-mail alterado');
    return visaoModelo(tipo, await obterModeloEmail(tipo));
  });

  app.delete('/modelos/:tipo', { schema: { params: ParamsTipo } }, async (request, reply) => {
    const { tipo } = request.params;
    await prisma.modeloEmail.deleteMany({ where: { tipo } });
    request.log.info({ admin: request.adminPlataforma?.id, tipo }, 'Modelo de e-mail restaurado ao padrão');
    return reply.status(204).send();
  });

  app.post('/modelos/:tipo/previa', { schema: { params: ParamsTipo, body: CorpoPrevia } }, async (request) => {
    const { tipo } = request.params;
    const config = await obterConfiguracaoEmail();
    return montarEmail(tipo, request.body, variaveisDeExemplo(tipo), config.remetente_nome);
  });

  app.post(
    '/modelos/:tipo/teste',
    { config: LIMITE_TESTE, schema: { params: ParamsTipo, body: CorpoTesteModelo } },
    async (request) => {
      const { tipo } = request.params;
      const { para, ...modelo } = request.body;
      const { config, remetenteNome } = await configParaTeste();
      const montado = montarEmail(tipo, modelo, variaveisDeExemplo(tipo), remetenteNome);
      await enviarDireto(config, { para, ...montado, assunto: `${PREFIXO_TESTE}${montado.assunto}`.slice(0, 200) });
      request.log.info({ admin: request.adminPlataforma?.id, tipo }, 'E-mail de teste de modelo enviado');
      return { ok: true as const };
    },
  );

  // ---------------------------------------------------------------- envios (histórico)

  app.get('/envios', { schema: { querystring: ConsultaEnvios } }, async (request) => {
    const q = request.query;
    const where: Prisma.EmailEnviadoWhereInput = {
      ...(q.tipo && { tipo: q.tipo }),
      ...(q.status && { status: q.status }),
      ...(q.busca && { destinatario: { contains: q.busca, mode: 'insensitive' } }),
    };
    const [itens, total] = await Promise.all([
      prisma.emailEnviado.findMany({
        where,
        orderBy: { criado_em: 'desc' },
        skip: (q.pagina - 1) * q.por_pagina,
        take: q.por_pagina,
        select: {
          id: true,
          tipo: true,
          destinatario: true,
          assunto: true,
          status: true,
          erro: true,
          tentativas: true,
          criado_em: true,
          enviado_em: true,
          clinica: { select: { id: true, nome: true } },
        },
      }),
      prisma.emailEnviado.count({ where }),
    ]);
    return { itens, total, pagina: q.pagina, por_pagina: q.por_pagina };
  });

  app.get('/envios/:id', { schema: { params: ParamsId } }, async (request) => {
    const email = await prisma.emailEnviado.findUnique({
      where: { id: request.params.id },
      include: { clinica: { select: { id: true, nome: true } } },
    });
    const encontrado = ou404(email, 'E-mail não encontrado.');
    // Defesa extra: link com token (redefinição de senha) nunca aparece no painel, nem enquanto pendente.
    return { ...encontrado, html: mascararTokensConteudo(encontrado.html), texto: mascararTokensConteudo(encontrado.texto) };
  });

  app.post('/envios/:id/reenviar', { schema: { params: ParamsId } }, async (request) => {
    const { id } = request.params;
    await reenviarEmail(id);
    request.log.info({ admin: request.adminPlataforma?.id, email: id }, 'E-mail reenfileirado');
    const email = await prisma.emailEnviado.findUnique({
      where: { id },
      omit: { html: true, texto: true },
      include: { clinica: { select: { id: true, nome: true } } },
    });
    return ou404(email, 'E-mail não encontrado.');
  });
};

export default modulo;
