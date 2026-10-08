/**
 * Monta o e-mail final (HTML + texto puro) a partir do modelo (assunto, corpo, texto do botão) e das variáveis.
 *
 * Segurança: o layout HTML é fixo; o texto do modelo e os VALORES das variáveis são escapados antes de aplicar
 * a marcação simples — ninguém injeta HTML pelo nome da clínica nem pelo modelo. O link do botão só é usado se
 * for http(s).
 */
import type { TipoEmail } from '@prisma/client';
import { CATALOGO_EMAILS } from './modelosPadrao';

export type ConteudoModelo = { assunto: string; corpo: string; texto_botao: string };
export type EmailMontado = { assunto: string; html: string; texto: string };

const CORES = { primaria: '#0f766e', texto: '#1f2937', suave: '#6b7280', fundo: '#f3f4f6', borda: '#e5e7eb' };

export function escaparHtml(valor: string): string {
  return valor
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Troca `{nome}` pelo valor (uma passada só: valores com `{x}` não são re-substituídos). Desconhecida fica como está. */
export function substituirVariaveis(texto: string, variaveis: Record<string, string>): string {
  return texto.replace(/\{([a-z_]+)\}/g, (todo, nome: string) => (nome in variaveis ? variaveis[nome]! : todo));
}

function ehUrlSegura(url: string | undefined): url is string {
  return !!url && /^https?:\/\/[^\s"'<>]+$/i.test(url);
}

/** **negrito** em texto JÁ escapado. */
function negrito(html: string): string {
  return html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

function blocosDoCorpo(corpo: string): string[] {
  return corpo
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);
}

function blocoParaHtml(bloco: string): string {
  const linhas = bloco.split('\n');
  const html: string[] = [];
  let lista: string[] = [];
  const fecharLista = () => {
    if (lista.length === 0) return;
    html.push(
      `<ul style="margin:0 0 16px;padding-left:20px;">${lista
        .map((item) => `<li style="margin:0 0 4px;">${item}</li>`)
        .join('')}</ul>`,
    );
    lista = [];
  };
  let paragrafo: string[] = [];
  const fecharParagrafo = () => {
    if (paragrafo.length === 0) return;
    html.push(`<p style="margin:0 0 16px;">${paragrafo.join('<br>')}</p>`);
    paragrafo = [];
  };
  for (const linha of linhas) {
    const conteudo = negrito(escaparHtml(linha.replace(/^\s*-\s+/, '')));
    if (/^\s*-\s+/.test(linha)) {
      fecharParagrafo();
      lista.push(conteudo);
    } else {
      fecharLista();
      paragrafo.push(conteudo);
    }
  }
  fecharParagrafo();
  fecharLista();
  return html.join('');
}

function botaoHtml(texto: string, url: string): string {
  const href = escaparHtml(url);
  return `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;">
  <tr><td style="border-radius:6px;background:${CORES.primaria};">
    <a href="${href}" target="_blank" style="display:inline-block;padding:12px 24px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px;">${escaparHtml(texto)}</a>
  </td></tr>
</table>
<p style="margin:0 0 16px;font-size:13px;color:${CORES.suave};">Se o botão não funcionar, copie e cole este endereço no navegador:<br><a href="${href}" style="color:${CORES.primaria};word-break:break-all;">${href}</a></p>`;
}

function layout(conteudo: string, remetente: string, assunto: string): string {
  const nome = escaparHtml(remetente);
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escaparHtml(assunto)}</title></head>
<body style="margin:0;padding:0;background:${CORES.fundo};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${CORES.fundo};">
  <tr><td align="center" style="padding:24px 12px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border:1px solid ${CORES.borda};border-radius:8px;">
      <tr><td style="padding:20px 28px;border-bottom:1px solid ${CORES.borda};font-family:Arial,Helvetica,sans-serif;font-size:18px;font-weight:700;color:${CORES.primaria};">${nome}</td></tr>
      <tr><td style="padding:24px 28px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:${CORES.texto};">${conteudo}</td></tr>
      <tr><td style="padding:16px 28px;border-top:1px solid ${CORES.borda};font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:${CORES.suave};">Este é um e-mail automático de ${nome} sobre a sua conta. Para falar com a gente, responda esta mensagem.</td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

function textoPuro(corpo: string, textoBotao: string, url: string | undefined, remetente: string): string {
  const semMarcacao = blocosDoCorpo(corpo)
    .map((b) => b.replace(/\*\*(.+?)\*\*/g, '$1'))
    .join('\n\n');
  const botao = url ? `\n\n${textoBotao}: ${url}` : '';
  return `${semMarcacao}${botao}\n\n--\nE-mail automático de ${remetente}.`;
}

/**
 * Monta assunto, HTML e texto. `remetente` = nome exibido no cabeçalho (configuracao_email.remetente_nome).
 */
export function montarEmail(
  tipo: TipoEmail,
  modelo: ConteudoModelo,
  variaveis: Record<string, string>,
  remetente: string,
): EmailMontado {
  const definicao = CATALOGO_EMAILS[tipo];
  const assunto = substituirVariaveis(modelo.assunto, variaveis).replace(/[\r\n]+/g, ' ').trim().slice(0, 200);
  const corpo = substituirVariaveis(modelo.corpo, variaveis);
  const textoBotao = substituirVariaveis(modelo.texto_botao, variaveis).trim();
  const url = variaveis[definicao.variavelLink];
  const urlSegura = ehUrlSegura(url) ? url : undefined;

  const conteudo = blocosDoCorpo(corpo).map(blocoParaHtml).join('') + (urlSegura && textoBotao ? botaoHtml(textoBotao, urlSegura) : '');
  return {
    assunto,
    html: layout(conteudo, remetente, assunto),
    texto: textoPuro(corpo, textoBotao, urlSegura, remetente),
  };
}
