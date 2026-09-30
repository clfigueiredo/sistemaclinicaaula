import bcrypt from 'bcryptjs';

const CUSTO = 10;

export function gerarHashSenha(senha: string): Promise<string> {
  return bcrypt.hash(senha, CUSTO);
}

export function conferirSenha(senha: string, hash: string): Promise<boolean> {
  return bcrypt.compare(senha, hash);
}

/**
 * Hash bcrypt fixo (mesmo custo) de uma senha aleatória descartada. Usado quando o e-mail não existe:
 * o login faz o mesmo trabalho de um e-mail existente, evitando enumeração de e-mails por tempo de resposta.
 */
export const HASH_FALSO = '$2b$10$WsmoPsM1uwv46tFxCRX2PO3G7avUUMKxj9r8yrb5qSCYi9Tgntwqm';

/** Gasta o mesmo tempo de um conferirSenha real e devolve sempre false. */
export async function conferirSenhaFalsa(senha: string): Promise<false> {
  await bcrypt.compare(senha, HASH_FALSO);
  return false;
}
