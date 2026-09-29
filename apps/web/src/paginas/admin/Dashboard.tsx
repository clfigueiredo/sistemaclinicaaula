// TODO(fase 2): implementar esta página (módulo admin-clinicas, rota /admin).
// Padrão de página: <CabecalhoPagina> + conteúdo; dados via hooks de src/api/<modulo>.ts (TanStack Query);
// formulários com react-hook-form + zod + componentes de src/componentes/ui; toasts com sonner.
// Visão geral da plataforma: clínicas, assinaturas e planos.
import { PaginaEmConstrucao } from '@/componentes/comum';

export default function PaginaAdminDashboard() {
  return <PaginaEmConstrucao titulo="Dashboard" descricao="Visão geral da plataforma: clínicas, assinaturas e planos." />;
}
