/**
 * API dos documentos clínicos (receita/atestado/declaração/pedido de exame).   [STUB — fase 2, DONO: documentos]
 * Contrato: docs/FASE2.md §4. Sem edição/exclusão (imutáveis). PDF: `api.baixar('/documentos/:id/pdf')` → Blob.
 *
 * Hooks previstos: useDocumentosPaciente(pacienteId), useDocumento(id), useEmitirDocumento, baixarPdfDocumento(id).
 */
export const chavesDocumentos = {
  todos: ['documentos'] as const,
  paciente: (pacienteId: string) => [...chavesDocumentos.todos, 'paciente', pacienteId] as const,
  detalhe: (id: string) => [...chavesDocumentos.todos, 'detalhe', id] as const,
};
