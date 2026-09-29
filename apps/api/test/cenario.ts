import type { PeriodoLimite } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { CATALOGO_RECURSOS, type CodigoRecurso } from '../src/plugins/recursos';

/** Limpa todas as tabelas do banco de teste (TRUNCATE não dispara o trigger do prontuário). */
export async function limparBanco() {
  const tabelas = await prisma.$queryRawUnsafe<{ tablename: string }[]>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`,
  );
  if (tabelas.length) {
    await prisma.$executeRawUnsafe(`TRUNCATE ${tabelas.map((t) => `"${t.tablename}"`).join(', ')} CASCADE`);
  }
}

type Cfg = { habilitado: boolean; limite: number | null; periodo: PeriodoLimite };

async function criarPlano(nome: string, recursos: Partial<Record<CodigoRecurso, Cfg>>, planoCadastro = false) {
  return prisma.plano.create({
    data: {
      nome,
      plano_cadastro: planoCadastro,
      recursos: {
        create: CATALOGO_RECURSOS.map((r) => ({
          recurso_codigo: r.codigo,
          ...(recursos[r.codigo] ?? { habilitado: false, limite: null, periodo: 'total' as const }),
        })),
      },
    },
  });
}

let seq = 0;
async function criarClinica(nome: string, planoId: string, documento: string) {
  seq++;
  const clinica = await prisma.clinica.create({ data: { nome, documento } });
  await prisma.assinatura.create({ data: { clinica_id: clinica.id, plano_id: planoId, status: 'teste' } });
  const admin = await prisma.usuario.create({
    data: {
      clinica_id: clinica.id,
      nome: `Admin ${nome}`,
      email: `admin${seq}@teste.local`,
      senha_hash: 'x',
      papel: 'admin',
    },
  });
  return { clinica, admin };
}

/** Catálogo + plano de teste (tudo 1, total) + plano ilimitado + clínicas A (teste) e B (ilimitado). */
export async function criarCenario() {
  await limparBanco();
  for (const r of CATALOGO_RECURSOS) {
    await prisma.recurso.create({ data: { codigo: r.codigo, nome: r.nome, tipo: r.tipo, ordem: r.ordem } });
  }
  const um = { habilitado: true, limite: 1, periodo: 'total' as const };
  const planoTeste = await criarPlano(
    'Teste grátis',
    {
      max_profissionais: um,
      max_recepcionistas: um,
      max_agendamentos: um,
      max_anexos: um,
      max_mensagens: um,
      whatsapp: { habilitado: true, limite: null, periodo: 'total' },
    },
    true,
  );
  const ilimitado = { habilitado: true, limite: null, periodo: 'total' as const };
  const planoGrande = await criarPlano('Grande', {
    max_profissionais: ilimitado,
    max_recepcionistas: ilimitado,
    max_agendamentos: { habilitado: true, limite: 2, periodo: 'mensal' },
    max_anexos: ilimitado,
    max_mensagens: ilimitado,
    whatsapp: ilimitado,
  });
  const a = await criarClinica('Clínica A', planoTeste.id, '11222333000181');
  const b = await criarClinica('Clínica B', planoGrande.id, '52998224725');
  return { planoTeste, planoGrande, a, b };
}
