/**
 * Serviço de e-mail transacional: renderização (servicos/email/renderizar.ts — puro) e fila de envio
 * (servicos/email/envio.ts — grava em emails_enviados). Sem SMTP nem Redis: provedor e enfileirador fakes.
 * configuracao_email e modelos_email (globais) são salvas no início e restauradas no fim.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ConfiguracaoEmail, ModeloEmail } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import {
  CATALOGO_EMAILS,
  definirEnfileiradorEmail,
  definirProvedorEmail,
  enfileirarEmail,
  montarEmail,
  processarEnvioEmail,
  variaveisDeExemplo,
} from '../src/servicos/email';
import { criarAdaptadorEmailFake, type AdaptadorEmailFake } from '../src/servicos/email/fakeAdapter';
import { substituirVariaveis } from '../src/servicos/email/renderizar';
import type { JobEnvioEmail } from '../src/servicos/filas';
import { criptografar } from '../src/utils/cripto';

const sufixo = randomUUID().slice(0, 8);
const modeloSimples = { assunto: 'Olá {responsavel}', corpo: 'Corpo', texto_botao: 'Acessar' };

// ============================================================================ renderizar (puro)

describe('montarEmail', () => {
  it('substitui variáveis conhecidas e mantém as desconhecidas', () => {
    expect(substituirVariaveis('{a} e {b} e {c}', { a: '1', b: '2' })).toBe('1 e 2 e {c}');
    // Uma passada só: valor com {x} não é re-substituído.
    expect(substituirVariaveis('{a}', { a: '{b}', b: 'x' })).toBe('{b}');
    const m = montarEmail('boas_vindas', modeloSimples, { responsavel: 'Maria' }, 'Sistema');
    expect(m.assunto).toBe('Olá Maria');
  });

  it('escapa HTML do modelo e dos valores das variáveis', () => {
    const m = montarEmail(
      'boas_vindas',
      { assunto: 'x', corpo: '<b>oi</b> {clinica}', texto_botao: 'Ir' },
      { clinica: '<img src=x onerror=alert(1)>' },
      'Remetente <script>',
    );
    expect(m.html).toContain('&lt;b&gt;oi&lt;/b&gt;');
    expect(m.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(m.html).not.toContain('<img');
    expect(m.html).not.toContain('<script>');
    expect(m.html).toContain('Remetente &lt;script&gt;');
  });

  it('**negrito**, parágrafos e listas', () => {
    const m = montarEmail('boas_vindas', { assunto: 'x', corpo: 'Primeiro **forte**\n\n- um\n- dois\n\nFim', texto_botao: 'Ir' }, {}, 'S');
    expect(m.html).toContain('<strong>forte</strong>');
    expect(m.html).toMatch(/<ul[^>]*><li[^>]*>um<\/li><li[^>]*>dois<\/li><\/ul>/);
    expect((m.html.match(/<p style="margin:0 0 16px;">/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('botão só com link http(s)', () => {
    const comLink = montarEmail('boas_vindas', modeloSimples, { link_acesso: 'https://app.exemplo.com/login' }, 'S');
    expect(comLink.html).toContain('href="https://app.exemplo.com/login"');
    expect(comLink.html).toContain('Acessar');

    const js = montarEmail('boas_vindas', modeloSimples, { link_acesso: 'javascript:alert(1)' }, 'S');
    expect(js.html).not.toContain('javascript:');
    expect(js.html).not.toContain('href=');

    const semLink = montarEmail('boas_vindas', modeloSimples, {}, 'S');
    expect(semLink.html).not.toContain('href=');
  });

  it('texto puro sem marcação, com o link do botão', () => {
    const m = montarEmail(
      'boas_vindas',
      { assunto: 'x', corpo: 'Olá **{responsavel}**\n\nSegundo', texto_botao: 'Acessar' },
      { responsavel: 'Ana', link_acesso: 'https://app.exemplo.com/login' },
      'Sistema Clínica',
    );
    expect(m.texto).toContain('Olá Ana\n\nSegundo');
    expect(m.texto).not.toContain('**');
    expect(m.texto).not.toContain('<');
    expect(m.texto).toContain('Acessar: https://app.exemplo.com/login');
    expect(m.texto).toContain('Sistema Clínica');
  });

  it('assunto sem quebra de linha', () => {
    const m = montarEmail('boas_vindas', { assunto: 'a\r\nBcc: x@y.com', corpo: 'c', texto_botao: 'b' }, {}, 'S');
    expect(m.assunto).not.toMatch(/[\r\n]/);
  });

  it('todos os modelos padrão usam só variáveis do próprio catálogo', () => {
    for (const [tipo, d] of Object.entries(CATALOGO_EMAILS)) {
      const nomes = new Set(d.variaveis.map((v) => v.nome));
      const usadas = [...`${d.padrao.assunto} ${d.padrao.corpo} ${d.padrao.texto_botao}`.matchAll(/\{([a-z_]+)\}/g)].map((x) => x[1]);
      for (const u of usadas) expect(nomes.has(u!), `${tipo}: {${u}}`).toBe(true);
      expect(nomes.has(d.variavelLink), `${tipo}: link`).toBe(true);
      expect(Object.keys(variaveisDeExemplo(tipo as keyof typeof CATALOGO_EMAILS))).toEqual([...nomes]);
    }
  });
});

// ============================================================================ envio (banco)

let snapshotConfig: ConfiguracaoEmail | null = null;
let snapshotModelos: ModeloEmail[] = [];
let fake: AdaptadorEmailFake;
const jobs: JobEnvioEmail[] = [];
const destinos: string[] = [];

function destino(nome: string) {
  const d = `${nome}.${sufixo}@envio.teste`;
  destinos.push(d);
  return d;
}

async function definirConfig(ativo: boolean) {
  const dados = {
    ativo,
    smtp_host: 'smtp.resend.com',
    smtp_porta: 465,
    smtp_seguro: true,
    smtp_usuario: 'resend',
    smtp_senha_cifrada: criptografar('re_chave_de_teste_1234'),
    smtp_senha_final: '1234',
    remetente_nome: 'Sistema Clínica',
    remetente_email: 'nao-responda@avisos.exemplo.com',
  };
  await prisma.configuracaoEmail.upsert({ where: { id: 1 }, create: { id: 1, ...dados }, update: dados });
}

async function enfileirarPendente(nome: string) {
  await definirConfig(true);
  const r = await enfileirarEmail({ tipo: 'boas_vindas', para: destino(nome), variaveis: variaveisDeExemplo('boas_vindas'), referencia: randomUUID() });
  expect(r.status).toBe('enfileirado');
  return (r as { id: string }).id;
}

describe('envio', () => {
  beforeAll(async () => {
    snapshotConfig = await prisma.configuracaoEmail.findUnique({ where: { id: 1 } });
    snapshotModelos = await prisma.modeloEmail.findMany();
    await prisma.configuracaoEmail.deleteMany({});
    await prisma.modeloEmail.deleteMany({});
  });

  beforeEach(() => {
    jobs.length = 0;
    fake = criarAdaptadorEmailFake();
    definirProvedorEmail(fake);
    definirEnfileiradorEmail(async (job) => {
      jobs.push(job);
    });
  });

  afterEach(async () => {
    definirProvedorEmail(null);
    definirEnfileiradorEmail(null);
    await prisma.modeloEmail.deleteMany({});
  });

  afterAll(async () => {
    try {
      await prisma.emailEnviado.deleteMany({ where: { destinatario: { in: destinos } } });
      await prisma.configuracaoEmail.deleteMany({});
      if (snapshotConfig) await prisma.configuracaoEmail.create({ data: snapshotConfig });
      if (snapshotModelos.length) await prisma.modeloEmail.createMany({ data: snapshotModelos });
    } catch {
      /* outro teste pode ter limpado o banco */
    }
    await prisma.$disconnect();
  });

  it('config desativada ⇒ grava ignorado (email_desativado) e não enfileira', async () => {
    await definirConfig(false);
    const r = await enfileirarEmail({ tipo: 'boas_vindas', para: destino('desativado'), variaveis: {}, referencia: randomUUID() });
    expect(r.status).toBe('ignorado');
    expect((r as { motivo: string }).motivo).toBe('email_desativado');
    expect(jobs).toHaveLength(0);
    const linha = await prisma.emailEnviado.findUniqueOrThrow({ where: { id: (r as { id: string }).id } });
    expect(linha.status).toBe('ignorado');
    expect(linha.erro).toBe('email_desativado');
  });

  it('mesmo (tipo, referencia, destinatario) ⇒ duplicado', async () => {
    await definirConfig(true);
    const ref = randomUUID();
    const para = destino('duplicado');
    const r1 = await enfileirarEmail({ tipo: 'boas_vindas', para, variaveis: {}, referencia: ref });
    const r2 = await enfileirarEmail({ tipo: 'boas_vindas', para: para.toUpperCase(), variaveis: {}, referencia: ref });
    expect(r1.status).toBe('enfileirado');
    expect(r2.status).toBe('duplicado');
    expect(jobs).toHaveLength(1);
  });

  it('modelo desligado ⇒ ignorado (modelo_desligado)', async () => {
    await definirConfig(true);
    const p = CATALOGO_EMAILS.aviso_renovacao.padrao;
    await prisma.modeloEmail.create({ data: { tipo: 'aviso_renovacao', ...p, ativo: false } });
    const r = await enfileirarEmail({ tipo: 'aviso_renovacao', para: destino('desligado'), variaveis: {}, referencia: randomUUID() });
    expect(r.status).toBe('ignorado');
    expect((r as { motivo: string }).motivo).toBe('modelo_desligado');
    expect(jobs).toHaveLength(0);
  });

  it('modelo não desligável é enviado mesmo com ativo=false no banco', async () => {
    await definirConfig(true);
    const p = CATALOGO_EMAILS.redefinir_senha.padrao;
    await prisma.modeloEmail.create({ data: { tipo: 'redefinir_senha', ...p, ativo: false } });
    const r = await enfileirarEmail({ tipo: 'redefinir_senha', para: destino('senha'), variaveis: {}, referencia: randomUUID() });
    expect(r.status).toBe('enfileirado');
  });

  it('destinatário inválido ⇒ erro, sem gravar', async () => {
    const r = await enfileirarEmail({ tipo: 'boas_vindas', para: 'sem-arroba', variaveis: {} });
    expect(r).toEqual({ status: 'erro', motivo: 'destinatario_invalido' });
  });

  it('processar com sucesso ⇒ enviado', async () => {
    const id = await enfileirarPendente('sucesso');
    expect(jobs).toEqual([{ emailId: id }]);
    const r = await processarEnvioEmail(id, false);
    expect(r.status).toBe('enviado');
    expect(fake.enviados).toHaveLength(1);
    const linha = await prisma.emailEnviado.findUniqueOrThrow({ where: { id } });
    expect(linha.status).toBe('enviado');
    expect(linha.erro).toBeNull();
    expect(linha.id_externo).toBe('fake-1');
    expect(linha.tentativas).toBe(1);
    expect(linha.enviado_em).not.toBeNull();
    // Reprocessar não envia de novo.
    expect((await processarEnvioEmail(id)).status).toBe('nada');
    expect(fake.enviados).toHaveLength(1);
  });

  it('falha temporária sem ser a última tentativa ⇒ lança e mantém pendente', async () => {
    const id = await enfileirarPendente('temporaria');
    fake.falharProximos = 1;
    await expect(processarEnvioEmail(id, false)).rejects.toThrow(/temporária/);
    const linha = await prisma.emailEnviado.findUniqueOrThrow({ where: { id } });
    expect(linha.status).toBe('pendente');
    expect(linha.erro).toContain('temporária');
    // Próxima tentativa funciona.
    expect((await processarEnvioEmail(id, true)).status).toBe('enviado');
  });

  it('falha temporária na última tentativa ⇒ falhou', async () => {
    const id = await enfileirarPendente('ultima');
    fake.falharProximos = 1;
    const r = await processarEnvioEmail(id, true);
    expect(r.status).toBe('falhou');
  });

  it('falha definitiva ⇒ falhou com o motivo', async () => {
    const id = await enfileirarPendente('definitiva');
    fake.falharDefinitivoProximos = 1;
    const r = await processarEnvioEmail(id, false);
    expect(r.status).toBe('falhou');
    const linha = await prisma.emailEnviado.findUniqueOrThrow({ where: { id } });
    expect(linha.status).toBe('falhou');
    expect(linha.erro).toContain('recusado');
  });

  it("marcador 'enviando' (processo morreu no meio) ⇒ falhou/envio_incerto, sem reenviar", async () => {
    const id = await enfileirarPendente('incerto');
    await prisma.emailEnviado.update({ where: { id }, data: { erro: 'enviando' } });
    const r = await processarEnvioEmail(id, false);
    expect(r).toEqual({ status: 'falhou', erro: 'envio_incerto' });
    expect(fake.enviados).toHaveLength(0);
  });

  it('config desligada depois de enfileirar ⇒ ignorado no processamento', async () => {
    const id = await enfileirarPendente('desligou');
    await definirConfig(false);
    const r = await processarEnvioEmail(id, false);
    expect(r).toEqual({ status: 'ignorado', erro: 'email_desativado' });
    expect(fake.enviados).toHaveLength(0);
  });
});

describe('mascararTokensConteudo', () => {
  it('mascara o token do link (query e &amp;) e mantém o resto', async () => {
    const { mascararTokensConteudo } = await import('../src/servicos/email/envio');
    expect(mascararTokensConteudo('https://x.com/redefinir-senha?token=abc_DEF-123 fim')).toBe(
      'https://x.com/redefinir-senha?token=•••• fim',
    );
    expect(mascararTokensConteudo('<a href="https://x.com/a?b=1&amp;token=zz9">')).toBe('<a href="https://x.com/a?b=1&amp;token=••••">');
    expect(mascararTokensConteudo('sem link')).toBe('sem link');
  });
});
