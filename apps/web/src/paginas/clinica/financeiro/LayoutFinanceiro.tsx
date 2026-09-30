// DONO: módulo `financeiro`. Contrato: docs/FASE2.md §1.
// Layout da área /financeiro: cabeçalho + abas (ABAS_FINANCEIRO filtradas pelo papel) + <Outlet />.
// Cada aba é uma rota filha com guard de papel próprio (src/rotas/index.tsx). O dono pode redesenhar à vontade.
import { NavLink, Outlet } from 'react-router-dom';
import { useMe } from '@/api/me';
import { ABAS_FINANCEIRO, itensPermitidos } from '@/rotas/navegacao';
import { CabecalhoPagina } from '@/componentes/comum';
import { cn } from '@/lib/utils';

export default function LayoutFinanceiro() {
  const { data: me } = useMe();
  const abas = itensPermitidos(ABAS_FINANCEIRO, me?.papel);
  return (
    <div>
      <CabecalhoPagina titulo="Financeiro" descricao="Caixa, contas a pagar e a receber, recorrências, repasses e relatórios." />
      <nav className="mb-6 flex gap-1 overflow-x-auto border-b">
        {abas.map((aba) => (
          <NavLink
            key={aba.caminho}
            to={aba.caminho}
            className={({ isActive }) =>
              cn(
                '-mb-px border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors',
                isActive
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )
            }
          >
            {aba.rotulo}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
