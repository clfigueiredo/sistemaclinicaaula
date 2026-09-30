// [STUB — fase 2] DONO: módulo `documentos`. Contrato: docs/FASE2.md §4.
// Aba "Documentos" da ficha do paciente (receitas, atestados, declarações, pedidos de exame em PDF).
// Já incluída na FichaPaciente para PAPEIS_ROTA.documentos (admin, profissional) quando o plano tem
// `documentos_pdf`. Documentos são IMUTÁVEIS (sem editar/excluir; correção = novo documento).
// PDF: api.baixar(`/documentos/${id}/pdf`) → Blob → URL.createObjectURL (abrir em nova aba / baixar).
// Hooks em src/api/documentos.ts.
import { FileText } from 'lucide-react';
import { EstadoVazio } from '@/componentes/comum';

export default function AbaDocumentos({ pacienteId }: { pacienteId: string }) {
  void pacienteId;
  return (
    <EstadoVazio
      icone={<FileText className="size-5" />}
      titulo="Documentos — em construção"
      descricao="Receitas, atestados, declarações e pedidos de exame em PDF."
    />
  );
}
