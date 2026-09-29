// TODO(fase 2): implementar esta página (módulo usuarios, rota /usuarios).
// Padrão de página: <CabecalhoPagina> + conteúdo; dados via hooks de src/api/<modulo>.ts (TanStack Query);
// formulários com react-hook-form + zod + componentes de src/componentes/ui; toasts com sonner.
// Usuários da clínica e papéis (limite max_recepcionistas; admin não conta).
import { PaginaEmConstrucao } from '@/componentes/comum';

export default function PaginaUsuarios() {
  return <PaginaEmConstrucao titulo="Usuários" descricao="Usuários da clínica e papéis (limite max_recepcionistas; admin não conta)." />;
}
