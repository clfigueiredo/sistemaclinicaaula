// TODO(fase 2): implementar esta página (módulo admin-clinicas, rota /admin/clinicas).
// Padrão de página: <CabecalhoPagina> + conteúdo; dados via hooks de src/api/<modulo>.ts (TanStack Query);
// formulários com react-hook-form + zod + componentes de src/componentes/ui; toasts com sonner.
// Clínicas cadastradas, plano e status da assinatura.
import { PaginaEmConstrucao } from '@/componentes/comum';

export default function PaginaListaClinicas() {
  return <PaginaEmConstrucao titulo="Clínicas" descricao="Clínicas cadastradas, plano e status da assinatura." />;
}
