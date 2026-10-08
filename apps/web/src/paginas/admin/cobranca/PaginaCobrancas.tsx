// Cobranças de todas as clínicas (super admin): filtros rápidos por situação, baixa manual, cancelamento e links.
// O conteúdo é o componente AbaCobrancas (antes uma aba de /admin/cobranca). Hooks em src/api/adminCobranca.ts.
import { CabecalhoPagina } from '@/componentes/comum';
import AbaCobrancas from './AbaCobrancas';

export default function PaginaCobrancas() {
  return (
    <div>
      <CabecalhoPagina
        titulo="Cobranças"
        descricao="Mensalidades e contratações de todas as clínicas. Cobrança em aberto além da tolerância suspende o acesso da clínica até o pagamento."
      />
      <AbaCobrancas />
    </div>
  );
}
