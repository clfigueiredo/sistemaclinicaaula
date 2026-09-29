// TODO(fase 2): implementar esta página (módulo admin-planos, rota /admin/planos/:id).
// Padrão de página: <CabecalhoPagina> + conteúdo; dados via hooks de src/api/<modulo>.ts (TanStack Query);
// formulários com react-hook-form + zod + componentes de src/componentes/ui; toasts com sonner.
// Edição do plano: preço, recursos, limites e período (total/mensal). useParams().id ("novo" para criar).
import { PaginaEmConstrucao } from '@/componentes/comum';

export default function PaginaDetalhePlano() {
  return <PaginaEmConstrucao titulo="Plano" descricao="Edição do plano: preço, recursos, limites e período (total/mensal)." />;
}
