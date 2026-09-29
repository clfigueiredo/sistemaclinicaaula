// TODO(fase 2): implementar esta página (módulo pacientes, rota /pacientes).
// Padrão de página: <CabecalhoPagina> + conteúdo; dados via hooks de src/api/<modulo>.ts (TanStack Query);
// formulários com react-hook-form + zod + componentes de src/componentes/ui; toasts com sonner.
// Busca e cadastro de pacientes.
import { PaginaEmConstrucao } from '@/componentes/comum';

export default function PaginaListaPacientes() {
  return <PaginaEmConstrucao titulo="Pacientes" descricao="Busca e cadastro de pacientes." />;
}
