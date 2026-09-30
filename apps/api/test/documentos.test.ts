/**
 * Módulo documentos (receita, atestado, declaração, pedido de exame em PDF).
 * Cria os próprios dados (nomes/documentos únicos) e apaga no fim — não limpa o banco.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PapelUsuario, PeriodoLimite } from '@prisma/client';
import { buildApp, type App } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { gerarPdfDocumento, paraWinAnsi } from '../src/modulos/documentos/pdf';
import { assinarTokenClinica } from '../src/plugins/auth';
import { CATALOGO_RECURSOS, type CodigoRecurso } from '../src/plugins/recursos';
import { criarDbTenant } from '../src/plugins/tenant';

const sufixo = randomUUID().slice(0, 8);
let seq = 0;
let app: App;
const clinicas: string[] = [];
const planos: string[] = [];
const ligado = { habilitado: true, limite: null, periodo: 'total' as PeriodoLimite };

async function criarPlano(recursos: Partial<Record<CodigoRecurso, typeof ligado>>) {
  const plano = await prisma.plano.create({
    data: {
      nome: `Docs ${sufixo} ${++seq}`,
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

async function criarClinica(planoId: string) {
  const clinica = await prisma.clinica.create({
    data: {
      nome: `Clínica São João ${sufixo} ${++seq}`,
      documento: `7${Date.now()}${seq}`.slice(0, 14),
      endereco: 'Rua da Consolação, 100',
      cidade: 'São Paulo',
      uf: 'SP',
      telefone: '11988887777',
    },
  });
  clinicas.push(clinica.id);
  await prisma.assinatura.create({ data: { clinica_id: clinica.id, plano_id: planoId, status: 'ativa' } });
  const db = criarDbTenant(clinica.id);
  async function usuario(papel: PapelUsuario, profissionalId: string | null = null) {
    const u = await db.usuario.create({
      data: {
        nome: `${papel} ${++seq}`,
        email: `${papel}.${seq}.${sufixo}@docs.teste`,
        senha_hash: 'x',
        papel,
        profissional_id: profissionalId,
      },
    });
    const token = assinarTokenClinica(app, { usuarioId: u.id, clinicaId: clinica.id, papel, profissionalId });
    return { usuario: u, h: { authorization: `Bearer ${token}` } };
  }
  return { clinica, db, usuario };
}

let A: Awaited<ReturnType<typeof criarClinica>>;
let B: Awaited<ReturnType<typeof criarClinica>>;
let semRecurso: Awaited<ReturnType<typeof criarClinica>>;
type Usu = Awaited<ReturnType<Awaited<ReturnType<typeof criarClinica>>['usuario']>>;
let admin: Usu, adminVinculado: Usu, prof: Usu, profSemVinculo: Usu, profInativo: Usu, recepcao: Usu, adminB: Usu;
let pacienteId: string;
let agendamentoId: string;
let profId: string;

beforeAll(async () => {
  for (const r of CATALOGO_RECURSOS) {
    await prisma.recurso.upsert({
      where: { codigo: r.codigo },
      create: { codigo: r.codigo, nome: r.nome, tipo: r.tipo, ordem: r.ordem },
      update: {},
    });
  }
  app = await buildApp({ logger: false });
  const plano = await criarPlano({ documentos_pdf: ligado });
  A = await criarClinica(plano.id);
  B = await criarClinica(plano.id);
  semRecurso = await criarClinica((await criarPlano({})).id);

  const p1 = await A.db.profissional.create({
    data: { nome: 'Dra. Conceição Araújo', especialidade: 'Clínica médica', registro: 'CRM-SP 123456' },
  });
  const p2 = await A.db.profissional.create({ data: { nome: 'Dr. Admin Médico', registro: 'CRM-SP 999' } });
  const p3 = await A.db.profissional.create({ data: { nome: 'Dr. Sem Vínculo' } });
  const p4 = await A.db.profissional.create({ data: { nome: 'Dr. Inativo', ativo: false } });
  profId = p1.id;
  admin = await A.usuario('admin');
  adminVinculado = await A.usuario('admin', p2.id);
  prof = await A.usuario('profissional', p1.id);
  profSemVinculo = await A.usuario('profissional', p3.id);
  profInativo = await A.usuario('profissional', p4.id);
  recepcao = await A.usuario('recepcao');
  adminB = await B.usuario('admin');

  const paciente = await A.db.paciente.create({
    data: { nome: 'João Gonçalves Simões', cpf: `${Date.now()}`.slice(-11), nascimento: new Date('1980-05-20T00:00:00Z') },
  });
  pacienteId = paciente.id;
  // Agendado pela recepção ⇒ vínculo do profissional com o paciente.
  const ag = await A.db.agendamento.create({
    data: {
      paciente_id: pacienteId,
      profissional_id: p1.id,
      inicio: new Date('2026-09-10T13:00:00Z'),
      fim: new Date('2026-09-10T13:30:00Z'),
      status: 'atendido',
      criado_por: recepcao.usuario.id,
    },
  });
  agendamentoId = ag.id;
  await A.db.agendamento.create({
    data: {
      paciente_id: pacienteId,
      profissional_id: p4.id,
      inicio: new Date('2026-09-11T13:00:00Z'),
      fim: new Date('2026-09-11T13:30:00Z'),
      criado_por: recepcao.usuario.id,
    },
  });
});

afterAll(async () => {
  if (clinicas.length) {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.permitir_exclusao_prontuario = 'on'`);
      await tx.documentoClinico.deleteMany({ where: { clinica_id: { in: clinicas } } });
      await tx.clinica.deleteMany({ where: { id: { in: clinicas } } });
    });
  }
  if (planos.length) await prisma.plano.deleteMany({ where: { id: { in: planos } } });
  await app.close();
});

const receita = () => ({
  paciente_id: pacienteId,
  tipo: 'receita',
  metadados: {
    uso: 'interno',
    itens: [
      { medicamento: 'Amoxicilina 500 mg', quantidade: '21 cápsulas', posologia: 'Tomar 1 cápsula de 8 em 8 horas por 7 dias.' },
      { medicamento: 'Dipirona 1 g', posologia: 'Se dor ou febre, até de 6/6 h.' },
    ],
  },
});

async function logs(acao: string, entidadeId: string) {
  return A.db.logAcesso.count({ where: { acao, entidade: 'documento_clinico', entidade_id: entidadeId } });
}

describe('documentos — permissões', () => {
  it('recepção recebe 403 em tudo', async () => {
    const r1 = await app.inject({ method: 'GET', url: `/documentos/pacientes/${pacienteId}`, headers: recepcao.h });
    const r2 = await app.inject({ method: 'POST', url: '/documentos', headers: recepcao.h, payload: receita() });
    const r3 = await app.inject({ method: 'GET', url: `/documentos/${randomUUID()}/pdf`, headers: recepcao.h });
    expect([r1.statusCode, r2.statusCode, r3.statusCode]).toEqual([403, 403, 403]);
  });

  it('profissional sem vínculo com o paciente recebe 403', async () => {
    const r = await app.inject({ method: 'POST', url: '/documentos', headers: profSemVinculo.h, payload: receita() });
    expect(r.statusCode).toBe(403);
    expect(r.json().erro).toBe('paciente_nao_vinculado');
    const l = await app.inject({ method: 'GET', url: `/documentos/pacientes/${pacienteId}`, headers: profSemVinculo.h });
    expect(l.statusCode).toBe(403);
  });

  it('profissional inativo recebe 403', async () => {
    const r = await app.inject({ method: 'POST', url: '/documentos', headers: profInativo.h, payload: receita() });
    expect(r.statusCode).toBe(403);
    expect(r.json().erro).toBe('profissional_inativo');
  });

  it('admin sem vínculo lê mas não emite', async () => {
    const l = await app.inject({ method: 'GET', url: `/documentos/pacientes/${pacienteId}`, headers: admin.h });
    expect(l.statusCode).toBe(200);
    const r = await app.inject({ method: 'POST', url: '/documentos', headers: admin.h, payload: receita() });
    expect(r.statusCode).toBe(403);
    expect(r.json().erro).toBe('sem_profissional_vinculado');
  });

  it('recurso desligado no plano ⇒ 403 recurso_indisponivel', async () => {
    const u = await semRecurso.usuario('admin');
    const r = await app.inject({ method: 'GET', url: `/documentos/pacientes/${randomUUID()}`, headers: u.h });
    expect(r.statusCode).toBe(403);
    expect(r.json().erro).toBe('recurso_indisponivel');
  });
});

describe('documentos — emissão, imutabilidade, PDF e LGPD', () => {
  let docId: string;

  it('profissional emite receita em nome próprio (texto montado dos itens) e grava log', async () => {
    const r = await app.inject({ method: 'POST', url: '/documentos', headers: prof.h, payload: receita() });
    expect(r.statusCode, r.body).toBe(201);
    const doc = r.json();
    docId = doc.id;
    expect(doc).toMatchObject({ tipo: 'receita', titulo: 'Receituário', profissional_id: profId, autor_id: prof.usuario.id });
    expect(doc.conteudo).toContain('1. Amoxicilina 500 mg — 21 cápsulas');
    expect(doc.metadados.conteudo_gerado).toBe(true);
    expect(await logs('criar', docId)).toBe(1);
  });

  it('valida o corpo por tipo e o CID do atestado exige autorização', async () => {
    const semItens = await app.inject({
      method: 'POST',
      url: '/documentos',
      headers: prof.h,
      payload: { paciente_id: pacienteId, tipo: 'receita' },
    });
    expect(semItens.statusCode).toBe(400);
    const semExames = await app.inject({
      method: 'POST',
      url: '/documentos',
      headers: prof.h,
      payload: { paciente_id: pacienteId, tipo: 'pedido_exame', metadados: { exames: [] } },
    });
    expect(semExames.statusCode).toBe(400);
    const cidSemAutorizacao = await app.inject({
      method: 'POST',
      url: '/documentos',
      headers: adminVinculado.h,
      payload: { paciente_id: pacienteId, tipo: 'atestado', metadados: { dias: 3, cid: 'J11' } },
    });
    expect(cidSemAutorizacao.statusCode).toBe(400);

    const ok = await app.inject({
      method: 'POST',
      url: '/documentos',
      headers: adminVinculado.h,
      payload: { paciente_id: pacienteId, tipo: 'atestado', metadados: { dias: 3, cid: 'j11.1', exibir_cid: true } },
    });
    expect(ok.statusCode, ok.body).toBe(201);
    expect(ok.json().conteudo).toContain('por 3 (três) dias');
    expect(ok.json().metadados).toMatchObject({ cid: 'J11.1', exibir_cid: true });
    expect(ok.json().profissional.nome).toBe('Dr. Admin Médico');
  });

  it('declaração usa o horário do agendamento; agendamento de outro paciente ⇒ 404', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/documentos',
      headers: prof.h,
      payload: { paciente_id: pacienteId, tipo: 'declaracao', agendamento_id: agendamentoId },
    });
    expect(r.statusCode, r.body).toBe(201);
    expect(r.json().conteudo).toContain('10/09/2026, das 10:00 às 10:30');
    const outro = await A.db.paciente.create({ data: { nome: 'Outro' } });
    const r2 = await app.inject({
      method: 'POST',
      url: '/documentos',
      headers: adminVinculado.h,
      payload: { paciente_id: outro.id, tipo: 'declaracao', agendamento_id: agendamentoId },
    });
    expect(r2.statusCode).toBe(404);
  });

  it('não há update nem delete (404) e o registro não muda', async () => {
    const put = await app.inject({ method: 'PUT', url: `/documentos/${docId}`, headers: prof.h, payload: { conteudo: 'x' } });
    const patch = await app.inject({ method: 'PATCH', url: `/documentos/${docId}`, headers: prof.h, payload: { conteudo: 'x' } });
    const del = await app.inject({ method: 'DELETE', url: `/documentos/${docId}`, headers: admin.h });
    expect([put.statusCode, patch.statusCode, del.statusCode]).toEqual([404, 404, 404]);
    const doc = await A.db.documentoClinico.findUniqueOrThrow({ where: { id: docId } });
    expect(doc.conteudo).toContain('Amoxicilina');
  });

  it('lista e detalhe gravam log de acesso', async () => {
    const l = await app.inject({ method: 'GET', url: `/documentos/pacientes/${pacienteId}`, headers: prof.h });
    expect(l.statusCode).toBe(200);
    expect(l.json().length).toBeGreaterThanOrEqual(3);
    expect(l.json()[0]).not.toHaveProperty('conteudo');
    expect(l.json()[0]).toHaveProperty('profissional.registro');
    expect(await logs('listar', pacienteId)).toBeGreaterThanOrEqual(1);

    const d = await app.inject({ method: 'GET', url: `/documentos/${docId}`, headers: prof.h });
    expect(d.statusCode).toBe(200);
    expect(d.json().paciente.nome).toBe('João Gonçalves Simões');
    expect(await logs('visualizar', docId)).toBe(1);
  });

  it('gera o PDF sob demanda (inline) e grava log de download', async () => {
    const r = await app.inject({ method: 'GET', url: `/documentos/${docId}/pdf`, headers: admin.h });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toBe('application/pdf');
    expect(r.headers['content-disposition']).toMatch(/^inline; filename="receita-\d{4}-\d{2}-\d{2}\.pdf"$/);
    expect(r.rawPayload.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(r.rawPayload.length).toBeGreaterThan(1000);
    expect(await logs('baixar', docId)).toBe(1);

    const semVinculo = await app.inject({ method: 'GET', url: `/documentos/${docId}/pdf`, headers: profSemVinculo.h });
    expect(semVinculo.statusCode).toBe(403);
  });

  it('pré-visualização devolve PDF sem gravar documento e registra log LGPD (B7)', async () => {
    const antes = await A.db.documentoClinico.count();
    const logsAntes = await logs('previa', pacienteId);
    const r = await app.inject({
      method: 'POST',
      url: '/documentos/previa',
      headers: prof.h,
      payload: { paciente_id: pacienteId, tipo: 'pedido_exame', metadados: { exames: ['Hemograma completo', 'Glicemia de jejum'] } },
    });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.rawPayload.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(await A.db.documentoClinico.count()).toBe(antes);
    expect(await logs('previa', pacienteId)).toBe(logsAntes + 1);
  });

  it('isolamento: outra clínica não enxerga o documento nem o paciente', async () => {
    const d = await app.inject({ method: 'GET', url: `/documentos/${docId}`, headers: adminB.h });
    const pdf = await app.inject({ method: 'GET', url: `/documentos/${docId}/pdf`, headers: adminB.h });
    const l = await app.inject({ method: 'GET', url: `/documentos/pacientes/${pacienteId}`, headers: adminB.h });
    expect([d.statusCode, pdf.statusCode, l.statusCode]).toEqual([404, 404, 404]);
  });
});

describe('documentos — PDF (pdfkit)', () => {
  it('mantém a acentuação do português com as fontes padrão', async () => {
    const pdf = await gerarPdfDocumento(
      {
        id: randomUUID(),
        tipo: 'atestado',
        titulo: null,
        conteudo: 'Atesto que João esteve em observação — afastamento de três dias.',
        metadados: { exibir_cid: true, cid: 'J11' },
        criado_em: new Date('2026-09-30T15:00:00Z'),
        clinica: {
          nome: 'Clínica Coração',
          documento: '12345678000199',
          endereco: 'Av. Paulista, 1000',
          cidade: 'São Paulo',
          uf: 'SP',
          cep: null,
          telefone: '11988887777',
          email: null,
          fuso_horario: 'America/Sao_Paulo',
        },
        paciente: { nome: 'Conceição Araújo', cpf: null, nascimento: null },
        profissional: { nome: 'Dra. Inês', especialidade: 'Clínica médica', registro: 'CRM-SP 1' },
      },
      { compress: false },
    );
    const s = pdf.toString('latin1');
    expect(s.startsWith('%PDF-')).toBe(true);
    // Texto das fontes padrão sai em hex (WinAnsi: ç = e7, ã = e3…) dentro de arrays TJ; decodifica tudo.
    const texto = [...s.matchAll(/\[(.*?)\] TJ/g)]
      .map((m) => [...m[1]!.matchAll(/<([0-9a-f]+)>/g)].map((h) => Buffer.from(h[1]!, 'hex').toString('latin1')).join(''))
      .join('\n');
    expect(texto).toContain('observação');
    expect(texto).toContain('Conceição Araújo');
    expect(texto).toContain('São Paulo, 30 de setembro de 2026.');
    expect(texto).toContain('João');
    expect(texto).toContain('CID-10');
    expect(texto).toContain('CRM-SP 1');
    expect(texto).toContain('observação \x97 afastamento'); // travessão "—" = 0x97 no WinAnsi
  });

  it('troca caracteres fora do WinAnsi sem perder acentos', () => {
    expect(paraWinAnsi('Pressão ≥ 140 → retornar 😀')).toBe('Pressão >= 140 -> retornar ');
    expect(paraWinAnsi('“Saúde” – ºª €')).toBe('“Saúde” – ºª €');
  });
});
