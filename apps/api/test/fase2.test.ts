/**
 * Fundação da fase 2 do produto: criptografia, slug, configurações da clínica, tenant dos modelos novos,
 * imutabilidade dos documentos clínicos, catálogo de recursos e WhatsApp sem paciente cadastrado.
 * Cria os próprios dados (nomes/documentos únicos) e apaga no fim — não limpa o banco.
 */
import { createCipheriv, randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PeriodoLimite } from '@prisma/client';
import { buildApp, type App } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { assinarTokenClinica } from '../src/plugins/auth';
import { assegurarRecurso, CATALOGO_RECURSOS, type CodigoRecurso } from '../src/plugins/recursos';
import { criarDbTenant } from '../src/plugins/tenant';
import {
  atualizarConfiguracaoClinica,
  obterConfiguracaoClinica,
  obterConfiguracaoClinicaPorId,
} from '../src/servicos/configuracaoClinica';
import type { JobEnvioWhatsapp } from '../src/servicos/filas';
import { definirEnfileirador, enfileirarMensagem, processarEnvio } from '../src/servicos/whatsapp/envio';
import { criarAdaptadorFake } from '../src/servicos/whatsapp/fakeAdapter';
import { textoAgendamentoOnlineRecusado, textoConviteRetorno } from '../src/servicos/whatsapp/mensagens';
import { definirProvedorWhatsapp } from '../src/servicos/whatsapp/whatsappService';
import {
  criptografar,
  criptografarJson,
  descriptografar,
  descriptografarJson,
  ErroCripto,
  finalSegredo,
  mascararSegredo,
} from '../src/utils/cripto';
import { gerarSlug, gerarSlugUnico, validarSlug } from '../src/utils/slug';

const sufixo = randomUUID().slice(0, 8);
let seq = 0;
let app: App;
const clinicas: string[] = [];
const planos: string[] = [];

type Cfg = { habilitado: boolean; limite: number | null; periodo: PeriodoLimite };

async function criarPlano(recursos: Partial<Record<CodigoRecurso, Cfg>>) {
  const plano = await prisma.plano.create({
    data: {
      nome: `Fase2 ${sufixo} ${++seq}`,
      recursos: {
        create: CATALOGO_RECURSOS.map((r) => ({
          recurso_codigo: r.codigo,
          ...(recursos[r.codigo] ?? { habilitado: false, limite: null, periodo: 'total' as const }),
        })),
      },
    },
  });
  planos.push(plano.id);
  return plano;
}

async function criarClinica(planoId: string, slug?: string) {
  const clinica = await prisma.clinica.create({
    data: { nome: `Fase2 ${sufixo} ${++seq}`, documento: `8${Date.now()}${seq}`.slice(0, 14), slug },
  });
  clinicas.push(clinica.id);
  await prisma.assinatura.create({ data: { clinica_id: clinica.id, plano_id: planoId, status: 'ativa' } });
  const admin = await prisma.usuario.create({
    data: { clinica_id: clinica.id, nome: 'Admin', email: `adm.${seq}.${sufixo}@fase2.teste`, senha_hash: 'x', papel: 'admin' },
  });
  const token = assinarTokenClinica(app, { usuarioId: admin.id, clinicaId: clinica.id, papel: 'admin', profissionalId: null });
  return { clinica, admin, token, db: criarDbTenant(clinica.id) };
}

beforeAll(async () => {
  for (const r of CATALOGO_RECURSOS) {
    await prisma.recurso.upsert({
      where: { codigo: r.codigo },
      create: { codigo: r.codigo, nome: r.nome, tipo: r.tipo, ordem: r.ordem },
      update: {},
    });
  }
  app = await buildApp({ logger: false });
});

afterAll(async () => {
  definirEnfileirador(null);
  definirProvedorWhatsapp(null);
  if (clinicas.length) {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.permitir_exclusao_prontuario = 'on'`);
      await tx.documentoClinico.deleteMany({ where: { clinica_id: { in: clinicas } } });
      await tx.mensagemWhatsapp.deleteMany({ where: { clinica_id: { in: clinicas } } });
      await tx.clinica.deleteMany({ where: { id: { in: clinicas } } });
    });
  }
  if (planos.length) await prisma.plano.deleteMany({ where: { id: { in: planos } } });
  await app.close();
});

// ----------------------------------------------------------------------------- cripto

describe('utils/cripto', () => {
  const outraChave = 'b2'.repeat(32);

  it('cifra e decifra (IV aleatório) e JSON', () => {
    const a = criptografar('sk_live_123456789');
    const b = criptografar('sk_live_123456789');
    expect(a).not.toBe(b);
    expect(a.startsWith('v1:')).toBe(true);
    expect(a).not.toContain('sk_live');
    expect(descriptografar(a)).toBe('sk_live_123456789');
    expect(descriptografarJson(criptografarJson({ provedor: 'asaas', api_key: 'abc' }))).toEqual({
      provedor: 'asaas',
      api_key: 'abc',
    });
  });

  it('recusa chave errada, dado adulterado e formato inválido', () => {
    const c = criptografar('segredo', outraChave);
    expect(descriptografar(c, outraChave)).toBe('segredo');
    expect(() => descriptografar(c)).toThrow(ErroCripto);
    const partes = c.split(':');
    partes[3] = Buffer.from('xxxxxxx').toString('base64');
    expect(() => descriptografar(partes.join(':'), outraChave)).toThrow(ErroCripto);
    expect(() => descriptografar('texto-puro')).toThrow(ErroCripto);
  });

  it('recusa tag de autenticação truncada e IV fora de 12 bytes (auditoria B5)', () => {
    const chaveBuf = Buffer.from(outraChave, 'hex');
    // Cifrado "válido" com tag GCM de 4 bytes: o Node aceitaria sem authTagLength.
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', chaveBuf, iv, { authTagLength: 4 });
    const dados = Buffer.concat([c.update('segredo', 'utf8'), c.final()]);
    const curto = ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), dados.toString('base64')].join(':');
    expect(() => descriptografar(curto, outraChave)).toThrow(ErroCripto);

    // Tag de 16 bytes, mas cortada para 8 no texto armazenado.
    const partes = criptografar('segredo', outraChave).split(':');
    partes[2] = Buffer.from(partes[2]!, 'base64').subarray(0, 8).toString('base64');
    expect(() => descriptografar(partes.join(':'), outraChave)).toThrow(ErroCripto);

    // IV de 16 bytes com tag completa.
    const iv16 = randomBytes(16);
    const c16 = createCipheriv('aes-256-gcm', chaveBuf, iv16);
    const d16 = Buffer.concat([c16.update('segredo', 'utf8'), c16.final()]);
    const ivLongo = ['v1', iv16.toString('base64'), c16.getAuthTag().toString('base64'), d16.toString('base64')].join(':');
    expect(() => descriptografar(ivLongo, outraChave)).toThrow(ErroCripto);
  });

  it('mascara sem revelar o segredo', () => {
    expect(finalSegredo('sk_live_abcd1234')).toBe('1234');
    expect(finalSegredo('curto')).toBe('');
    expect(mascararSegredo('sk_live_abcd1234')).toBe('••••1234');
    expect(mascararSegredo('curto')).toBe('••••');
    expect(mascararSegredo(null)).toBe('');
  });
});

// ----------------------------------------------------------------------------- slug

describe('utils/slug', () => {
  it('gera e valida slugs', () => {
    expect(gerarSlug('Clínica São José  & Cia.')).toBe('clinica-sao-jose-cia');
    expect(gerarSlug('!!!')).toBe('clinica');
    expect(validarSlug('clinica-sao-jose')).toBe(true);
    expect(validarSlug('Clinica')).toBe(false);
    expect(validarSlug('a--b')).toBe(false);
    expect(validarSlug('admin')).toBe(false);
    expect(validarSlug('ab')).toBe(false);
  });

  it('gera slug único', async () => {
    const plano = await criarPlano({});
    const nome = `Slug Único ${sufixo}`;
    const primeiro = await gerarSlugUnico(nome);
    expect(primeiro).toBe(gerarSlug(nome));
    await criarClinica(plano.id, primeiro);
    expect(await gerarSlugUnico(nome)).toBe(`${primeiro}-2`);
  });

  it('PUT /me/clinica edita o slug (formato e unicidade)', async () => {
    const plano = await criarPlano({});
    const a = await criarClinica(plano.id, `fase2-a-${sufixo}`);
    const b = await criarClinica(plano.id);
    const h = { authorization: `Bearer ${b.token}` };
    const invalido = await app.inject({ method: 'PUT', url: '/me/clinica', headers: h, payload: { slug: 'Não Pode' } });
    expect(invalido.statusCode).toBe(400);
    const duplicado = await app.inject({ method: 'PUT', url: '/me/clinica', headers: h, payload: { slug: a.clinica.slug } });
    expect(duplicado.statusCode).toBe(409);
    const ok = await app.inject({ method: 'PUT', url: '/me/clinica', headers: h, payload: { slug: `fase2-b-${sufixo}` } });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().slug).toBe(`fase2-b-${sufixo}`);
    const me = await app.inject({ method: 'GET', url: '/me', headers: h });
    expect(me.json().clinica.slug).toBe(`fase2-b-${sufixo}`);
  });
});

// ----------------------------------------------------------------------------- tenant / modelos novos

describe('modelos da fase 2 no tenant', () => {
  it('configuração da clínica é criada sob demanda e isolada', async () => {
    const plano = await criarPlano({});
    const a = await criarClinica(plano.id);
    const b = await criarClinica(plano.id);
    const cfgA = await obterConfiguracaoClinica(a.db);
    expect(cfgA).toMatchObject({ clinica_id: a.clinica.id, ao_ativo: false, retorno_dias_antecedencia: 7 });
    expect((await obterConfiguracaoClinica(a.db)).id).toBe(cfgA.id);
    await atualizarConfiguracaoClinica(a.db, { ao_ativo: true, ao_dias_a_frente: 60 });
    expect(await obterConfiguracaoClinicaPorId(a.clinica.id)).toMatchObject({ ao_ativo: true, ao_dias_a_frente: 60 });
    expect(await obterConfiguracaoClinica(b.db)).toMatchObject({ clinica_id: b.clinica.id, ao_ativo: false });
  });

  it('isola contas/movimentações e rejeita valor não positivo no banco', async () => {
    const plano = await criarPlano({});
    const a = await criarClinica(plano.id);
    const b = await criarClinica(plano.id);
    const conta = await a.db.contaFinanceira.create({ data: { nome: 'Caixa', saldo_inicial: 100 } });
    expect(conta.clinica_id).toBe(a.clinica.id);
    expect(await b.db.contaFinanceira.findUnique({ where: { id: conta.id } })).toBeNull();
    const mov = await a.db.movimentacaoFinanceira.create({
      data: {
        tipo: 'entrada',
        data: new Date('2026-10-01T00:00:00Z'),
        valor: 150.5,
        conta_financeira_id: conta.id,
        forma_pagamento: 'pix',
      },
    });
    expect(mov.valor.toString()).toBe('150.5');
    expect(await b.db.movimentacaoFinanceira.count({ where: { id: mov.id } })).toBe(0);
    await expect(
      a.db.movimentacaoFinanceira.create({
        data: { tipo: 'saida', data: new Date(), valor: 0, conta_financeira_id: conta.id, forma_pagamento: 'dinheiro' },
      }),
    ).rejects.toThrow();
  });

  it('documentos clínicos são imutáveis (extensão e trigger)', async () => {
    const plano = await criarPlano({});
    const a = await criarClinica(plano.id);
    const paciente = await a.db.paciente.create({ data: { nome: 'Paciente Doc' } });
    const prof = await a.db.profissional.create({ data: { nome: 'Dr. Doc', registro: 'CRM 1' } });
    const doc = await a.db.documentoClinico.create({
      data: { tipo: 'atestado', paciente_id: paciente.id, profissional_id: prof.id, conteudo: 'Atesto...' },
    });
    await expect(a.db.documentoClinico.update({ where: { id: doc.id }, data: { conteudo: 'x' } })).rejects.toMatchObject({
      codigo: 'documento_imutavel',
    });
    await expect(a.db.documentoClinico.delete({ where: { id: doc.id } })).rejects.toMatchObject({
      codigo: 'documento_imutavel',
    });
    await expect(prisma.documentoClinico.update({ where: { id: doc.id }, data: { conteudo: 'x' } })).rejects.toThrow(
      /imutável/,
    );
    await expect(prisma.documentoClinico.delete({ where: { id: doc.id } })).rejects.toThrow(/imutável/);
  });

  it('cobranças: só leitura e filtradas pela clínica; gateways proibidos via request.db', async () => {
    const plano = await criarPlano({});
    const a = await criarClinica(plano.id);
    const b = await criarClinica(plano.id);
    await prisma.cobranca.create({
      data: { clinica_id: a.clinica.id, gateway: 'asaas', valor: 99.9, vencimento: new Date('2026-10-10T00:00:00Z') },
    });
    expect(await a.db.cobranca.count()).toBe(1);
    expect(await b.db.cobranca.count()).toBe(0);
    await expect(
      a.db.cobranca.create({ data: { clinica_id: a.clinica.id, gateway: 'asaas', valor: 1, vencimento: new Date() } }),
    ).rejects.toMatchObject({ codigo: 'proibido' });
    await expect(a.db.gatewayPagamento.findMany()).rejects.toMatchObject({ codigo: 'proibido' });
  });
});

// ----------------------------------------------------------------------------- recursos

describe('recursos da fase 2', () => {
  it('catálogo tem os recursos novos e assegurarRecurso respeita o plano', async () => {
    const codigos = CATALOGO_RECURSOS.map((r) => r.codigo);
    for (const c of ['financeiro', 'agendamento_online', 'lista_espera', 'documentos_pdf', 'retorno_automatico', 'dashboard']) {
      expect(codigos).toContain(c);
    }
    const plano = await criarPlano({});
    const a = await criarClinica(plano.id);
    await expect(assegurarRecurso(a.clinica.id, 'dashboard')).rejects.toMatchObject({
      codigo: 'recurso_indisponivel',
      extras: { recurso: 'dashboard' },
    });
    const liberado = await criarPlano({ dashboard: { habilitado: true, limite: null, periodo: 'total' } });
    const b = await criarClinica(liberado.id);
    await expect(assegurarRecurso(b.clinica.id, 'dashboard')).resolves.toBeUndefined();
  });
});

// ----------------------------------------------------------------------------- WhatsApp sem paciente

describe('enfileirarMensagem sem paciente cadastrado', () => {
  it('envia com consentimento externo e recusa sem ele', async () => {
    const jobs: JobEnvioWhatsapp[] = [];
    definirEnfileirador(async (job) => {
      jobs.push(job);
    });
    const fake = criarAdaptadorFake();
    definirProvedorWhatsapp(fake);
    const ilimitado = { habilitado: true, limite: null, periodo: 'total' as const };
    const plano = await criarPlano({ whatsapp: ilimitado, max_mensagens: ilimitado });
    const a = await criarClinica(plano.id);
    const conteudo = textoAgendamentoOnlineRecusado({
      paciente: 'Maria Visitante',
      clinica: 'Clínica X',
      inicio: new Date('2026-10-05T13:00:00Z'),
      fuso: 'America/Sao_Paulo',
      motivo: 'Profissional em congresso',
    });
    expect(conteudo).toContain('Motivo: Profissional em congresso');

    const semConsentimento = await enfileirarMensagem({
      clinicaId: a.clinica.id,
      pacienteId: null,
      telefone: '11988887777',
      tipo: 'agendamento_recusado',
      conteudo,
    });
    expect(semConsentimento).toMatchObject({ enfileirada: false, erro: 'sem_consentimento' });

    const ok = await enfileirarMensagem({
      clinicaId: a.clinica.id,
      pacienteId: null,
      telefone: '11988887777',
      consentimentoExterno: true,
      tipo: 'agendamento_recusado',
      conteudo,
    });
    expect(ok.enfileirada).toBe(true);
    expect(jobs).toHaveLength(1);
    const msg = await prisma.mensagemWhatsapp.findUniqueOrThrow({ where: { id: ok.mensagemId! } });
    expect(msg).toMatchObject({ paciente_id: null, telefone: '5511988887777', consentimento_externo: true, status: 'pendente' });

    const envio = await processarEnvio(ok.mensagemId!);
    expect(envio.status).toBe('enviada');
    expect(fake.enviadas.at(-1)).toMatchObject({ telefone: '5511988887777' });
  });

  it('templates de retorno formatam a data @db.Date sem deslocar o dia', () => {
    const texto = textoConviteRetorno({
      paciente: 'João Silva',
      clinica: 'Clínica X',
      profissional: 'Dra. Ana',
      dataPrevista: new Date('2026-10-20T00:00:00Z'),
      linkAgendamento: 'http://localhost:5173/agendar/clinica-x',
    });
    expect(texto).toContain('20/10/2026');
    expect(texto).toContain('/agendar/clinica-x');
  });
});
