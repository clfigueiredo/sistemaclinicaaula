/**
 * Testes do módulo WhatsApp com adaptador FAKE (nada é enviado de verdade) e enfileirador em
 * memória (sem Redis). Cria os próprios dados com nomes/documentos únicos — não limpa o banco.
 */
import { randomUUID } from 'node:crypto';
import { addDays } from 'date-fns';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PapelUsuario, PeriodoLimite } from '@prisma/client';
import { buildApp, type App } from '../src/app';
import { env } from '../src/config/env';
import { prisma } from '../src/lib/prisma';
import { assinarTokenClinica } from '../src/plugins/auth';
import { CATALOGO_RECURSOS, type CodigoRecurso } from '../src/plugins/recursos';
import { definirEnfileirador, enfileirarMensagem, processarEnvio } from '../src/servicos/whatsapp/envio';
import { criarAdaptadorFake, type AdaptadorFake } from '../src/servicos/whatsapp/fakeAdapter';
import { interpretarResposta } from '../src/servicos/whatsapp/mensagens';
import { processarLembretesClinica, selecionarAgendamentosParaLembrete } from '../src/servicos/whatsapp/lembretes';
import { variantesTelefone } from '../src/servicos/whatsapp/telefone';
import { definirProvedorWhatsapp, nomeSessao } from '../src/servicos/whatsapp/whatsappService';
import type { JobEnvioWhatsapp } from '../src/servicos/filas';

const FUSO = 'America/Sao_Paulo';
const sufixo = randomUUID().slice(0, 8);
let seq = 0;

let app: App;
let fake: AdaptadorFake;
const jobs: JobEnvioWhatsapp[] = [];

type Cfg = { habilitado: boolean; limite: number | null; periodo: PeriodoLimite };

async function criarPlano(nome: string, recursos: Partial<Record<CodigoRecurso, Cfg>>) {
  return prisma.plano.create({
    data: {
      nome: `${nome} ${sufixo}`,
      recursos: {
        create: CATALOGO_RECURSOS.map((r) => ({
          recurso_codigo: r.codigo,
          ...(recursos[r.codigo] ?? { habilitado: false, limite: null, periodo: 'total' as const }),
        })),
      },
    },
  });
}

function documentoUnico() {
  return `9${Date.now()}${String(++seq).padStart(3, '0')}`.slice(0, 14);
}

function telefoneUnico() {
  return `55119${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
}

async function criarClinica(nome: string, planoId: string, conectada = true) {
  const clinica = await prisma.clinica.create({ data: { nome: `${nome} ${sufixo}`, documento: documentoUnico() } });
  await prisma.assinatura.create({ data: { clinica_id: clinica.id, plano_id: planoId, status: 'ativa' } });
  const mk = (papel: 'admin' | 'recepcao') =>
    prisma.usuario.create({
      data: {
        clinica_id: clinica.id,
        nome: `${papel} ${nome}`,
        email: `${papel}.${++seq}.${sufixo}@whats.teste`,
        senha_hash: 'x',
        papel,
      },
    });
  const admin = await mk('admin');
  const recepcao = await mk('recepcao');
  const profissional = await prisma.profissional.create({ data: { clinica_id: clinica.id, nome: 'Dra. Ana Teste' } });
  if (conectada) {
    await prisma.whatsappSessao.create({
      data: { clinica_id: clinica.id, nome_sessao: nomeSessao(clinica.id), status: 'conectada', token: 'fake' },
    });
  }
  const token = (u: { id: string; papel: PapelUsuario }) =>
    assinarTokenClinica(app, { usuarioId: u.id, clinicaId: clinica.id, papel: u.papel, profissionalId: null });
  return { clinica, admin, recepcao, profissional, tokenAdmin: token(admin), tokenRecepcao: token(recepcao) };
}

type Clin = Awaited<ReturnType<typeof criarClinica>>;

async function criarPaciente(c: Clin, dados: { aceita?: boolean; whatsapp?: string | null } = {}) {
  return prisma.paciente.create({
    data: {
      clinica_id: c.clinica.id,
      nome: `Paciente ${++seq} Silva`,
      whatsapp: dados.whatsapp === undefined ? telefoneUnico() : dados.whatsapp,
      aceita_whatsapp: dados.aceita ?? true,
    },
  });
}

/** Data/hora local (fuso da clínica) daqui a `dias` dias. */
function emDias(dias: number, hora = '10:00') {
  const dia = formatInTimeZone(addDays(new Date(), dias), FUSO, 'yyyy-MM-dd');
  return fromZonedTime(`${dia}T${hora}:00`, FUSO);
}

async function criarAgendamento(
  c: Clin,
  pacienteId: string,
  inicio: Date,
  status: 'agendado' | 'confirmado' = 'agendado',
) {
  return prisma.agendamento.create({
    data: {
      clinica_id: c.clinica.id,
      paciente_id: pacienteId,
      profissional_id: c.profissional.id,
      inicio,
      fim: new Date(inicio.getTime() + 30 * 60_000),
      status,
    },
  });
}

/** Roda o "worker" para os jobs enfileirados até agora (sem Redis e sem intervalo). */
async function drenarFila() {
  const pendentes = jobs.splice(0);
  for (const j of pendentes) await processarEnvio(j.mensagemId, { ultimaTentativa: true });
}

function webhook(corpo: unknown, token: string | null = env.WEBHOOK_TOKEN) {
  return app.inject({
    method: 'POST',
    url: token === null ? '/webhooks/whatsapp' : `/webhooks/whatsapp?token=${encodeURIComponent(token)}`,
    payload: corpo as object,
  });
}

function msgRecebida(c: Clin, telefone: string, texto: string, id = `false_${telefone}@c.us_${randomUUID()}`) {
  return {
    event: 'onmessage',
    session: nomeSessao(c.clinica.id),
    id,
    body: texto,
    type: 'chat',
    from: `${telefone}@c.us`,
    fromMe: false,
    isGroupMsg: false,
    t: Math.floor(Date.now() / 1000),
  };
}

let planoTeste: { id: string };
let planoGrande: { id: string };

beforeAll(async () => {
  if (!env.WEBHOOK_TOKEN) (env as { WEBHOOK_TOKEN: string }).WEBHOOK_TOKEN = 'token-de-teste-whatsapp';
  for (const r of CATALOGO_RECURSOS) {
    await prisma.recurso.upsert({
      where: { codigo: r.codigo },
      create: { codigo: r.codigo, nome: r.nome, tipo: r.tipo, ordem: r.ordem },
      update: {},
    });
  }
  const um = { habilitado: true, limite: 1, periodo: 'total' as const };
  const ilimitado = { habilitado: true, limite: null, periodo: 'total' as const };
  planoTeste = await criarPlano('WhatsApp teste', { whatsapp: ilimitado, max_mensagens: um });
  planoGrande = await criarPlano('WhatsApp grande', { whatsapp: ilimitado, max_mensagens: ilimitado });

  fake = criarAdaptadorFake();
  definirProvedorWhatsapp(fake);
  definirEnfileirador(async (job) => {
    jobs.push(job);
  });
  app = await buildApp();
});

beforeEach(() => {
  fake.limpar();
  jobs.length = 0;
});

afterAll(async () => {
  definirProvedorWhatsapp(null);
  definirEnfileirador(null);
  await app?.close();
  await prisma.$disconnect();
});

describe('utilitários', () => {
  it('interpreta respostas e variantes de telefone', () => {
    expect(interpretarResposta(' 1 ')).toBe('confirmar');
    expect(interpretarResposta('2.')).toBe('cancelar');
    expect(interpretarResposta('Sim')).toBe('confirmar');
    expect(interpretarResposta('talvez')).toBe('outra');
    expect(variantesTelefone('(11) 99999-8888')).toEqual(['5511999998888', '551199998888']);
    expect(variantesTelefone('551199998888@c.us')).toContain('5511999998888');
  });
});

describe('lembretes', () => {
  it('seleciona só amanhã + agendado + consentimento e não duplica', async () => {
    const c = await criarClinica('Clínica Seleção', planoGrande.id);
    const ok = await criarPaciente(c);
    const semConsentimento = await criarPaciente(c, { aceita: false });
    const semWhats = await criarPaciente(c, { whatsapp: null });

    const alvo = await criarAgendamento(c, ok.id, emDias(1, '10:00'));
    await criarAgendamento(c, ok.id, emDias(1, '15:00'), 'confirmado');
    await criarAgendamento(c, ok.id, emDias(2, '10:00'));
    await criarAgendamento(c, ok.id, emDias(0, '23:30'));
    await criarAgendamento(c, semConsentimento.id, emDias(1, '11:00'));
    await criarAgendamento(c, semWhats.id, emDias(1, '12:00'));

    const selecionados = await selecionarAgendamentosParaLembrete(c.clinica.id);
    expect(selecionados.map((a) => a.id)).toEqual([alvo.id]);

    const r1 = await processarLembretesClinica(c.clinica.id);
    expect(r1).toMatchObject({ selecionados: 1, enfileirados: 1, falharam: 0 });
    expect(jobs).toHaveLength(1);

    // Rodar de novo (lembrete ainda pendente na fila) não duplica.
    const r2 = await processarLembretesClinica(c.clinica.id);
    expect(r2).toMatchObject({ selecionados: 0, enfileirados: 0 });

    await drenarFila();
    expect(fake.enviadas).toHaveLength(1);
    expect(fake.enviadas[0].telefone).toBe(ok.whatsapp);
    expect(fake.enviadas[0].texto).toContain('Responda *1* para confirmar ou *2* para cancelar');

    const msg = await prisma.mensagemWhatsapp.findFirstOrThrow({ where: { agendamento_id: alvo.id, tipo: 'lembrete' } });
    expect(msg).toMatchObject({ status: 'enviada', direcao: 'saida' });
    expect(msg.enviada_em).not.toBeNull();
    expect(msg.id_externo).toMatch(/FAKE/);
    const ag = await prisma.agendamento.findUniqueOrThrow({ where: { id: alvo.id } });
    expect(ag.lembrete_enviado_em).not.toBeNull();

    // Depois de enviado também não duplica, e reprocessar o mesmo job não reenvia.
    expect(await selecionarAgendamentosParaLembrete(c.clinica.id)).toHaveLength(0);
    expect(await processarEnvio(msg.id)).toMatchObject({ status: 'ignorada' });
    expect(fake.enviadas).toHaveLength(1);
  });

  it('clínica sem sessão conectada é ignorada', async () => {
    const c = await criarClinica('Clínica Desconectada', planoGrande.id, false);
    const p = await criarPaciente(c);
    await criarAgendamento(c, p.id, emDias(1));
    const r = await processarLembretesClinica(c.clinica.id);
    expect(r.ignorada).toBe('sessao_desconectada');
    expect(jobs).toHaveLength(0);
  });

  it('respeita max_mensagens do plano de teste: o 2º envio não sai', async () => {
    const c = await criarClinica('Clínica Limite', planoTeste.id);
    const p1 = await criarPaciente(c);
    const p2 = await criarPaciente(c);
    await criarAgendamento(c, p1.id, emDias(1, '09:00'));
    await criarAgendamento(c, p2.id, emDias(1, '09:30'));

    const r = await processarLembretesClinica(c.clinica.id);
    expect(r).toMatchObject({ selecionados: 2, enfileirados: 1, falharam: 1, erros: { limite_atingido: 1 } });
    await drenarFila();
    expect(fake.enviadas).toHaveLength(1);

    const falhou = await prisma.mensagemWhatsapp.findMany({ where: { clinica_id: c.clinica.id, status: 'falhou' } });
    expect(falhou).toHaveLength(1);
    expect(falhou[0].erro).toBe('limite_atingido');

    // Rodar de novo não cria outra mensagem de falha para o mesmo agendamento.
    const r2 = await processarLembretesClinica(c.clinica.id);
    expect(r2.selecionados).toBe(0);
  });

  it('falha temporária mantém pendente para retry e não duplica o envio', async () => {
    const c = await criarClinica('Clínica Retry', planoGrande.id);
    const p = await criarPaciente(c);
    await criarAgendamento(c, p.id, emDias(1));
    await processarLembretesClinica(c.clinica.id);
    const [job] = jobs.splice(0);

    fake.falharProximos = 1;
    await expect(processarEnvio(job.mensagemId)).rejects.toThrow(/simulada/);
    expect((await prisma.mensagemWhatsapp.findUniqueOrThrow({ where: { id: job.mensagemId } })).status).toBe('pendente');

    await expect(processarEnvio(job.mensagemId)).resolves.toMatchObject({ status: 'enviada' });
    await expect(processarEnvio(job.mensagemId)).resolves.toMatchObject({ status: 'ignorada' });
    expect(fake.enviadas).toHaveLength(1);
  });
});

describe('webhook', () => {
  async function prepararLembreteEnviado(c: Clin, telefone?: string) {
    const p = await criarPaciente(c, telefone ? { whatsapp: telefone } : {});
    const ag = await criarAgendamento(c, p.id, emDias(1, '14:00'));
    await processarLembretesClinica(c.clinica.id);
    await drenarFila();
    fake.limpar();
    return { paciente: p, agendamento: ag };
  }

  it('token inválido ou ausente → 401', async () => {
    const c = await criarClinica('Clínica Token', planoGrande.id);
    const corpo = msgRecebida(c, telefoneUnico(), '1');
    expect((await webhook(corpo, null)).statusCode).toBe(401);
    expect((await webhook(corpo, 'errado')).statusCode).toBe(401);
  });

  it('resposta 1 confirma, responde pela fila e é idempotente', async () => {
    const c = await criarClinica('Clínica Confirma', planoGrande.id);
    const { paciente, agendamento } = await prepararLembreteEnviado(c);

    // Responde sem o nono dígito (como o WhatsApp às vezes identifica celulares BR).
    const semNono = `${paciente.whatsapp!.slice(0, 4)}${paciente.whatsapp!.slice(5)}`;
    const corpo = msgRecebida(c, semNono, '1');
    const r = await webhook(corpo);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ ok: true, acao: 'confirmado' });

    expect((await prisma.agendamento.findUniqueOrThrow({ where: { id: agendamento.id } })).status).toBe('confirmado');
    const entrada = await prisma.mensagemWhatsapp.findMany({ where: { clinica_id: c.clinica.id, direcao: 'entrada' } });
    expect(entrada).toHaveLength(1);
    expect(entrada[0]).toMatchObject({ status: 'recebida', paciente_id: paciente.id, agendamento_id: agendamento.id });

    // Resposta de confirmação enfileirada (não enviada direto).
    expect(fake.enviadas).toHaveLength(0);
    expect(jobs).toHaveLength(1);
    await drenarFila();
    expect(fake.enviadas[0].texto).toContain('confirmada');

    // Mesmo evento de novo: não processa duas vezes.
    const r2 = await webhook(corpo);
    expect(r2.json()).toMatchObject({ acao: 'duplicada' });
    expect(await prisma.mensagemWhatsapp.count({ where: { clinica_id: c.clinica.id, direcao: 'entrada' } })).toBe(1);
    expect(jobs).toHaveLength(0);

    // Segunda barreira: índice único parcial (clinica_id, id_externo) nas mensagens de entrada.
    await expect(
      prisma.mensagemWhatsapp.create({
        data: {
          clinica_id: c.clinica.id,
          telefone: paciente.whatsapp!,
          direcao: 'entrada',
          conteudo: '1',
          status: 'recebida',
          id_externo: entrada[0].id_externo,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('resposta 2 cancela, cria aviso para a recepção e outra resposta recebe instruções uma vez', async () => {
    const c = await criarClinica('Clínica Cancela', planoGrande.id);
    const { paciente, agendamento } = await prepararLembreteEnviado(c);

    const r0 = await webhook(msgRecebida(c, paciente.whatsapp!, 'que horas mesmo?'));
    expect(r0.json()).toMatchObject({ acao: 'instrucoes' });
    const r0b = await webhook(msgRecebida(c, paciente.whatsapp!, 'oi?'));
    expect(r0b.json()).toMatchObject({ acao: 'registrada' });
    expect(jobs).toHaveLength(1);
    await drenarFila();

    const r = await webhook(msgRecebida(c, paciente.whatsapp!, '2'));
    expect(r.json()).toMatchObject({ acao: 'cancelado' });
    const cancelado = await prisma.agendamento.findUniqueOrThrow({ where: { id: agendamento.id } });
    expect(cancelado.status).toBe('cancelado');
    expect(cancelado.motivo_cancelamento).toBe('Cancelado pelo paciente via WhatsApp');
    expect(cancelado.cancelado_em).toBeInstanceOf(Date);
    await drenarFila();
    expect(fake.enviadas.at(-1)?.texto).toContain('cancelada');

    // Recepção lê o aviso e marca como lido.
    const avisos = await app.inject({
      method: 'GET',
      url: '/whatsapp/avisos',
      headers: { authorization: `Bearer ${c.tokenRecepcao}` },
    });
    expect(avisos.statusCode).toBe(200);
    const corpo = avisos.json();
    expect(corpo.nao_lidos).toBe(1);
    expect(corpo.itens[0]).toMatchObject({ tipo: 'aviso', lido: false, paciente: { id: paciente.id } });

    const lido = await app.inject({
      method: 'POST',
      url: `/whatsapp/avisos/${corpo.itens[0].id}/lido`,
      headers: { authorization: `Bearer ${c.tokenRecepcao}` },
    });
    expect(lido.statusCode).toBe(200);
    const avisoLido = await prisma.mensagemWhatsapp.findUniqueOrThrow({ where: { id: corpo.itens[0].id } });
    expect(avisoLido.lida_em).toBeInstanceOf(Date);
    const depois = await app.inject({
      method: 'GET',
      url: '/whatsapp/avisos?nao_lidos=true',
      headers: { authorization: `Bearer ${c.tokenRecepcao}` },
    });
    expect(depois.json().nao_lidos).toBe(0);

    // Histórico (admin) traz entradas e saídas com paciente, sem os avisos internos.
    const hist = await app.inject({
      method: 'GET',
      url: '/whatsapp/mensagens?pagina=1',
      headers: { authorization: `Bearer ${c.tokenAdmin}` },
    });
    expect(hist.statusCode).toBe(200);
    expect(hist.json().total).toBe(6); // lembrete, 3 entradas, instruções e resposta de cancelamento
    expect(hist.json().itens.every((m: { tipo: string | null }) => m.tipo !== 'aviso')).toBe(true);
  });

  it('isolamento: sessão da clínica A não altera agendamento da clínica B com o mesmo telefone', async () => {
    const telefone = telefoneUnico();
    const a = await criarClinica('Clínica Iso A', planoGrande.id);
    const b = await criarClinica('Clínica Iso B', planoGrande.id);
    const la = await prepararLembreteEnviado(a, telefone);
    const lb = await prepararLembreteEnviado(b, telefone);

    const r = await webhook(msgRecebida(a, telefone, '2'));
    expect(r.json()).toMatchObject({ acao: 'cancelado' });
    expect((await prisma.agendamento.findUniqueOrThrow({ where: { id: la.agendamento.id } })).status).toBe('cancelado');
    expect((await prisma.agendamento.findUniqueOrThrow({ where: { id: lb.agendamento.id } })).status).toBe('agendado');
    expect(await prisma.mensagemWhatsapp.count({ where: { clinica_id: b.clinica.id, direcao: 'entrada' } })).toBe(0);
  });

  it('evento de status atualiza a sessão; sessão desconhecida é ignorada', async () => {
    const c = await criarClinica('Clínica Status', planoGrande.id);
    const r = await webhook({ event: 'status-find', session: nomeSessao(c.clinica.id), status: 'desconnectedMobile' });
    expect(r.json()).toMatchObject({ acao: 'status_atualizado' });
    expect((await prisma.whatsappSessao.findUniqueOrThrow({ where: { clinica_id: c.clinica.id } })).status).toBe(
      'desconectada',
    );
    const r2 = await webhook({ event: 'status-find', session: 'clinica_inexistente', status: 'inChat' });
    expect(r2.json()).toMatchObject({ acao: 'ignorado' });
  });
});

describe('rotas da clínica', () => {
  it('recepção não pode conectar (403); admin conecta e recebe QR', async () => {
    const c = await criarClinica('Clínica Rotas', planoGrande.id, false);
    const rec = await app.inject({
      method: 'POST',
      url: '/whatsapp/conectar',
      headers: { authorization: `Bearer ${c.tokenRecepcao}` },
    });
    expect(rec.statusCode).toBe(403);

    const adm = await app.inject({
      method: 'POST',
      url: '/whatsapp/conectar',
      headers: { authorization: `Bearer ${c.tokenAdmin}` },
    });
    expect(adm.statusCode).toBe(200);
    expect(adm.json()).toMatchObject({ status: 'aguardando_qr', qr_code: expect.stringMatching(/^data:image/) });

    const st = await app.inject({ method: 'GET', url: '/whatsapp/status', headers: { authorization: `Bearer ${c.tokenAdmin}` } });
    expect(st.json()).toMatchObject({ recurso_habilitado: true, status: 'aguardando_qr' });

    const des = await app.inject({
      method: 'POST',
      url: '/whatsapp/desconectar',
      headers: { authorization: `Bearer ${c.tokenAdmin}` },
    });
    expect(des.statusCode).toBe(200);
  });

  it('plano sem WhatsApp não conecta (recurso_indisponivel)', async () => {
    const plano = await criarPlano('Sem WhatsApp', {});
    const c = await criarClinica('Clínica Sem Whats', plano.id, false);
    const r = await app.inject({
      method: 'POST',
      url: '/whatsapp/conectar',
      headers: { authorization: `Bearer ${c.tokenAdmin}` },
    });
    expect(r.statusCode).toBe(403);
    expect(r.json().erro).toBe('recurso_indisponivel');
  });

  it('executar lembretes manualmente enfileira os de amanhã', async () => {
    const c = await criarClinica('Clínica Manual', planoGrande.id);
    const p = await criarPaciente(c);
    await criarAgendamento(c, p.id, emDias(1));
    const r = await app.inject({
      method: 'POST',
      url: '/whatsapp/lembretes/executar',
      headers: { authorization: `Bearer ${c.tokenAdmin}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ selecionados: 1, enfileirados: 1 });
    expect(jobs).toHaveLength(1);
  });
});

describe('assinatura inativa (vencida/cancelada/bloqueada)', () => {
  async function inativarAssinatura(c: Clin, como: 'vencida' | 'cancelada' | 'bloqueada') {
    await prisma.assinatura.update({
      where: { clinica_id: c.clinica.id },
      // "vencida" também vale por expiração: status ativa com expira_em no passado.
      data: como === 'vencida' ? { status: 'ativa', expira_em: new Date(Date.now() - 60_000) } : { status: como },
    });
  }

  it('job de lembretes pula a clínica', async () => {
    const c = await criarClinica('Clínica Vencida Lembrete', planoGrande.id);
    const p = await criarPaciente(c);
    await criarAgendamento(c, p.id, emDias(1, '11:00'));
    await inativarAssinatura(c, 'vencida');
    const r = await processarLembretesClinica(c.clinica.id);
    expect(r).toMatchObject({ ignorada: 'assinatura_inativa', enfileirados: 0 });
    expect(jobs).toHaveLength(0);
    expect(await prisma.mensagemWhatsapp.count({ where: { clinica_id: c.clinica.id } })).toBe(0);
  });

  it('enfileiramento grava falhou e o worker não envia o que já estava na fila', async () => {
    const c = await criarClinica('Clínica Bloqueada Envio', planoGrande.id);
    const p = await criarPaciente(c);
    await criarAgendamento(c, p.id, emDias(1, '15:00'));
    await processarLembretesClinica(c.clinica.id);
    expect(jobs).toHaveLength(1); // enfileirado enquanto a assinatura estava ativa

    await inativarAssinatura(c, 'bloqueada');
    await drenarFila();
    expect(fake.enviadas).toHaveLength(0);
    const lembrete = await prisma.mensagemWhatsapp.findFirstOrThrow({ where: { clinica_id: c.clinica.id, tipo: 'lembrete' } });
    expect(lembrete).toMatchObject({ status: 'falhou', erro: 'assinatura_inativa' });

    const nova = await enfileirarMensagem({ clinicaId: c.clinica.id, pacienteId: p.id, tipo: 'confirmacao', conteudo: 'Olá' });
    expect(nova).toMatchObject({ enfileirada: false, erro: 'assinatura_inativa' });
    expect(jobs).toHaveLength(0);
  });

  it('mensagem recebida é gravada, mas não altera o agendamento nem responde', async () => {
    const c = await criarClinica('Clínica Cancelada Webhook', planoGrande.id);
    const p = await criarPaciente(c);
    const ag = await criarAgendamento(c, p.id, emDias(1, '16:00'));
    await processarLembretesClinica(c.clinica.id);
    await drenarFila();
    expect(fake.enviadas).toHaveLength(1);
    fake.limpar();

    await inativarAssinatura(c, 'cancelada');
    const r = await webhook(msgRecebida(c, p.whatsapp!, '2'));
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ acao: 'registrada' });
    expect((await prisma.agendamento.findUniqueOrThrow({ where: { id: ag.id } })).status).toBe('agendado');
    const entrada = await prisma.mensagemWhatsapp.findMany({ where: { clinica_id: c.clinica.id, direcao: 'entrada' } });
    expect(entrada).toHaveLength(1); // só a mensagem recebida (sem aviso de cancelamento)
    expect(entrada[0]).toMatchObject({ conteudo: '2', status: 'recebida', tipo: null });
    expect(jobs).toHaveLength(0);
    expect(fake.enviadas).toHaveLength(0);
  });
});
