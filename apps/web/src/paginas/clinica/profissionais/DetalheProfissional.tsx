// TODO(fase 2): implementar esta página (módulo profissionais, rota /profissionais/:id).
// Padrão de página: <CabecalhoPagina> + conteúdo; dados via hooks de src/api/<modulo>.ts (TanStack Query);
// formulários com react-hook-form + zod + componentes de src/componentes/ui; toasts com sonner.
// Dados + grade semanal de horários + bloqueios de agenda. useParams().id ("novo" para criar).
import { PaginaEmConstrucao } from '@/componentes/comum';

export default function PaginaDetalheProfissional() {
  return <PaginaEmConstrucao titulo="Profissional" descricao="Dados + grade semanal de horários + bloqueios de agenda." />;
}
