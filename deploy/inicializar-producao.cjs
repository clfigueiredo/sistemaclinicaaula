/**
 * Inicialização do banco de PRODUÇÃO (idempotente) — chamado por deploy/acessos.sh dentro do container da API:
 *   docker compose ... exec -T -e DOMINIO=... -e MODO=instalar api node --input-type=commonjs - < deploy/inicializar-producao.cjs
 *
 * Garante (sem nunca apagar nem sobrescrever o que já existe):
 *  - catálogo de recursos (tabela `recursos`) e uma linha de plano_recursos para cada recurso em todos os planos;
 *  - plano "Teste grátis" marcado como plano de cadastro (se nenhum plano for de cadastro) e plano "Profissional";
 *  - super admin admin@DOMINIO;
 *  - clínica "Minha Clínica" (plano Profissional, assinatura ativa) com o usuário admin clinica@DOMINIO.
 * Senhas novas são aleatórias. MODO=redefinir gera senha nova para os dois acessos.
 *
 * Saída: uma linha por acesso, "ACESSO|<admin|clinica>|<email>|<senha ou vazio>|<criado|redefinido|existente>".
 * O catálogo e os limites espelham src/plugins/recursos.ts e prisma/seed.ts — mantenha em sincronia.
 */
const crypto = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();
const DOMINIO = process.env.DOMINIO;
const REDEFINIR = process.env.MODO === 'redefinir';

const ID_PLANO_TESTE = '00000000-0000-4000-8000-000000000001';
const ID_PLANO_PROFISSIONAL = '00000000-0000-4000-8000-000000000002';
const ID_CLINICA = '00000000-0000-4000-8000-0000000001a0';

const CATALOGO = [
  ['max_profissionais', 'Profissionais', 'limite', 'Profissionais ativos'],
  ['max_recepcionistas', 'Usuários de equipe', 'limite', 'Recepção e administradores adicionais (o administrador principal não conta)'],
  ['max_agendamentos', 'Agendamentos', 'limite', 'Agendamentos criados'],
  ['max_anexos', 'Anexos', 'limite', 'Arquivos de exame anexados'],
  ['whatsapp', 'WhatsApp', 'booleano', 'Permite conectar um número de WhatsApp'],
  ['max_mensagens', 'Mensagens WhatsApp', 'limite', 'Mensagens de WhatsApp enviadas'],
  ['financeiro', 'Financeiro', 'booleano', 'Caixa, contas a pagar e a receber, recorrências e repasses'],
  ['agendamento_online', 'Agendamento online', 'booleano', 'Página pública para o paciente solicitar horários'],
  ['lista_espera', 'Lista de espera', 'booleano', 'Pacientes aguardando vaga, com sugestão quando um horário é liberado'],
  ['documentos_pdf', 'Receituário e atestados', 'booleano', 'Receitas, atestados, declarações e pedidos de exame em PDF'],
  ['retorno_automatico', 'Retorno automático', 'booleano', 'Controle de retornos com convite pelo WhatsApp'],
  ['dashboard', 'Dashboard', 'booleano', 'Indicadores da agenda e do financeiro'],
];
const FASE2 = ['financeiro', 'agendamento_online', 'lista_espera', 'documentos_pdf', 'retorno_automatico', 'dashboard'];

function limites(valores) {
  const r = {};
  for (const [codigo, limite, periodo] of valores) r[codigo] = { habilitado: true, limite, periodo };
  r.whatsapp = { habilitado: true, limite: null, periodo: 'total' };
  for (const codigo of FASE2) r[codigo] = { habilitado: true, limite: null, periodo: 'total' };
  return r;
}
const RECURSOS_TESTE = limites([
  ['max_profissionais', 1, 'total'], ['max_recepcionistas', 1, 'total'], ['max_agendamentos', 1, 'total'],
  ['max_anexos', 1, 'total'], ['max_mensagens', 3, 'total'],
]);
const RECURSOS_PROFISSIONAL = limites([
  ['max_profissionais', 10, 'total'], ['max_recepcionistas', 5, 'total'], ['max_agendamentos', 2000, 'mensal'],
  ['max_anexos', 1000, 'total'], ['max_mensagens', 2000, 'mensal'],
]);

const gerarSenha = () => crypto.randomBytes(15).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 16);
const hash = (s) => bcrypt.hash(s, 10);

/** CNPJ aleatório válido (só para a clínica criada pelo instalador; editável no painel). */
function gerarCnpj() {
  const n = Array.from({ length: 8 }, () => crypto.randomInt(10)).concat([0, 0, 0, 1]);
  const dv = (base) => {
    const pesos = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const resto = base.reduce((s, d, i) => s + d * pesos[i], 0) % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  n.push(dv(n));
  n.push(dv(n));
  return n.join('');
}

async function criarPlanoSeFaltar(id, dados, recursos) {
  if (await prisma.plano.findUnique({ where: { id } })) return;
  await prisma.plano.create({ data: { id, ...dados } });
  for (const [codigo, cfg] of Object.entries(recursos)) {
    await prisma.planoRecurso.create({ data: { plano_id: id, recurso_codigo: codigo, ...cfg } });
  }
}

async function main() {
  if (!DOMINIO) throw new Error('DOMINIO não informado.');

  // --- Catálogo de recursos
  for (const [i, [codigo, nome, tipo, descricao]] of CATALOGO.entries()) {
    await prisma.recurso.upsert({
      where: { codigo },
      create: { codigo, nome, tipo, descricao, ordem: i + 1 },
      update: { nome, tipo, descricao, ordem: i + 1 },
    });
  }

  // --- Planos
  const temPlanoCadastro = await prisma.plano.count({ where: { plano_cadastro: true, ativo: true } });
  await criarPlanoSeFaltar(
    ID_PLANO_TESTE,
    {
      nome: 'Teste grátis',
      descricao: 'Todas as funções liberadas, com 1 unidade de cada recurso. Sem prazo de expiração.',
      preco: 0,
      plano_cadastro: !temPlanoCadastro,
    },
    RECURSOS_TESTE,
  );
  await criarPlanoSeFaltar(
    ID_PLANO_PROFISSIONAL,
    { nome: 'Profissional', descricao: 'Para clínicas em crescimento: até 10 profissionais e 2.000 agendamentos por mês.', preco: 199.9 },
    RECURSOS_PROFISSIONAL,
  );
  // Planos criados pelo super admin: linha para cada recurso, desabilitada se ainda não existir.
  for (const plano of await prisma.plano.findMany({ select: { id: true } })) {
    await prisma.planoRecurso.createMany({
      data: CATALOGO.map(([codigo]) => ({ plano_id: plano.id, recurso_codigo: codigo, habilitado: false, limite: null, periodo: 'total' })),
      skipDuplicates: true,
    });
  }

  // --- Super admin
  const acessos = [];
  let admin = await prisma.usuarioPlataforma.findFirst({ orderBy: { criado_em: 'asc' } });
  if (!admin) {
    const senha = gerarSenha();
    admin = await prisma.usuarioPlataforma.create({
      data: { nome: 'Administrador', email: `admin@${DOMINIO}`, senha_hash: await hash(senha) },
    });
    acessos.push(['admin', admin.email, senha, 'criado']);
  } else if (REDEFINIR) {
    const senha = gerarSenha();
    await prisma.usuarioPlataforma.update({ where: { id: admin.id }, data: { senha_hash: await hash(senha), ativo: true } });
    acessos.push(['admin', admin.email, senha, 'redefinido']);
  } else {
    acessos.push(['admin', admin.email, '', 'existente']);
  }

  // --- Clínica do instalador + admin da clínica
  if (!(await prisma.clinica.findUnique({ where: { id: ID_CLINICA } }))) {
    let slug = 'minha-clinica';
    while (await prisma.clinica.findUnique({ where: { slug } })) slug = `minha-clinica-${crypto.randomInt(1000, 9999)}`;
    let documento = gerarCnpj();
    while (await prisma.clinica.findUnique({ where: { documento } })) documento = gerarCnpj();
    await prisma.clinica.create({
      data: { id: ID_CLINICA, nome: 'Minha Clínica', slug, documento, responsavel: 'Administrador', email: `clinica@${DOMINIO}` },
    });
    await prisma.assinatura.create({ data: { clinica_id: ID_CLINICA, plano_id: ID_PLANO_PROFISSIONAL, status: 'ativa', expira_em: null } });
  }
  let usuario = await prisma.usuario.findFirst({ where: { clinica_id: ID_CLINICA, papel: 'admin' }, orderBy: { criado_em: 'asc' } });
  if (!usuario) {
    const senha = gerarSenha();
    usuario = await prisma.usuario.create({
      data: { clinica_id: ID_CLINICA, nome: 'Administrador', email: `clinica@${DOMINIO}`, senha_hash: await hash(senha), papel: 'admin' },
    });
    acessos.push(['clinica', usuario.email, senha, 'criado']);
  } else if (REDEFINIR) {
    const senha = gerarSenha();
    await prisma.usuario.update({
      where: { id: usuario.id },
      data: { senha_hash: await hash(senha), ativo: true, senha_alterada_em: new Date() },
    });
    acessos.push(['clinica', usuario.email, senha, 'redefinido']);
  } else {
    acessos.push(['clinica', usuario.email, '', 'existente']);
  }

  for (const a of acessos) console.log(['ACESSO', ...a].join('|'));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
