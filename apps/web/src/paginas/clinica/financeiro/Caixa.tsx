// [STUB — fase 2] DONO: módulo `financeiro`. Contrato: docs/FASE2.md §1. Aba "Caixa" de /financeiro
// (renderizada dentro do LayoutFinanceiro). Hooks em src/api/financeiro.ts.
import { Construction } from 'lucide-react';
import { EstadoVazio } from '@/componentes/comum';

export default function Pagina() {
  return (
    <EstadoVazio
      icone={<Construction className="size-5" />}
      titulo="Caixa — em construção"
      descricao="Entradas, saídas, saldos por conta, recebimentos de consultas e estornos."
    />
  );
}
