/**
 * API do módulo usuários da clínica (somente admin gerencia).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './cliente';
import { chavesMe } from './me';
import type { Papel } from './tipos';

export type UsuarioClinica = {
  id: string;
  nome: string;
  email: string;
  papel: Papel;
  profissional_id: string | null;
  ativo: boolean;
  ultimo_acesso_em: string | null;
  criado_em: string;
  profissional: { id: string; nome: string; cor_agenda: string; ativo: boolean } | null;
};

export type DadosNovoUsuario = {
  nome: string;
  email: string;
  senha: string;
  papel: Papel;
  profissional_id?: string | null;
};

export type DadosEditarUsuario = Partial<Omit<DadosNovoUsuario, 'senha'>> & { ativo?: boolean };

export const chavesUsuario = {
  todos: ['usuarios'] as const,
  lista: () => [...chavesUsuario.todos, 'lista'] as const,
};

export function useListaUsuarios() {
  return useQuery({ queryKey: chavesUsuario.lista(), queryFn: () => api.get<UsuarioClinica[]>('/usuarios') });
}

function useInvalidar() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: chavesUsuario.todos });
    qc.invalidateQueries({ queryKey: chavesMe.me }); // uso de recepcionistas
    qc.invalidateQueries({ queryKey: ['profissionais'] }); // vínculo exibido no detalhe do profissional
  };
}

export function useCriarUsuario() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: (dados: DadosNovoUsuario) => api.post<UsuarioClinica>('/usuarios', dados),
    onSuccess: invalidar,
  });
}

export function useEditarUsuario() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: ({ id, ...dados }: DadosEditarUsuario & { id: string }) =>
      api.put<UsuarioClinica>(`/usuarios/${id}`, dados),
    onSuccess: invalidar,
  });
}

/**
 * Admin redefinindo a senha de OUTRO usuário: { senha } → sem corpo (204).
 * Trocando a PRÓPRIA senha: { senha, senha_atual } → { token } (os tokens antigos deixam de valer;
 * guarde o novo com sessao.definir('clinica', token)).
 */
export function useRedefinirSenha() {
  return useMutation({
    mutationFn: ({ id, senha, senha_atual }: { id: string; senha: string; senha_atual?: string }) =>
      api.put<{ token?: string } | undefined>(`/usuarios/${id}/senha`, { senha, senha_atual }),
  });
}
