/**
 * Módulo whatsapp — WhatsApp: conexão/QR/status + webhook
 *
 * TODO(fase 2): implementar. Rotas previstas (prefixo "(nenhum)"):
 *   GET    /whatsapp/status         status da sessão da clínica
 *   POST   /whatsapp/conectar       exigirPapel("admin") + exigirRecurso("whatsapp") → whatsappService.iniciarSessao
 *   GET    /whatsapp/qrcode         exigirPapel("admin")
 *   POST   /whatsapp/desconectar    exigirPapel("admin")
 *   GET    /whatsapp/mensagens      histórico (mensagens_whatsapp)
 *   POST   /webhooks/whatsapp       PÚBLICO — valida ?token=WEBHOOK_TOKEN; resposta "1" confirma, "2" cancela
 *
 * - Prefixo vazio porque o módulo tem dois grupos: /whatsapp (autenticado) e /webhooks (público).
 * - Só fale com o provedor via whatsappService (src/servicos/whatsapp). Envio SEMPRE pela fila (src/servicos/filas.ts).
 * - Webhook usa prisma CRU (descobre a clínica pelo nome_sessao) — sem token JWT.
 *
 * Convenções (ver CLAUDE.md → "Convenções para módulos"): validação com Zod no `schema`,
 * dados SEMPRE via request.db (tenant), nunca clinica_id do body/query,
 * erros com ErroNegocio. Pode criar outros arquivos nesta pasta (rotas.ts, servico.ts, esquemas.ts).
 * Este módulo já é registrado automaticamente por src/modulos/index.ts — não edite aquele arquivo.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { autenticarClinica } from '../../plugins/auth';

export const prefixo = '';

const modulo: FastifyPluginAsyncZod = async (app) => {
  // Rotas autenticadas da clínica: /whatsapp/*
  await app.register(
    async (rotas) => {
      rotas.addHook('onRequest', autenticarClinica);
      // TODO(fase 2): rotas de conexão/QR/status/mensagens
    },
    { prefix: '/whatsapp' },
  );

  // Webhook público do provedor: /webhooks/whatsapp
  await app.register(
    async (_rotas) => {
      // TODO(fase 2): POST /whatsapp (validar request.query.token === env.WEBHOOK_TOKEN)
    },
    { prefix: '/webhooks' },
  );
};

export default modulo;
