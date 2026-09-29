/**
 * Adaptador FAKE do WhatsApp (testes / desenvolvimento sem celular).
 * Não fala com nenhum provedor: guarda as mensagens "enviadas" em memória e usa o mesmo
 * parser de webhook do WPPConnect (para testar o fluxo de respostas com payloads reais).
 *
 *   const fake = criarAdaptadorFake();
 *   definirProvedorWhatsapp(fake);
 *   ...
 *   expect(fake.enviadas).toHaveLength(1);
 */
import { prisma } from '../../lib/prisma';
import { normalizarTelefone } from './telefone';
import { ErroProvedorWhatsapp, nomeSessao, type StatusConexaoWhatsapp, type WhatsappService } from './tipos';
import { interpretarWebhookWppconnect } from './wppconnectAdapter';

export type EnvioFake = { clinicaId: string; telefone: string; texto: string; idExterno: string };

export type AdaptadorFake = WhatsappService & {
  enviadas: EnvioFake[];
  /** Próximos envios falham (temporário) enquanto > 0. */
  falharProximos: number;
  telefoneConectado: string;
  limpar(): void;
};

export function criarAdaptadorFake(): AdaptadorFake {
  let seq = 0;

  async function gravar(clinicaId: string, status: StatusConexaoWhatsapp, telefone: string | null) {
    await prisma.whatsappSessao.upsert({
      where: { clinica_id: clinicaId },
      create: { clinica_id: clinicaId, nome_sessao: nomeSessao(clinicaId), status, telefone, token: 'fake' },
      update: { status, telefone },
    });
  }

  const fake: AdaptadorFake = {
    enviadas: [],
    falharProximos: 0,
    telefoneConectado: '5511900000000',
    limpar() {
      fake.enviadas.length = 0;
      fake.falharProximos = 0;
    },
    async iniciarSessao(clinicaId) {
      await gravar(clinicaId, 'aguardando_qr', null);
      return { status: 'aguardando_qr', qrCode: 'data:image/png;base64,RkFLRQ==' };
    },
    async obterQrCode(clinicaId) {
      const s = await prisma.whatsappSessao.findUnique({ where: { clinica_id: clinicaId } });
      return s?.status === 'aguardando_qr'
        ? { status: 'aguardando_qr', qrCode: 'data:image/png;base64,RkFLRQ==' }
        : { status: s?.status ?? 'desconectada', qrCode: null };
    },
    async status(clinicaId) {
      const s = await prisma.whatsappSessao.findUnique({ where: { clinica_id: clinicaId } });
      return { status: s?.status ?? 'desconectada', telefone: s?.telefone ?? null };
    },
    async desconectar(clinicaId) {
      await gravar(clinicaId, 'desconectada', null);
    },
    async enviarMensagem(clinicaId, telefone, texto) {
      if (fake.falharProximos > 0) {
        fake.falharProximos--;
        throw new ErroProvedorWhatsapp('Falha simulada de rede.', true, 'provedor_indisponivel');
      }
      const numero = normalizarTelefone(telefone);
      if (!numero) throw new ErroProvedorWhatsapp('Telefone inválido.', false, 'telefone_invalido');
      const idExterno = `true_${numero}@c.us_FAKE${++seq}`;
      fake.enviadas.push({ clinicaId, telefone: numero, texto, idExterno });
      return { idExterno };
    },
    interpretarWebhook: interpretarWebhookWppconnect,
  };
  return fake;
}
