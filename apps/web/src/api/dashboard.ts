/**
 * API do dashboard da clínica.   [STUB — fase 2, DONO: dashboard]  Contrato: docs/FASE2.md §6.
 * (Não confundir com o dashboard do super admin: GET /admin/dashboard em adminClinicas.ts.)
 *
 * Hooks previstos: useDashboard({ inicio, fim, profissionalId? }).
 */
export const chavesDashboard = {
  todos: ['dashboard'] as const,
  resumo: (filtros: object) => [...chavesDashboard.todos, filtros] as const,
};
