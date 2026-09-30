/**
 * API dos documentos clínicos (receita/atestado/declaração/pedido de exame).   Contrato: docs/FASE2.md §4.
 *
 * Documentos são IMUTÁVEIS (sem edição/exclusão; correção = novo documento). O PDF é gerado pelo servidor
 * sob demanda: `abrirPdfDocumento(id)` (rota autenticada, gera log de acesso) abre numa nova aba via Blob.
 * `gerarPreviaDocumento(dados)` devolve o PDF de pré-visualização (nada é gravado).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ErroApi } from './cliente';
import type { TipoDocumentoClinico } from './tipos';

export const chavesDocumentos = {
  todos: ['documentos'] as const,
  paciente: (pacienteId: string) => [...chavesDocumentos.todos, 'paciente', pacienteId] as const,
  detalhe: (id: string) => [...chavesDocumentos.todos, 'detalhe', id] as const,
};

type ProfissionalDocumento = { id: string; nome: string; especialidade: string | null; registro: string | null };

export type DocumentoResumo = {
  id: string;
  tipo: TipoDocumentoClinico;
  titulo: string | null;
  criado_em: string;
  agendamento_id: string | null;
  profissional: ProfissionalDocumento;
  autor: { id: string; nome: string } | null;
};

export type ItemReceita = { medicamento: string; posologia?: string | null; quantidade?: string | null };

export type MetadadosDocumento = {
  // receita
  uso?: 'interno' | 'externo' | null;
  itens?: ItemReceita[];
  // atestado
  dias?: number | null;
  cid?: string | null;
  exibir_cid?: boolean;
  // declaração
  data?: string | null;
  hora_inicio?: string | null;
  hora_fim?: string | null;
  // pedido de exame
  exames?: string[];
  indicacao_clinica?: string | null;
  conteudo_gerado?: boolean;
};

export type Documento = DocumentoResumo & {
  paciente_id: string;
  profissional_id: string;
  autor_id: string | null;
  conteudo: string;
  metadados: MetadadosDocumento | null;
  paciente: { id: string; nome: string };
  agendamento: { id: string; inicio: string } | null;
};

export type NovoDocumento = {
  paciente_id: string;
  tipo: TipoDocumentoClinico;
  conteudo?: string;
  titulo?: string | null;
  agendamento_id?: string | null;
  metadados?: MetadadosDocumento | null;
};

const semRetentarNegado = (n: number, e: Error) => !(e instanceof ErroApi && [403, 404].includes(e.status)) && n < 2;

export function useDocumentosPaciente(pacienteId: string) {
  return useQuery({
    queryKey: chavesDocumentos.paciente(pacienteId),
    queryFn: () => api.get<DocumentoResumo[]>(`/documentos/pacientes/${pacienteId}`),
    retry: semRetentarNegado,
  });
}

export function useDocumento(id: string | null) {
  return useQuery({
    queryKey: chavesDocumentos.detalhe(id ?? ''),
    queryFn: () => api.get<Documento>(`/documentos/${id}`),
    enabled: !!id,
    retry: semRetentarNegado,
  });
}

export function useEmitirDocumento(pacienteId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dados: NovoDocumento) => api.post<Documento>('/documentos', dados),
    onSuccess: () => qc.invalidateQueries({ queryKey: chavesDocumentos.paciente(pacienteId) }),
  });
}

/** PDF de pré-visualização (Blob). O documento NÃO é gravado. */
export async function gerarPreviaDocumento(dados: NovoDocumento): Promise<Blob> {
  return api.post<Blob>('/documentos/previa', dados, { resposta: 'blob' });
}

/**
 * Abre o PDF numa nova aba. A aba é aberta ANTES da requisição (senão o navegador bloqueia o pop-up)
 * e recebe a URL do Blob quando o PDF chega.
 */
export async function abrirPdfDocumento(id: string): Promise<void> {
  const aba = window.open('', '_blank');
  try {
    const blob = await api.baixar(`/documentos/${id}/pdf`);
    const url = URL.createObjectURL(blob);
    if (aba) aba.location.href = url;
    else window.location.assign(url);
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    aba?.close();
    throw e;
  }
}
