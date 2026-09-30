/**
 * Guards de rota por tipo de token e papel.
 *
 *   <RotaClinica />                         exige token da clínica (carrega /me)
 *   <RotaClinica papeis={['admin']} />       exige também um dos papéis
 *   <RotaClinica recurso="financeiro" />     exige também o recurso habilitado no plano (senão mostra
 *                                           <RecursoIndisponivel />)
 *   <RotaAdmin />                            exige token do super admin
 *   <RotaPublica tipo="clinica" />           se já logado, redireciona para a área logada
 */
import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/contextos/AuthContext';
import { useAdminMe, useMe } from '@/api/me';
import type { CodigoRecurso, Papel } from '@/api/tipos';
import { Carregando, RecursoIndisponivel, SemPermissao } from '@/componentes/comum';
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

export function RotaClinica({
  papeis,
  recurso,
  children,
}: {
  papeis?: Papel[];
  recurso?: CodigoRecurso;
  children?: ReactNode;
}) {
  const { tokenClinica } = useAuth();
  const location = useLocation();
  const { data: me, isLoading, error, refetch } = useMe();

  if (!tokenClinica) return <Navigate to="/login" replace state={{ de: location.pathname }} />;
  if (isLoading) return <Carregando telaCheia={!children} />;
  if (error || !me) return <ErroSessao erro={error} tentar={() => refetch()} />;
  if (papeis && !papeis.includes(me.papel)) return <SemPermissao />;
  if (recurso && !me.recursos[recurso]?.habilitado) return <RecursoIndisponivel nome={me.recursos[recurso]?.nome} />;
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
  const location = useLocation();
  // Ao logar/cadastrar, o token muda antes do navigate() da página: este guard re-renderiza primeiro,
  // então ele precisa mandar para o MESMO destino (senão o cadastro cairia na agenda e não no onboarding,
  // e o login ignoraria a rota de origem `state.de`).
  const de = (location.state as { de?: string } | null)?.de;
  if (tipo === 'clinica' && tokenClinica) {
    return <Navigate to={location.pathname === '/cadastro' ? '/onboarding' : (de ?? '/agenda')} replace />;
  }
  if (tipo === 'admin' && tokenAdmin) return <Navigate to={de ?? '/admin'} replace />;
  return <Outlet />;
}
