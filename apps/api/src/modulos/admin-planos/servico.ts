/**
 * Serviço de planos (plataforma — prisma cru).
 */
import type { PeriodoLimite, Plano, PlanoRecurso, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { CATALOGO_RECURSOS, type CodigoRecurso } from '../../plugins/recursos';
import { ErroNegocio, ou404 } from '../../utils/erros';

export type ConfigRecursoEntrada = {
  codigo: CodigoRecurso;
  habilitado: boolean;
  limite?: number | null;
  periodo?: PeriodoLimite;
};

type Tx = Prisma.TransactionClient;

type PlanoComRecursos = Plano & { recursos: PlanoRecurso[]; _count?: { assinaturas: number } };

/** Catálogo de recursos (ordem fixa do código). */
export function catalogo() {
  return [...CATALOGO_RECURSOS]
    .sort((a, b) => a.ordem - b.ordem)
    .map((r) => ({ codigo: r.codigo, nome: r.nome, tipo: r.tipo, descricao: r.descricao, ordem: r.ordem }));
}

/** Formato de saída do plano: sempre traz TODOS os recursos do catálogo (os ausentes vêm desabilitados). */
export function serializarPlano(plano: PlanoComRecursos) {
  return {
    id: plano.id,
    nome: plano.nome,
    descricao: plano.descricao,
    preco: plano.preco.toString(),
    ativo: plano.ativo,
    plano_cadastro: plano.plano_cadastro,
    contratavel: plano.contratavel,
    exibir_landing: plano.exibir_landing,
    criado_em: plano.criado_em,
    atualizado_em: plano.atualizado_em,
    total_clinicas: plano._count?.assinaturas ?? 0,
    recursos: catalogo().map((r) => {
      const pr = plano.recursos.find((x) => x.recurso_codigo === r.codigo);
      const ehLimite = r.tipo === 'limite';
      return {
        codigo: r.codigo,
        nome: r.nome,
        tipo: r.tipo,
        descricao: r.descricao,
        habilitado: !!pr?.habilitado,
        limite: ehLimite ? (pr?.limite ?? null) : null,
        periodo: ehLimite ? (pr?.periodo ?? 'total') : null,
      };
    }),
  };
}

const incluirPlano = { recursos: true, _count: { select: { assinaturas: true } } } as const;

export async function listarPlanos() {
  const planos = await prisma.plano.findMany({
    include: incluirPlano,
    orderBy: [{ ativo: 'desc' }, { preco: 'asc' }, { nome: 'asc' }],
  });
  return planos.map(serializarPlano);
}

export async function obterPlano(id: string, cliente: Tx | typeof prisma = prisma) {
  const plano = ou404(await cliente.plano.findUnique({ where: { id }, include: incluirPlano }), 'Plano não encontrado.');
  return serializarPlano(plano);
}

/** Garante que o catálogo existe na tabela `recursos` (FK de plano_recursos). Idempotente. */
async function garantirCatalogo(tx: Tx) {
  for (const r of CATALOGO_RECURSOS) {
    await tx.recurso.upsert({
      where: { codigo: r.codigo },
      update: {},
      create: { codigo: r.codigo, nome: r.nome, descricao: r.descricao, tipo: r.tipo, ordem: r.ordem },
    });
  }
}

/**
 * Grava a configuração de recursos do plano. Recursos do catálogo que não vierem na lista
 * ficam como estão (ou desabilitados, se ainda não existirem).
 */
export async function salvarRecursos(tx: Tx, planoId: string, entrada: ConfigRecursoEntrada[]) {
  await garantirCatalogo(tx);
  const existentes = await tx.planoRecurso.findMany({ where: { plano_id: planoId } });
  for (const r of CATALOGO_RECURSOS) {
    const cfg = entrada.find((e) => e.codigo === r.codigo);
    const jaExiste = existentes.some((e) => e.recurso_codigo === r.codigo);
    if (!cfg && jaExiste) continue;
    const ehLimite = r.tipo === 'limite';
    const dados = {
      habilitado: cfg?.habilitado ?? false,
      limite: ehLimite ? (cfg?.limite ?? null) : null,
      periodo: ehLimite ? (cfg?.periodo ?? 'total') : ('total' as const),
    };
    await tx.planoRecurso.upsert({
      where: { plano_id_recurso_codigo: { plano_id: planoId, recurso_codigo: r.codigo } },
      update: dados,
      create: { plano_id: planoId, recurso_codigo: r.codigo, ...dados },
    });
  }
}

/** Marca o plano como plano de cadastro, desmarcando os outros (na transação recebida). */
export async function marcarPlanoCadastro(tx: Tx, planoId: string) {
  const plano = ou404(await tx.plano.findUnique({ where: { id: planoId } }), 'Plano não encontrado.');
  if (!plano.ativo) {
    throw new ErroNegocio(409, 'plano_inativo', 'Um plano inativo não pode ser o plano de cadastro. Ative-o antes.');
  }
  // Desmarca os outros ANTES de marcar este (índice único parcial no banco).
  await tx.plano.updateMany({ where: { plano_cadastro: true, id: { not: planoId } }, data: { plano_cadastro: false } });
  if (!plano.plano_cadastro) await tx.plano.update({ where: { id: planoId }, data: { plano_cadastro: true } });
}
