/**
 * Testes do módulo pacientes. Cria os PRÓPRIOS dados (nomes únicos) — sem truncate, pois outros
 * módulos podem estar usando o mesmo banco de teste.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PapelUsuario } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { buildApp, type App } from '../src/app';
import { assinarTokenClinica } from '../src/plugins/auth';
import { CATALOGO_RECURSOS } from '../src/plugins/recursos';

// Sufixo só com letras (dígitos no termo de busca ativariam a busca por CPF/telefone).
const U = Array.from({ length: 8 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('');
let app: App;

type Clinica = { id: string; planoId: string; tokens: Record<PapelUsuario, string>; profissionalId: string };
let A: Clinica;
let B: Clinica;

function cpfValido(): string {
  const n = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  if (new Set(n).size === 1) n[0] = (n[0]! + 1) % 10;
  const dv = (base: number[]) => {
    const soma = base.reduce((s, d, i) => s + d * (base.length + 1 - i), 0);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  n.push(dv(n));
  n.push(dv(n));
  return n.join('');
}

async function criarClinica(rotulo: string): Promise<Clinica> {
  for (const r of CATALOGO_RECURSOS) {
    await prisma.recurso.upsert({
      where: { codigo: r.codigo },
      create: { codigo: r.codigo, nome: r.nome, tipo: r.tipo, ordem: r.ordem },
      update: {},
    });
  }
  const plano = await prisma.plano.create({
    data: {
      nome: `Plano pacientes ${U} ${rotulo}`,
      recursos: {
        create: CATALOGO_RECURSOS.map((r) => ({ recurso_codigo: r.codigo, habilitado: true, limite: null, periodo: 'total' as const })),
      },
    },
  });
  const clinica = await prisma.clinica.create({
    data: { nome: `Clínica ${rotulo} ${U}`, documento: `9${Date.now()}${Math.floor(Math.random() * 1e6)}` },
  });
  await prisma.assinatura.create({ data: { clinica_id: clinica.id, plano_id: plano.id, status: 'ativa' } });
  const profissional = await prisma.profissional.create({ data: { clinica_id: clinica.id, nome: `Dr. ${rotulo}` } });
  const tokens = {} as Record<PapelUsuario, string>;
  for (const papel of ['admin', 'recepcao', 'profissional'] as const) {
    const u = await prisma.usuario.create({
      data: {
        clinica_id: clinica.id,
        nome: `${papel} ${rotulo}`,
        email: `${papel}.${rotulo}.${U}@teste.local`,
        senha_hash: 'x',
        papel,
        profissional_id: papel === 'profissional' ? profissional.id : null,
      },
    });
    tokens[papel] = assinarTokenClinica(app, {
      usuarioId: u.id,
      clinicaId: clinica.id,
      papel,
      profissionalId: u.profissional_id,
    });
  }
  return { id: clinica.id, planoId: plano.id, tokens, profissionalId: profissional.id };
}

const h = (token: string) => ({ authorization: `Bearer ${token}` });

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  A = await criarClinica('A');
  B = await criarClinica('B');
});

afterAll(async () => {
  await app?.close();
  // Limpa só o que este arquivo criou (a exclusão da clínica apaga os dados dela em cascata).
  const criadas = [A, B].filter(Boolean);
  await prisma.clinica.deleteMany({ where: { id: { in: criadas.map((c) => c.id) } } });
  await prisma.plano.deleteMany({ where: { id: { in: criadas.map((c) => c.planoId) } } });
  await prisma.$disconnect();
});

describe('cadastro de pacientes', () => {
  it('cria paciente normalizando telefone/WhatsApp com DDI 55 e CPF só dígitos', async () => {
    const cpf = cpfValido();
    const r = await app.inject({
      method: 'POST',
      url: '/pacientes',
      headers: h(A.tokens.recepcao),
      payload: {
        nome: `Maria ${U}`,
        cpf: `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`,
        nascimento: '1990-05-20',
        telefone: '(11) 3333-4444',
        whatsapp: '(11) 99999-8888',
        aceita_whatsapp: true,
      },
    });
    expect(r.statusCode).toBe(201);
    const p = r.json();
    expect(p).toMatchObject({
      cpf,
      telefone: '551133334444',
      whatsapp: '5511999998888',
      nascimento: '1990-05-20',
      aceita_whatsapp: true,
      ativo: true,
    });
    expect(p.clinica_id).toBe(A.id);
  });

  it('aceita o payload mínimo do cadastro rápido da agenda', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/pacientes',
      headers: h(A.tokens.recepcao),
      payload: { nome: `Rápido ${U}`, telefone: '11988887777', whatsapp: '5511988887777', aceita_whatsapp: true },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({
      id: expect.any(String),
      nome: `Rápido ${U}`,
      telefone: '5511988887777',
      whatsapp: '5511988887777',
      aceita_whatsapp: true,
      cpf: null,
    });
  });

  it('aceita_whatsapp é false por padrão e exige número quando true', async () => {
    const ok = await app.inject({
      method: 'POST',
      url: '/pacientes',
      headers: h(A.tokens.admin),
      payload: { nome: `Sem consentimento ${U}` },
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().aceita_whatsapp).toBe(false);

    const r = await app.inject({
      method: 'POST',
      url: '/pacientes',
      headers: h(A.tokens.admin),
      payload: { nome: `Sem número ${U}`, aceita_whatsapp: true },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().detalhes.some((d: { campo: string }) => d.campo === 'body.whatsapp')).toBe(true);
  });

  it('valida CPF e telefone', async () => {
    const r1 = await app.inject({
      method: 'POST',
      url: '/pacientes',
      headers: h(A.tokens.admin),
      payload: { nome: `CPF ruim ${U}`, cpf: '111.111.111-11' },
    });
    expect(r1.statusCode).toBe(400);
    const r2 = await app.inject({
      method: 'POST',
      url: '/pacientes',
      headers: h(A.tokens.admin),
      payload: { nome: `Tel ruim ${U}`, telefone: '123' },
    });
    expect(r2.statusCode).toBe(400);
  });

  it('CPF duplicado na mesma clínica → 409, mas permitido em outra clínica', async () => {
    const cpf = cpfValido();
    const r1 = await app.inject({ method: 'POST', url: '/pacientes', headers: h(A.tokens.admin), payload: { nome: `Um ${U}`, cpf } });
    expect(r1.statusCode).toBe(201);
    const r2 = await app.inject({ method: 'POST', url: '/pacientes', headers: h(A.tokens.admin), payload: { nome: `Dois ${U}`, cpf } });
    expect(r2.statusCode).toBe(409);
    expect(r2.json().erro).toBe('cpf_em_uso');
    const r3 = await app.inject({ method: 'POST', url: '/pacientes', headers: h(B.tokens.admin), payload: { nome: `Três ${U}`, cpf } });
    expect(r3.statusCode).toBe(201);

    // edição para CPF de outro paciente também dá 409
    const outro = await app.inject({ method: 'POST', url: '/pacientes', headers: h(A.tokens.admin), payload: { nome: `Quatro ${U}` } });
    const r4 = await app.inject({
      method: 'PUT',
      url: `/pacientes/${outro.json().id}`,
      headers: h(A.tokens.admin),
      payload: { nome: `Quatro ${U}`, cpf },
    });
    expect(r4.statusCode).toBe(409);
  });

  it('convênio de outra clínica → 404', async () => {
    const convB = await prisma.convenio.create({ data: { clinica_id: B.id, nome: `Conv B ${U}` } });
    const r = await app.inject({
      method: 'POST',
      url: '/pacientes',
      headers: h(A.tokens.admin),
      payload: { nome: `Conv ${U}`, convenio_id: convB.id },
    });
    expect(r.statusCode).toBe(404);
    const convA = await prisma.convenio.create({ data: { clinica_id: A.id, nome: `Conv A ${U}` } });
    const ok = await app.inject({
      method: 'POST',
      url: '/pacientes',
      headers: h(A.tokens.admin),
      payload: { nome: `Conv ${U}`, convenio_id: convA.id, numero_carteirinha: '123' },
    });
    expect(ok.statusCode).toBe(201);
    const det = await app.inject({ method: 'GET', url: `/pacientes/${ok.json().id}`, headers: h(A.tokens.admin) });
    expect(det.json().convenio).toMatchObject({ id: convA.id, nome: `Conv A ${U}` });
  });

  it('profissional não edita dados cadastrais', async () => {
    const r = await app.inject({ method: 'POST', url: '/pacientes', headers: h(A.tokens.profissional), payload: { nome: `X ${U}` } });
    expect(r.statusCode).toBe(403);
  });
});

describe('busca e listagem', () => {
  it('busca por nome sem acento/caixa, por CPF e por telefone, paginada e ordenada', async () => {
    const cpf = cpfValido();
    for (const nome of [`Zé Antônio ${U}`, `José Antônio ${U}`, `Joséfa Lima ${U}`]) {
      await app.inject({ method: 'POST', url: '/pacientes', headers: h(A.tokens.admin), payload: { nome } });
    }
    await app.inject({
      method: 'POST',
      url: '/pacientes',
      headers: h(A.tokens.admin),
      payload: { nome: `Busca Doc ${U}`, cpf, telefone: '(21) 98765-4321' },
    });

    const r = await app.inject({
      method: 'GET',
      url: `/pacientes?busca=${encodeURIComponent(`JOSE ANTONIO ${U}`)}`,
      headers: h(A.tokens.recepcao),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().itens.map((p: { nome: string }) => p.nome)).toEqual([`José Antônio ${U}`]);

    const r2 = await app.inject({ method: 'GET', url: `/pacientes?busca=antonio ${U}`, headers: h(A.tokens.recepcao) });
    expect(r2.json().total).toBe(2);
    expect(r2.json().itens.map((p: { nome: string }) => p.nome)).toEqual([`José Antônio ${U}`, `Zé Antônio ${U}`]);

    const r3 = await app.inject({ method: 'GET', url: `/pacientes?busca=antonio ${U}&porPagina=1&pagina=2`, headers: h(A.tokens.recepcao) });
    expect(r3.json()).toMatchObject({ total: 2, pagina: 2, porPagina: 1 });
    expect(r3.json().itens).toHaveLength(1);

    const porCpf = await app.inject({ method: 'GET', url: `/pacientes?busca=${cpf}`, headers: h(A.tokens.admin) });
    expect(porCpf.json().itens[0]).toMatchObject({ nome: `Busca Doc ${U}`, cpf });
    const porTel = await app.inject({ method: 'GET', url: `/pacientes?busca=98765-4321`, headers: h(A.tokens.admin) });
    expect(porTel.json().itens.map((p: { nome: string }) => p.nome)).toContain(`Busca Doc ${U}`);
    expect(Object.keys(porTel.json().itens[0])).toEqual(
      expect.arrayContaining(['id', 'nome', 'cpf', 'nascimento', 'telefone', 'whatsapp', 'convenio_id', 'aceita_whatsapp']),
    );

    // isolamento: a clínica B não encontra
    const rB = await app.inject({ method: 'GET', url: `/pacientes?busca=${cpf}`, headers: h(B.tokens.admin) });
    expect(rB.json().total).toBe(0);
  });

  it('inativar tira o paciente da lista padrão', async () => {
    const c = await app.inject({ method: 'POST', url: '/pacientes', headers: h(A.tokens.admin), payload: { nome: `Inativo ${U}` } });
    const id = c.json().id;
    const put = await app.inject({
      method: 'PUT',
      url: `/pacientes/${id}`,
      headers: h(A.tokens.admin),
      payload: { nome: `Inativo ${U}`, ativo: false },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().ativo).toBe(false);
    const lista = await app.inject({ method: 'GET', url: `/pacientes?busca=Inativo ${U}`, headers: h(A.tokens.admin) });
    expect(lista.json().total).toBe(0);
    const todos = await app.inject({ method: 'GET', url: `/pacientes?busca=Inativo ${U}&inativos=true`, headers: h(A.tokens.admin) });
    expect(todos.json().total).toBe(1);
  });

  it('não existe exclusão de paciente', async () => {
    const c = await app.inject({ method: 'POST', url: '/pacientes', headers: h(A.tokens.admin), payload: { nome: `NaoApaga ${U}` } });
    const r = await app.inject({ method: 'DELETE', url: `/pacientes/${c.json().id}`, headers: h(A.tokens.admin) });
    expect(r.statusCode).toBe(404);
  });
});

describe('isolamento entre clínicas', () => {
  it('paciente de outra clínica → 404 em leitura, edição e alergias', async () => {
    const c = await app.inject({ method: 'POST', url: '/pacientes', headers: h(B.tokens.admin), payload: { nome: `Da B ${U}` } });
    const id = c.json().id;
    const get = await app.inject({ method: 'GET', url: `/pacientes/${id}`, headers: h(A.tokens.admin) });
    expect(get.statusCode).toBe(404);
    const put = await app.inject({ method: 'PUT', url: `/pacientes/${id}`, headers: h(A.tokens.admin), payload: { nome: 'hack' } });
    expect(put.statusCode).toBe(404);
    const al = await app.inject({
      method: 'POST',
      url: `/pacientes/${id}/alergias`,
      headers: h(A.tokens.admin),
      payload: { descricao: 'Dipirona' },
    });
    expect(al.statusCode).toBe(404);
    expect((await prisma.paciente.findUnique({ where: { id } }))?.nome).toBe(`Da B ${U}`);
  });
});

describe('alergias e medicações (dados clínicos)', () => {
  it('profissional/admin gerenciam; recepção não vê nem edita', async () => {
    const c = await app.inject({ method: 'POST', url: '/pacientes', headers: h(A.tokens.recepcao), payload: { nome: `Alérgico ${U}` } });
    const id = c.json().id;
    // Vínculo do profissional com o paciente: agendamento feito pela recepção (criado_por ≠ profissional).
    await prisma.agendamento.create({
      data: { clinica_id: A.id, paciente_id: id, profissional_id: A.profissionalId, inicio: new Date(), fim: new Date() },
    });

    const al = await app.inject({
      method: 'POST',
      url: `/pacientes/${id}/alergias`,
      headers: h(A.tokens.profissional),
      payload: { descricao: 'Penicilina', gravidade: 'grave' },
    });
    expect(al.statusCode).toBe(201);
    const med = await app.inject({
      method: 'POST',
      url: `/pacientes/${id}/medicacoes`,
      headers: h(A.tokens.admin),
      payload: { nome: 'Losartana', dosagem: '50 mg', frequencia: '1x ao dia' },
    });
    expect(med.statusCode).toBe(201);

    const recep = await app.inject({
      method: 'POST',
      url: `/pacientes/${id}/alergias`,
      headers: h(A.tokens.recepcao),
      payload: { descricao: 'Látex' },
    });
    expect(recep.statusCode).toBe(403);

    const detRecep = await app.inject({ method: 'GET', url: `/pacientes/${id}`, headers: h(A.tokens.recepcao) });
    expect(detRecep.statusCode).toBe(200);
    expect(detRecep.json()).toMatchObject({ alergias: null, medicacoes: null });

    const detProf = await app.inject({ method: 'GET', url: `/pacientes/${id}`, headers: h(A.tokens.profissional) });
    expect(detProf.json().alergias).toMatchObject([{ descricao: 'Penicilina', gravidade: 'grave' }]);
    expect(detProf.json().medicacoes).toMatchObject([{ nome: 'Losartana', dosagem: '50 mg' }]);

    const put = await app.inject({
      method: 'PUT',
      url: `/pacientes/${id}/alergias/${al.json().id}`,
      headers: h(A.tokens.profissional),
      payload: { descricao: 'Penicilina e derivados', gravidade: 'grave' },
    });
    expect(put.statusCode).toBe(200);
    const del = await app.inject({
      method: 'DELETE',
      url: `/pacientes/${id}/medicacoes/${med.json().id}`,
      headers: h(A.tokens.profissional),
    });
    expect(del.statusCode).toBe(204);
    const delRecep = await app.inject({
      method: 'DELETE',
      url: `/pacientes/${id}/alergias/${al.json().id}`,
      headers: h(A.tokens.recepcao),
    });
    expect(delRecep.statusCode).toBe(403);
  });
});
