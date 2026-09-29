// TODO(fase 2): implementar esta página (módulo agendamentos, rota /agenda).
// Padrão de página: <CabecalhoPagina> + conteúdo; dados via hooks de src/api/<modulo>.ts (TanStack Query);
// formulários com react-hook-form + zod + componentes de src/componentes/ui; toasts com sonner.
// Agenda por profissional (FullCalendar: @fullcalendar/react + timegrid/daygrid/interaction, locale pt-br).
import { PaginaEmConstrucao } from '@/componentes/comum';

export default function PaginaAgenda() {
  return <PaginaEmConstrucao titulo="Agenda" descricao="Agenda por profissional (FullCalendar: @fullcalendar/react + timegrid/daygrid/interaction, locale pt-br)." />;
}
