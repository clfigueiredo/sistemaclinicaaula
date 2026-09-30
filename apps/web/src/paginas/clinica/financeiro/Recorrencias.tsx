// [STUB — fase 2] DONO: módulo `financeiro`. Contrato: docs/FASE2.md §1. Aba "Recorrências" de /financeiro
// (renderizada dentro do LayoutFinanceiro). Hooks em src/api/financeiro.ts.
import { Construction } from 'lucide-react';
import { EstadoVazio } from '@/componentes/comum';

export default function Pagina() {
  return (
    <EstadoVazio
      icone={<Construction className="size-5" />}
      titulo="Recorrências — em construção"
      descricao="Modelos mensais (aluguel, mensalidades) que geram os títulos."
    />
  );
}
