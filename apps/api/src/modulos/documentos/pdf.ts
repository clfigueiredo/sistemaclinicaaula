/**
 * Geração do PDF dos documentos clínicos com pdfkit (A4, fontes padrão Helvetica).
 *
 * As fontes padrão do PDF usam WinAnsiEncoding: cobre todo o português (á, ã, ç, é, ê, õ, º, ª, –, “ ”…).
 * Caracteres fora dessa tabela (emojis, setas…) são trocados por equivalentes simples em `paraWinAnsi`
 * para não virarem lixo no PDF. O PDF é gerado em memória, sob demanda, a partir do registro imutável.
 */
import PDFDocument from 'pdfkit';
import { formatInTimeZone } from 'date-fns-tz';
import { ptBR } from 'date-fns/locale';
import type { TipoDocumentoClinico } from '@prisma/client';
import { TITULOS_PADRAO } from './modelos';

export type DadosPdfDocumento = {
  id: string;
  tipo: TipoDocumentoClinico;
  titulo: string | null;
  conteudo: string;
  metadados: unknown;
  criado_em: Date;
  clinica: {
    nome: string;
    documento: string | null;
    endereco: string | null;
    cidade: string | null;
    uf: string | null;
    cep: string | null;
    telefone: string | null;
    email: string | null;
    fuso_horario: string;
  };
  paciente: { nome: string; cpf: string | null; nascimento: Date | null };
  profissional: { nome: string; especialidade: string | null; registro: string | null };
  /** Pré-visualização: marca d'água e rodapé sem identificador. */
  previa?: boolean;
};

// Caracteres do cp1252 além do Latin-1 (0x80–0x9F) aceitos pelas fontes padrão.
const EXTRAS_WINANSI = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');
const SUBSTITUICOES: Record<string, string> = {
  '→': '->',
  '←': '<-',
  '≥': '>=',
  '≤': '<=',
  '≠': '!=',
  '✓': 'v',
  '✔': 'v',
  ' ': ' ',
  '\t': '    ',
};

/** Deixa o texto seguro para as fontes padrão do PDF (WinAnsi), preservando a acentuação do português. */
export function paraWinAnsi(texto: string): string {
  let saida = '';
  for (const ch of texto.normalize('NFC')) {
    const cp = ch.codePointAt(0)!;
    if (ch === '\n' || (cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff) || EXTRAS_WINANSI.has(ch)) {
      saida += SUBSTITUICOES[ch] ?? ch;
    } else if (SUBSTITUICOES[ch]) {
      saida += SUBSTITUICOES[ch];
    } else if (ch === '\r') {
      continue;
    } else {
      // Tenta a letra base (ex.: "ŝ" → "s"); senão, descarta.
      const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
      saida += /^[\x20-\x7e]+$/.test(base) ? base : '';
    }
  }
  return saida;
}

function formatarDocumentoClinica(doc: string | null): string | null {
  if (!doc) return null;
  const d = doc.replace(/\D/g, '');
  if (d.length === 14) return `CNPJ ${d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')}`;
  if (d.length === 11) return `CPF ${d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')}`;
  return doc;
}

function formatarCpf(cpf: string | null): string | null {
  const d = cpf?.replace(/\D/g, '') ?? '';
  return d.length === 11 ? d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4') : cpf || null;
}

function formatarTelefone(tel: string | null): string | null {
  if (!tel) return null;
  let d = tel.replace(/\D/g, '');
  if (d.length > 11 && d.startsWith('55')) d = d.slice(2);
  if (d.length === 11) return d.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3');
  if (d.length === 10) return d.replace(/^(\d{2})(\d{4})(\d{4})$/, '($1) $2-$3');
  return tel;
}

/** "30 de setembro de 2026" no fuso da clínica. */
export function dataPorExtenso(data: Date, fuso: string): string {
  return formatInTimeZone(data, fuso, "d 'de' MMMM 'de' yyyy", { locale: ptBR });
}

type Receita = { uso?: string | null; itens?: { medicamento: string; posologia?: string | null; quantidade?: string | null }[]; conteudo_gerado?: boolean };
type Atestado = { cid?: string | null; exibir_cid?: boolean };
type PedidoExame = { exames?: string[]; indicacao_clinica?: string | null; conteudo_gerado?: boolean };

const COR_TEXTO = '#1f2937';
const COR_SUAVE = '#6b7280';
const COR_LINHA = '#d1d5db';
const MARGEM = 56;

export function gerarPdfDocumento(dados: DadosPdfDocumento, opcoes: { compress?: boolean } = {}): Promise<Buffer> {
  const t = paraWinAnsi;
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: MARGEM, bottom: MARGEM + 24, left: MARGEM, right: MARGEM },
    bufferPages: true,
    compress: opcoes.compress ?? true,
    info: {
      Title: t(`${dados.titulo || TITULOS_PADRAO[dados.tipo]} — ${dados.paciente.nome}`),
      Author: t(dados.profissional.nome),
      Creator: 'Sistema Clínica',
      CreationDate: dados.criado_em,
    },
  });

  const partes: Buffer[] = [];
  const pronto = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (b: Buffer) => partes.push(b));
    doc.on('end', () => resolve(Buffer.concat(partes)));
    doc.on('error', reject);
  });

  const largura = doc.page.width - MARGEM * 2;
  const { clinica } = dados;

  // ---------------------------------------------------------------- cabeçalho da clínica
  doc.fillColor(COR_TEXTO).font('Helvetica-Bold').fontSize(15).text(t(clinica.nome), { align: 'center' });
  doc.font('Helvetica').fontSize(9).fillColor(COR_SUAVE);
  const linhasCabecalho = [
    formatarDocumentoClinica(clinica.documento),
    [clinica.endereco, [clinica.cidade, clinica.uf].filter(Boolean).join('/'), clinica.cep ? `CEP ${clinica.cep}` : null]
      .filter(Boolean)
      .join(' · ') || null,
    [formatarTelefone(clinica.telefone) ? `Tel. ${formatarTelefone(clinica.telefone)}` : null, clinica.email]
      .filter(Boolean)
      .join(' · ') || null,
  ].filter((l): l is string => !!l);
  for (const l of linhasCabecalho) doc.text(t(l), { align: 'center' });
  doc.moveDown(0.6);
  doc.moveTo(MARGEM, doc.y).lineTo(MARGEM + largura, doc.y).lineWidth(1).strokeColor(COR_LINHA).stroke();
  doc.moveDown(1.4);

  // ---------------------------------------------------------------- título
  const titulo = dados.titulo || TITULOS_PADRAO[dados.tipo];
  doc.fillColor(COR_TEXTO).font('Helvetica-Bold').fontSize(16).text(t(titulo.toLocaleUpperCase('pt-BR')), {
    align: 'center',
    characterSpacing: 0.5,
  });
  const meta = (dados.metadados ?? {}) as Receita & Atestado & PedidoExame;
  if (dados.tipo === 'receita' && meta.uso) {
    doc.moveDown(0.2).font('Helvetica').fontSize(10).fillColor(COR_SUAVE).text(t(`Uso ${meta.uso}`), { align: 'center' });
  }
  doc.moveDown(1.2);

  // ---------------------------------------------------------------- paciente
  doc.fillColor(COR_TEXTO).fontSize(11);
  doc.font('Helvetica-Bold').text('Paciente: ', { continued: true }).font('Helvetica').text(t(dados.paciente.nome));
  const extrasPaciente = [
    formatarCpf(dados.paciente.cpf) ? `CPF: ${formatarCpf(dados.paciente.cpf)}` : null,
    dados.paciente.nascimento ? `Nascimento: ${formatInTimeZone(dados.paciente.nascimento, 'UTC', 'dd/MM/yyyy')}` : null,
  ].filter(Boolean);
  if (extrasPaciente.length) doc.fontSize(10).fillColor(COR_SUAVE).text(t(extrasPaciente.join('    ')));
  doc.moveDown(1.2);

  // ---------------------------------------------------------------- corpo
  doc.fillColor(COR_TEXTO).font('Helvetica').fontSize(11);
  const paragrafo = (texto: string) =>
    doc.font('Helvetica').fontSize(11).fillColor(COR_TEXTO).text(t(texto), { align: 'justify', lineGap: 3 });

  if (dados.tipo === 'receita' && meta.itens?.length) {
    meta.itens.forEach((item, i) => {
      doc.font('Helvetica-Bold').fontSize(11).fillColor(COR_TEXTO);
      const esquerda = `${i + 1}. ${item.medicamento}`;
      if (item.quantidade) {
        const y = doc.y;
        doc.text(t(esquerda), MARGEM, y, { width: largura * 0.7 });
        const yFim = doc.y;
        doc.font('Helvetica').text(t(item.quantidade), MARGEM + largura * 0.7, y, { width: largura * 0.3, align: 'right' });
        doc.y = Math.max(yFim, doc.y);
        doc.x = MARGEM;
      } else {
        doc.text(t(esquerda));
      }
      if (item.posologia) {
        doc.font('Helvetica').fontSize(11).text(t(item.posologia), MARGEM + 16, doc.y, { width: largura - 16, lineGap: 2 });
        doc.x = MARGEM;
      }
      doc.moveDown(0.8);
    });
    if (!meta.conteudo_gerado && dados.conteudo.trim()) {
      doc.moveDown(0.4).font('Helvetica-Bold').text('Orientações');
      doc.moveDown(0.2);
      paragrafo(dados.conteudo);
    }
  } else if (dados.tipo === 'pedido_exame' && meta.exames?.length) {
    doc.font('Helvetica-Bold').text('Solicito:');
    doc.moveDown(0.4);
    meta.exames.forEach((e, i) => {
      doc.font('Helvetica').text(t(`${i + 1}. ${e}`), MARGEM + 8, doc.y, { width: largura - 8, lineGap: 2 });
    });
    doc.x = MARGEM;
    if (meta.indicacao_clinica) {
      doc.moveDown(0.8).font('Helvetica-Bold').text('Indicação clínica: ', { continued: true });
      doc.font('Helvetica').text(t(meta.indicacao_clinica));
    }
    if (!meta.conteudo_gerado && dados.conteudo.trim()) {
      doc.moveDown(0.8);
      paragrafo(dados.conteudo);
    }
  } else {
    paragrafo(dados.conteudo);
  }

  if (dados.tipo === 'atestado' && meta.exibir_cid && meta.cid) {
    doc.moveDown(0.8).font('Helvetica-Bold').text('CID-10: ', { continued: true }).font('Helvetica').text(t(meta.cid));
    doc.font('Helvetica').fontSize(8).fillColor(COR_SUAVE).text('Código informado com autorização do(a) paciente.');
  }

  // ---------------------------------------------------------------- local, data e assinatura
  const alturaAssinatura = 150;
  if (doc.y + alturaAssinatura > doc.page.height - doc.page.margins.bottom) doc.addPage();
  doc.moveDown(2);
  const local = [clinica.cidade, dataPorExtenso(dados.criado_em, clinica.fuso_horario)].filter(Boolean).join(', ');
  doc.font('Helvetica').fontSize(11).fillColor(COR_TEXTO).text(t(`${local}.`), MARGEM, doc.y, { width: largura, align: 'right' });

  doc.moveDown(4);
  const larguraLinha = 260;
  const xLinha = MARGEM + (largura - larguraLinha) / 2;
  doc.moveTo(xLinha, doc.y).lineTo(xLinha + larguraLinha, doc.y).lineWidth(0.8).strokeColor(COR_TEXTO).stroke();
  doc.moveDown(0.4);
  doc.font('Helvetica-Bold').fontSize(11).text(t(dados.profissional.nome), MARGEM, doc.y, { width: largura, align: 'center' });
  doc.font('Helvetica').fontSize(10).fillColor(COR_SUAVE);
  if (dados.profissional.especialidade) doc.text(t(dados.profissional.especialidade), { width: largura, align: 'center' });
  if (dados.profissional.registro) doc.text(t(dados.profissional.registro), { width: largura, align: 'center' });

  // ---------------------------------------------------------------- rodapé e marca d'água (todas as páginas)
  const paginas = doc.bufferedPageRange();
  for (let i = paginas.start; i < paginas.start + paginas.count; i++) {
    doc.switchToPage(i);
    const margemInferior = doc.page.margins.bottom;
    doc.page.margins.bottom = 0; // escrever no rodapé sem criar página nova
    const yRodape = doc.page.height - MARGEM + 8;
    doc.moveTo(MARGEM, yRodape - 8).lineTo(MARGEM + largura, yRodape - 8).lineWidth(0.5).strokeColor(COR_LINHA).stroke();
    const emitido = formatInTimeZone(dados.criado_em, clinica.fuso_horario, "dd/MM/yyyy 'às' HH:mm");
    const identificacao = dados.previa
      ? 'PRÉ-VISUALIZAÇÃO — documento ainda não emitido, sem validade'
      : `Documento nº ${dados.id} · emitido em ${emitido}`;
    doc.font('Helvetica').fontSize(7.5).fillColor(COR_SUAVE);
    doc.text(t(identificacao), MARGEM, yRodape, { width: largura * 0.8, lineBreak: false });
    doc.text(`Página ${i - paginas.start + 1} de ${paginas.count}`, MARGEM + largura * 0.8, yRodape, {
      width: largura * 0.2,
      align: 'right',
      lineBreak: false,
    });
    if (dados.previa) {
      doc.save();
      doc.rotate(-35, { origin: [doc.page.width / 2, doc.page.height / 2] });
      doc.font('Helvetica-Bold').fontSize(56).fillColor('#9ca3af').opacity(0.18);
      const larguraMarca = doc.page.width * 1.6;
      doc.text(t('PRÉ-VISUALIZAÇÃO'), (doc.page.width - larguraMarca) / 2, doc.page.height / 2 - 28, {
        width: larguraMarca,
        align: 'center',
        lineBreak: false,
      });
      doc.restore();
    }
    doc.page.margins.bottom = margemInferior;
  }

  doc.end();
  return pronto;
}
