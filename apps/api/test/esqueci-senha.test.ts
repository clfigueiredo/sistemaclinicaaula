/**
 * E-mails transacionais do auth: boas-vindas no auto-cadastro e "esqueci minha senha"
 * (POST /auth/esqueci-senha, GET /auth/redefinir-senha/validar, POST /auth/redefinir-senha).
 * Cria os PRÓPRIOS dados (nomes únicos) — sem truncate. O envio de e-mail fica ativo com um enfileirador falso
 * (nada vai para o Redis/SMTP); a configuração original de `configuracao_email` é restaurada no fim.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ConfiguracaoEmail } from '@prisma/client';
import { buildApp, type App } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { assinarTokenClinica } from '../src/plugins/auth';
import { CATALOGO_RECURSOS } from '../src/plugins/recursos';
import { aguardarSolicitacoesRedefinicao, hashToken, MAX_TOKENS_POR_JANELA } from '../src/modulos/auth/redefinicaoSenha';
import { definirEnfileiradorEmail, ID_CONFIGURACAO_EMAIL } from '../src/servicos/email';
import { criptografar } from '../src/utils/cripto';
import { gerarHashSenha } from '../src/utils/senha';

const U = randomUUID().slice(0, 8);
const SENHA_ANTIGA = 'senha-antiga-123';
let app: App;
let planoId: string;
let planoCadastroCriado: string | null = null;
let configOriginal: ConfiguracaoEmail | null = null;
const clinicas: string[] = [];
const jobsEnfileirados: string[] = [];

let seqIp = 0;
/** IP diferente a cada chamada: o rate limit (3/min no esqueci-senha) não interfere nos cenários. */
const ipUnico = () => {
  seqIp++;
  return `10.88.${Math.floor(seqIp / 250)}.${(seqIp % 250) + 1}`;
};
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** CPF válido aleatório (para o auto-cadastro). */
function cpfValido(): string {
  const base = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  const dv = (nums: number[]) => {
    const soma = nums.reduce((s, n, i) => s + n * (nums.length + 1 - i), 0);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  const d1 = dv(base);
  const d2 = dv([...base, d1]);
  return [...base, d1, d2].join('');
}

async function criarClinica(sufixo: string, status: 'ativa' | 'inativa' = 'ativa') {
  const clinica = await prisma.clinica.create({
    data: {
      nome: `Clínica Senha ${sufixo} ${U}`,
      documento: `7${String(Math.floor(Math.random() * 1e5)).padStart(5, '0')}${Date.now()}`.slice(0, 14),
      status,
    },
  });
  clinicas.push(clinica.id);
  await prisma.assinatura.create({ data: { clinica_id: clinica.id, plano_id: planoId, status: 'ativa' } });
  return clinica;
}

async function criarUsuario(clinicaId: string, email: string, ativo = true) {
  return prisma.usuario.create({
    data: {
      clinica_id: clinicaId,
      nome: `Usuária ${U}`,
      email,
      senha_hash: await gerarHashSenha(SENHA_ANTIGA),
      papel: 'admin',
      ativo,
    },
  });
}

const novoEmail = (rotulo: string) => `${rotulo}.${randomUUID().slice(0, 6)}.${U}@senha.local`;

async function pedirLink(email: string) {
  const r = await app.inject({
    method: 'POST',
    url: '/auth/esqueci-senha',
    payload: { email },
    remoteAddress: ipUnico(),
  });
  await aguardarSolicitacoesRedefinicao();
  return r;
}

async function emailsRedefinicao(destinatario: string) {
  return prisma.emailEnviado.findMany({
    where: { tipo: 'redefinir_senha', destinatario },
    orderBy: { criado_em: 'asc' },
  });
}

function tokenDoEmail(conteudo: string): string {
  const m = conteudo.match(/redefinir-senha\?token=([A-Za-z0-9_%-]+)/);
  if (!m) throw new Error('Link de redefinição não encontrado no e-mail');
  return decodeURIComponent(m[1]!);
}

/** Pede um link e devolve o token em claro (lido do e-mail registrado). */
async function obterToken(email: string): Promise<string> {
  const antes = (await emailsRedefinicao(email)).length;
  await pedirLink(email);
  const emails = await emailsRedefinicao(email);
  expect(emails.length).toBe(antes + 1);
  return tokenDoEmail(emails.at(-1)!.texto + emails.at(-1)!.html);
}

const validar = (token: string) =>
  app.inject({
    method: 'GET',
    url: `/auth/redefinir-senha/validar?token=${encodeURIComponent(token)}`,
    remoteAddress: ipUnico(),
  });
const redefinir = (token: string, senha: string) =>
  app.inject({ method: 'POST', url: '/auth/redefinir-senha', payload: { token, senha }, remoteAddress: ipUnico() });
const login = (email: string, senha: string) =>
  app.inject({ method: 'POST', url: '/auth/login', payload: { email, senha }, remoteAddress: ipUnico() });

async function configurarEmail(ativo: boolean) {
  const dados = {
    ativo,
    smtp_senha_cifrada: criptografar('chave-smtp-de-teste'),
    smtp_senha_final: 'este',
    remetente_email: 'nao-responda@teste.local',
  };
  await prisma.configuracaoEmail.upsert({
    where: { id: ID_CONFIGURACAO_EMAIL },
    create: { id: ID_CONFIGURACAO_EMAIL, ...dados },
    update: dados,
  });
}

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  definirEnfileiradorEmail(async (job) => {
    jobsEnfileirados.push(job.emailId);
  });
  configOriginal = await prisma.configuracaoEmail.findUnique({ where: { id: ID_CONFIGURACAO_EMAIL } });

  for (const r of CATALOGO_RECURSOS) {
    await prisma.recurso.upsert({
      where: { codigo: r.codigo },
      create: { codigo: r.codigo, nome: r.nome, tipo: r.tipo, ordem: r.ordem },
      update: {},
    });
  }
  const plano = await prisma.plano.create({
    data: {
      nome: `Plano senha ${U}`,
      recursos: {
        create: CATALOGO_RECURSOS.map((r) => ({ recurso_codigo: r.codigo, habilitado: true, limite: null, periodo: 'total' as const })),
      },
    },
  });
  planoId = plano.id;
  // O auto-cadastro exige um plano ativo marcado como plano_cadastro.
  if (!(await prisma.plano.findFirst({ where: { plano_cadastro: true, ativo: true } }))) {
    const cadastro = await prisma.plano.create({
      data: {
        nome: `Plano cadastro senha ${U}`,
        plano_cadastro: true,
        recursos: {
          create: CATALOGO_RECURSOS.map((r) => ({ recurso_codigo: r.codigo, habilitado: true, limite: 1, periodo: 'total' as const })),
        },
      },
    });
    planoCadastroCriado = cadastro.id;
  }
});

beforeEach(async () => {
  await configurarEmail(true);
});

afterAll(async () => {
  try {
    await aguardarSolicitacoesRedefinicao();
    definirEnfileiradorEmail(null);
    if (configOriginal) {
      const { id: _id, atualizado_em: _a, ...resto } = configOriginal;
      await prisma.configuracaoEmail.update({ where: { id: ID_CONFIGURACAO_EMAIL }, data: resto });
    } else {
      await prisma.configuracaoEmail.deleteMany({ where: { id: ID_CONFIGURACAO_EMAIL } });
    }
    await prisma.emailEnviado.deleteMany({ where: { destinatario: { endsWith: `.${U}@senha.local` } } });
    if (clinicas.length) await prisma.clinica.deleteMany({ where: { id: { in: clinicas } } });
    await prisma.plano.deleteMany({ where: { id: { in: [planoId, planoCadastroCriado].filter(Boolean) as string[] } } });
  } finally {
    await app?.close();
    await prisma.$disconnect();
  }
});

// ----------------------------------------------------------------------------

describe('POST /auth/esqueci-senha', () => {
  it('e-mail inexistente ⇒ 204 e nenhum token nem e-mail', async () => {
    const email = novoEmail('ninguem');
    const r = await pedirLink(email);
    expect(r.statusCode).toBe(204);
    expect(r.body).toBe('');
    expect(await emailsRedefinicao(email)).toHaveLength(0);
  });

  it('e-mail existente ⇒ 204, token gravado só como hash e e-mail redefinir_senha com o link', async () => {
    const clinica = await criarClinica('Existe');
    const email = novoEmail('existe');
    const usuario = await criarUsuario(clinica.id, email);

    const r = await pedirLink(email);
    expect(r.statusCode).toBe(204);

    const tokens = await prisma.tokenRedefinicaoSenha.findMany({ where: { usuario_id: usuario.id } });
    expect(tokens).toHaveLength(1);
    const [emailRegistrado] = await emailsRedefinicao(email);
    expect(emailRegistrado).toBeDefined();
    expect(emailRegistrado!.status).toBe('pendente');
    expect(emailRegistrado!.referencia).toBe(tokens[0]!.id);
    expect(emailRegistrado!.clinica_id).toBe(clinica.id);
    expect(jobsEnfileirados).toContain(emailRegistrado!.id);

    const token = tokenDoEmail(emailRegistrado!.texto + emailRegistrado!.html);
    expect(tokens[0]!.token_hash).toBe(hashToken(token));
    expect(tokens[0]!.token_hash).not.toBe(token);
    expect(tokens[0]!.token_hash).toMatch(/^[0-9a-f]{64}$/);
    // Válido por 1 hora.
    const validadeMs = tokens[0]!.expira_em.getTime() - tokens[0]!.criado_em.getTime();
    expect(validadeMs).toBeGreaterThan(59 * 60 * 1000);
    expect(validadeMs).toBeLessThan(61 * 60 * 1000);
  });

  it('mesmo e-mail em 2 clínicas ⇒ 2 tokens e 2 e-mails (um por clínica)', async () => {
    const c1 = await criarClinica('Dupla 1');
    const c2 = await criarClinica('Dupla 2');
    const email = novoEmail('dupla');
    const u1 = await criarUsuario(c1.id, email);
    const u2 = await criarUsuario(c2.id, email);

    await pedirLink(email);
    expect(await prisma.tokenRedefinicaoSenha.count({ where: { usuario_id: u1.id } })).toBe(1);
    expect(await prisma.tokenRedefinicaoSenha.count({ where: { usuario_id: u2.id } })).toBe(1);
    const emails = await emailsRedefinicao(email);
    expect(emails).toHaveLength(2);
    expect(new Set(emails.map((e) => e.clinica_id))).toEqual(new Set([c1.id, c2.id]));
  });

  it('usuário inativo ou clínica inativa ⇒ nada', async () => {
    const clinica = await criarClinica('Inativo');
    const emailInativo = novoEmail('inativo');
    const inativo = await criarUsuario(clinica.id, emailInativo, false);
    const clinicaInativa = await criarClinica('Clínica inativa', 'inativa');
    const emailClinicaInativa = novoEmail('clinica-inativa');
    const daInativa = await criarUsuario(clinicaInativa.id, emailClinicaInativa);

    expect((await pedirLink(emailInativo)).statusCode).toBe(204);
    expect((await pedirLink(emailClinicaInativa)).statusCode).toBe(204);
    expect(await prisma.tokenRedefinicaoSenha.count({ where: { usuario_id: { in: [inativo.id, daInativa.id] } } })).toBe(0);
    expect(await emailsRedefinicao(emailInativo)).toHaveLength(0);
    expect(await emailsRedefinicao(emailClinicaInativa)).toHaveLength(0);
  });

  it(`limite de ${MAX_TOKENS_POR_JANELA} links por hora por usuário (passou ⇒ 204 sem gerar)`, async () => {
    const clinica = await criarClinica('Limite');
    const email = novoEmail('limite');
    const usuario = await criarUsuario(clinica.id, email);

    for (let i = 0; i < MAX_TOKENS_POR_JANELA + 2; i++) {
      expect((await pedirLink(email)).statusCode).toBe(204);
    }
    expect(await prisma.tokenRedefinicaoSenha.count({ where: { usuario_id: usuario.id } })).toBe(MAX_TOKENS_POR_JANELA);
    expect(await emailsRedefinicao(email)).toHaveLength(MAX_TOKENS_POR_JANELA);
  });

  it('rate limit por IP: 4º pedido no mesmo minuto ⇒ 429', async () => {
    const ip = ipUnico();
    const codigos: number[] = [];
    for (let i = 0; i < 4; i++) {
      const r = await app.inject({
        method: 'POST',
        url: '/auth/esqueci-senha',
        payload: { email: novoEmail('rate') },
        remoteAddress: ip,
      });
      codigos.push(r.statusCode);
    }
    await aguardarSolicitacoesRedefinicao();
    expect(codigos).toEqual([204, 204, 204, 429]);
  });
});

describe('GET /auth/redefinir-senha/validar', () => {
  it('token válido ⇒ clínica e e-mail mascarado', async () => {
    const clinica = await criarClinica('Validar');
    const email = novoEmail('maria');
    await criarUsuario(clinica.id, email);
    const token = await obterToken(email);

    const r = await validar(token);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ valido: true, clinica: clinica.nome, email: `ma***@senha.local` });
  });

  it('token inexistente, expirado ou usado ⇒ 400 token_invalido', async () => {
    const clinica = await criarClinica('Inválidos');
    const usuario = await criarUsuario(clinica.id, novoEmail('invalidos'));
    const expirado = `expirado-${randomUUID()}`;
    const usado = `usado-${randomUUID()}`;
    await prisma.tokenRedefinicaoSenha.createMany({
      data: [
        { usuario_id: usuario.id, token_hash: hashToken(expirado), expira_em: new Date(Date.now() - 1000) },
        {
          usuario_id: usuario.id,
          token_hash: hashToken(usado),
          expira_em: new Date(Date.now() + 60_000),
          usado_em: new Date(),
        },
      ],
    });

    for (const token of [`nao-existe-${randomUUID()}`, expirado, usado]) {
      const r = await validar(token);
      expect(r.statusCode, token).toBe(400);
      expect(r.json()).toMatchObject({ erro: 'token_invalido', mensagem: 'Este link é inválido ou expirou. Peça um novo.' });
    }
  });
});

describe('POST /auth/redefinir-senha', () => {
  it('troca a senha (nova entra, antiga não), não reusa o link e derruba as sessões abertas', async () => {
    const clinica = await criarClinica('Redefinir');
    const email = novoEmail('redefinir');
    const usuario = await criarUsuario(clinica.id, email);
    const sessaoAntiga = assinarTokenClinica(app, {
      usuarioId: usuario.id,
      clinicaId: clinica.id,
      papel: 'admin',
      profissionalId: null,
    });
    const antes = await app.inject({ method: 'GET', url: '/me', headers: { authorization: `Bearer ${sessaoAntiga}` } });
    expect(antes.statusCode).toBe(200);

    const token = await obterToken(email);
    await espera(1100); // iat do JWT tem resolução de segundos

    const r = await redefinir(token, 'senha-nova-456');
    expect(r.statusCode).toBe(204);

    expect((await login(email, 'senha-nova-456')).statusCode).toBe(200);
    expect((await login(email, SENHA_ANTIGA)).statusCode).toBe(401);

    const depois = await app.inject({ method: 'GET', url: '/me', headers: { authorization: `Bearer ${sessaoAntiga}` } });
    expect(depois.statusCode).toBe(401);

    const reuso = await redefinir(token, 'outra-senha-789');
    expect(reuso.statusCode).toBe(400);
    expect(reuso.json().erro).toBe('token_invalido');
    expect((await login(email, 'senha-nova-456')).statusCode).toBe(200);
  });

  it('usar um link invalida os outros links pendentes do mesmo usuário', async () => {
    const clinica = await criarClinica('Pendentes');
    const email = novoEmail('pendentes');
    const usuario = await criarUsuario(clinica.id, email);
    const primeiro = await obterToken(email);
    const segundo = await obterToken(email);

    expect((await redefinir(segundo, 'senha-nova-456')).statusCode).toBe(204);
    expect((await validar(primeiro)).statusCode).toBe(400);
    expect((await redefinir(primeiro, 'outra-senha-789')).statusCode).toBe(400);
    expect(await prisma.tokenRedefinicaoSenha.count({ where: { usuario_id: usuario.id, usado_em: null } })).toBe(0);
  });

  it('dois envios simultâneos do mesmo link ⇒ só um troca a senha', async () => {
    const clinica = await criarClinica('Concorrente');
    const email = novoEmail('concorrente');
    await criarUsuario(clinica.id, email);
    const token = await obterToken(email);

    const [a, b] = await Promise.all([redefinir(token, 'senha-a-111111'), redefinir(token, 'senha-b-222222')]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([204, 400]);
  });

  it('senha curta ⇒ 400 validacao; token expirado ⇒ 400 token_invalido', async () => {
    const clinica = await criarClinica('Regras');
    const usuario = await criarUsuario(clinica.id, novoEmail('regras'));
    const expirado = `expirado-${randomUUID()}`;
    await prisma.tokenRedefinicaoSenha.create({
      data: { usuario_id: usuario.id, token_hash: hashToken(expirado), expira_em: new Date(Date.now() - 1000) },
    });

    expect((await redefinir(expirado, '123')).json().erro).toBe('validacao');
    const r = await redefinir(expirado, 'senha-valida-123');
    expect(r.statusCode).toBe(400);
    expect(r.json().erro).toBe('token_invalido');
  });
});

describe('POST /auth/cadastro — boas-vindas', () => {
  it('registra o e-mail boas_vindas (ignorado com envio desativado) sem a senha no conteúdo', async () => {
    await configurarEmail(false);
    const email = novoEmail('cadastro');
    const senha = `Senha-Secreta-${U}`;
    const r = await app.inject({
      method: 'POST',
      url: '/auth/cadastro',
      remoteAddress: ipUnico(),
      payload: {
        nomeClinica: `Clínica Cadastro ${U}`,
        documento: cpfValido(),
        responsavel: 'Maria Responsável',
        email,
        telefone: '11987654321',
        senha,
      },
    });
    expect(r.statusCode).toBe(201);
    const corpo = r.json();
    clinicas.push(corpo.clinica.id);

    // O e-mail é enfileirado sem bloquear a resposta: espera o registro aparecer.
    let registro = null;
    for (let i = 0; i < 50 && !registro; i++) {
      registro = await prisma.emailEnviado.findFirst({ where: { tipo: 'boas_vindas', destinatario: email } });
      if (!registro) await espera(100);
    }
    expect(registro).not.toBeNull();
    expect(registro!.status).toBe('ignorado');
    expect(registro!.erro).toBe('email_desativado');
    expect(registro!.referencia).toBe(corpo.usuario.id);
    expect(registro!.clinica_id).toBe(corpo.clinica.id);
    expect(registro!.html).toContain('Maria Responsável');
    expect(registro!.html).not.toContain(senha);
    expect(registro!.texto).not.toContain(senha);
    expect(registro!.assunto).not.toContain(senha);
  });
});
