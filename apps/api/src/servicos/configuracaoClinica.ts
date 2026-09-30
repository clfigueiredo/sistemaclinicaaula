/**
 * Configurações da clínica (tabela `configuracoes_clinica`, 1:1 com a clínica, criada SOB DEMANDA).
 *
 * Nunca assuma que a linha existe: use sempre estes helpers (upsert com os defaults do schema).
 *
 *   // rota autenticada (tenant):
 *   const cfg = await obterConfiguracaoClinica(request.db);
 *   // fora do HTTP (worker, rota pública já com a clínica resolvida pelo slug):
 *   const cfg = await obterConfiguracaoClinicaPorId(clinicaId);
 *   // atualizar (admin):
 *   await atualizarConfiguracaoClinica(request.db, { ao_ativo: true, ao_dias_a_frente: 60 });
 *
 * Campos: `ao_*` = agendamento online (módulo agendamento-online); `retorno_*` = retorno automático
 * (módulo retornos). Quem edita cada grupo é o módulo dono (ver docs/FASE2.md).
 */
import type { ConfiguracaoClinica, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import type { DbTenant } from '../plugins/tenant';

export type { ConfiguracaoClinica };

export type DadosConfiguracaoClinica = Omit<
  Prisma.ConfiguracaoClinicaUncheckedUpdateInput,
  'id' | 'clinica_id' | 'criado_em' | 'atualizado_em'
>;

/** Com escopo de tenant (`request.db` ou `tx`): o clinica_id vem do token. */
export async function obterConfiguracaoClinica(db: Pick<DbTenant, 'configuracaoClinica'>): Promise<ConfiguracaoClinica> {
  // where vazio: a extensão tenant injeta clinica_id (único) no where e no create.
  return db.configuracaoClinica.upsert({
    where: {} as Prisma.ConfiguracaoClinicaWhereUniqueInput,
    create: {},
    update: {},
  });
}

/** Prisma cru (workers, rotas públicas). */
export async function obterConfiguracaoClinicaPorId(clinicaId: string): Promise<ConfiguracaoClinica> {
  return prisma.configuracaoClinica.upsert({
    where: { clinica_id: clinicaId },
    create: { clinica_id: clinicaId },
    update: {},
  });
}

export async function atualizarConfiguracaoClinica(
  db: Pick<DbTenant, 'configuracaoClinica'>,
  dados: DadosConfiguracaoClinica,
): Promise<ConfiguracaoClinica> {
  return db.configuracaoClinica.upsert({
    where: {} as Prisma.ConfiguracaoClinicaWhereUniqueInput,
    create: dados as Prisma.ConfiguracaoClinicaUncheckedCreateInput,
    update: dados,
  });
}
