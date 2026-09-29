/**
 * Adaptador do WPPConnect Server (https://github.com/wppconnect-team/wppconnect-server).
 *
 * Endpoints usados (todos com `Authorization: Bearer <token da sessão>`, exceto generate-token):
 *   POST /api/:session/:secretkey/generate-token → { status, session, token, full }
 *   POST /api/:session/start-session  { waitQrCode:false }   (webhook = o global do servidor, --webhook-url)
 *   GET  /api/:session/status-session → { status: CLOSED|INITIALIZING|QRCODE|CONNECTED|…, qrcode: dataURL|null }
 *   GET  /api/:session/get-phone-number / host-device        → número conectado
 *   POST /api/:session/logout-session  | close-session
 *   POST /api/:session/send-message { phone, isGroup:false, message } → { status, response:[{ id, … }] }
 *
 * Token: gerado por sessão (uma por clínica) e persistido em whatsapp_sessoes.token. Em 401 o
 * token é regerado automaticamente e a chamada repetida uma vez.
 *
 * Webhook (eventos enviados pelo WPPConnect para POST /webhooks/whatsapp?token=...):
 *   { event: 'onmessage', session, id, body, type:'chat', from:'5511…@c.us', fromMe, isGroupMsg, t, sender… }
 *   { event: 'status-find', session, status: 'inChat'|'isLogged'|'qrReadSuccess'|'notLogged'|'browserClose'|
 *                                            'desconnectedMobile'|'disconnectedMobile'|'autocloseCalled'|… }
 *   { event: 'qrcode', session, qrcode: '<base64 sem prefixo>', urlcode }
 *   { event: 'logoutsession' | 'closesession', session, … }
 */
import { env } from '../../config/env';
import { prisma } from '../../lib/prisma';
import { normalizarTelefone } from './telefone';
import {
  ErroProvedorWhatsapp,
  nomeSessao,
  type EventoWhatsapp,
  type ResultadoSessao,
  type ResultadoStatus,
  type StatusConexaoWhatsapp,
  type WhatsappService,
} from './tipos';

type Json = Record<string, unknown>;

const TIMEOUT_MS = 30_000;

export type OpcoesWppconnect = {
  url?: string;
  chaveSecreta?: string;
  /** Tentativas de consultar o status logo após iniciar a sessão (esperando o QR). */
  tentativasQr?: number;
  intervaloQrMs?: number;
  fetch?: typeof fetch;
};

function comPrefixoDataUrl(qr: unknown): string | null {
  if (typeof qr !== 'string' || !qr) return null;
  return qr.startsWith('data:') ? qr : `data:image/png;base64,${qr}`;
}

/** Status do WPPConnect → status interno. */
export function mapearStatusWppconnect(status: unknown): StatusConexaoWhatsapp {
  const s = String(status ?? '').toUpperCase();
  switch (s) {
    case 'CONNECTED':
    case 'INCHAT':
    case 'ISLOGGED':
    case 'QRREADSUCCESS':
      return 'conectada';
    case 'QRCODE':
    case 'PHONECODE':
    case 'NOTLOGGED':
      return 'aguardando_qr';
    case 'INITIALIZING':
    case 'STARTING':
    case 'OPENING':
      return 'iniciando';
    case 'QRREADERROR':
    case 'QRREADFAIL':
      return 'erro';
    default:
      // CLOSED, BROWSERCLOSE, DESCONNECTEDMOBILE, DISCONNECTEDMOBILE, AUTOCLOSECALLED, SERVERCLOSE, DELETETOKEN…
      return 'desconectada';
  }
}

/** Procura recursivamente um id "5511…@c.us" ou { user: '5511…' } na resposta do WPPConnect. */
function extrairTelefone(valor: unknown, profundidade = 0): string | null {
  if (profundidade > 4 || valor === null || valor === undefined) return null;
  if (typeof valor === 'string') {
    const m = valor.match(/(\d{10,15})@c\.us/);
    return m ? m[1] : null;
  }
  if (typeof valor !== 'object') return null;
  const obj = valor as Json;
  if (typeof obj.user === 'string' && /^\d{10,15}$/.test(obj.user) && obj.server !== 'lid') return obj.user;
  for (const chave of ['wid', 'id', 'me', 'phone', 'response', '_serialized']) {
    const t = extrairTelefone(obj[chave], profundidade + 1);
    if (t) return t;
  }
  return null;
}

/** Converte o corpo do webhook do WPPConnect num evento interno. */
export function interpretarWebhookWppconnect(corpo: unknown): EventoWhatsapp | null {
  if (!corpo || typeof corpo !== 'object') return null;
  const c = corpo as Json;
  const evento = String(c.event ?? '');
  const sessao = typeof c.session === 'string' ? c.session : '';
  if (!sessao) return null;

  switch (evento) {
    case 'onmessage': {
      if (c.fromMe === true || c.isGroupMsg === true) return null;
      const tipo = String(c.type ?? 'chat');
      if (tipo !== 'chat') return null;
      const texto = typeof c.body === 'string' ? c.body : typeof c.content === 'string' ? c.content : '';
      if (!texto.trim()) return null;
      const remetente = [c.from, (c.sender as Json | undefined)?.id, c.chatId, c.author].find(
        (v) => typeof v === 'string' && v.endsWith('@c.us'),
      ) as string | undefined;
      // Remetentes só com LID (…@lid, sem número) não dão para casar com o paciente: ignorados.
      const telefone = normalizarTelefone(remetente);
      if (!telefone) return null;
      const id = typeof c.id === 'string' ? c.id : ((c.id as Json | undefined)?._serialized as string | undefined);
      const t = typeof c.t === 'number' ? c.t : typeof c.timestamp === 'number' ? c.timestamp : null;
      return {
        tipo: 'mensagem',
        nomeSessao: sessao,
        telefone,
        texto,
        idExterno: id ?? null,
        recebidaEm: t ? new Date(t * 1000) : new Date(),
      };
    }
    case 'status-find':
      return { tipo: 'status', nomeSessao: sessao, status: mapearStatusWppconnect(c.status), telefone: null };
    case 'qrcode':
      return { tipo: 'qrcode', nomeSessao: sessao, qrCode: comPrefixoDataUrl(c.qrcode) };
    case 'logoutsession':
    case 'closesession':
      return { tipo: 'status', nomeSessao: sessao, status: 'desconectada', telefone: null };
    default:
      return null;
  }
}

export function criarAdaptadorWppconnect(opcoes: OpcoesWppconnect = {}): WhatsappService {
  const baseUrl = (opcoes.url ?? env.WPPCONNECT_URL).replace(/\/$/, '');
  const chaveSecreta = opcoes.chaveSecreta ?? env.WPPCONNECT_SECRET_KEY;
  const tentativasQr = opcoes.tentativasQr ?? 10;
  const intervaloQrMs = opcoes.intervaloQrMs ?? 1500;
  const buscar = opcoes.fetch ?? fetch;

  async function http(
    metodo: 'GET' | 'POST',
    caminho: string,
    token: string | null,
    corpo?: unknown,
  ): Promise<{ status: number; dados: Json }> {
    let resposta: Response;
    try {
      resposta = await buscar(`${baseUrl}${caminho}`, {
        method: metodo,
        headers: {
          Accept: 'application/json',
          ...(corpo !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      throw new ErroProvedorWhatsapp(
        `Não foi possível falar com o servidor de WhatsApp (${(e as Error).message}).`,
        true,
        'provedor_indisponivel',
      );
    }
    const texto = await resposta.text();
    let dados: Json = {};
    try {
      dados = texto ? (JSON.parse(texto) as Json) : {};
    } catch {
      dados = { bruto: texto.slice(0, 500) };
    }
    return { status: resposta.status, dados };
  }

  async function obterSessao(clinicaId: string) {
    const nome = nomeSessao(clinicaId);
    return prisma.whatsappSessao.upsert({
      where: { clinica_id: clinicaId },
      create: { clinica_id: clinicaId, nome_sessao: nome },
      update: {},
    });
  }

  async function gerarToken(clinicaId: string): Promise<string> {
    if (!chaveSecreta) {
      throw new ErroProvedorWhatsapp('WPPCONNECT_SECRET_KEY não configurada no servidor.', false, 'provedor_nao_configurado');
    }
    const nome = nomeSessao(clinicaId);
    const { status, dados } = await http(
      'POST',
      `/api/${encodeURIComponent(nome)}/${encodeURIComponent(chaveSecreta)}/generate-token`,
      null,
    );
    const token = typeof dados.token === 'string' ? dados.token : null;
    if (status >= 400 || !token) {
      throw new ErroProvedorWhatsapp(
        `Falha ao gerar o token da sessão no WPPConnect (HTTP ${status}). Confira WPPCONNECT_SECRET_KEY.`,
        status >= 500,
        'token_invalido',
      );
    }
    await prisma.whatsappSessao.update({ where: { clinica_id: clinicaId }, data: { token } });
    return token;
  }

  /** Chamada autenticada com a sessão da clínica; regera o token em 401 e tenta de novo uma vez. */
  async function chamar(clinicaId: string, metodo: 'GET' | 'POST', acao: string, corpo?: unknown) {
    const sessao = await obterSessao(clinicaId);
    let token = sessao.token ?? (await gerarToken(clinicaId));
    const caminho = `/api/${encodeURIComponent(sessao.nome_sessao)}/${acao}`;
    let r = await http(metodo, caminho, token, corpo);
    if (r.status === 401) {
      token = await gerarToken(clinicaId);
      r = await http(metodo, caminho, token, corpo);
    }
    return r;
  }

  async function salvarStatus(clinicaId: string, status: StatusConexaoWhatsapp, telefone?: string | null) {
    await prisma.whatsappSessao.update({
      where: { clinica_id: clinicaId },
      data: {
        status,
        ...(telefone !== undefined ? { telefone } : {}),
        ...(status === 'desconectada' ? { telefone: null } : {}),
      },
    });
  }

  async function consultarStatus(clinicaId: string): Promise<{ status: StatusConexaoWhatsapp; qrCode: string | null }> {
    const r = await chamar(clinicaId, 'GET', 'status-session');
    if (r.status >= 500) throw new ErroProvedorWhatsapp(`WPPConnect respondeu HTTP ${r.status}.`, true);
    if (r.status >= 400) return { status: 'desconectada', qrCode: null };
    const status = mapearStatusWppconnect(r.dados.status);
    return { status, qrCode: status === 'aguardando_qr' ? comPrefixoDataUrl(r.dados.qrcode) : null };
  }

  async function obterTelefoneConectado(clinicaId: string): Promise<string | null> {
    for (const acao of ['get-phone-number', 'host-device']) {
      try {
        const r = await chamar(clinicaId, 'GET', acao);
        if (r.status < 400) {
          const t = normalizarTelefone(extrairTelefone(r.dados));
          if (t) return t;
        }
      } catch {
        /* tenta o próximo */
      }
    }
    return null;
  }

  const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const adaptador: WhatsappService = {
    async iniciarSessao(clinicaId) {
      await obterSessao(clinicaId);
      const r = await chamar(clinicaId, 'POST', 'start-session', { waitQrCode: false });
      if (r.status >= 400) {
        await salvarStatus(clinicaId, 'erro');
        throw new ErroProvedorWhatsapp(
          `O WPPConnect recusou iniciar a sessão (HTTP ${r.status}).`,
          r.status >= 500,
          'falha_iniciar_sessao',
        );
      }
      await salvarStatus(clinicaId, 'iniciando');
      // O navegador do WPPConnect leva alguns segundos para gerar o QR: consulta algumas vezes.
      let atual: ResultadoSessao = { status: 'iniciando', qrCode: null };
      for (let i = 0; i < tentativasQr; i++) {
        atual = await consultarStatus(clinicaId);
        if (atual.status === 'conectada' || (atual.status === 'aguardando_qr' && atual.qrCode)) break;
        if (atual.status === 'desconectada') atual = { status: 'iniciando', qrCode: null };
        await esperar(intervaloQrMs);
      }
      const telefone = atual.status === 'conectada' ? await obterTelefoneConectado(clinicaId) : undefined;
      await salvarStatus(clinicaId, atual.status, telefone);
      return atual;
    },

    async obterQrCode(clinicaId) {
      const atual = await consultarStatus(clinicaId);
      return atual;
    },

    async status(clinicaId): Promise<ResultadoStatus> {
      const sessao = await obterSessao(clinicaId);
      if (!sessao.token && sessao.status === 'desconectada') return { status: 'desconectada', telefone: null };
      const atual = await consultarStatus(clinicaId);
      let telefone: string | null = null;
      if (atual.status === 'conectada') {
        telefone = sessao.telefone ?? (await obterTelefoneConectado(clinicaId));
      }
      // "iniciando" gravado por nós enquanto o provedor ainda diz CLOSED: mantém iniciando.
      const status = atual.status === 'desconectada' && sessao.status === 'iniciando' ? 'iniciando' : atual.status;
      await salvarStatus(clinicaId, status, telefone);
      return { status, telefone };
    },

    async desconectar(clinicaId) {
      await obterSessao(clinicaId);
      let ok = false;
      try {
        const r = await chamar(clinicaId, 'POST', 'logout-session');
        ok = r.status < 400;
      } catch {
        /* tenta fechar */
      }
      if (!ok) {
        try {
          await chamar(clinicaId, 'POST', 'close-session');
        } catch {
          /* segue: marca desconectada localmente */
        }
      }
      await salvarStatus(clinicaId, 'desconectada', null);
    },

    async enviarMensagem(clinicaId, telefone, texto) {
      const numero = normalizarTelefone(telefone);
      if (!numero) throw new ErroProvedorWhatsapp('Telefone inválido.', false, 'telefone_invalido');
      const r = await chamar(clinicaId, 'POST', 'send-message', { phone: numero, isGroup: false, message: texto });
      if (r.status >= 400 || r.dados.status === 'error') {
        const msg = typeof r.dados.message === 'string' ? r.dados.message : `HTTP ${r.status}`;
        // Sessão fechada/desconectada, 5xx e 429 são temporários; 400/404 (número inválido) não.
        const temporario = r.status >= 500 || r.status === 429 || r.status === 401 || /disconnect|not active|closed/i.test(msg);
        throw new ErroProvedorWhatsapp(`Falha no envio pelo WPPConnect: ${msg}`, temporario, 'falha_envio');
      }
      const resposta = r.dados.response;
      const primeiro = (Array.isArray(resposta) ? resposta[0] : resposta) as Json | undefined;
      const id = primeiro?.id;
      const idExterno =
        typeof id === 'string' ? id : typeof (id as Json | undefined)?._serialized === 'string' ? ((id as Json)._serialized as string) : null;
      return { idExterno };
    },

    interpretarWebhook: interpretarWebhookWppconnect,
  };
  return adaptador;
}
