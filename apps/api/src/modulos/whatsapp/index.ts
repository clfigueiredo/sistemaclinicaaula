/**
 * Módulo whatsapp — conexão/QR/status, histórico, avisos, lembretes + webhook público.
 *
 * Rotas autenticadas (/whatsapp):
 *   GET  /whatsapp/status             admin             status + telefone + QR (se aguardando) + recurso
 *   POST /whatsapp/conectar           admin + recurso   inicia a sessão e devolve o QR (quando disponível)
 *   GET  /whatsapp/qrcode             admin             QR atual
 *   POST /whatsapp/desconectar        admin             logout da sessão
 *   GET  /whatsapp/mensagens          admin             histórico paginado (?pagina=&por_pagina=&direcao=&tipo=)
 *   GET  /whatsapp/avisos             admin, recepção   cancelamentos recebidos (?nao_lidos=true)
 *   POST /whatsapp/avisos/:id/lido    admin, recepção   marca o aviso como lido
 *   POST /whatsapp/lembretes/executar admin + recurso   enfileira agora os lembretes de amanhã da clínica
 *
 * Webhook público (/webhooks):
 *   POST /webhooks/whatsapp?token=WEBHOOK_TOKEN  (também aceita header x-webhook-token ou Bearer)
 *   Sem JWT: a clínica é identificada pelo NOME DA SESSÃO do evento. Responde 200 sempre que o token
 *   é válido (inclusive para eventos ignorados), para o WPPConnect não ficar reenviando.
 *
 * Regras: só fala com o provedor via whatsappService; envios SEMPRE pela fila (enfileirarMensagem).
 */
import { timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod, ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { env } from '../../config/env';
import { autenticarClinica, exigirPapel } from '../../plugins/auth';
import { exigirRecurso, obterAssinaturaAtual } from '../../plugins/recursos';
import { ErroNegocio, erros, ou404 } from '../../utils/erros';
import { processarLembretesClinica } from '../../servicos/whatsapp/lembretes';
import { processarEventoWhatsapp } from '../../servicos/whatsapp/respostas';
import { ErroProvedorWhatsapp, whatsappService } from '../../servicos/whatsapp/whatsappService';

export const prefixo = '';

function erroProvedor(e: unknown): never {
  if (e instanceof ErroProvedorWhatsapp) {
    throw new ErroNegocio(
      502,
      'whatsapp_indisponivel',
      'Não foi possível falar com o servidor de WhatsApp. Tente novamente em instantes.',
      { detalhe: e.message },
    );
  }
  throw e;
}

function tokenDoWebhook(request: FastifyRequest): string {
  const q = (request.query ?? {}) as Record<string, unknown>;
  if (typeof q.token === 'string') return q.token;
  const h = request.headers['x-webhook-token'];
  if (typeof h === 'string') return h;
  const auth = request.headers.authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) return auth.slice(7);
  return '';
}

function tokenValido(recebido: string): boolean {
  const esperado = env.WEBHOOK_TOKEN;
  if (!esperado || !recebido) return false;
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

const Paginacao = z.object({
  pagina: z.coerce.number().int().min(1).default(1),
  por_pagina: z.coerce.number().int().min(1).max(100).default(20),
  direcao: z.enum(['entrada', 'saida']).optional(),
  tipo: z.enum(['lembrete', 'confirmacao', 'aviso']).optional(),
});

const selecaoMensagem = {
  id: true,
  telefone: true,
  tipo: true,
  direcao: true,
  conteudo: true,
  status: true,
  erro: true,
  enviada_em: true,
  criado_em: true,
  paciente: { select: { id: true, nome: true } },
  agendamento: {
    select: { id: true, inicio: true, status: true, profissional: { select: { id: true, nome: true } } },
  },
} as const;

const modulo: FastifyPluginAsyncZod = async (app) => {
  // --------------------------------------------------------------------------
  // Rotas autenticadas da clínica: /whatsapp/*
  // --------------------------------------------------------------------------
  await app.register(
    async (base) => {
      const rotas = base.withTypeProvider<ZodTypeProvider>();
      rotas.addHook('onRequest', autenticarClinica);

      rotas.get('/status', { preHandler: exigirPapel('admin') }, async (request) => {
        const assinatura = await obterAssinaturaAtual(request.clinicaId);
        const recursoHabilitado = !!assinatura?.plano.recursos.find((r) => r.recurso_codigo === 'whatsapp')?.habilitado;
        const salvo = await request.db.whatsappSessao.findFirst();
        let status = salvo?.status ?? 'desconectada';
        let telefone = salvo?.telefone ?? null;
        let qrCode: string | null = null;
        let erroProvedorMsg: string | null = null;

        if (salvo) {
          try {
            const atual = await whatsappService.status(request.clinicaId);
            status = atual.status;
            telefone = atual.telefone;
            if (status === 'aguardando_qr') qrCode = (await whatsappService.obterQrCode(request.clinicaId)).qrCode;
          } catch (e) {
            if (!(e instanceof ErroProvedorWhatsapp)) throw e;
            erroProvedorMsg = 'Servidor de WhatsApp indisponível no momento. Exibindo o último status conhecido.';
          }
        }
        return {
          recurso_habilitado: recursoHabilitado,
          status,
          telefone,
          qr_code: qrCode,
          atualizado_em: salvo?.atualizado_em ?? null,
          erro_provedor: erroProvedorMsg,
        };
      });

      rotas.post('/conectar', { preHandler: [exigirPapel('admin'), exigirRecurso('whatsapp')] }, async (request) => {
        try {
          const r = await whatsappService.iniciarSessao(request.clinicaId);
          const salvo = await request.db.whatsappSessao.findFirst();
          return { status: r.status, qr_code: r.qrCode, telefone: salvo?.telefone ?? null };
        } catch (e) {
          erroProvedor(e);
        }
      });

      rotas.get('/qrcode', { preHandler: exigirPapel('admin') }, async (request) => {
        try {
          const r = await whatsappService.obterQrCode(request.clinicaId);
          return { status: r.status, qr_code: r.qrCode };
        } catch (e) {
          erroProvedor(e);
        }
      });

      rotas.post('/desconectar', { preHandler: exigirPapel('admin') }, async (request) => {
        try {
          await whatsappService.desconectar(request.clinicaId);
        } catch (e) {
          erroProvedor(e);
        }
        return { status: 'desconectada' as const };
      });

      rotas.get(
        '/mensagens',
        { preHandler: exigirPapel('admin'), schema: { querystring: Paginacao } },
        async (request) => {
          const { pagina, por_pagina, direcao, tipo } = request.query;
          const where = {
            ...(direcao ? { direcao } : {}),
            // Avisos internos da recepção ficam fora do histórico (a menos que pedidos).
            ...(tipo ? { tipo } : { OR: [{ tipo: null }, { tipo: { not: 'aviso' as const } }] }),
          };
          const [itens, total] = await Promise.all([
            request.db.mensagemWhatsapp.findMany({
              where,
              select: selecaoMensagem,
              orderBy: { criado_em: 'desc' },
              skip: (pagina - 1) * por_pagina,
              take: por_pagina,
            }),
            request.db.mensagemWhatsapp.count({ where }),
          ]);
          return { itens, total, pagina, porPagina: por_pagina };
        },
      );

      rotas.get(
        '/avisos',
        {
          preHandler: exigirPapel('admin', 'recepcao'),
          schema: {
            querystring: z.object({
              nao_lidos: z.enum(['true', 'false']).optional(),
              limite: z.coerce.number().int().min(1).max(100).default(30),
            }),
          },
        },
        async (request) => {
          const apenasNaoLidos = request.query.nao_lidos === 'true';
          const where = { tipo: 'aviso' as const, ...(apenasNaoLidos ? { lida_em: null } : {}) };
          const [itens, naoLidos] = await Promise.all([
            request.db.mensagemWhatsapp.findMany({
              where,
              select: { ...selecaoMensagem, lida_em: true },
              orderBy: { criado_em: 'desc' },
              take: request.query.limite,
            }),
            request.db.mensagemWhatsapp.count({ where: { tipo: 'aviso', lida_em: null } }),
          ]);
          return {
            itens: itens.map(({ status: _status, ...m }) => ({ ...m, lido: m.lida_em !== null })),
            nao_lidos: naoLidos,
          };
        },
      );

      rotas.post(
        '/avisos/:id/lido',
        { preHandler: exigirPapel('admin', 'recepcao'), schema: { params: z.object({ id: z.uuid('ID inválido.') }) } },
        async (request) => {
          const aviso = ou404(
            await request.db.mensagemWhatsapp.findFirst({ where: { id: request.params.id, tipo: 'aviso' } }),
            'Aviso não encontrado.',
          );
          const lidaEm = aviso.lida_em ?? new Date();
          if (!aviso.lida_em) {
            await request.db.mensagemWhatsapp.update({ where: { id: aviso.id }, data: { lida_em: lidaEm } });
          }
          return { id: aviso.id, lido: true, lida_em: lidaEm };
        },
      );

      rotas.post(
        '/lembretes/executar',
        { preHandler: [exigirPapel('admin'), exigirRecurso('whatsapp')] },
        async (request) => {
          const r = await processarLembretesClinica(request.clinicaId);
          if (r.ignorada === 'sessao_desconectada') {
            throw new ErroNegocio(409, 'whatsapp_desconectado', 'Conecte o WhatsApp da clínica antes de enviar lembretes.');
          }
          if (r.ignorada) throw erros.proibido('Não é possível enviar lembretes agora.');
          return {
            selecionados: r.selecionados,
            enfileirados: r.enfileirados,
            falharam: r.falharam,
            erros: r.erros,
          };
        },
      );
    },
    { prefix: '/whatsapp' },
  );

  // --------------------------------------------------------------------------
  // Webhook público do provedor: /webhooks/whatsapp
  // --------------------------------------------------------------------------
  await app.register(
    async (rotas) => {
      rotas.post('/whatsapp', async (request, reply) => {
        if (!tokenValido(tokenDoWebhook(request))) {
          return reply.status(401).send({ erro: 'nao_autenticado', mensagem: 'Token do webhook inválido.' });
        }
        const evento = whatsappService.interpretarWebhook(request.body);
        if (!evento) return { ok: true, acao: 'ignorado' };
        try {
          const r = await processarEventoWhatsapp(evento);
          return { ok: true, acao: r.acao };
        } catch (e) {
          // Nunca devolve 5xx ao provedor (evita tempestade de reenvios); o erro fica no log.
          request.log.error({ err: e, sessao: evento.nomeSessao }, 'Falha ao processar webhook do WhatsApp');
          return { ok: false };
        }
      });
    },
    { prefix: '/webhooks' },
  );
};

export default modulo;
