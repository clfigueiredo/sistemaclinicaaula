// Aviso no topo do app (ao lado do sino), renderizado pelo LayoutClinica para admin/recepção quando o plano
// tem `lista_espera`: horários liberados por cancelamento (futuros, ainda livres) com pacientes compatíveis
// na lista de espera (GET /lista-espera/vagas-recentes, polling 60 s). Popover com links /agenda?agendamento=<id>.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { CalendarClock, ListOrdered, Users } from 'lucide-react';
import { useVagasRecentes } from '@/api/listaEspera';
import { Button } from '@/componentes/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/componentes/ui/popover';

export default function AvisoTopoListaEspera() {
  const [aberto, setAberto] = useState(false);
  const { data } = useVagasRecentes();
  const total = data?.total ?? 0;
  const rotulo = total
    ? `Lista de espera: ${total} horário(s) liberado(s) com pacientes aguardando`
    : 'Lista de espera';

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={rotulo} title={rotulo}>
          <ListOrdered className="size-5" />
          {total > 0 && (
            <span className="absolute top-1 right-1 grid min-w-4 place-items-center rounded-full bg-warning px-1 text-[10px] leading-4 font-semibold text-black">
              {total > 99 ? '99+' : total}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(24rem,calc(100vw-2rem))] p-0">
        <div className="border-b px-4 py-3">
          <p className="text-sm font-medium">Horários liberados</p>
          <p className="text-xs text-muted-foreground">Cancelamentos recentes com pacientes compatíveis na lista de espera.</p>
        </div>
        {total === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">Nenhum horário liberado no momento.</p>
        ) : (
          <ul className="max-h-80 divide-y overflow-y-auto">
            {data!.itens.map((v) => (
              <li key={v.agendamento_id}>
                <Link
                  to={`/agenda?agendamento=${v.agendamento_id}`}
                  onClick={() => setAberto(false)}
                  className="flex items-start gap-3 px-4 py-3 text-sm hover:bg-accent"
                >
                  <CalendarClock className="mt-0.5 size-4 shrink-0 text-primary" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">
                      {format(new Date(v.inicio), "EEE, dd/MM 'às' HH:mm", { locale: ptBR })}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">{v.profissional.nome}</span>
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                    <Users className="size-3.5" /> {v.sugestoes}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <div className="border-t p-2">
          <Button variant="ghost" size="sm" className="w-full" asChild>
            <Link to="/lista-espera" onClick={() => setAberto(false)}>
              Abrir lista de espera
            </Link>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
