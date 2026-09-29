/**
 * Guards de rota por tipo de token e papel.
 *
 *   <RotaClinica />                         exige token da clínica (carrega /me)
 *   <RotaClinica papeis={['admin']} />       exige também um dos papéis
 *   <RotaAdmin />                            exige token do super admin
 *   <RotaPublica tipo="clinica" />           se já logado, redireciona para a área logada
 */
import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/contextos/AuthContext';
import { useAdminMe, useMe } from '@/api/me';
import type { Papel } from '@/api/tipos';
import { Carregando, SemPermissao } from '@/componentes/comum';
import { Button } from '@/componentes/ui/button';
import { mensagemDeErro } from '@/api/cliente';

function ErroSessao({ erro, tentar }: { erro: unknown; tentar: () => void }) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
      <p className="text-sm text-muted-foreground">{mensagemDeErro(erro)}</p>
      <Button variant="outline" onClick={tentar}>
        Tentar novamente
      </Button>
    </div>
  );
}

export function RotaClinica({ papeis, children }: { papeis?: Papel[]; children?: ReactNode }) {
  const { tokenClinica } = useAuth();
  const location = useLocation();
  const { data: me, isLoading, error, refetch } = useMe();

  if (!tokenClinica) return <Navigate to="/login" replace state={{ de: location.pathname }} />;
  if (isLoading) return <Carregando telaCheia={!children} />;
  if (error || !me) return <ErroSessao erro={error} tentar={() => refetch()} />;
  if (papeis && !papeis.includes(me.papel)) return <SemPermissao />;
  return children ? <>{children}</> : <Outlet />;
}

export function RotaAdmin({ children }: { children?: ReactNode }) {
  const { tokenAdmin } = useAuth();
  const location = useLocation();
  const { data, isLoading, error, refetch } = useAdminMe();

  if (!tokenAdmin) return <Navigate to="/admin/login" replace state={{ de: location.pathname }} />;
  if (isLoading) return <Carregando telaCheia />;
  if (error || !data) return <ErroSessao erro={error} tentar={() => refetch()} />;
  return children ? <>{children}</> : <Outlet />;
}

export function RotaPublica({ tipo }: { tipo: 'clinica' | 'admin' }) {
  const { tokenClinica, tokenAdmin } = useAuth();
  if (tipo === 'clinica' && tokenClinica) return <Navigate to="/agenda" replace />;
  if (tipo === 'admin' && tokenAdmin) return <Navigate to="/admin" replace />;
  return <Outlet />;
}
