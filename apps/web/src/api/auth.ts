/** Hooks de autenticação: login da clínica, login do super admin, auto-cadastro e "esqueci minha senha". */
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from './cliente';
import type { UsuarioSessao } from './tipos';

export type RespostaLoginClinica =
  | { token: string; usuario: UsuarioSessao; clinica: { id: string; nome: string } }
  | { selecionarClinica: true; clinicas: { id: string; nome: string }[] };

export type DadosLogin = { email: string; senha: string; clinicaId?: string };

export type DadosCadastro = {
  nomeClinica: string;
  documento: string;
  responsavel: string;
  email: string;
  telefone: string;
  senha: string;
};

export function useLoginClinica() {
  return useMutation({
    mutationFn: (dados: DadosLogin) =>
      api.post<RespostaLoginClinica>('/auth/login', dados, { sessao: 'nenhuma' }),
  });
}

export function useLoginAdmin() {
  return useMutation({
    mutationFn: (dados: { email: string; senha: string }) =>
      api.post<{ token: string; usuario: { id: string; nome: string; email: string } }>('/auth/admin/login', dados, {
        sessao: 'nenhuma',
      }),
  });
}

export function useCadastro() {
  return useMutation({
    mutationFn: (dados: DadosCadastro) =>
      api.post<{ token: string; usuario: UsuarioSessao; clinica: { id: string; nome: string } }>(
        '/auth/cadastro',
        dados,
        { sessao: 'nenhuma' },
      ),
  });
}

// ------------------------------------------------------------------ esqueci minha senha (rotas públicas, sem token)

export type ValidacaoTokenRedefinicao = { valido: true; clinica: string; email: string };

/** Pede o link por e-mail. A API responde 204 sempre (não revela se o e-mail existe). */
export function useEsqueciSenha() {
  return useMutation({
    mutationFn: (dados: { email: string }) => api.post<void>('/auth/esqueci-senha', dados, { sessao: 'nenhuma' }),
  });
}

/** Confere o link ao abrir a página de redefinição. Erro 400 `token_invalido` = inválido/expirado/usado. */
export function useValidarTokenRedefinicao(token: string) {
  return useQuery({
    queryKey: ['auth', 'redefinir-senha', token],
    queryFn: () =>
      api.get<ValidacaoTokenRedefinicao>('/auth/redefinir-senha/validar', { token }, { sessao: 'nenhuma' }),
    enabled: !!token,
    retry: false,
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
}

export function useRedefinirSenha() {
  return useMutation({
    mutationFn: (dados: { token: string; senha: string }) =>
      api.post<void>('/auth/redefinir-senha', dados, { sessao: 'nenhuma' }),
  });
}
