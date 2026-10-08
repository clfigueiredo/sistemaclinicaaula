/**
 * Módulo admin-planos — Planos e catálogo de recursos (painel super admin).
 *
 * Prefixo "/admin" (todas as rotas exigem token de plataforma — autenticarAdmin):
 *   GET    /admin/recursos              catálogo de recursos [{ codigo, nome, tipo: limite|booleano, descricao, ordem }]
 *   GET    /admin/planos                lista planos (com recursos e total_clinicas)
 *   GET    /admin/planos/:id            detalhe
 *   POST   /admin/planos                cria { nome, descricao?, preco?, ativo?, plano_cadastro?, contratavel?, exibir_landing?, recursos?[] }
 *   PUT    /admin/planos/:id            edita (campos opcionais) + recursos numa única requisição:
 *                                       recursos: [{ codigo, habilitado, limite (null = ilimitado), periodo: total|mensal }]
 *   PATCH  /admin/planos/:id/ativo      { ativo } — ativa/desativa (o plano de cadastro não pode ser desativado)
 *   PATCH  /admin/planos/:id/cadastro   marca como plano_cadastro (desmarca os outros na mesma transação)
 *   DELETE /admin/planos/:id            apaga (só se não houver assinaturas nem for o plano de cadastro)
 *
 * Regras:
 * - Prisma CRU (dados de plataforma, sem clinica_id).
 * - Só UM plano pode ter plano_cadastro = true (também garantido por índice único parcial no banco).
 * - Plano inativo não pode ser o plano de cadastro.
 * - Recursos liga/desliga (tipo booleano) ignoram limite/período.
 * - `contratavel`: aparece para a clínica contratar em /planos (módulo contratacao) — só plano pago (preço > 0).
 * - `exibir_landing`: aparece na landing page (GET /publico/planos); vale também para o plano gratuito.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { prisma } from '../../lib/prisma';
import { autenticarAdmin } from '../../plugins/auth';
import { ErroNegocio, ou404 } from '../../utils/erros';
import { CorpoAtivo, CorpoCriarPlano, CorpoEditarPlano, ParamsId } from './esquemas';
import { catalogo, listarPlanos, marcarPlanoCadastro, obterPlano, salvarRecursos } from './servico';

export const prefixo = '/admin';

const erroCadastroInativo = () =>
  new ErroNegocio(409, 'plano_cadastro_inativo', 'O plano de cadastro não pode ficar inativo. Marque outro plano como plano de cadastro antes.');

const erroDesmarcarCadastro = () =>
  new ErroNegocio(
    409,
    'plano_cadastro_obrigatorio',
    'Deve sempre existir um plano de cadastro. Para trocar, marque outro plano como plano de cadastro.',
  );

const erroContratavelGratuito = () =>
  new ErroNegocio(
    409,
    'plano_gratuito_contratavel',
    'Um plano gratuito não pode ficar disponível para contratação (não há o que pagar). Defina um preço ou desmarque a opção.',
  );

const modulo: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', autenticarAdmin);

  // ------------------------------------------------------------------ catálogo
  app.get('/recursos', async () => catalogo());

  // ------------------------------------------------------------------ planos
  app.get('/planos', async () => listarPlanos());

  app.get('/planos/:id', { schema: { params: ParamsId } }, async (request) => obterPlano(request.params.id));

  app.post('/planos', { schema: { body: CorpoCriarPlano } }, async (request, reply) => {
    const { recursos, plano_cadastro, ...dados } = request.body;
    if (plano_cadastro && !dados.ativo) throw erroCadastroInativo();
    if (dados.contratavel && !(dados.preco > 0)) throw erroContratavelGratuito();

    const plano = await prisma.$transaction(async (tx) => {
      const criado = await tx.plano.create({
        data: {
          nome: dados.nome,
          descricao: dados.descricao ?? null,
          preco: dados.preco,
          ativo: dados.ativo,
          contratavel: dados.contratavel,
          exibir_landing: dados.exibir_landing,
        },
      });
      await salvarRecursos(tx, criado.id, recursos);
      if (plano_cadastro) await marcarPlanoCadastro(tx, criado.id);
      return obterPlano(criado.id, tx);
    });

    request.log.info({ planoId: plano.id, admin: request.adminPlataforma?.id }, 'Plano criado');
    return reply.status(201).send(plano);
  });

  app.put('/planos/:id', { schema: { params: ParamsId, body: CorpoEditarPlano } }, async (request) => {
    const { id } = request.params;
    const { recursos, plano_cadastro, ...dados } = request.body;

    const plano = await prisma.$transaction(async (tx) => {
      const atual = ou404(await tx.plano.findUnique({ where: { id } }), 'Plano não encontrado.');
      const ativoFinal = dados.ativo ?? atual.ativo;
      const cadastroFinal = plano_cadastro ?? atual.plano_cadastro;
      if (atual.plano_cadastro && plano_cadastro === false) throw erroDesmarcarCadastro();
      if (cadastroFinal && !ativoFinal) throw erroCadastroInativo();
      const precoFinal = dados.preco ?? atual.preco.toNumber();
      if ((dados.contratavel ?? atual.contratavel) && !(precoFinal > 0)) throw erroContratavelGratuito();

      await tx.plano.update({
        where: { id },
        data: {
          ...(dados.nome !== undefined && { nome: dados.nome }),
          ...(dados.descricao !== undefined && { descricao: dados.descricao }),
          ...(dados.preco !== undefined && { preco: dados.preco }),
          ...(dados.ativo !== undefined && { ativo: dados.ativo }),
          ...(dados.contratavel !== undefined && { contratavel: dados.contratavel }),
          ...(dados.exibir_landing !== undefined && { exibir_landing: dados.exibir_landing }),
        },
      });
      if (recursos) await salvarRecursos(tx, id, recursos);
      if (plano_cadastro === true) await marcarPlanoCadastro(tx, id);
      return obterPlano(id, tx);
    });

    request.log.info({ planoId: id, admin: request.adminPlataforma?.id }, 'Plano atualizado');
    return plano;
  });

  app.patch('/planos/:id/ativo', { schema: { params: ParamsId, body: CorpoAtivo } }, async (request) => {
    const { id } = request.params;
    const atual = ou404(await prisma.plano.findUnique({ where: { id } }), 'Plano não encontrado.');
    if (!request.body.ativo && atual.plano_cadastro) throw erroCadastroInativo();
    await prisma.plano.update({ where: { id }, data: { ativo: request.body.ativo } });
    request.log.info({ planoId: id, ativo: request.body.ativo, admin: request.adminPlataforma?.id }, 'Plano ativado/desativado');
    return obterPlano(id);
  });

  app.patch('/planos/:id/cadastro', { schema: { params: ParamsId } }, async (request) => {
    const { id } = request.params;
    await prisma.$transaction(async (tx) => marcarPlanoCadastro(tx, id));
    request.log.info({ planoId: id, admin: request.adminPlataforma?.id }, 'Plano de cadastro alterado');
    return obterPlano(id);
  });

  app.delete('/planos/:id', { schema: { params: ParamsId } }, async (request, reply) => {
    const { id } = request.params;
    const plano = ou404(
      await prisma.plano.findUnique({ where: { id }, include: { _count: { select: { assinaturas: true } } } }),
      'Plano não encontrado.',
    );
    if (plano.plano_cadastro) {
      throw new ErroNegocio(409, 'plano_cadastro', 'O plano de cadastro não pode ser excluído.');
    }
    if (plano._count.assinaturas > 0) {
      throw new ErroNegocio(
        409,
        'plano_em_uso',
        `Este plano tem ${plano._count.assinaturas} clínica(s) vinculada(s) e não pode ser excluído. Desative-o para que não seja mais usado.`,
        { total_clinicas: plano._count.assinaturas },
      );
    }
    await prisma.plano.delete({ where: { id } });
    request.log.info({ planoId: id, admin: request.adminPlataforma?.id }, 'Plano excluído');
    return reply.status(204).send();
  });
};

export default modulo;
