/**
 * Painel de e-mails do super admin (módulo admin-email).
 * Nenhum SMTP real: provedor fake (definirProvedorEmail) e reenfileirador fake (sem Redis).
 * As tabelas globais configuracao_email e modelos_email são salvas no início e restauradas no fim;
 * os e-mails criados aqui são apagados pelo id.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ConfiguracaoEmail, ModeloEmail } from '@prisma/client';
import { buildApp, type App } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { assinarTokenPlataforma } from '../src/plugins/auth';
import { CATALOGO_EMAILS, definirProvedorEmail } from '../src/servicos/email';
import { criarAdaptadorEmailFake, type AdaptadorEmailFake } from '../src/servicos/email/fakeAdapter';
import { definirReenfileiradorEmail } from '../src/modulos/admin-email/servico';
import { descriptografar } from '../src/utils/cripto';

const sufixo = randomUUID().slice(0, 8);
const SENHA = `re_teste_${sufixo}_chaveSecreta9876`;
let app: App;
let tokenAdmin: string;
let adminId: string;
let fake: AdaptadorEmailFake;
let snapshotConfig: ConfiguracaoEmail | null = null;
let snapshotModelos: ModeloEmail[] = [];
const emailsCriados: string[] = [];
const reenfileirados: string[] = [];

function comoAdmin(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) {
  return app.inject({ method, url, headers: { authorization: `Bearer ${tokenAdmin}` }, payload: payload as object });
}

async function configurarCompleto(extra: Record<string, unknown> = {}) {
  const r = await comoAdmin('PUT', '/admin/email/configuracao', {
    smtp_host: 'smtp.resend.com',
    smtp_porta: 465,
    smtp_seguro: true,
    smtp_usuario: 'resend',
    smtp_senha: SENHA,
    remetente_nome: 'Sistema Clínica',
    remetente_email: `nao-responda.${sufixo}@avisos.exemplo.com`,
    responder_para: `suporte.${sufixo}@exemplo.com`,
    ativo: true,
    ...extra,
  });
  expect(r.statusCode, r.body).toBe(200);
  return r.json();
}

async function criarEmail(status: 'enviado' | 'falhou' | 'ignorado' | 'pendente', destinatario: string, erro: string | null = null) {
  const e = await prisma.emailEnviado.create({
    data: {
      tipo: 'boas_vindas',
      referencia: `teste-${sufixo}-${randomUUID()}`,
      destinatario,
      assunto: 'Assunto de teste',
      html: '<p>html de teste</p>',
      texto: 'texto de teste',
      status,
      erro,
    },
  });
  emailsCriados.push(e.id);
  return e;
}

beforeAll(async () => {
  app = await buildApp({ logger: false });
  await app.ready();
  const admin = await prisma.usuarioPlataforma.create({
    data: { nome: 'Super E-mail', email: `super.${sufixo}@email.teste`, senha_hash: 'x' },
  });
  adminId = admin.id;
  tokenAdmin = assinarTokenPlataforma(app, admin.id);
  snapshotConfig = await prisma.configuracaoEmail.findUnique({ where: { id: 1 } });
  snapshotModelos = await prisma.modeloEmail.findMany();
  await prisma.configuracaoEmail.deleteMany({});
  await prisma.modeloEmail.deleteMany({});
});

beforeEach(() => {
  fake = criarAdaptadorEmailFake();
  definirProvedorEmail(fake);
  reenfileirados.length = 0;
  definirReenfileiradorEmail(async (id) => {
    reenfileirados.push(id);
  });
});

afterEach(() => {
  definirProvedorEmail(null);
  definirReenfileiradorEmail(null);
});

afterAll(async () => {
  try {
    await prisma.emailEnviado.deleteMany({ where: { id: { in: emailsCriados } } });
    await prisma.configuracaoEmail.deleteMany({});
    await prisma.modeloEmail.deleteMany({});
    if (snapshotConfig) await prisma.configuracaoEmail.create({ data: snapshotConfig });
    if (snapshotModelos.length) await prisma.modeloEmail.createMany({ data: snapshotModelos });
    await prisma.usuarioPlataforma.deleteMany({ where: { id: adminId } });
  } catch {
    /* outro teste pode ter limpado o banco */
  }
  await app?.close();
  await prisma.$disconnect();
});

describe('acesso', () => {
  it('sem token de admin ⇒ 401', async () => {
    const r = await app.inject({ method: 'GET', url: '/admin/email/configuracao' });
    expect(r.statusCode).toBe(401);
    const r2 = await app.inject({ method: 'GET', url: '/admin/email/envios' });
    expect(r2.statusCode).toBe(401);
  });
});

describe('configuração', () => {
  it('ativar sem senha ⇒ 400 configuracao_incompleta', async () => {
    const r = await comoAdmin('PUT', '/admin/email/configuracao', {
      remetente_email: `remetente.${sufixo}@exemplo.com`,
      ativo: true,
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().erro).toBe('configuracao_incompleta');
    expect(r.json().mensagem).toMatch(/senha/);
  });

  it('valida e-mail e porta', async () => {
    const r = await comoAdmin('PUT', '/admin/email/configuracao', { remetente_email: 'nao-e-email', smtp_porta: 70000 });
    expect(r.statusCode).toBe(400);
    expect(r.json().erro).toBe('validacao');
  });

  it('salva a senha cifrada e nunca a devolve', async () => {
    const visao = await configurarCompleto();
    expect(visao.ativo).toBe(true);
    expect(visao.senha_definida).toBe(true);
    expect(visao.senha_mascarada).toBe(`••••${SENHA.slice(-4)}`);
    expect(JSON.stringify(visao)).not.toContain(SENHA);

    const linha = await prisma.configuracaoEmail.findUniqueOrThrow({ where: { id: 1 } });
    expect(linha.smtp_senha_cifrada).not.toContain(SENHA);
    expect(descriptografar(linha.smtp_senha_cifrada!)).toBe(SENHA);
    expect(linha.smtp_senha_final).toBe(SENHA.slice(-4));

    const get = await comoAdmin('GET', '/admin/email/configuracao');
    expect(get.statusCode).toBe(200);
    expect(get.body).not.toContain(SENHA);
    expect(get.json()).not.toHaveProperty('smtp_senha_cifrada');
  });

  it('senha vazia mantém a atual', async () => {
    await configurarCompleto();
    const r = await comoAdmin('PUT', '/admin/email/configuracao', { smtp_senha: '', remetente_nome: 'Outro Nome' });
    expect(r.statusCode).toBe(200);
    const linha = await prisma.configuracaoEmail.findUniqueOrThrow({ where: { id: 1 } });
    expect(descriptografar(linha.smtp_senha_cifrada!)).toBe(SENHA);
    expect(linha.remetente_nome).toBe('Outro Nome');
  });

  it('testar envia pelo provedor (mesmo com o envio desativado)', async () => {
    await configurarCompleto({ ativo: false });
    const r = await comoAdmin('POST', '/admin/email/configuracao/testar', { para: `destino.${sufixo}@exemplo.com` });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toEqual({ ok: true });
    expect(fake.enviados).toHaveLength(1);
    expect(fake.enviados[0]!.para).toBe(`destino.${sufixo}@exemplo.com`);
  });

  it('testar com falha do SMTP ⇒ 422 falha_smtp', async () => {
    await configurarCompleto();
    fake.falharDefinitivoProximos = 1;
    const r = await comoAdmin('POST', '/admin/email/configuracao/testar', { para: `destino.${sufixo}@exemplo.com` });
    expect(r.statusCode).toBe(422);
    expect(r.json().erro).toBe('falha_smtp');
    expect(r.json().mensagem).toContain('fake');
  });
});

describe('modelos', () => {
  it('lista os 5 tipos com o texto padrão', async () => {
    const r = await comoAdmin('GET', '/admin/email/modelos');
    expect(r.statusCode).toBe(200);
    const lista = r.json() as Array<{ tipo: string; personalizado: boolean; assunto: string; padrao: { assunto: string } }>;
    expect(lista).toHaveLength(Object.keys(CATALOGO_EMAILS).length);
    for (const m of lista) {
      expect(m.personalizado).toBe(false);
      expect(m.assunto).toBe(m.padrao.assunto);
    }
  });

  it('variável desconhecida ⇒ 400 com os nomes', async () => {
    const r = await comoAdmin('PUT', '/admin/email/modelos/boas_vindas', {
      assunto: 'Olá {responsavel}',
      corpo: 'Seu código {codigo_secreto} e {senha}',
      texto_botao: 'Entrar',
      ativo: true,
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().erro).toBe('variavel_desconhecida');
    expect(r.json().mensagem).toContain('{codigo_secreto}');
    expect(r.json().mensagem).toContain('{senha}');
  });

  it('modelo não desligável fica ativo', async () => {
    const r = await comoAdmin('PUT', '/admin/email/modelos/redefinir_senha', {
      assunto: 'Nova senha — {clinica}',
      corpo: 'Olá, {nome}! O link vale {validade}.',
      texto_botao: 'Criar senha',
      ativo: false,
    });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().ativo).toBe(true);
    expect(r.json().personalizado).toBe(true);
    const linha = await prisma.modeloEmail.findUniqueOrThrow({ where: { tipo: 'redefinir_senha' } });
    expect(linha.ativo).toBe(true);
  });

  it('modelo desligável pode ser desligado', async () => {
    const r = await comoAdmin('PUT', '/admin/email/modelos/aviso_renovacao', {
      assunto: 'Vence em breve',
      corpo: 'Olá, {responsavel}.',
      texto_botao: 'Pagar',
      ativo: false,
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().ativo).toBe(false);
  });

  it('DELETE restaura o padrão', async () => {
    await comoAdmin('PUT', '/admin/email/modelos/boas_vindas', {
      assunto: 'Personalizado {clinica}',
      corpo: 'Corpo personalizado',
      texto_botao: 'Entrar',
      ativo: true,
    });
    const d = await comoAdmin('DELETE', '/admin/email/modelos/boas_vindas');
    expect(d.statusCode).toBe(204);
    expect(await prisma.modeloEmail.findUnique({ where: { tipo: 'boas_vindas' } })).toBeNull();
    const lista = (await comoAdmin('GET', '/admin/email/modelos')).json() as Array<{ tipo: string; assunto: string; personalizado: boolean }>;
    const bv = lista.find((m) => m.tipo === 'boas_vindas')!;
    expect(bv.personalizado).toBe(false);
    expect(bv.assunto).toBe(CATALOGO_EMAILS.boas_vindas.padrao.assunto);
  });

  it('prévia escapa HTML e usa variáveis de exemplo', async () => {
    const r = await comoAdmin('POST', '/admin/email/modelos/boas_vindas/previa', {
      assunto: 'Olá {responsavel}',
      corpo: 'Teste <script>alert(1)</script> para **{clinica}**',
      texto_botao: 'Entrar',
    });
    expect(r.statusCode).toBe(200);
    const p = r.json();
    expect(p.assunto).toBe('Olá Maria Silva');
    expect(p.html).toContain('&lt;script&gt;');
    expect(p.html).not.toContain('<script>');
    expect(p.html).toContain('<strong>Clínica Bem Estar</strong>');
    expect(typeof p.texto).toBe('string');
  });

  it('teste de modelo envia com "[Teste] " no assunto', async () => {
    await configurarCompleto();
    const r = await comoAdmin('POST', '/admin/email/modelos/pagamento_confirmado/teste', {
      para: `destino.${sufixo}@exemplo.com`,
      assunto: 'Plano {plano} liberado',
      corpo: 'Valor {valor}',
      texto_botao: 'Acessar',
    });
    expect(r.statusCode, r.body).toBe(200);
    expect(fake.enviados).toHaveLength(1);
    expect(fake.enviados[0]!.assunto).toBe('[Teste] Plano Profissional liberado');
  });

  it('tipo inválido ⇒ 400', async () => {
    const r = await comoAdmin('POST', '/admin/email/modelos/nao_existe/previa', { assunto: 'a', corpo: 'b', texto_botao: 'c' });
    expect(r.statusCode).toBe(400);
  });
});

describe('envios', () => {
  it('lista paginada, filtrada e sem html/texto', async () => {
    const dest = `lista.${sufixo}@exemplo.com`;
    await criarEmail('enviado', dest);
    await criarEmail('falhou', dest, 'Destinatário recusado');
    await criarEmail('ignorado', dest, 'email_desativado');

    const r = await comoAdmin('GET', `/admin/email/envios?busca=LISTA.${sufixo}&por_pagina=2&pagina=1`);
    expect(r.statusCode).toBe(200);
    const corpo = r.json();
    expect(corpo.total).toBe(3);
    expect(corpo.itens).toHaveLength(2);
    expect(corpo.pagina).toBe(1);
    expect(corpo.por_pagina).toBe(2);
    expect(corpo.itens[0]).not.toHaveProperty('html');
    expect(corpo.itens[0]).not.toHaveProperty('texto');
    expect(corpo.itens[0]).toHaveProperty('clinica', null);

    const p2 = (await comoAdmin('GET', `/admin/email/envios?busca=lista.${sufixo}&por_pagina=2&pagina=2`)).json();
    expect(p2.itens).toHaveLength(1);

    const falhas = (await comoAdmin('GET', `/admin/email/envios?busca=lista.${sufixo}&status=falhou`)).json();
    expect(falhas.total).toBe(1);
    expect(falhas.itens[0].erro).toBe('Destinatário recusado');
  });

  it('detalhe traz html e texto', async () => {
    const e = await criarEmail('enviado', `detalhe.${sufixo}@exemplo.com`);
    const r = await comoAdmin('GET', `/admin/email/envios/${e.id}`);
    expect(r.statusCode).toBe(200);
    expect(r.json().html).toBe('<p>html de teste</p>');
    expect(r.json().texto).toBe('texto de teste');
    const nf = await comoAdmin('GET', `/admin/email/envios/${randomUUID()}`);
    expect(nf.statusCode).toBe(404);
  });

  it('reenviar falhou ⇒ pendente + job na fila', async () => {
    await configurarCompleto();
    const e = await criarEmail('falhou', `reenvio.${sufixo}@exemplo.com`, 'Falha temporária');
    const r = await comoAdmin('POST', `/admin/email/envios/${e.id}/reenviar`);
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().status).toBe('pendente');
    expect(r.json().erro).toBeNull();
    expect(reenfileirados).toEqual([e.id]);
  });

  it('reenviar e-mail enviado ⇒ 409', async () => {
    await configurarCompleto();
    const e = await criarEmail('enviado', `reenvio2.${sufixo}@exemplo.com`);
    const r = await comoAdmin('POST', `/admin/email/envios/${e.id}/reenviar`);
    expect(r.statusCode).toBe(409);
    expect(reenfileirados).toHaveLength(0);
  });

  it('reenviar com envio desativado ⇒ 409 email_desativado', async () => {
    await configurarCompleto({ ativo: false });
    const e = await criarEmail('ignorado', `reenvio3.${sufixo}@exemplo.com`, 'email_desativado');
    const r = await comoAdmin('POST', `/admin/email/envios/${e.id}/reenviar`);
    expect(r.statusCode).toBe(409);
    expect(r.json().erro).toBe('email_desativado');
    const linha = await prisma.emailEnviado.findUniqueOrThrow({ where: { id: e.id } });
    expect(linha.status).toBe('ignorado');
  });
});

describe('correções da revisão de segurança', () => {
  it('trocar host/porta/usuário sem informar a senha de novo ⇒ 400 senha_obrigatoria', async () => {
    await configurarCompleto();
    const r = await comoAdmin('PUT', '/admin/email/configuracao', { smtp_host: 'smtp.atacante.example' });
    expect(r.statusCode).toBe(400);
    expect(r.json().erro).toBe('senha_obrigatoria');
    const ok = await comoAdmin('PUT', '/admin/email/configuracao', { smtp_host: 'smtp-relay.brevo.com', smtp_senha: 'nova-chave-123' });
    expect(ok.statusCode, ok.body).toBe(200);
    await configurarCompleto();
  });

  it('link com token de redefinição nunca aparece no detalhe e não pode ser reenviado', async () => {
    await configurarCompleto();
    const e = await prisma.emailEnviado.create({
      data: {
        tipo: 'redefinir_senha',
        referencia: `teste-${sufixo}-${randomUUID()}`,
        destinatario: `token.${sufixo}@exemplo.com`,
        assunto: 'Redefinição',
        html: '<a href="https://app.exemplo.com/redefinir-senha?token=SEGREDO123abc">x</a>',
        texto: 'Criar nova senha: https://app.exemplo.com/redefinir-senha?token=SEGREDO123abc',
        status: 'falhou',
      },
    });
    emailsCriados.push(e.id);
    const r = await comoAdmin('GET', `/admin/email/envios/${e.id}`);
    expect(r.statusCode).toBe(200);
    expect(r.body).not.toContain('SEGREDO123abc');
    expect(r.json().texto).toContain('token=••••');
    const reenvio = await comoAdmin('POST', `/admin/email/envios/${e.id}/reenviar`);
    expect(reenvio.statusCode).toBe(409);
    expect(reenvio.json().erro).toBe('reenvio_indisponivel');
  });
});
