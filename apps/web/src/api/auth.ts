/** Hooks de autenticação: login da clínica, login do super admin e auto-cadastro. */
import { useMutation } from '@tanstack/react-query';
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
