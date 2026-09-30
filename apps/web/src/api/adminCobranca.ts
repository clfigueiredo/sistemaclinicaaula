/**
 * API da cobrança automática do SaaS (super admin).   [STUB — fase 2, DONO: admin-cobranca]
 * Contrato: docs/FASE2.md §7. Rotas /admin/* usam o token do super admin automaticamente.
 * Segredos NUNCA voltam da API (só os últimos 4 caracteres em `credenciais_final`).
 *
 * Hooks previstos: useGatewaysPagamento, useSalvarGateway, useAtivarGateway, useDesativarGateway,
 * useTestarGateway, useCobrancas(filtros), useCriarCobranca, useCancelarCobranca, useAtivarCobrancaClinica,
 * useEventosGateway(filtros); clínica: useMinhasCobrancas (GET /cobrancas/minhas, admin da clínica).
 */
export const chavesAdminCobranca = {
  todos: ['admin', 'cobranca'] as const,
  gateways: () => [...chavesAdminCobranca.todos, 'gateways'] as const,
  cobrancas: (filtros: object) => [...chavesAdminCobranca.todos, 'cobrancas', filtros] as const,
  eventos: (filtros: object) => [...chavesAdminCobranca.todos, 'eventos', filtros] as const,
  /** Faturas da própria clínica (token da clínica — não começa com 'admin'). */
  minhas: ['cobrancas', 'minhas'] as const,
};
