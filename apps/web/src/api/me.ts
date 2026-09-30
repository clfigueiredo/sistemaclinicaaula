/**
 * Sessão atual: useMe() (clínica), useAdminMe() (super admin) e usePodeUsar(codigo) para a UX
 * dos limites do plano. Lembrete: esconder/desabilitar botão é só UX — o backend também bloqueia.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './cliente';
import type { AdminMe, CodigoRecurso, Me } from './tipos';
import { useAuth } from '@/contextos/AuthContext';

export const chavesMe = {
  me: ['me'] as const,
  onboarding: ['me', 'onboarding'] as const,
  adminMe: ['admin', 'me'] as const,
};

/** Dados da sessão da clínica (usuário, clínica, papel, assinatura, plano, recursos e uso). */
export function useMe() {
  const { tokenClinica } = useAuth();
  return useQuery({
    queryKey: chavesMe.me,
    queryFn: () => api.get<Me>('/me'),
    enabled: !!tokenClinica,
    staleTime: 30_000,
  });
}

export type ProgressoOnboarding = { profissional: boolean; horarios: boolean; convenios: boolean; whatsapp: boolean };

/** Passos do onboarding já concluídos (somente admin). Fica sob ['me'], então invalidar o /me atualiza. */
export function useOnboarding() {
  const { tokenClinica } = useAuth();
  return useQuery({
    queryKey: chavesMe.onboarding,
    queryFn: () => api.get<ProgressoOnboarding>('/me/onboarding'),
    enabled: !!tokenClinica,
  });
}

export type DadosClinica = Partial<
  Pick<Me['clinica'], 'nome' | 'responsavel' | 'email' | 'telefone' | 'endereco' | 'cidade' | 'uf' | 'cep' | 'fuso_horario'>
>;

/** Edita os dados cadastrais da própria clínica (somente admin). */
export function useEditarClinica() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dados: DadosClinica) => api.put<Me['clinica']>('/me/clinica', dados),
    onSuccess: () => qc.invalidateQueries({ queryKey: chavesMe.me }),
  });
}

export function useAdminMe() {
  const { tokenAdmin } = useAuth();
  return useQuery({
    queryKey: chavesMe.adminMe,
    queryFn: () => api.get<AdminMe>('/admin/me'),
    enabled: !!tokenAdmin,
    staleTime: 60_000,
  });
}

export type PodeUsar = {
  /** true se pode executar a ação agora (habilitado, com saldo e sem modo somente leitura). */
  pode: boolean;
  carregando: boolean;
  habilitado: boolean;
  limite: number | null;
  uso: number | null;
  /** Quantas unidades ainda restam (null = ilimitado). */
  restante: number | null;
  motivo: 'desabilitado' | 'limite' | 'somente_leitura' | null;
  /** Texto pronto para tooltip/aviso. */
  mensagem: string | null;
};

/**
 * Diz se a clínica pode usar/consumir um recurso do plano.
 *
 *   const { pode, mensagem } = usePodeUsar('max_profissionais');
 *   <Button disabled={!pode} title={mensagem ?? undefined}>Novo profissional</Button>
 *
 * Após criar/excluir algo que consome recurso, invalide ['me'] para atualizar o uso:
 *   queryClient.invalidateQueries({ queryKey: chavesMe.me })
 */
export function usePodeUsar(codigo: CodigoRecurso, quantidade = 1): PodeUsar {
  const { data: me, isLoading } = useMe();
  const r = me?.recursos[codigo];
  if (!me || !r) {
    return {
      pode: false,
      carregando: isLoading,
      habilitado: false,
      limite: null,
      uso: null,
      restante: null,
      motivo: null,
      mensagem: null,
    };
  }
  const restante = r.limite === null ? null : Math.max(0, r.limite - (r.uso ?? 0));
  let motivo: PodeUsar['motivo'] = null;
  let mensagem: string | null = null;
  if (me.assinatura?.somente_leitura) {
    motivo = 'somente_leitura';
    mensagem = 'Sua assinatura está inativa: o sistema está em modo somente leitura.';
  } else if (!r.habilitado) {
    motivo = 'desabilitado';
    mensagem = `"${r.nome}" não está disponível no seu plano. Faça upgrade para liberar.`;
  } else if (restante !== null && restante < quantidade) {
    motivo = 'limite';
    mensagem = `Você atingiu o limite de ${r.limite} ${r.nome.toLowerCase()}${r.periodo === 'mensal' ? ' neste mês' : ''} do seu plano. Faça upgrade para continuar.`;
  }
  return {
    pode: motivo === null,
    carregando: false,
    habilitado: r.habilitado,
    limite: r.limite,
    uso: r.uso,
    restante,
    motivo,
    mensagem,
  };
}
