/**
 * ============================================================================
 * ISOLAMENTO DE TENANT — `request.db`
 * ============================================================================
 *
 * `criarDbTenant(clinicaId)` devolve um Prisma Client estendido ($extends + query hooks) que
 * aplica AUTOMATICAMENTE o filtro `clinica_id` em TODOS os modelos de clínica
 * (lista MODELOS_DE_CLINICA abaixo):
 *
 *   - leituras   (findMany, findFirst, findUnique*, count, aggregate, groupBy):
 *                 where = { ...where, clinica_id }
 *   - escritas   (update, updateMany*, delete, deleteMany): idem no where; `clinica_id`
 *                 é removido do `data` (não dá para "mover" registro de clínica)
 *   - criação    (create, createMany*, upsert): `clinica_id` é SEMPRE sobrescrito com o do token
 *
 * Em rotas da clínica, o plugin de auth (`autenticarClinica`) cria esse client e o expõe em
 * `request.db`. Portanto:
 *
 *   ✅ request.db.paciente.findMany({ where: { nome: { contains: 'ana' } } })
 *   ✅ request.db.paciente.create({ data: { nome, convenio_id } })   // sem clinica_id
 *   ✅ request.db.$transaction(async (tx) => { ... })                // tx também é filtrado
 *   ❌ prisma.paciente.findMany(...)            // prisma "cru" NÃO filtra — só admin/auth/workers
 *   ❌ clinica_id vindo do body/query            // NUNCA; vem só do token
 *
 * Limitações (IMPORTANTE para quem escreve módulos):
 *   1. Nested writes (ex.: paciente.create({ data: { alergias: { create: [...] } } })) NÃO passam
 *      pelo hook nos filhos. Faça creates separados dentro de `request.db.$transaction`.
 *   2. `include`/`select` de relações não é filtrado — é seguro porque as FKs apontam para registros
 *      da mesma clínica, DESDE QUE você valide as FKs recebidas no body antes de gravar, ex.:
 *        ou404(await request.db.paciente.findUnique({ where: { id: body.paciente_id } }))
 *   3. $queryRaw/$executeRaw não são filtrados: se usar SQL cru, filtre `clinica_id` manualmente
 *      com `request.clinicaId`.
 *   4. `ProntuarioRegistro` é imutável: update/delete/upsert lançam ErroNegocio 403 (e o banco
 *      também tem trigger bloqueando).
 *
 * Modelos de plataforma acessados via request.db:
 *   - Clinica:    só a própria clínica (leitura e `update`; `status`/`documento` não podem ser alterados)
 *   - Assinatura: só leitura, filtrada pela clínica
 *   - Recurso, Plano, PlanoRecurso: só leitura
 *   - UsuarioPlataforma: proibido
 * ============================================================================
 */
import { Prisma, type PrismaClient } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { ErroNegocio } from '../utils/erros';

/** Modelos com coluna clinica_id. Ao criar um novo modelo de clínica no schema, ADICIONE AQUI. */
export const MODELOS_DE_CLINICA: ReadonlySet<Prisma.ModelName> = new Set<Prisma.ModelName>([
  'Usuario',
  'Profissional',
  'ProfissionalHorario',
  'BloqueioAgenda',
  'Convenio',
  'Paciente',
  'PacienteAlergia',
  'PacienteMedicacao',
  'Agendamento',
  'ProntuarioRegistro',
  'Anexo',
  'WhatsappSessao',
  'MensagemWhatsapp',
  'LogAcesso',
]);

const MODELOS_IMUTAVEIS: ReadonlySet<string> = new Set(['ProntuarioRegistro']);
const MODELOS_SOMENTE_LEITURA: ReadonlySet<string> = new Set(['Recurso', 'Plano', 'PlanoRecurso', 'Assinatura']);

const OPERACOES_LEITURA = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
]);
const OPERACOES_COM_WHERE = new Set([
  ...OPERACOES_LEITURA,
  'update',
  'updateMany',
  'updateManyAndReturn',
  'delete',
  'deleteMany',
  'upsert',
]);
const OPERACOES_ESCRITA = new Set([
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'upsert',
  'delete',
  'deleteMany',
]);

type Registro = Record<string, unknown>;

function ehObjetoSimples(v: unknown): v is Registro {
  return typeof v === 'object' && v !== null && Object.getPrototypeOf(v) === Object.prototype;
}

/** Detecta input "checked" do Prisma (relações via connect/create) — nesse modo usamos `clinica: { connect }`. */
function usaInputDeRelacao(data: Registro): boolean {
  return Object.values(data).some(
    (v) => ehObjetoSimples(v) && ('connect' in v || 'create' in v || 'connectOrCreate' in v),
  );
}

function comClinicaNoCreate(data: unknown, clinicaId: string): Registro {
  const d: Registro = { ...(data as Registro) };
  delete d.clinica_id;
  delete d.clinica;
  if (usaInputDeRelacao(d)) d.clinica = { connect: { id: clinicaId } };
  else d.clinica_id = clinicaId;
  return d;
}

function semClinicaNoUpdate(data: unknown): Registro {
  const d: Registro = { ...(data as Registro) };
  delete d.clinica_id;
  delete d.clinica;
  return d;
}

/**
 * Cria o Prisma Client com escopo de uma clínica. `base` permite injetar outro client (testes).
 */
export function criarDbTenant(clinicaId: string, base: PrismaClient = prisma) {
  if (!clinicaId) throw new Error('criarDbTenant: clinicaId é obrigatório');

  return base.$extends({
    name: 'tenant',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const a = (args ?? {}) as Registro;

          // --- Modelos de plataforma ---
          if (model === 'UsuarioPlataforma') {
            throw new ErroNegocio(403, 'proibido', 'Acesso negado a dados da plataforma.');
          }
          if (model === 'Clinica') {
            if (!OPERACOES_LEITURA.has(operation) && operation !== 'update') {
              throw new ErroNegocio(403, 'proibido', 'Operação não permitida sobre a clínica.');
            }
            const where = (a.where ?? {}) as Registro;
            if (where.id !== undefined && where.id !== clinicaId) {
              throw new ErroNegocio(404, 'nao_encontrado', 'Clínica não encontrada.');
            }
            a.where = { ...where, id: clinicaId };
            if (operation === 'update') {
              const data = semClinicaNoUpdate(a.data);
              delete data.id;
              delete data.status;
              delete data.documento;
              a.data = data;
            }
            return query(a);
          }
          if (MODELOS_SOMENTE_LEITURA.has(model)) {
            if (!OPERACOES_LEITURA.has(operation)) {
              throw new ErroNegocio(403, 'proibido', 'Operação não permitida.');
            }
            if (model === 'Assinatura') a.where = { ...((a.where ?? {}) as Registro), clinica_id: clinicaId };
            return query(a);
          }
          if (!MODELOS_DE_CLINICA.has(model as Prisma.ModelName)) {
            // Modelo novo esquecido na lista: falha fechada (seguro por padrão).
            throw new Error(`Modelo ${model} não está mapeado no tenant (src/plugins/tenant.ts).`);
          }

          // --- Modelos de clínica ---
          if (MODELOS_IMUTAVEIS.has(model) && OPERACOES_ESCRITA.has(operation) && !operation.startsWith('create')) {
            throw new ErroNegocio(
              403,
              'prontuario_imutavel',
              'Registros de prontuário não podem ser alterados nem excluídos. Para corrigir, crie um novo registro.',
            );
          }

          if (OPERACOES_COM_WHERE.has(operation)) {
            a.where = { ...((a.where ?? {}) as Registro), clinica_id: clinicaId };
          }

          switch (operation) {
            case 'create':
              a.data = comClinicaNoCreate(a.data, clinicaId);
              break;
            case 'createMany':
            case 'createManyAndReturn':
              a.data = Array.isArray(a.data)
                ? a.data.map((d) => ({ ...semClinicaNoUpdate(d), clinica_id: clinicaId }))
                : { ...semClinicaNoUpdate(a.data), clinica_id: clinicaId };
              break;
            case 'update':
            case 'updateMany':
            case 'updateManyAndReturn':
              a.data = semClinicaNoUpdate(a.data);
              break;
            case 'upsert':
              a.create = comClinicaNoCreate(a.create, clinicaId);
              a.update = semClinicaNoUpdate(a.update);
              break;
          }

          return query(a);
        },
      },
    },
  });
}

/** Tipo do client com escopo de tenant (o mesmo de `request.db`). */
export type DbTenant = ReturnType<typeof criarDbTenant>;
