// [STUB — fase 2] DONO: módulo `financeiro`. Contrato: docs/FASE2.md §1. Aba "Relatórios" de /financeiro
// (renderizada dentro do LayoutFinanceiro). Hooks em src/api/financeiro.ts.
import { Construction } from 'lucide-react';
import { EstadoVazio } from '@/componentes/comum';

export default function Pagina() {
  return (
    <EstadoVazio
      icone={<Construction className="size-5" />}
      titulo="Relatórios — em construção"
      descricao="Resumo por categoria, forma de pagamento e fluxo de caixa."
    />
  );
}
