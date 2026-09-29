// TODO(fase 2): implementar esta página (módulo admin-clinicas, rota /admin/clinicas/:id).
// Padrão de página: <CabecalhoPagina> + conteúdo; dados via hooks de src/api/<modulo>.ts (TanStack Query);
// formulários com react-hook-form + zod + componentes de src/componentes/ui; toasts com sonner.
// Dados da clínica, assinatura (plano/status/expiração) e uso dos recursos. useParams().id.
import { PaginaEmConstrucao } from '@/componentes/comum';

export default function PaginaDetalheClinica() {
  return <PaginaEmConstrucao titulo="Clínica" descricao="Dados da clínica, assinatura (plano/status/expiração) e uso dos recursos." />;
}
