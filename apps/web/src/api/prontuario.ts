/**
 * API do módulo prontuário (registros imutáveis + anexos): tipos + hooks TanStack Query.
 *
 * Chaves: ['prontuario', pacienteId, 'registros'] e ['anexos', pacienteId].
 * Não existem rotas de edição/exclusão: correção = novo registro com `corrige_registro_id`.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ErroApi } from './cliente';
import { chavesMe } from './me';

export type RegistroProntuario = {
  id: string;
  paciente_id: string;
  profissional_id: string | null;
  agendamento_id: string | null;
  autor_id: string | null;
  texto: string;
  corrige_registro_id: string | null;
  criado_em: string;
  profissional: { id: string; nome: string; especialidade: string | null; registro: string | null } | null;
  autor: { id: string; nome: string } | null;
  agendamento: { id: string; inicio: string } | null;
  anexos: { id: string; nome_arquivo: string; mime_tipo: string | null; tamanho: number }[];
  correcoes: { id: string; criado_em: string }[];
};

export type Anexo = {
  id: string;
  paciente_id: string;
  registro_id: string | null;
  nome_arquivo: string;
  mime_tipo: string | null;
  tamanho: number;
  criado_em: string;
  usuario: { id: string; nome: string } | null;
};

export type NovoRegistro = { texto: string; agendamento_id?: string | null; corrige_registro_id?: string | null };

export const chavesProntuario = {
  registros: (pacienteId: string) => ['prontuario', pacienteId, 'registros'] as const,
  anexos: (pacienteId: string) => ['anexos', pacienteId] as const,
};

const semRetentarNegado = (n: number, e: Error) => !(e instanceof ErroApi && [403, 404].includes(e.status)) && n < 2;

export function useRegistrosProntuario(pacienteId: string) {
  return useQuery({
    queryKey: chavesProntuario.registros(pacienteId),
    queryFn: () => api.get<RegistroProntuario[]>(`/prontuario/pacientes/${pacienteId}`),
    retry: semRetentarNegado,
  });
}

export function useCriarRegistro(pacienteId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dados: NovoRegistro) => api.post<RegistroProntuario>(`/prontuario/pacientes/${pacienteId}`, dados),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['prontuario', pacienteId] }),
  });
}

export function useAnexos(pacienteId: string) {
  return useQuery({
    queryKey: chavesProntuario.anexos(pacienteId),
    queryFn: () => api.get<Anexo[]>(`/prontuario/pacientes/${pacienteId}/anexos`),
    retry: semRetentarNegado,
  });
}

export function useEnviarAnexo(pacienteId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ arquivo, registroId }: { arquivo: File; registroId?: string | null }) => {
      const form = new FormData();
      if (registroId) form.append('registro_id', registroId); // antes do arquivo (exigência do multipart)
      form.append('arquivo', arquivo);
      return api.upload<Anexo>(`/prontuario/pacientes/${pacienteId}/anexos`, form);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: chavesProntuario.anexos(pacienteId) });
      qc.invalidateQueries({ queryKey: ['prontuario', pacienteId] });
      qc.invalidateQueries({ queryKey: chavesMe.me }); // consome max_anexos
    },
  });
}

/** Baixa o anexo pela rota autenticada (gera log de acesso no backend) e dispara o download. */
export async function baixarAnexo(anexo: Pick<Anexo, 'id' | 'nome_arquivo'>): Promise<void> {
  const blob = await api.baixar(`/prontuario/anexos/${anexo.id}/download`);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = anexo.nome_arquivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
