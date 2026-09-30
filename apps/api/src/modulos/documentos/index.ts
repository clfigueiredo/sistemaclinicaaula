/**
 * Módulo documentos — receituário, atestado, declaração de comparecimento e pedido de exame em PDF.
 *
 * Contrato: docs/FASE2.md §4. Recurso do plano: `documentos_pdf`. Tabela: documentos_clinicos
 * (IMUTÁVEL: a extensão tenant lança 403 `documento_imutavel` em update/delete + trigger no banco).
 *
 * Rotas (prefixo "/documentos"; autenticarClinica + exigirRecurso('documentos_pdf') + papel admin/profissional):
 *   GET  /documentos/pacientes/:pacienteId   lista (sem `conteudo`), mais recentes primeiro     log `listar`
 *   GET  /documentos/:id                     documento completo                                  log `visualizar`
 *   POST /documentos                         { paciente_id, tipo, conteudo?, titulo?, agendamento_id?, metadados? }
 *                                            201 documento                                        log `criar`
 *   POST /documentos/previa                  mesmo corpo do POST ⇒ PDF de pré-visualização (NADA é gravado)
 *   GET  /documentos/:id/pdf                 application/pdf inline, gerado sob demanda           log `baixar`
 *   Sem PUT/DELETE (404). Correção = novo documento.
 *
 * Regras (as mesmas do prontuário — modulos/prontuario/acesso.ts):
 *   - Recepção: 403 em tudo. `assegurarAcessoProntuario` em TODAS as rotas (vínculo profissional–paciente;
 *     profissional inativo ⇒ 403 `profissional_inativo`).
 *   - Emissão: sempre em nome do profissional do token (`profissionalAutor`): profissional, ou admin vinculado a
 *     profissional ATIVO. Admin sem vínculo lê, mas não emite (403 `sem_profissional_vinculado`).
 *     `autor_id` = usuário logado. `agendamento_id` precisa ser do mesmo paciente.
 *   - Conteúdo: se vier vazio, o servidor monta a partir dos metadados (itens da receita, exames) ou do modelo
 *     padrão (atestado, declaração) — ver modelos.ts. CID no atestado só com `exibir_cid = true`.
 *   - PDF (pdf.ts): A4, cabeçalho da clínica, título, paciente, corpo, cidade + data por extenso (fuso da
 *     clínica), assinatura (nome, especialidade, registro), rodapé com o id do documento. Não é armazenado.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Prisma } from '@prisma/client';
import { formatInTimeZone } from 'date-fns-tz';
import { z } from 'zod';
import { autenticarClinica, exigirPapel } from '../../plugins/auth';
import { exigirRecurso } from '../../plugins/recursos';
import { ErroNegocio, ou404 } from '../../utils/erros';
import { logAcesso } from '../../utils/logAcesso';
import { assegurarAcessoProntuario, profissionalAutor } from '../prontuario/acesso';
import { CorpoDocumento } from './esquemas';
import { textoAtestado, textoDeclaracao, textoExames, textoItensReceita, TITULOS_PADRAO } from './modelos';
import { gerarPdfDocumento, type DadosPdfDocumento } from './pdf';

export const prefixo = '/documentos';

const ENTIDADE_LOG = 'documento_clinico';

const ParamsId = z.object({ id: z.uuid('Documento inválido') });
const ParamsPaciente = z.object({ pacienteId: z.uuid('Paciente inválido') });

const SELECT_PROFISSIONAL = { id: true, nome: true, especialidade: true, registro: true } as const;

const INCLUDE_DETALHE = {
  paciente: { select: { id: true, nome: true } },
  profissional: { select: SELECT_PROFISSIONAL },
  autor: { select: { id: true, nome: true } },
  agendamento: { select: { id: true, inicio: true } },
} as const;

const SELECT_CLINICA = {
  nome: true,
  documento: true,
  endereco: true,
  cidade: true,
  uf: true,
  cep: true,
  telefone: true,
  email: true,
  fuso_horario: true,
} as const;

async function carregarClinica(request: FastifyRequest) {
  return ou404(
    await request.db.clinica.findUnique({ where: { id: request.clinicaId! }, select: SELECT_CLINICA }),
    'Clínica não encontrada.',
  );
}

type Preparado = {
  pacienteId: string;
  profissionalId: string;
  tipo: CorpoDocumento['tipo'];
  titulo: string;
  conteudo: string;
  agendamentoId: string | null;
  metadados: Record<string, unknown> | null;
};

/** Valida permissões/FKs e monta o texto final (comum à emissão e à pré-visualização). */
async function prepararDocumento(request: FastifyRequest, corpo: CorpoDocumento): Promise<Preparado> {
  const profissionalId = await profissionalAutor(request);
  const pacienteBase = await assegurarAcessoProntuario(request, corpo.paciente_id);

  let agendamento: { id: string; inicio: Date; fim: Date } | null = null;
  if (corpo.agendamento_id) {
    agendamento = ou404(
      await request.db.agendamento.findFirst({
        where: { id: corpo.agendamento_id, paciente_id: corpo.paciente_id },
        select: { id: true, inicio: true, fim: true },
      }),
      'Agendamento não encontrado para este paciente.',
    );
  }

  let conteudo = corpo.conteudo?.trim() ?? '';
  let metadados: Record<string, unknown> | null = corpo.metadados ? { ...corpo.metadados } : null;

  switch (corpo.tipo) {
    case 'receita': {
      const itens = corpo.metadados?.itens ?? [];
      if (!conteudo) {
        if (!itens.length) {
          throw new ErroNegocio(400, 'conteudo_vazio', 'Informe ao menos um medicamento ou o texto da receita.');
        }
        conteudo = textoItensReceita(itens);
        metadados = { ...metadados, conteudo_gerado: true };
      }
      break;
    }
    case 'pedido_exame': {
      if (!conteudo) {
        conteudo = textoExames(corpo.metadados);
        metadados = { ...metadados, conteudo_gerado: true };
      }
      break;
    }
    case 'atestado': {
      const m = corpo.metadados;
      // Sem autorização, o CID não é gravado.
      if (metadados) metadados = { dias: m?.dias ?? null, cid: m?.exibir_cid ? (m?.cid ?? null) : null, exibir_cid: !!m?.exibir_cid };
      if (!conteudo) conteudo = textoAtestado(pacienteBase.nome, m);
      break;
    }
    case 'declaracao': {
      const m = { ...(corpo.metadados ?? {}) };
      if (!conteudo) {
        const clinica = await carregarClinica(request);
        const fuso = clinica.fuso_horario;
        if (agendamento) {
          m.data ??= formatInTimeZone(agendamento.inicio, fuso, 'yyyy-MM-dd');
          m.hora_inicio ??= formatInTimeZone(agendamento.inicio, fuso, 'HH:mm');
          m.hora_fim ??= formatInTimeZone(agendamento.fim, fuso, 'HH:mm');
        }
        const dataIso = m.data ?? formatInTimeZone(new Date(), fuso, 'yyyy-MM-dd');
        const [a, mes, d] = dataIso.split('-');
        conteudo = textoDeclaracao(pacienteBase.nome, `${d}/${mes}/${a}`, m);
        metadados = { ...m, data: dataIso };
      }
      break;
    }
  }

  if (!conteudo) throw new ErroNegocio(400, 'conteudo_vazio', 'Informe o conteúdo do documento.');
  if (conteudo.length > 20_000) {
    throw new ErroNegocio(400, 'conteudo_longo', 'Conteúdo muito longo (máx. 20.000 caracteres).');
  }

  return {
    pacienteId: corpo.paciente_id,
    profissionalId,
    tipo: corpo.tipo,
    titulo: corpo.titulo?.trim() || TITULOS_PADRAO[corpo.tipo],
    conteudo,
    agendamentoId: agendamento?.id ?? null,
    metadados,
  };
}

async function enviarPdf(
  request: FastifyRequest,
  reply: FastifyReply,
  dados: Omit<DadosPdfDocumento, 'clinica' | 'paciente' | 'profissional'> & {
    paciente_id: string;
    profissional_id: string;
  },
  nomeArquivo: string,
) {
  const [clinica, paciente, profissional] = await Promise.all([
    carregarClinica(request),
    request.db.paciente.findUnique({ where: { id: dados.paciente_id }, select: { nome: true, cpf: true, nascimento: true } }),
    request.db.profissional.findUnique({ where: { id: dados.profissional_id }, select: SELECT_PROFISSIONAL }),
  ]);
  const pdf = await gerarPdfDocumento({
    ...dados,
    clinica,
    paciente: ou404(paciente, 'Paciente não encontrado.'),
    profissional: ou404(profissional, 'Profissional não encontrado.'),
  });
  return reply
    .header('Content-Type', 'application/pdf')
    .header('Content-Disposition', `inline; filename="${nomeArquivo}"`)
    .header('Cache-Control', 'no-store')
    .send(pdf);
}

const modulo: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', autenticarClinica);
  app.addHook('preHandler', exigirRecurso('documentos_pdf'));
  // Recepção nunca acessa documentos clínicos (dados clínicos — regra 4 do CLAUDE.md).
  app.addHook('preHandler', exigirPapel('admin', 'profissional'));

  app.get('/pacientes/:pacienteId', { schema: { params: ParamsPaciente } }, async (request) => {
    const { pacienteId } = request.params;
    await assegurarAcessoProntuario(request, pacienteId);
    const documentos = await request.db.documentoClinico.findMany({
      where: { paciente_id: pacienteId },
      select: {
        id: true,
        tipo: true,
        titulo: true,
        criado_em: true,
        agendamento_id: true,
        profissional: { select: SELECT_PROFISSIONAL },
        autor: { select: { id: true, nome: true } },
      },
      orderBy: { criado_em: 'desc' },
    });
    await logAcesso(request, 'listar', ENTIDADE_LOG, pacienteId);
    return documentos;
  });

  app.get('/:id', { schema: { params: ParamsId } }, async (request) => {
    const documento = ou404(
      await request.db.documentoClinico.findUnique({ where: { id: request.params.id }, include: INCLUDE_DETALHE }),
      'Documento não encontrado.',
    );
    await assegurarAcessoProntuario(request, documento.paciente_id);
    await logAcesso(request, 'visualizar', ENTIDADE_LOG, documento.id);
    return documento;
  });

  app.post('/', { schema: { body: CorpoDocumento } }, async (request, reply) => {
    const p = await prepararDocumento(request, request.body);
    const documento = await request.db.documentoClinico.create({
      data: {
        tipo: p.tipo,
        paciente_id: p.pacienteId,
        profissional_id: p.profissionalId,
        agendamento_id: p.agendamentoId,
        autor_id: request.usuarioClinica!.id,
        titulo: p.titulo,
        conteudo: p.conteudo,
        metadados: (p.metadados ?? undefined) as Prisma.InputJsonValue | undefined,
      },
      include: INCLUDE_DETALHE,
    });
    await logAcesso(request, 'criar', ENTIDADE_LOG, documento.id);
    return reply.status(201).send(documento);
  });

  app.post('/previa', { schema: { body: CorpoDocumento } }, async (request, reply) => {
    const p = await prepararDocumento(request, request.body);
    return enviarPdf(
      request,
      reply,
      {
        id: 'previa',
        tipo: p.tipo,
        titulo: p.titulo,
        conteudo: p.conteudo,
        metadados: p.metadados,
        criado_em: new Date(),
        paciente_id: p.pacienteId,
        profissional_id: p.profissionalId,
        previa: true,
      },
      'previa.pdf',
    );
  });

  app.get('/:id/pdf', { schema: { params: ParamsId } }, async (request, reply) => {
    const documento = ou404(
      await request.db.documentoClinico.findUnique({ where: { id: request.params.id } }),
      'Documento não encontrado.',
    );
    await assegurarAcessoProntuario(request, documento.paciente_id);
    const fuso = (await carregarClinica(request)).fuso_horario;
    await logAcesso(request, 'baixar', ENTIDADE_LOG, documento.id);
    const nome = `${documento.tipo}-${formatInTimeZone(documento.criado_em, fuso, 'yyyy-MM-dd')}.pdf`;
    return enviarPdf(request, reply, { ...documento, previa: false }, nome);
  });
};

export default modulo;
