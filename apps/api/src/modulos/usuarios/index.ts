/**
 * Módulo usuarios — Usuários da clínica
 *
 * Rotas (prefixo "/usuarios"):
 *   GET  /usuarios            admin; lista (sem senha_hash) com o profissional vinculado
 *   POST /usuarios            admin; { nome, email, senha, papel, profissional_id? }
 *                             papel recepcao consome `max_recepcionistas` (admin não conta)
 *   PUT  /usuarios/:id        admin; { nome?, email?, papel?, profissional_id?, ativo? }
 *                             reativar recepção / mudar para recepção → consome o limite
 *   PUT  /usuarios/:id/senha  admin redefine a senha de qualquer usuário: { senha };
 *                             qualquer usuário troca a PRÓPRIA senha: { senha, senha_atual }
 *
 * Regras:
 *   - E-mail único na clínica (409 email_em_uso).
 *   - Papel `profissional` exige profissional_id; `admin` pode ter (opcional); `recepcao` nunca tem.
 *   - Um profissional só pode estar vinculado a um usuário (409 profissional_vinculado).
 *   - O admin não pode desativar nem mudar o papel de si mesmo; a clínica nunca fica sem admin ativo
 *     (409 ultimo_admin).
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { PapelUsuario, Prisma } from '@prisma/client';
import { z } from 'zod';
import { autenticarClinica, exigirPapel } from '../../plugins/auth';
import { assegurarLimite } from '../../plugins/recursos';
import type { DbTenant } from '../../plugins/tenant';
import { ErroNegocio, erros, ou404 } from '../../utils/erros';
import { conferirSenha, gerarHashSenha } from '../../utils/senha';

export const prefixo = '/usuarios';

const MSG_NAO_ENCONTRADO = 'Usuário não encontrado.';

type Tx = Parameters<Parameters<DbTenant['$transaction']>[0]>[0];

const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('E-mail inválido'));
const senha = z.string().min(6, 'A senha deve ter pelo menos 6 caracteres').max(100, 'Senha longa demais');
const papel = z.enum(['admin', 'recepcao', 'profissional'], { error: 'Papel inválido' });
const nome = z.string().trim().min(2, 'Informe o nome').max(150, 'Máximo de 150 caracteres');
const paramsId = z.object({ id: z.uuid('Identificador inválido') });

const selecao = {
  id: true,
  nome: true,
  email: true,
  papel: true,
  profissional_id: true,
  ativo: true,
  ultimo_acesso_em: true,
  criado_em: true,
  profissional: { select: { id: true, nome: true, cor_agenda: true, ativo: true } },
} satisfies Prisma.UsuarioSelect;

async function assegurarEmailLivre(tx: Tx, valor: string, ignorarId?: string) {
  const existente = await tx.usuario.findFirst({
    where: { email: valor, ...(ignorarId ? { id: { not: ignorarId } } : {}) },
    select: { id: true },
  });
  if (existente) throw new ErroNegocio(409, 'email_em_uso', 'Já existe um usuário com este e-mail nesta clínica.');
}

/** Valida o vínculo com profissional conforme o papel final. Devolve o profissional_id a gravar. */
async function resolverVinculo(
  tx: Tx,
  papelFinal: PapelUsuario,
  profissionalId: string | null,
  ignorarUsuarioId?: string,
): Promise<string | null> {
  if (papelFinal === 'recepcao') return null;
  if (papelFinal === 'profissional' && !profissionalId) {
    throw erros.invalido('Selecione o profissional vinculado a este usuário.', 'profissional_obrigatorio');
  }
  if (!profissionalId) return null;
  ou404(await tx.profissional.findUnique({ where: { id: profissionalId }, select: { id: true } }), 'Profissional não encontrado.');
  const outro = await tx.usuario.findFirst({
    where: { profissional_id: profissionalId, ...(ignorarUsuarioId ? { id: { not: ignorarUsuarioId } } : {}) },
    select: { nome: true },
  });
  if (outro) {
    throw new ErroNegocio(
      409,
      'profissional_vinculado',
      `Este profissional já está vinculado ao usuário ${outro.nome}.`,
    );
  }
  return profissionalId;
}

const modulo: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', autenticarClinica);

  app.get('/', { preHandler: exigirPapel('admin') }, async (request) =>
    request.db.usuario.findMany({ select: selecao, orderBy: [{ ativo: 'desc' }, { nome: 'asc' }] }),
  );

  app.post(
    '/',
    {
      preHandler: exigirPapel('admin'),
      schema: {
        body: z.object({ nome, email, senha, papel, profissional_id: z.uuid('Profissional inválido').nullish() }),
      },
    },
    async (request, reply) => {
      const dados = request.body;
      const senhaHash = await gerarHashSenha(dados.senha);
      const criado = await request.db.$transaction(async (tx) => {
        if (dados.papel === 'recepcao') await assegurarLimite(request.clinicaId, 'max_recepcionistas', { tx });
        await assegurarEmailLivre(tx, dados.email);
        const profissionalId = await resolverVinculo(tx, dados.papel, dados.profissional_id ?? null);
        return tx.usuario.create({
          data: {
            nome: dados.nome,
            email: dados.email,
            senha_hash: senhaHash,
            papel: dados.papel,
            profissional_id: profissionalId,
          },
          select: selecao,
        });
      });
      reply.status(201);
      return criado;
    },
  );

  app.put(
    '/:id',
    {
      preHandler: exigirPapel('admin'),
      schema: {
        params: paramsId,
        body: z.object({
          nome: nome.optional(),
          email: email.optional(),
          papel: papel.optional(),
          profissional_id: z.uuid('Profissional inválido').nullish(),
          ativo: z.boolean().optional(),
        }),
      },
    },
    async (request) => {
      const { id } = request.params;
      const dados = request.body;
      const eu = request.usuarioClinica!;

      return request.db.$transaction(async (tx) => {
        const atual = ou404(await tx.usuario.findUnique({ where: { id } }), MSG_NAO_ENCONTRADO);
        const papelFinal = dados.papel ?? atual.papel;
        const ativoFinal = dados.ativo ?? atual.ativo;

        if (id === eu.id) {
          if (!ativoFinal) throw erros.invalido('Você não pode desativar o seu próprio usuário.', 'auto_desativacao');
          if (papelFinal !== atual.papel) {
            throw erros.invalido('Você não pode alterar o seu próprio papel.', 'auto_alteracao_papel');
          }
        }

        // A clínica nunca pode ficar sem um admin ativo.
        if (atual.papel === 'admin' && atual.ativo && (papelFinal !== 'admin' || !ativoFinal)) {
          const outrosAdmins = await tx.usuario.count({ where: { papel: 'admin', ativo: true, id: { not: id } } });
          if (outrosAdmins === 0) {
            throw new ErroNegocio(409, 'ultimo_admin', 'A clínica precisa ter pelo menos um administrador ativo.');
          }
        }

        // Passar a ocupar uma vaga de recepção (reativar ou mudar de papel) consome o limite.
        const eraRecepcaoAtiva = atual.papel === 'recepcao' && atual.ativo;
        if (papelFinal === 'recepcao' && ativoFinal && !eraRecepcaoAtiva) {
          await assegurarLimite(request.clinicaId, 'max_recepcionistas', { tx });
        }

        if (dados.email !== undefined && dados.email !== atual.email) await assegurarEmailLivre(tx, dados.email, id);

        const profissionalDesejado = dados.profissional_id !== undefined ? dados.profissional_id : atual.profissional_id;
        const profissionalId = await resolverVinculo(tx, papelFinal, profissionalDesejado ?? null, id);

        return tx.usuario.update({
          where: { id },
          data: {
            ...(dados.nome !== undefined ? { nome: dados.nome } : {}),
            ...(dados.email !== undefined ? { email: dados.email } : {}),
            papel: papelFinal,
            ativo: ativoFinal,
            profissional_id: profissionalId,
          },
          select: selecao,
        });
      });
    },
  );

  app.put(
    '/:id/senha',
    { schema: { params: paramsId, body: z.object({ senha, senha_atual: z.string().optional() }) } },
    async (request, reply) => {
      const { id } = request.params;
      const eu = request.usuarioClinica!;
      const proprio = id === eu.id;
      if (!proprio && eu.papel !== 'admin') throw erros.proibido('Somente o administrador pode redefinir senhas.');

      const usuario = ou404(await request.db.usuario.findUnique({ where: { id } }), MSG_NAO_ENCONTRADO);
      if (proprio && eu.papel !== 'admin') {
        if (!request.body.senha_atual || !(await conferirSenha(request.body.senha_atual, usuario.senha_hash))) {
          throw erros.invalido('A senha atual não confere.', 'senha_atual_invalida');
        }
      }
      await request.db.usuario.update({
        where: { id },
        data: { senha_hash: await gerarHashSenha(request.body.senha) },
      });
      return reply.status(204).send();
    },
  );
};

export default modulo;
