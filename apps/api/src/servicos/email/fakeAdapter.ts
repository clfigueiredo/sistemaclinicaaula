/**
 * Provedor FAKE de e-mail (testes): guarda em memória o que "enviou".
 *
 *   const fake = criarAdaptadorEmailFake();
 *   definirProvedorEmail(fake);
 *   expect(fake.enviados).toHaveLength(1);
 */
import { ErroProvedorEmail, type MensagemEmail, type ProvedorEmail } from './tipos';

export type AdaptadorEmailFake = ProvedorEmail & {
  enviados: MensagemEmail[];
  /** Próximos envios falham (temporário) enquanto > 0. */
  falharProximos: number;
  /** Próximos envios falham de forma definitiva enquanto > 0. */
  falharDefinitivoProximos: number;
  limpar(): void;
};

export function criarAdaptadorEmailFake(): AdaptadorEmailFake {
  let seq = 0;
  const fake: AdaptadorEmailFake = {
    enviados: [],
    falharProximos: 0,
    falharDefinitivoProximos: 0,
    async enviar(_config, mensagem) {
      if (fake.falharDefinitivoProximos > 0) {
        fake.falharDefinitivoProximos -= 1;
        throw new ErroProvedorEmail('Destinatário recusado (fake).', false);
      }
      if (fake.falharProximos > 0) {
        fake.falharProximos -= 1;
        throw new ErroProvedorEmail('Falha temporária (fake).', true);
      }
      fake.enviados.push(mensagem);
      seq += 1;
      return { idExterno: `fake-${seq}` };
    },
    async verificar() {},
    limpar() {
      fake.enviados = [];
      fake.falharProximos = 0;
      fake.falharDefinitivoProximos = 0;
    },
  };
  return fake;
}
