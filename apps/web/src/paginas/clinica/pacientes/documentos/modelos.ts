// Modelos de texto pré-preenchidos do formulário de documentos (o servidor usa os mesmos textos quando o
// conteúdo vem vazio — apps/api/src/modulos/documentos/modelos.ts).
import type { TipoDocumentoClinico } from '@/api/tipos';

export const TITULOS_PADRAO: Record<TipoDocumentoClinico, string> = {
  receita: 'Receituário',
  atestado: 'Atestado',
  declaracao: 'Declaração de comparecimento',
  pedido_exame: 'Pedido de exames',
};

export const DESCRICOES_TIPO: Record<TipoDocumentoClinico, string> = {
  receita: 'Medicamentos com posologia ou texto livre',
  atestado: 'Dias de afastamento e CID (com autorização)',
  declaracao: 'Comparecimento com data e horário',
  pedido_exame: 'Lista de exames solicitados',
};

const UNIDADES = ['zero', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze',
  'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const DEZENAS = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const CENTENAS = ['', 'cento', 'duzentos', 'trezentos'];

export function numeroPorExtenso(n: number): string {
  if (n < 20) return UNIDADES[n] ?? String(n);
  if (n < 100) {
    const u = n % 10;
    return u ? `${DEZENAS[Math.floor(n / 10)]} e ${UNIDADES[u]}` : DEZENAS[Math.floor(n / 10)]!;
  }
  if (n === 100) return 'cem';
  if (n < 400) {
    const r = n % 100;
    return r ? `${CENTENAS[Math.floor(n / 100)]} e ${numeroPorExtenso(r)}` : CENTENAS[Math.floor(n / 100)]!;
  }
  return String(n);
}

export function modeloAtestado(paciente: string, dias: number | null): string {
  const base = `Atesto, para os devidos fins, que ${paciente} esteve sob meus cuidados profissionais nesta data`;
  if (!dias) return `${base}.`;
  return `${base}, devendo permanecer afastado(a) de suas atividades por ${dias} (${numeroPorExtenso(dias)}) ${
    dias === 1 ? 'dia' : 'dias'
  } a partir desta data.`;
}

/** data 'YYYY-MM-DD'. */
export function modeloDeclaracao(paciente: string, data: string, horaInicio: string, horaFim: string): string {
  const [a, m, d] = data.split('-');
  const dataBr = a && m && d ? `${d}/${m}/${a}` : '__/__/____';
  const horario = horaInicio && horaFim ? `, das ${horaInicio} às ${horaFim}` : horaInicio ? `, a partir das ${horaInicio}` : '';
  return `Declaro, para os devidos fins, que ${paciente} compareceu a esta clínica no dia ${dataBr}${horario}, para atendimento.`;
}
