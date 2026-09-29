// TODO(fase 2): implementar esta página (módulo pacientes + prontuario, rota /pacientes/:id).
// Padrão de página: <CabecalhoPagina> + conteúdo; dados via hooks de src/api/<modulo>.ts (TanStack Query);
// formulários com react-hook-form + zod + componentes de src/componentes/ui; toasts com sonner.
// Ficha com abas: Dados (alergias/medicações), Prontuário e Anexos. Abas de prontuário/anexos só para PAPEIS_ROTA.prontuario (recepção NÃO vê). useParams().id.
import { PaginaEmConstrucao } from '@/componentes/comum';

export default function PaginaFichaPaciente() {
  return <PaginaEmConstrucao titulo="Paciente" descricao="Ficha com abas: Dados (alergias/medicações), Prontuário e Anexos." />;
}
