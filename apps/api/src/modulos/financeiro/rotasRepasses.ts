/**
 * Repasses aos profissionais: relatório por período (admin vê todos; profissional só o próprio),
 * detalhe das entradas, pagamento de repasse (saída origem `repasse`) e "meus recebimentos" do profissional.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { exigirPapel } from '../../plugins/auth';
import { ErroNegocio, erros } from '../../utils/erros';
import {
  CATEGORIA_REPASSES,
  assegurarNaoFutura,
  categoriaPadraoId,
  dataSemHora,
  dec,
  fusoDaClinica,
  resolverPeriodo,
  validarConta,
  validarProfissional,
  zDataIso,
  zFormaPagamento,
  zId,
  zPeriodo,
  zTextoOpcional,
  zValor,
} from './comum';
import { calcularRepasses, entradasDoProfissional, includeMovimentacao, serializarMovimentacao } from './servico';

/** Profissional logado: sempre o próprio (sem vínculo ⇒ 403). Admin: o filtro informado. */
function profissionalAlvo(request: FastifyRequest, informado?: string): string | undefined {
  const u = request.usuarioClinica!;
  if (u.papel === 'profissional') {
    if (!u.profissionalId) throw erros.proibido('Seu usuário não está vinculado a um profissional.');
    return u.profissionalId;
  }
  return informado;
}

function formatarPeriodo(p: { inicio: string; fim: string }) {
  const f = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
  return `${f(p.inicio)} a ${f(p.fim)}`;
}

const rotas: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/repasses',
    {
      preHandler: exigirPapel('admin', 'profissional'),
      schema: { querystring: z.object({ ...zPeriodo, profissional_id: zId('Profissional').optional() }) },
    },
    async (request) => {
      const fuso = await fusoDaClinica(request.db, request.clinicaId);
      const periodo = resolverPeriodo(request.query, fuso);
      const alvo = profissionalAlvo(request, request.query.profissional_id);
      if (alvo) await validarProfissional(request.db, alvo);
      return calcularRepasses(request.db, periodo, alvo);
    },
  );

  app.get(
    '/repasses/entradas',
    {
      preHandler: exigirPapel('admin', 'profissional'),
      schema: { querystring: z.object({ ...zPeriodo, profissional_id: zId('Profissional').optional() }) },
    },
    async (request) => {
      const fuso = await fusoDaClinica(request.db, request.clinicaId);
      const periodo = resolverPeriodo(request.query, fuso);
      const alvo = profissionalAlvo(request, request.query.profissional_id);
      if (!alvo) throw new ErroNegocio(400, 'profissional_obrigatorio', 'Informe o profissional.');
      await validarProfissional(request.db, alvo);
      return entradasDoProfissional(request.db, alvo, periodo);
    },
  );

  app.post(
    '/repasses/pagamentos',
    {
      preHandler: exigirPapel('admin'),
      schema: {
        body: z.object({
          profissional_id: zId('Profissional'),
          inicio: zDataIso('Início'),
          fim: zDataIso('Fim'),
          valor: zValor(),
          data: zDataIso('Data'),
          conta_financeira_id: zId('Conta'),
          forma_pagamento: zFormaPagamento,
          descricao: zTextoOpcional(300),
        }),
      },
    },
    async (request, reply) => {
      const b = request.body;
      const db = request.db;
      const fuso = await fusoDaClinica(db, request.clinicaId);
      const periodo = resolverPeriodo({ inicio: b.inicio, fim: b.fim }, fuso);
      assegurarNaoFutura(b.data, fuso);
      const prof = (await validarProfissional(db, b.profissional_id))!;
      await validarConta(db, b.conta_financeira_id);
      const categoriaId = await categoriaPadraoId(db, CATEGORIA_REPASSES, 'despesa');
      const criada = await db.movimentacaoFinanceira.create({
        data: {
          tipo: 'saida',
          origem: 'repasse',
          data: dataSemHora(b.data),
          valor: dec(b.valor),
          conta_financeira_id: b.conta_financeira_id,
          categoria_id: categoriaId,
          forma_pagamento: b.forma_pagamento,
          descricao: b.descricao ?? `Repasse de ${prof.nome} — ${formatarPeriodo(periodo)}`,
          profissional_id: prof.id,
          repasse_inicio: dataSemHora(periodo.inicio),
          repasse_fim: dataSemHora(periodo.fim),
          criado_por: request.usuarioClinica!.id,
        },
        include: includeMovimentacao,
      });
      reply.status(201);
      return serializarMovimentacao(criada);
    },
  );

  app.get(
    '/meus-recebimentos',
    { preHandler: exigirPapel('profissional'), schema: { querystring: z.object({ ...zPeriodo }) } },
    async (request) => {
      const fuso = await fusoDaClinica(request.db, request.clinicaId);
      const periodo = resolverPeriodo(request.query, fuso);
      const alvo = profissionalAlvo(request)!;
      const [linhas, itens] = await Promise.all([
        calcularRepasses(request.db, periodo, alvo),
        entradasDoProfissional(request.db, alvo, periodo),
      ]);
      const l = linhas[0];
      return {
        periodo,
        itens,
        total_entradas: l?.total_entradas ?? '0.00',
        percentual: l?.percentual ?? null,
        valor_repasse: l?.valor_repasse ?? '0.00',
        pago: l?.pago ?? '0.00',
        saldo: l?.saldo ?? '0.00',
      };
    },
  );
};

export default rotas;
