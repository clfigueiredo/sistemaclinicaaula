// Aviso no topo do app (ao lado do sino), renderizado pelo LayoutClinica para admin/recepção quando o plano
// tem `agendamento_online`: ícone com o número de solicitações pendentes (polling 60 s) que leva a /solicitacoes.
import { Link } from 'react-router-dom';
import { CalendarPlus } from 'lucide-react';
import { useResumoSolicitacoes } from '@/api/agendamentoOnline';
import { Button } from '@/componentes/ui/button';

export default function AvisoTopoSolicitacoes() {
  const { data } = useResumoSolicitacoes();
  const pendentes = data?.pendentes ?? 0;
  const rotulo = pendentes
    ? `Agendamento online: ${pendentes} solicitação(ões) pendente(s)`
    : 'Agendamento online: nenhuma solicitação pendente';
  return (
    <Button variant="ghost" size="icon" className="relative" asChild>
      <Link to="/solicitacoes" aria-label={rotulo} title={rotulo}>
        <CalendarPlus className="size-5" />
        {pendentes > 0 && (
          <span className="absolute top-1 right-1 grid min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] leading-4 font-semibold text-primary-foreground">
            {pendentes > 99 ? '99+' : pendentes}
          </span>
        )}
      </Link>
    </Button>
  );
}
