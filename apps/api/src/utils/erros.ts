/**
 * Erro de negócio padronizado. O error handler global (src/plugins/erros.ts) converte em:
 *   HTTP <status>  { erro: <codigo>, mensagem: <mensagem>, ...extras }
 *
 * Exemplo:
 *   throw new ErroNegocio(409, 'horario_ocupado', 'Já existe um agendamento neste horário.');
 */
export class ErroNegocio extends Error {
  constructor(
    public readonly status: number,
    public readonly codigo: string,
    mensagem: string,
    public readonly extras: Record<string, unknown> = {},
  ) {
    super(mensagem);
    this.name = 'ErroNegocio';
  }
}

/** Atalhos para os erros mais comuns. */
export const erros = {
  naoEncontrado: (mensagem = 'Registro não encontrado.') => new ErroNegocio(404, 'nao_encontrado', mensagem),
  proibido: (mensagem = 'Você não tem permissão para esta ação.') => new ErroNegocio(403, 'proibido', mensagem),
  naoAutenticado: (mensagem = 'Sessão expirada ou inválida. Faça login novamente.') =>
    new ErroNegocio(401, 'nao_autenticado', mensagem),
  conflito: (mensagem: string, codigo = 'conflito') => new ErroNegocio(409, codigo, mensagem),
  invalido: (mensagem: string, codigo = 'requisicao_invalida') => new ErroNegocio(400, codigo, mensagem),
};

/**
 * Retorna o valor ou lança 404. Útil com request.db (que já filtra pela clínica):
 *   const paciente = ou404(await request.db.paciente.findUnique({ where: { id } }), 'Paciente não encontrado.');
 */
export function ou404<T>(valor: T | null | undefined, mensagem?: string): T {
  if (valor === null || valor === undefined) throw erros.naoEncontrado(mensagem);
  return valor;
}
