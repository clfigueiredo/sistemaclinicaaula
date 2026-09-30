/**
 * Modelos de texto dos documentos clínicos. Quando o `conteudo` vem vazio, o servidor monta o texto a partir
 * dos metadados (itens da receita, exames do pedido) ou do modelo padrão do tipo (atestado, declaração).
 * O texto final é gravado no registro imutável — o PDF é sempre gerado a partir dele.
 */
import type { TipoDocumentoClinico } from '@prisma/client';
import type { MetadadosAtestado, MetadadosDeclaracao, MetadadosPedidoExame, MetadadosReceita } from './esquemas';

export const TITULOS_PADRAO: Record<TipoDocumentoClinico, string> = {
  receita: 'Receituário',
  atestado: 'Atestado',
  declaracao: 'Declaração de comparecimento',
  pedido_exame: 'Pedido de exames',
};

const UNIDADES = ['zero', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze',
  'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const DEZENAS = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const CENTENAS = ['', 'cento', 'duzentos', 'trezentos'];

/** Número por extenso (0–399), suficiente para dias de afastamento. */
export function numeroPorExtenso(n: number): string {
  if (n < 20) return UNIDADES[n] ?? String(n);
  if (n < 100) {
    const d = Math.floor(n / 10);
    const u = n % 10;
    return u ? `${DEZENAS[d]} e ${UNIDADES[u]}` : DEZENAS[d]!;
  }
  if (n === 100) return 'cem';
  if (n < 400) {
    const c = Math.floor(n / 100);
    const r = n % 100;
    return r ? `${CENTENAS[c]} e ${numeroPorExtenso(r)}` : CENTENAS[c] === 'cento' ? 'cem' : CENTENAS[c]!;
  }
  return String(n);
}

export function textoItensReceita(itens: NonNullable<MetadadosReceita['itens']>): string {
  return itens
    .map((i, idx) => {
      const linha = `${idx + 1}. ${i.medicamento}${i.quantidade ? ` — ${i.quantidade}` : ''}`;
      return i.posologia ? `${linha}\n   ${i.posologia}` : linha;
    })
    .join('\n');
}

export function textoExames(m: MetadadosPedidoExame): string {
  const lista = m.exames.map((e, i) => `${i + 1}. ${e}`).join('\n');
  return m.indicacao_clinica ? `${lista}\n\nIndicação clínica: ${m.indicacao_clinica}` : lista;
}

export function textoAtestado(paciente: string, m: MetadadosAtestado | null | undefined): string {
  const dias = m?.dias;
  const base = `Atesto, para os devidos fins, que ${paciente} esteve sob meus cuidados profissionais nesta data`;
  if (!dias) return `${base}.`;
  const plural = dias === 1 ? 'dia' : 'dias';
  return `${base}, devendo permanecer afastado(a) de suas atividades por ${dias} (${numeroPorExtenso(dias)}) ${plural} a partir desta data.`;
}

export function textoDeclaracao(paciente: string, dataBr: string, m: MetadadosDeclaracao | null | undefined): string {
  const horario =
    m?.hora_inicio && m?.hora_fim
      ? `, das ${m.hora_inicio} às ${m.hora_fim}`
      : m?.hora_inicio
        ? `, a partir das ${m.hora_inicio}`
        : '';
  return `Declaro, para os devidos fins, que ${paciente} compareceu a esta clínica no dia ${dataBr}${horario}, para atendimento.`;
}
