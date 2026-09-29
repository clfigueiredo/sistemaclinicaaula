// TODO(fase 2): implementar esta página (módulo profissionais, rota /profissionais).
// Padrão de página: <CabecalhoPagina> + conteúdo; dados via hooks de src/api/<modulo>.ts (TanStack Query);
// formulários com react-hook-form + zod + componentes de src/componentes/ui; toasts com sonner.
// Profissionais da clínica (limite max_profissionais).
import { PaginaEmConstrucao } from '@/componentes/comum';

export default function PaginaListaProfissionais() {
  return <PaginaEmConstrucao titulo="Profissionais" descricao="Profissionais da clínica (limite max_profissionais)." />;
}
