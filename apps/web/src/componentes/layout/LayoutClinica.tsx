import { Suspense } from 'react';
import { Link, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contextos/AuthContext';
import { useMe } from '@/api/me';
import { ROTULOS_PAPEL, ROTULOS_STATUS_ASSINATURA } from '@/api/tipos';
import { MENU_CLINICA, itensPermitidos } from '@/rotas/navegacao';
import { Carregando } from '@/componentes/comum';
import { Badge } from '@/componentes/ui/badge';
import { AcessoSuspenso } from './AcessoSuspenso';
import { Estrutura } from './Estrutura';
import { SinoAvisos } from './SinoAvisos';
import AvisoTopoSolicitacoes from '@/paginas/clinica/solicitacoes/AvisoTopoSolicitacoes';
import AvisoTopoListaEspera from '@/paginas/clinica/lista-espera/AvisoTopoListaEspera';

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
  // Assinatura vencida/cancelada/bloqueada: acesso suspenso (a API recusa todo o resto) — só a tela de pagamento.
  if (somenteLeitura) return <AcessoSuspenso me={me} aoSair={sair} />;
  // Avisos de cancelamento via WhatsApp: admin e recepção, se o plano tiver WhatsApp.
  const equipe = me.papel === 'admin' || me.papel === 'recepcao';
  const mostrarAvisos = equipe && !!me.recursos.whatsapp?.habilitado;
  // Fase 2: avisos no topo de cada módulo (componentes dos donos — docs/FASE2.md).
  const mostrarSolicitacoes = equipe && !!me.recursos.agendamento_online?.habilitado;
  const mostrarListaEspera = equipe && !!me.recursos.lista_espera?.habilitado;
  const acoesTopo =
    mostrarAvisos || mostrarSolicitacoes || mostrarListaEspera ? (
      <>
        {mostrarSolicitacoes && <AvisoTopoSolicitacoes />}
        {mostrarListaEspera && <AvisoTopoListaEspera />}
        {mostrarAvisos && <SinoAvisos />}
      </>
    ) : null;

  return (
    <Estrutura
      itens={itensPermitidos(MENU_CLINICA, me.papel, me.recursos)}
      subtitulo={<span className="font-medium text-foreground">{me.clinica.nome}</span>}
      usuario={{ nome: me.usuario.nome, detalhe: `${ROTULOS_PAPEL[me.papel]} · ${me.usuario.email}` }}
      aoSair={sair}
      acoesTopo={acoesTopo}
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
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <Link to="/configuracoes" className="text-primary hover:underline">
                Ver uso e limites
              </Link>
              <Link to="/planos" className="font-medium text-primary hover:underline">
                {me.plano && Number(me.plano.preco) > 0 ? 'Ver planos' : 'Fazer upgrade'}
              </Link>
            </div>
          )}
        </div>
      }
    >
      <Suspense fallback={<Carregando />}>
        <Outlet />
      </Suspense>
    </Estrutura>
  );
}
