import { Suspense } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contextos/AuthContext';
import { useAdminMe } from '@/api/me';
import { MENU_ADMIN } from '@/rotas/navegacao';
import { Carregando } from '@/componentes/comum';
import { Badge } from '@/componentes/ui/badge';
import { Estrutura } from './Estrutura';

export function LayoutAdmin() {
  const { data } = useAdminMe();
  const { sairAdmin } = useAuth();
  const navigate = useNavigate();
  if (!data) return <Carregando telaCheia />;

  const sair = () => {
    sairAdmin();
    navigate('/admin/login', { replace: true });
  };

  return (
    <Estrutura
      itens={MENU_ADMIN}
      subtitulo={<Badge variant="secondary">Super admin</Badge>}
      usuario={{ nome: data.usuario.nome, detalhe: data.usuario.email }}
      aoSair={sair}
    >
      <Suspense fallback={<Carregando />}>
        <Outlet />
      </Suspense>
    </Estrutura>
  );
}
