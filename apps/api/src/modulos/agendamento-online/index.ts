/**
 * Módulo agendamento-online — página pública /agendar/:slug + solicitações para a recepção.
 *
 * Contrato completo: docs/FASE2.md §2. Recurso do plano: `agendamento_online`.
 * Tabelas: solicitacoes_agendamento, configuracoes_clinica (campos ao_*), clinicas.slug,
 * profissionais.agendamento_online. Prefixo "" (as rotas trazem o caminho completo).
 *
 * PÚBLICAS (sem JWT; rate limit por IP):
 *   GET  /publico/clinicas/:slug                         60/min  dados da clínica + profissionais visíveis + config pública
 *   GET  /publico/clinicas/:slug/disponibilidade?profissional_id&data=YYYY-MM-DD   60/min  só horários livres
 *   POST /publico/clinicas/:slug/solicitacoes            5/min   cria solicitação `pendente` (honeypot `website`)
 *   Disponível só se: clínica ativa + assinatura ativa + recurso habilitado + configuracoes_clinica.ao_ativo.
 *   Caso contrário 404 `agendamento_indisponivel` (mesma resposta para slug inexistente).
 *   Nunca devolvem dados de pacientes/agendamentos: disponibilidade = { data, fuso, horarios: [{ inicio, fim, hora }] }.
 *
 * INTERNAS (autenticarClinica + exigirRecurso('agendamento_online')):
 *   GET  /solicitacoes?status&pagina&por_pagina          admin, recepção   Paginado (+ profissional)
 *   GET  /solicitacoes/resumo                            admin, recepção   { pendentes } (só horários futuros)
 *   GET  /solicitacoes/:id                               admin, recepção   + pacientes_candidatos (CPF/telefone)
 *   POST /solicitacoes/:id/aprovar                       admin, recepção   { paciente_id?, tipo?, convenio_id?, observacoes? }
 *   POST /solicitacoes/:id/recusar                       admin, recepção   { motivo?, notificar? = true }
 *   GET  /agendamento-online/configuracao                admin
 *   PUT  /agendamento-online/configuracao                admin             (slug é editado em PUT /me/clinica)
 *
 * Decisões:
 *   - Solicitação NÃO consome max_agendamentos; a APROVAÇÃO consome (assegurarLimite com tx) e cria o agendamento
 *     com as validações normais (travarAgendaProfissional + validarHorario, sem encaixe). `criado_por` = quem aprovou.
 *   - Aprovação sem `paciente_id`: se já existe paciente com o MESMO CPF, ele é usado (CPF é único por clínica);
 *     senão cria um paciente novo com os dados + consentimento da solicitação. Casamento por telefone é só
 *     sugestão (`pacientes_candidatos`) — familiares costumam dividir o número.
 *   - WhatsApp de confirmação/recusa só se a SOLICITAÇÃO tiver `aceita_whatsapp` (consentimento dado no formulário
 *     para receber a resposta), para o telefone informado. Aprovação: se o paciente tem `aceita_whatsapp`, vai
 *     pelo paciente; senão sem paciente com `consentimentoExterno` (não altera o cadastro).
 *   - Anti-abuso: rate limit por IP, honeypot `website` (201 falso, nada gravado), máx.
 *     `ao_max_pendentes_por_telefone` pendentes por telefone (409 `limite_solicitacoes`), grava ip/user_agent,
 *     horário revalidado no servidor sob a trava da agenda (409 `horario_indisponivel`).
 *   - Worker: workers/solicitacoesAgendamento.ts expira pendentes cujo horário passou.
 */
import type { FastifyPluginAsyncZod, ZodTypeProvider } from 'fastify-type-provider-zod';
import type { FastifyRequest } from 'fastify';
import type { Prisma, StatusSolicitacaoAgendamento } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { addMinutes } from 'date-fns';
import { z } from 'zod';
import { env } from '../../config/env';
import { autenticarClinica, exigirPapel } from '../../plugins/auth';
import { assegurarLimite, exigirRecurso } from '../../plugins/recursos';
import { atualizarConfiguracaoClinica, obterConfiguracaoClinica } from '../../servicos/configuracaoClinica';
import { enfileirarMensagem, type ResultadoEnfileirar } from '../../servicos/whatsapp/envio';
import {
  textoAgendamentoOnlineConfirmado,
  textoAgendamentoOnlineRecusado,
} from '../../servicos/whatsapp/mensagens';
import { normalizarTelefone, variantesTelefone } from '../../servicos/whatsapp/telefone';
import { somenteDigitos, validarCpf } from '../../utils/documento';
import { ErroNegocio, erros, ou404 } from '../../utils/erros';
import { obterFuso, travarAgendaProfissional, validarHorario } from '../agendamentos/servico';
import { hojeNoFuso, horariosPublicos, profissionaisPublicos, resolverClinicaPublica } from './servico';

export const prefixo = '';

const STATUS = ['pendente', 'aprovada', 'recusada', 'expirada'] as const;

// ----------------------------------------------------------------------------- esquemas

const ParamsSlug = z.object({ slug: z.string().trim().min(1).max(100) });
const Id = z.object({ id: z.uuid('ID inválido.') });
const dataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve estar no formato AAAA-MM-DD.');

const FiltroDisponibilidade = z.object({
  profissional_id: z.uuid('Profissional inválido.'),
  data: dataIso,
});

const CorpoSolicitacao = z.object({
  profissional_id: z.uuid('Selecione o profissional.'),
  inicio: z.coerce
    .date({ error: 'Horário inválido.' })
    .refine((d) => !Number.isNaN(d.getTime()), 'Horário inválido.'),
  nome: z.string().trim().min(3, 'Informe seu nome completo.').max(120, 'Máximo de 120 caracteres.'),
  telefone: z.string().trim().min(8, 'Informe seu WhatsApp.').max(30, 'Telefone inválido.'),
  email: z.union([z.literal(''), z.email('E-mail inválido.').max(200)]).nullish(),
  cpf: z
    .string()
    .trim()
    .max(20)
    .nullish()
    .refine((v) => !v || validarCpf(v), 'CPF inválido.'),
  nascimento: z.union([z.literal(''), dataIso]).nullish(),
  observacoes: z.string().trim().max(1000, 'Máximo de 1000 caracteres.').nullish(),
  aceita_whatsapp: z.boolean({ error: 'Informe se aceita receber mensagens pelo WhatsApp.' }),
  /** Honeypot: campo escondido no formulário. Preenchido = robô. */
  website: z.string().max(500).nullish(),
});

const FiltroLista = z.object({
  status: z.enum(STATUS, 'Status inválido.').optional(),
  pagina: z.coerce.number().int().min(1).default(1),
  por_pagina: z.coerce.number().int().min(1).max(100).default(20),
});

const CorpoAprovar = z.object({
  paciente_id: z.uuid('Paciente inválido.').nullish(),
  tipo: z.enum(['particular', 'convenio']).default('particular'),
  convenio_id: z.uuid('Convênio inválido.').nullish(),
  observacoes: z.string().trim().max(2000, 'Máximo de 2000 caracteres.').nullish(),
});

const CorpoRecusar = z.object({
  motivo: z.string().trim().max(500, 'Máximo de 500 caracteres.').nullish(),
  notificar: z.boolean().default(true),
});

const CorpoConfig = z.object({
  ativo: z.boolean().optional(),
  antecedencia_min_horas: z.coerce.number().int().min(0, 'Mínimo 0.').max(168, 'Máximo de 168 horas.').optional(),
  dias_a_frente: z.coerce.number().int().min(1, 'Mínimo 1 dia.').max(180, 'Máximo de 180 dias.').optional(),
  mensagem_boas_vindas: z.string().trim().max(1000, 'Máximo de 1000 caracteres.').nullish(),
  max_pendentes_por_telefone: z.coerce.number().int().min(1, 'Mínimo 1.').max(10, 'Máximo 10.').optional(),
  profissionais_visiveis: z.array(z.uuid('Profissional inválido.')).max(500).optional(),
});

// ----------------------------------------------------------------------------- helpers

const selecaoSolicitacao = {
  id: true,
  profissional_id: true,
  inicio: true,
  fim: true,
  status: true,
  nome: true,
  telefone: true,
  email: true,
  cpf: true,
  nascimento: true,
  observacoes: true,
  aceita_whatsapp: true,
  paciente_id: true,
  agendamento_id: true,
  motivo_recusa: true,
  analisado_por: true,
  analisado_em: true,
  criado_em: true,
  atualizado_em: true,
  profissional: { select: { id: true, nome: true, especialidade: true } },
  paciente: { select: { id: true, nome: true } },
} satisfies Prisma.SolicitacaoAgendamentoSelect;

function linkPublico(slug: string | null | undefined) {
  return slug ? `${env.WEB_URL_PUBLICA}/agendar/${slug}` : null;
}

function resumoWhatsapp(r: ResultadoEnfileirar) {
  return r.enfileirada ? { enfileirada: true as const } : { enfileirada: false as const, erro: r.erro };
}

async function montarConfiguracao(request: FastifyRequest) {
  const [cfg, clinica, profissionais] = await Promise.all([
    obterConfiguracaoClinica(request.db),
    request.db.clinica.findUnique({ where: { id: request.clinicaId }, select: { slug: true } }),
    request.db.profissional.findMany({
      select: { id: true, nome: true, ativo: true, agendamento_online: true, especialidade: true },
      orderBy: [{ ativo: 'desc' }, { nome: 'asc' }],
    }),
  ]);
  return {
    ativo: cfg.ao_ativo,
    antecedencia_min_horas: cfg.ao_antecedencia_min_horas,
    dias_a_frente: cfg.ao_dias_a_frente,
    mensagem_boas_vindas: cfg.ao_mensagem_boas_vindas,
    max_pendentes_por_telefone: cfg.ao_max_pendentes_por_telefone,
    slug: clinica?.slug ?? null,
    link_publico: linkPublico(clinica?.slug),
    profissionais,
  };
}

// ----------------------------------------------------------------------------- rotas

const modulo: FastifyPluginAsyncZod = async (app) => {
  // ---------------------------------------------------------------- públicas
  await app.register(async (base) => {
    const publico = base.withTypeProvider<ZodTypeProvider>();
    const leitura = { rateLimit: { max: 60, timeWindow: '1 minute' } };

    publico.get(
      '/publico/clinicas/:slug',
      { config: leitura, schema: { params: ParamsSlug } },
      async (request) => {
        const { clinica, config, db } = await resolverClinicaPublica(request.params.slug);
        const profissionais = await profissionaisPublicos(db);
        return {
          clinica: {
            nome: clinica.nome,
            slug: clinica.slug,
            telefone: clinica.telefone,
            endereco: clinica.endereco,
            cidade: clinica.cidade,
            uf: clinica.uf,
            fuso_horario: clinica.fuso_horario,
          },
          mensagem_boas_vindas: config.ao_mensagem_boas_vindas,
          antecedencia_min_horas: config.ao_antecedencia_min_horas,
          dias_a_frente: config.ao_dias_a_frente,
          hoje: hojeNoFuso(clinica.fuso_horario),
          profissionais,
        };
      },
    );

    publico.get(
      '/publico/clinicas/:slug/disponibilidade',
      { config: leitura, schema: { params: ParamsSlug, querystring: FiltroDisponibilidade } },
      async (request) => {
        const { config, db, fuso } = await resolverClinicaPublica(request.params.slug);
        const [prof] = await profissionaisPublicos(db, request.query.profissional_id);
        if (!prof) throw erros.naoEncontrado('Profissional não encontrado.');
        const horarios = await horariosPublicos(db, {
          profissionalId: prof.id,
          duracaoMin: prof.duracao_consulta_min,
          dia: request.query.data,
          fuso,
          config,
        });
        return { data: request.query.data, fuso, horarios };
      },
    );

    publico.post(
      '/publico/clinicas/:slug/solicitacoes',
      { config: { rateLimit: { max: 5, timeWindow: '1 minute' } }, schema: { params: ParamsSlug, body: CorpoSolicitacao } },
      async (request, reply) => {
        const b = request.body;
        const { clinica, config, db, fuso } = await resolverClinicaPublica(request.params.slug);
        const [prof] = await profissionaisPublicos(db, b.profissional_id);

        // Honeypot: responde como se tivesse dado certo, sem gravar nada.
        if (b.website && b.website.trim() !== '') {
          return reply.status(201).send({
            id: randomUUID(),
            status: 'pendente' as const,
            inicio: b.inicio,
            fim: addMinutes(b.inicio, prof?.duracao_consulta_min ?? 30),
            profissional: { nome: prof?.nome ?? '' },
          });
        }
        if (!prof) throw erros.naoEncontrado('Profissional não encontrado.');

        const telefone = normalizarTelefone(b.telefone);
        if (!telefone) throw erros.invalido('Informe um número de WhatsApp válido, com DDD.', 'telefone_invalido');
        const dia = hojeNoFuso(fuso, b.inicio);

        const criada = await db.$transaction(async (tx) => {
          await travarAgendaProfissional(tx, clinica.id, prof.id);
          const livres = await horariosPublicos(tx, {
            profissionalId: prof.id,
            duracaoMin: prof.duracao_consulta_min,
            dia,
            fuso,
            config,
          });
          const slot = livres.find((h) => new Date(h.inicio).getTime() === b.inicio.getTime());
          if (!slot) {
            throw new ErroNegocio(
              409,
              'horario_indisponivel',
              'Este horário não está mais disponível. Escolha outro horário.',
            );
          }
          const pendentes = await tx.solicitacaoAgendamento.count({
            where: { telefone: { in: variantesTelefone(telefone) }, status: 'pendente' },
          });
          if (pendentes >= config.ao_max_pendentes_por_telefone) {
            throw new ErroNegocio(
              409,
              'limite_solicitacoes',
              'Você já tem solicitações aguardando a confirmação da clínica. Aguarde o retorno antes de pedir outro horário.',
            );
          }
          return tx.solicitacaoAgendamento.create({
            data: {
              profissional_id: prof.id,
              inicio: new Date(slot.inicio),
              fim: new Date(slot.fim),
              nome: b.nome,
              telefone,
              email: b.email || null,
              cpf: b.cpf ? somenteDigitos(b.cpf) : null,
              nascimento: b.nascimento ? new Date(`${b.nascimento}T00:00:00Z`) : null,
              observacoes: b.observacoes || null,
              aceita_whatsapp: b.aceita_whatsapp,
              ip: request.ip ?? null,
              user_agent: request.headers['user-agent']?.slice(0, 300) ?? null,
            },
            select: { id: true, status: true, inicio: true, fim: true },
          });
        });
        return reply.status(201).send({ ...criada, profissional: { nome: prof.nome } });
      },
    );
  });

  // ---------------------------------------------------------------- internas
  await app.register(async (base) => {
    const interno = base.withTypeProvider<ZodTypeProvider>();
    interno.addHook('onRequest', autenticarClinica);
    interno.addHook('preHandler', exigirRecurso('agendamento_online'));
    const equipe = exigirPapel('admin', 'recepcao');

    // ------------------------------------------------------------ listar
    interno.get('/solicitacoes', { preHandler: equipe, schema: { querystring: FiltroLista } }, async (request) => {
      const { status, pagina, por_pagina } = request.query;
      const where: Prisma.SolicitacaoAgendamentoWhereInput = status ? { status } : {};
      const [itens, total] = await Promise.all([
        request.db.solicitacaoAgendamento.findMany({
          where,
          select: selecaoSolicitacao,
          orderBy: status === 'pendente' ? [{ inicio: 'asc' }] : [{ criado_em: 'desc' }],
          skip: (pagina - 1) * por_pagina,
          take: por_pagina,
        }),
        request.db.solicitacaoAgendamento.count({ where }),
      ]);
      return { itens, total, pagina, porPagina: por_pagina };
    });

    interno.get('/solicitacoes/resumo', { preHandler: equipe }, async (request) => {
      const pendentes = await request.db.solicitacaoAgendamento.count({
        where: { status: 'pendente', inicio: { gte: new Date() } },
      });
      return { pendentes };
    });

    // ------------------------------------------------------------ detalhe
    interno.get('/solicitacoes/:id', { preHandler: equipe, schema: { params: Id } }, async (request) => {
      const s = ou404(
        await request.db.solicitacaoAgendamento.findUnique({ where: { id: request.params.id }, select: selecaoSolicitacao }),
        'Solicitação não encontrada.',
      );
      const telefones = variantesTelefone(s.telefone);
      const ou: Prisma.PacienteWhereInput[] = [];
      if (s.cpf) ou.push({ cpf: s.cpf });
      if (telefones.length) ou.push({ whatsapp: { in: telefones } }, { telefone: { in: telefones } });
      const candidatos = ou.length
        ? await request.db.paciente.findMany({
            where: { ativo: true, OR: ou },
            select: {
              id: true,
              nome: true,
              cpf: true,
              whatsapp: true,
              telefone: true,
              nascimento: true,
              aceita_whatsapp: true,
            },
            orderBy: { nome: 'asc' },
            take: 10,
          })
        : [];
      const pacientes_candidatos = candidatos
        .map((p) => ({ ...p, motivo: s.cpf && p.cpf === s.cpf ? ('cpf' as const) : ('telefone' as const) }))
        .sort((a, b) => (a.motivo === b.motivo ? 0 : a.motivo === 'cpf' ? -1 : 1));
      return { ...s, pacientes_candidatos };
    });

    // ------------------------------------------------------------ aprovar
    interno.post(
      '/solicitacoes/:id/aprovar',
      { preHandler: equipe, schema: { params: Id, body: CorpoAprovar } },
      async (request) => {
        const b = request.body;
        const s = ou404(
          await request.db.solicitacaoAgendamento.findUnique({ where: { id: request.params.id } }),
          'Solicitação não encontrada.',
        );
        if (s.status !== 'pendente') {
          throw erros.conflito('Esta solicitação já foi analisada.', 'solicitacao_nao_pendente');
        }
        const prof = ou404(
          await request.db.profissional.findUnique({ where: { id: s.profissional_id } }),
          'Profissional não encontrado.',
        );
        if (!prof.ativo) throw erros.invalido('Este profissional está inativo.', 'profissional_inativo');

        let pacienteId: string | null = null;
        if (b.paciente_id) {
          const p = ou404(await request.db.paciente.findUnique({ where: { id: b.paciente_id } }), 'Paciente não encontrado.');
          if (!p.ativo) throw erros.invalido('Este paciente está inativo.', 'paciente_inativo');
          pacienteId = p.id;
        } else if (s.cpf) {
          const p = await request.db.paciente.findFirst({ where: { cpf: s.cpf } });
          if (p) {
            if (!p.ativo) {
              throw erros.invalido(
                'Já existe um paciente inativo com este CPF. Reative o cadastro ou selecione outro paciente.',
                'paciente_inativo',
              );
            }
            pacienteId = p.id;
          }
        }

        let convenioId: string | null = null;
        if (b.tipo === 'convenio') {
          if (!b.convenio_id) throw erros.invalido('Selecione o convênio para agendamentos por convênio.', 'convenio_obrigatorio');
          const c = ou404(await request.db.convenio.findUnique({ where: { id: b.convenio_id } }), 'Convênio não encontrado.');
          if (!c.ativo) throw erros.invalido('Este convênio está inativo.', 'convenio_inativo');
          convenioId = c.id;
        }
        const fuso = await obterFuso(request.db, request.clinicaId);
        const usuarioId = request.usuarioClinica!.id;
        const pacienteCriado = !pacienteId;

        const r = await request.db.$transaction(async (tx) => {
          await assegurarLimite(request.clinicaId, 'max_agendamentos', { tx });
          await travarAgendaProfissional(tx, request.clinicaId, prof.id);
          // Marca antes (trava a linha): duas aprovações simultâneas ⇒ a segunda recebe 409.
          const marcada = await tx.solicitacaoAgendamento.updateMany({
            where: { id: s.id, status: 'pendente' },
            data: { status: 'aprovada', analisado_por: usuarioId, analisado_em: new Date() },
          });
          if (marcada.count === 0) throw erros.conflito('Esta solicitação já foi analisada.', 'solicitacao_nao_pendente');
          await validarHorario(tx, { profissionalId: prof.id, inicio: s.inicio, fim: s.fim, fuso, encaixe: false });

          let pid = pacienteId;
          if (!pid) {
            const novo = await tx.paciente.create({
              data: {
                nome: s.nome,
                cpf: s.cpf,
                nascimento: s.nascimento,
                telefone: s.telefone,
                whatsapp: s.telefone,
                email: s.email,
                aceita_whatsapp: s.aceita_whatsapp,
                convenio_id: convenioId,
              },
              select: { id: true },
            });
            pid = novo.id;
          }
          const observacoes =
            [b.observacoes, s.observacoes ? `Agendamento online: ${s.observacoes}` : null].filter(Boolean).join('\n') ||
            'Agendamento online';
          const ag = await tx.agendamento.create({
            data: {
              paciente_id: pid,
              profissional_id: prof.id,
              inicio: s.inicio,
              fim: s.fim,
              tipo: b.tipo,
              convenio_id: convenioId,
              observacoes,
              criado_por: usuarioId,
            },
            select: { id: true },
          });
          const solicitacao = await tx.solicitacaoAgendamento.update({
            where: { id: s.id },
            data: { paciente_id: pid, agendamento_id: ag.id },
            select: selecaoSolicitacao,
          });
          return { solicitacao, agendamentoId: ag.id, pacienteId: pid };
        });

        // Depois do commit: WhatsApp de confirmação (só com o consentimento dado na solicitação).
        let whatsapp: { enfileirada: boolean; erro?: string } | null = null;
        if (s.aceita_whatsapp) {
          const [clinica, paciente] = await Promise.all([
            request.db.clinica.findUnique({
              where: { id: request.clinicaId },
              select: { nome: true, endereco: true, cidade: true, uf: true },
            }),
            request.db.paciente.findUnique({ where: { id: r.pacienteId }, select: { nome: true, aceita_whatsapp: true } }),
          ]);
          const endereco = clinica
            ? [clinica.endereco, [clinica.cidade, clinica.uf].filter(Boolean).join('/')].filter(Boolean).join(' — ') || null
            : null;
          const conteudo = textoAgendamentoOnlineConfirmado({
            paciente: paciente?.nome ?? s.nome,
            clinica: clinica?.nome ?? '',
            profissional: prof.nome,
            inicio: s.inicio,
            fuso,
            endereco,
          });
          const res = paciente?.aceita_whatsapp
            ? await enfileirarMensagem({
                clinicaId: request.clinicaId,
                pacienteId: r.pacienteId,
                agendamentoId: r.agendamentoId,
                tipo: 'agendamento_confirmado',
                conteudo,
                telefone: s.telefone,
              })
            : await enfileirarMensagem({
                clinicaId: request.clinicaId,
                pacienteId: null,
                agendamentoId: r.agendamentoId,
                tipo: 'agendamento_confirmado',
                conteudo,
                telefone: s.telefone,
                consentimentoExterno: true,
              });
          whatsapp = resumoWhatsapp(res);
        }
        return {
          solicitacao: r.solicitacao,
          agendamento_id: r.agendamentoId,
          paciente_id: r.pacienteId,
          paciente_criado: pacienteCriado,
          whatsapp,
        };
      },
    );

    // ------------------------------------------------------------ recusar
    interno.post(
      '/solicitacoes/:id/recusar',
      { preHandler: equipe, schema: { params: Id, body: CorpoRecusar } },
      async (request) => {
        const { motivo, notificar } = request.body;
        const s = ou404(
          await request.db.solicitacaoAgendamento.findUnique({ where: { id: request.params.id } }),
          'Solicitação não encontrada.',
        );
        const r = await request.db.solicitacaoAgendamento.updateMany({
          where: { id: s.id, status: 'pendente' },
          data: {
            status: 'recusada' satisfies StatusSolicitacaoAgendamento,
            motivo_recusa: motivo || null,
            analisado_por: request.usuarioClinica!.id,
            analisado_em: new Date(),
          },
        });
        if (r.count === 0) throw erros.conflito('Esta solicitação já foi analisada.', 'solicitacao_nao_pendente');
        const solicitacao = await request.db.solicitacaoAgendamento.findUniqueOrThrow({
          where: { id: s.id },
          select: selecaoSolicitacao,
        });

        let whatsapp: { enfileirada: boolean; erro?: string } | null = null;
        if (notificar) {
          if (!s.aceita_whatsapp) {
            whatsapp = { enfileirada: false, erro: 'sem_consentimento' };
          } else {
            const clinica = await request.db.clinica.findUnique({
              where: { id: request.clinicaId },
              select: { nome: true, slug: true, fuso_horario: true },
            });
            const cfg = await obterConfiguracaoClinica(request.db);
            const res = await enfileirarMensagem({
              clinicaId: request.clinicaId,
              pacienteId: null,
              tipo: 'agendamento_recusado',
              telefone: s.telefone,
              consentimentoExterno: s.aceita_whatsapp,
              conteudo: textoAgendamentoOnlineRecusado({
                paciente: s.nome,
                clinica: clinica?.nome ?? '',
                inicio: s.inicio,
                fuso: clinica?.fuso_horario || 'America/Sao_Paulo',
                motivo: motivo || null,
                linkAgendamento: cfg.ao_ativo ? linkPublico(clinica?.slug) : null,
              }),
            });
            whatsapp = resumoWhatsapp(res);
          }
        }
        return { solicitacao, whatsapp };
      },
    );

    // ------------------------------------------------------------ configuração
    const admin = exigirPapel('admin');

    interno.get('/agendamento-online/configuracao', { preHandler: admin }, async (request) => montarConfiguracao(request));

    interno.put(
      '/agendamento-online/configuracao',
      { preHandler: admin, schema: { body: CorpoConfig } },
      async (request) => {
        const b = request.body;
        if (b.profissionais_visiveis) {
          const ids = [...new Set(b.profissionais_visiveis)];
          const existentes = await request.db.profissional.count({ where: { id: { in: ids } } });
          if (existentes !== ids.length) throw erros.naoEncontrado('Profissional não encontrado.');
        }
        await request.db.$transaction(async (tx) => {
          const dados: Parameters<typeof atualizarConfiguracaoClinica>[1] = {};
          if (b.ativo !== undefined) dados.ao_ativo = b.ativo;
          if (b.antecedencia_min_horas !== undefined) dados.ao_antecedencia_min_horas = b.antecedencia_min_horas;
          if (b.dias_a_frente !== undefined) dados.ao_dias_a_frente = b.dias_a_frente;
          if (b.mensagem_boas_vindas !== undefined) dados.ao_mensagem_boas_vindas = b.mensagem_boas_vindas || null;
          if (b.max_pendentes_por_telefone !== undefined) dados.ao_max_pendentes_por_telefone = b.max_pendentes_por_telefone;
          await atualizarConfiguracaoClinica(tx, dados);
          if (b.profissionais_visiveis) {
            const ids = [...new Set(b.profissionais_visiveis)];
            await tx.profissional.updateMany({ where: { id: { in: ids } }, data: { agendamento_online: true } });
            await tx.profissional.updateMany({ where: { id: { notIn: ids } }, data: { agendamento_online: false } });
          }
        });
        return montarConfiguracao(request);
      },
    );
  });
};

export default modulo;
