/**
 * API do módulo admin-planos (super admin): catálogo de recursos e planos.
 *
 *   GET    /admin/recursos
 *   GET    /admin/planos            GET /admin/planos/:id
 *   POST   /admin/planos            PUT /admin/planos/:id
 *   PATCH  /admin/planos/:id/ativo  PATCH /admin/planos/:id/cadastro
 *   DELETE /admin/planos/:id
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './cliente';
import type { CodigoRecurso, PeriodoLimite } from './tipos';

export type TipoRecurso = 'limite' | 'booleano';

export type RecursoCatalogo = {
  codigo: CodigoRecurso;
  nome: string;
  tipo: TipoRecurso;
  descricao: string;
  ordem: number;
};

export type RecursoPlano = {
  codigo: CodigoRecurso;
  nome: string;
  tipo: TipoRecurso;
  descricao: string;
  habilitado: boolean;
  /** null = ilimitado (ou recurso liga/desliga) */
  limite: number | null;
  /** null para recursos liga/desliga */
  periodo: PeriodoLimite | null;
};

export type Plano = {
  id: string;
  nome: string;
  descricao: string | null;
  preco: string;
  ativo: boolean;
  plano_cadastro: boolean;
  /** Aparece em "Planos" no painel da clínica para contratação com pagamento online. */
  contratavel: boolean;
  /** Aparece na landing page. */
  exibir_landing: boolean;
  criado_em: string;
  atualizado_em: string;
  total_clinicas: number;
  recursos: RecursoPlano[];
};

export type ConfigRecursoPlano = {
  codigo: CodigoRecurso;
  habilitado: boolean;
  limite?: number | null;
  periodo?: PeriodoLimite;
};

export type DadosPlano = {
  nome: string;
  descricao?: string | null;
  preco: number;
  ativo?: boolean;
  plano_cadastro?: boolean;
  contratavel?: boolean;
  exibir_landing?: boolean;
  recursos: ConfigRecursoPlano[];
};

export const chavesPlano = {
  todos: ['admin', 'planos'] as const,
  lista: () => [...chavesPlano.todos, 'lista'] as const,
  detalhe: (id: string) => [...chavesPlano.todos, 'detalhe', id] as const,
  recursos: ['admin', 'recursos'] as const,
};

/** Invalida planos e o que depende deles (clínicas e dashboard exibem o plano). */
function useInvalidarPlanos() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: chavesPlano.todos });
    qc.invalidateQueries({ queryKey: ['admin', 'clinicas'] });
    qc.invalidateQueries({ queryKey: ['admin', 'dashboard'] });
  };
}

export function useCatalogoRecursos() {
  return useQuery({
    queryKey: chavesPlano.recursos,
    queryFn: () => api.get<RecursoCatalogo[]>('/admin/recursos'),
    staleTime: 10 * 60_000,
  });
}

export function useListaPlanos() {
  return useQuery({ queryKey: chavesPlano.lista(), queryFn: () => api.get<Plano[]>('/admin/planos') });
}

export function usePlano(id: string | undefined) {
  return useQuery({
    queryKey: chavesPlano.detalhe(id ?? ''),
    queryFn: () => api.get<Plano>(`/admin/planos/${id}`),
    enabled: !!id,
  });
}

export function useCriarPlano() {
  const invalidar = useInvalidarPlanos();
  return useMutation({
    mutationFn: (dados: DadosPlano) => api.post<Plano>('/admin/planos', dados),
    onSuccess: invalidar,
  });
}

export function useEditarPlano(id: string) {
  const invalidar = useInvalidarPlanos();
  return useMutation({
    mutationFn: (dados: Partial<DadosPlano>) => api.put<Plano>(`/admin/planos/${id}`, dados),
    onSuccess: invalidar,
  });
}

export function useAlterarAtivoPlano() {
  const invalidar = useInvalidarPlanos();
  return useMutation({
    mutationFn: ({ id, ativo }: { id: string; ativo: boolean }) => api.patch<Plano>(`/admin/planos/${id}/ativo`, { ativo }),
    onSuccess: invalidar,
  });
}

export function useMarcarPlanoCadastro() {
  const invalidar = useInvalidarPlanos();
  return useMutation({
    mutationFn: (id: string) => api.patch<Plano>(`/admin/planos/${id}/cadastro`),
    onSuccess: invalidar,
  });
}

export function useExcluirPlano() {
  const invalidar = useInvalidarPlanos();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/admin/planos/${id}`),
    onSuccess: invalidar,
  });
}
