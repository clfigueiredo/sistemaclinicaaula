/**
 * Seed idempotente (pode rodar várias vezes): `npm run db:seed`.
 *
 * Cria:
 *  - Super admin: admin@sistema.local / admin123
 *  - Catálogo de recursos (tabela `recursos`)
 *  - Plano "Teste grátis" (plano_cadastro = true): tudo limitado a 1, período total, WhatsApp habilitado
 *  - Plano "Profissional" (exemplo pago): limites maiores, agendamentos/mensagens mensais
 *  - Clínica demo (plano Profissional, assinatura ativa) com:
 *      admin@demo.local / demo123          (admin)
 *      recepcao@demo.local / demo123       (recepção)
 *      profissional@demo.local / demo123   (profissional, vinculado à Dra. Ana Souza)
 *    + 1 profissional com grade de horários, 2 convênios e 1 paciente.
 */
import { PrismaClient, type PeriodoLimite } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { CATALOGO_RECURSOS, type CodigoRecurso } from '../src/plugins/recursos';

const prisma = new PrismaClient();

const IDS = {
  planoTeste: '00000000-0000-4000-8000-000000000001',
  planoProfissional: '00000000-0000-4000-8000-000000000002',
  clinicaDemo: '00000000-0000-4000-8000-000000000101',
  profissionalDemo: '00000000-0000-4000-8000-000000000201',
  pacienteDemo: '00000000-0000-4000-8000-000000000301',
};

type ConfigRecurso = { habilitado: boolean; limite: number | null; periodo: PeriodoLimite };

const RECURSOS_TESTE: Record<CodigoRecurso, ConfigRecurso> = {
  max_profissionais: { habilitado: true, limite: 1, periodo: 'total' },
  max_recepcionistas: { habilitado: true, limite: 1, periodo: 'total' },
  max_agendamentos: { habilitado: true, limite: 1, periodo: 'total' },
  max_anexos: { habilitado: true, limite: 1, periodo: 'total' },
  whatsapp: { habilitado: true, limite: null, periodo: 'total' },
  max_mensagens: { habilitado: true, limite: 1, periodo: 'total' },
  financeiro: { habilitado: false, limite: null, periodo: 'total' },
  agendamento_online: { habilitado: false, limite: null, periodo: 'total' },
};

const RECURSOS_PROFISSIONAL: Record<CodigoRecurso, ConfigRecurso> = {
  max_profissionais: { habilitado: true, limite: 10, periodo: 'total' },
  max_recepcionistas: { habilitado: true, limite: 5, periodo: 'total' },
  max_agendamentos: { habilitado: true, limite: 2000, periodo: 'mensal' },
  max_anexos: { habilitado: true, limite: 1000, periodo: 'total' },
  whatsapp: { habilitado: true, limite: null, periodo: 'total' },
  max_mensagens: { habilitado: true, limite: 2000, periodo: 'mensal' },
  financeiro: { habilitado: false, limite: null, periodo: 'total' },
  agendamento_online: { habilitado: false, limite: null, periodo: 'total' },
};

async function salvarRecursosDoPlano(planoId: string, recursos: Record<CodigoRecurso, ConfigRecurso>) {
  for (const [codigo, cfg] of Object.entries(recursos)) {
    await prisma.planoRecurso.upsert({
      where: { plano_id_recurso_codigo: { plano_id: planoId, recurso_codigo: codigo } },
      create: { plano_id: planoId, recurso_codigo: codigo, ...cfg },
      update: cfg,
    });
  }
}

async function main() {
  const hash = (s: string) => bcrypt.hash(s, 10);

  // --- Super admin
  await prisma.usuarioPlataforma.upsert({
    where: { email: 'admin@sistema.local' },
    create: { nome: 'Administrador', email: 'admin@sistema.local', senha_hash: await hash('admin123') },
    update: {},
  });

  // --- Catálogo de recursos
  for (const r of CATALOGO_RECURSOS) {
    await prisma.recurso.upsert({
      where: { codigo: r.codigo },
      create: { codigo: r.codigo, nome: r.nome, descricao: r.descricao, tipo: r.tipo, ordem: r.ordem },
      update: { nome: r.nome, descricao: r.descricao, tipo: r.tipo, ordem: r.ordem },
    });
  }

  // --- Planos
  await prisma.plano.updateMany({ where: { plano_cadastro: true, NOT: { id: IDS.planoTeste } }, data: { plano_cadastro: false } });
  await prisma.plano.upsert({
    where: { id: IDS.planoTeste },
    create: {
      id: IDS.planoTeste,
      nome: 'Teste grátis',
      descricao: 'Todas as funções liberadas, com 1 unidade de cada recurso. Sem prazo de expiração.',
      preco: 0,
      plano_cadastro: true,
    },
    update: { plano_cadastro: true },
  });
  await salvarRecursosDoPlano(IDS.planoTeste, RECURSOS_TESTE);

  await prisma.plano.upsert({
    where: { id: IDS.planoProfissional },
    create: {
      id: IDS.planoProfissional,
      nome: 'Profissional',
      descricao: 'Para clínicas em crescimento: até 10 profissionais e 2.000 agendamentos por mês.',
      preco: 199.9,
    },
    update: {},
  });
  await salvarRecursosDoPlano(IDS.planoProfissional, RECURSOS_PROFISSIONAL);

  // --- Clínica demo
  const clinicaId = IDS.clinicaDemo;
  await prisma.clinica.upsert({
    where: { id: clinicaId },
    create: {
      id: clinicaId,
      nome: 'Clínica Demo',
      documento: '11222333000181',
      responsavel: 'Administrador Demo',
      email: 'contato@demo.local',
      telefone: '11999990000',
      cidade: 'São Paulo',
      uf: 'SP',
    },
    update: {},
  });
  await prisma.assinatura.upsert({
    where: { clinica_id: clinicaId },
    create: { clinica_id: clinicaId, plano_id: IDS.planoProfissional, status: 'ativa' },
    update: {},
  });

  await prisma.profissional.upsert({
    where: { id: IDS.profissionalDemo },
    create: {
      id: IDS.profissionalDemo,
      clinica_id: clinicaId,
      nome: 'Dra. Ana Souza',
      especialidade: 'Clínica geral',
      registro: 'CRM-SP 123456',
      duracao_consulta_min: 30,
      cor_agenda: '#0d9488',
    },
    update: {},
  });
  await prisma.profissionalHorario.deleteMany({ where: { clinica_id: clinicaId, profissional_id: IDS.profissionalDemo } });
  const grade = [1, 2, 3, 4, 5].flatMap((dia) => [
    { dia_semana: dia, hora_inicio: '08:00', hora_fim: '12:00' },
    { dia_semana: dia, hora_inicio: '14:00', hora_fim: '18:00' },
  ]);
  await prisma.profissionalHorario.createMany({
    data: grade.map((g) => ({ ...g, clinica_id: clinicaId, profissional_id: IDS.profissionalDemo })),
  });

  const senhaDemo = await hash('demo123');
  const usuarios = [
    { nome: 'Administrador Demo', email: 'admin@demo.local', papel: 'admin' as const, profissional_id: null },
    { nome: 'Recepção Demo', email: 'recepcao@demo.local', papel: 'recepcao' as const, profissional_id: null },
    {
      nome: 'Dra. Ana Souza',
      email: 'profissional@demo.local',
      papel: 'profissional' as const,
      profissional_id: IDS.profissionalDemo,
    },
  ];
  for (const u of usuarios) {
    await prisma.usuario.upsert({
      where: { clinica_id_email: { clinica_id: clinicaId, email: u.email } },
      create: { ...u, clinica_id: clinicaId, senha_hash: senhaDemo },
      update: {},
    });
  }

  for (const nome of ['Unimed', 'Bradesco Saúde']) {
    await prisma.convenio.upsert({
      where: { clinica_id_nome: { clinica_id: clinicaId, nome } },
      create: { clinica_id: clinicaId, nome },
      update: {},
    });
  }

  await prisma.paciente.upsert({
    where: { id: IDS.pacienteDemo },
    create: {
      id: IDS.pacienteDemo,
      clinica_id: clinicaId,
      nome: 'João da Silva',
      cpf: '52998224725',
      nascimento: new Date('1985-04-12'),
      sexo: 'masculino',
      telefone: '11988887777',
      whatsapp: '5511988887777',
      aceita_whatsapp: false,
    },
    update: {},
  });

  console.log('✅ Seed concluído.');
  console.log('   Super admin: admin@sistema.local / admin123');
  console.log('   Clínica demo: admin@demo.local, recepcao@demo.local, profissional@demo.local / demo123');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
