import { Suspense } from 'react';
import { Link, Outlet, useNavigate } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { useAuth } from '@/contextos/AuthContext';
import { useMe } from '@/api/me';
import { ROTULOS_PAPEL, ROTULOS_STATUS_ASSINATURA } from '@/api/tipos';
import { MENU_CLINICA, itensPermitidos } from '@/rotas/navegacao';
import { Carregando } from '@/componentes/comum';
import { Badge } from '@/componentes/ui/badge';
import { Estrutura } from './Estrutura';
import { SinoAvisos } from './SinoAvisos';

export function LayoutClinica() {
  const { data: me } = useMe();
  const { sairClinica } = useAuth();
  const navigate = useNavigate();
  if (!me) return <Carregando telaCheia />;

  const sair = () => {
    sairClinica();
    navigate('/login', { replace: true });
  };

  const somenteLeitura = me.assinatura?.somente_leitura;
  const status = me.assinatura?.status;
  // Avisos de cancelamento via WhatsApp: admin e recepção, se o plano tiver WhatsApp.
  const mostrarAvisos = (me.papel === 'admin' || me.papel === 'recepcao') && !!me.recursos.whatsapp?.habilitado;

  return (
    <Estrutura
      itens={itensPermitidos(MENU_CLINICA, me.papel)}
      subtitulo={<span className="font-medium text-foreground">{me.clinica.nome}</span>}
      usuario={{ nome: me.usuario.nome, detalhe: `${ROTULOS_PAPEL[me.papel]} · ${me.usuario.email}` }}
      aoSair={sair}
      acoesTopo={mostrarAvisos ? <SinoAvisos /> : null}
      rodapeSidebar={
        <div className="space-y-1.5 text-xs">
          <div className="text-muted-foreground">Plano</div>
          <div className="flex items-center justify-between gap-2">
            <span className="truncate font-medium">{me.plano?.nome ?? '—'}</span>
            {status && (
              <Badge variant={somenteLeitura ? 'destructive' : 'secondary'}>{ROTULOS_STATUS_ASSINATURA[status]}</Badge>
            )}
          </div>
          {me.papel === 'admin' && (
            <Link to="/configuracoes" className="inline-block text-primary hover:underline">
              Ver uso e limites
            </Link>
          )}
        </div>
      }
      aviso={
        somenteLeitura ? (
          <div className="flex items-center gap-2 border-b border-destructive/20 bg-destructive/10 px-4 py-2 text-sm text-destructive sm:px-6">
            <AlertTriangle className="size-4 shrink-0" />
            Sua assinatura está {status ? ROTULOS_STATUS_ASSINATURA[status].toLowerCase() : 'inativa'}: o sistema
            está em modo somente leitura.
          </div>
        ) : null
      }
    >
      <Suspense fallback={<Carregando />}>
        <Outlet />
      </Suspense>
    </Estrutura>
  );
}
