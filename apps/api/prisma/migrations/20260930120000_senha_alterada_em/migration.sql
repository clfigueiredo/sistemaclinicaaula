-- Última troca/redefinição de senha: tokens JWT emitidos antes disso são recusados.
ALTER TABLE "usuarios" ADD COLUMN "senha_alterada_em" TIMESTAMP(3);
