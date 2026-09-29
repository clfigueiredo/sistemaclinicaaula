// Agenda da clínica (FullCalendar): visão dia/semana/mês, filtro por profissional, bloqueios,
// criação por clique em horário vazio, detalhes/ações de status e remarcação por arrastar.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin, { type EventResizeDoneArg } from '@fullcalendar/interaction';
import ptBrLocale from '@fullcalendar/core/locales/pt-br';
import type {
  DateSelectArg,
  DatesSetArg,
  EventClickArg,
  EventContentArg,
  EventDropArg,
  EventInput,
} from '@fullcalendar/core';
import { AlertTriangle, CalendarPlus, CheckCircle2, Loader2, RefreshCw, UserCheck, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { mensagemDeErro } from '@/api/cliente';
import {
  STATUS_REMARCAVEIS,
  useAgendamentos,
  useBloqueiosAgenda,
  useEditarAgendamento,
  useProfissionaisAgenda,
  type Agendamento,
} from '@/api/agendamentos';
import { useMe, usePodeUsar } from '@/api/me';
import { ROTULOS_STATUS_AGENDAMENTO, type StatusAgendamento } from '@/api/tipos';
import { AvisoLimite, CabecalhoPagina, Carregando, EstadoVazio, UsoRecurso } from '@/componentes/comum';
import { Alert, AlertDescription, AlertTitle } from '@/componentes/ui/alert';
import { Button } from '@/componentes/ui/button';
import { Card, CardContent } from '@/componentes/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/componentes/ui/select';
import { cn } from '@/lib/utils';
import { DialogoAgendamento, type SugestaoNovo } from './DialogoAgendamento';
import { PainelAgendamento } from './PainelAgendamento';
import { ESTILO_STATUS, useTelaPequena } from './utilidades';

const TODOS = 'todos';
const ORDEM_STATUS: StatusAgendamento[] = ['agendado', 'confirmado', 'compareceu', 'atendido', 'faltou', 'cancelado'];

export default function PaginaAgenda() {
  const { data: me } = useMe();
  const telaPequena = useTelaPequena();
  const calendario = useRef<FullCalendar>(null);
  const { pode: podeCriarPlano, mensagem: mensagemLimite } = usePodeUsar('max_agendamentos');

  const papel = me?.papel;
  const profissionalFixo = papel === 'profissional' ? me?.usuario.profissionalId ?? null : null;
  const somenteLeitura = !!me?.assinatura?.somente_leitura;
  const podeAlterar = !somenteLeitura && (papel !== 'profissional' || !!profissionalFixo);

  const [filtroProf, setFiltroProf] = useState<string>(TODOS);
  const [intervalo, setIntervalo] = useState<{ inicio: string; fim: string } | null>(null);
  const [selecionadoId, setSelecionadoId] = useState<string | null>(null);
  const [dialogo, setDialogo] = useState<{ aberto: boolean; sugestao?: SugestaoNovo | null; edicao?: Agendamento | null }>({
    aberto: false,
  });

  const profissionais = useProfissionaisAgenda();
  const profissionalId = profissionalFixo ?? (filtroProf === TODOS ? undefined : filtroProf);

  const agendamentos = useAgendamentos({ ...(intervalo ?? {}), profissionalId }, !!intervalo);
  const bloqueios = useBloqueiosAgenda(intervalo ? { ...intervalo, profissionalId } : null);
  const editar = useEditarAgendamento();

  // Troca de view ao mudar o tamanho da tela (celular: dia; desktop: semana).
  useEffect(() => {
    const api = calendario.current?.getApi();
    if (!api) return;
    const atual = api.view.type;
    if (telaPequena && atual === 'timeGridWeek') api.changeView('timeGridDay');
    if (!telaPequena && atual === 'timeGridDay') api.changeView('timeGridWeek');
  }, [telaPequena]);

  const listaProfissionais = profissionais.data ?? [];
  const mostrarProfissional = !profissionalId && listaProfissionais.length > 1;

  const eventos = useMemo<EventInput[]>(() => {
    const agora = Date.now();
    const lista: EventInput[] = (agendamentos.data ?? []).map((a) => {
      const cor = a.profissional.cor_agenda || '#0d9488';
      const arrastavel = podeAlterar && STATUS_REMARCAVEIS.includes(a.status) && new Date(a.inicio).getTime() > agora;
      return {
        id: a.id,
        title: a.paciente.nome,
        start: a.inicio,
        end: a.fim,
        backgroundColor: cor,
        borderColor: cor,
        textColor: '#ffffff',
        classNames: ['cursor-pointer', ...ESTILO_STATUS[a.status].evento],
        editable: arrastavel,
        extendedProps: { agendamento: a },
      };
    });
    for (const b of bloqueios.data ?? []) {
      // Em "todos", só os bloqueios da clínica toda (os de um profissional aparecem ao filtrá-lo).
      if (!profissionalId && b.profissional_id) continue;
      lista.push({
        id: `bloqueio-${b.id}`,
        start: b.inicio,
        end: b.fim,
        display: 'background',
        backgroundColor: '#94a3b8',
        title: b.motivo ? `Bloqueado · ${b.motivo}` : 'Bloqueado',
        classNames: ['bloqueio-agenda'],
      });
    }
    return lista;
  }, [agendamentos.data, bloqueios.data, podeAlterar, profissionalId]);

  const selecionado = useMemo(
    () => (selecionadoId ? (agendamentos.data ?? []).find((a) => a.id === selecionadoId) ?? null : null),
    [selecionadoId, agendamentos.data],
  );

  const podeCriar = podeAlterar && podeCriarPlano;

  function abrirNovo(sugestao?: SugestaoNovo) {
    setDialogo({ aberto: true, sugestao: { profissionalId, ...sugestao }, edicao: null });
  }

  function aoSelecionar(info: DateSelectArg) {
    info.view.calendar.unselect();
    if (!podeAlterar) return;
    if (!podeCriarPlano) {
      toast.error('Limite do plano', { description: mensagemLimite ?? undefined });
      return;
    }
    abrirNovo({ inicio: info.start, fim: info.allDay ? undefined : info.end });
  }

  function aoDatas(arg: DatesSetArg) {
    const novo = { inicio: arg.start.toISOString(), fim: arg.end.toISOString() };
    setIntervalo((atual) => (atual?.inicio === novo.inicio && atual?.fim === novo.fim ? atual : novo));
  }

  async function remarcar(info: EventDropArg | EventResizeDoneArg) {
    const a = info.event.extendedProps.agendamento as Agendamento;
    const inicio = info.event.start!;
    const fim = info.event.end ?? new Date(inicio.getTime() + (new Date(a.fim).getTime() - new Date(a.inicio).getTime()));
    try {
      await editar.mutateAsync({ id: a.id, inicio: inicio.toISOString(), fim: fim.toISOString() });
      toast.success('Agendamento remarcado.', {
        description: a.status === 'confirmado' ? 'O status voltou para "Agendado" (nova confirmação).' : undefined,
      });
    } catch (e) {
      info.revert();
      if ((e as { codigo?: string }).codigo !== 'assinatura_inativa') toast.error(mensagemDeErro(e));
    }
  }

  function conteudoEvento(arg: EventContentArg) {
    if (arg.event.display === 'background') {
      return <div className="p-1 text-[10px] font-medium text-muted-foreground">{arg.event.title}</div>;
    }
    const a = arg.event.extendedProps.agendamento as Agendamento;
    const Icone =
      a.status === 'confirmado' ? CheckCircle2 : a.status === 'compareceu' ? UserCheck : a.status === 'cancelado' || a.status === 'faltou' ? XCircle : null;
    return (
      <div className="flex h-full min-w-0 flex-col overflow-hidden px-1 py-0.5 text-xs leading-tight" title={`${a.paciente.nome} · ${ROTULOS_STATUS_AGENDAMENTO[a.status]}`}>
        <div className="flex min-w-0 items-center gap-1 font-medium">
          {Icone && <Icone className="size-3 shrink-0" aria-label={ROTULOS_STATUS_AGENDAMENTO[a.status]} />}
          <span className="truncate">{a.paciente.nome}</span>
        </div>
        <div className="truncate opacity-90">
          {arg.timeText}
          {mostrarProfissional && ` · ${a.profissional.nome}`}
        </div>
      </div>
    );
  }

  if (!me || profissionais.isLoading) return <Carregando />;

  if (papel === 'profissional' && !profissionalFixo) {
    return (
      <div>
        <CabecalhoPagina titulo="Agenda" />
        <EstadoVazio
          icone={<AlertTriangle className="size-5" />}
          titulo="Usuário sem profissional vinculado"
          descricao="Peça ao administrador da clínica para vincular seu usuário a um cadastro de profissional."
        />
      </div>
    );
  }

  if (profissionais.isSuccess && listaProfissionais.length === 0) {
    return (
      <div>
        <CabecalhoPagina titulo="Agenda" descricao="Consultas por profissional." />
        <EstadoVazio
          titulo="Nenhum profissional ativo"
          descricao="Cadastre um profissional e a grade de horários dele para começar a agendar."
          acao={
            papel !== 'profissional' ? (
              <Button asChild>
                <Link to="/profissionais">Cadastrar profissional</Link>
              </Button>
            ) : undefined
          }
        />
      </div>
    );
  }

  const ocupado = agendamentos.isFetching || bloqueios.isFetching;

  return (
    <div>
      <CabecalhoPagina
        titulo="Agenda"
        descricao={profissionalFixo ? 'Sua agenda de atendimentos.' : 'Consultas por profissional. Clique em um horário vazio para agendar.'}
        acoes={
          <>
            <UsoRecurso codigo="max_agendamentos" />
            {podeAlterar && (
              <Button onClick={() => abrirNovo()} disabled={!podeCriar} title={!podeCriar ? (mensagemLimite ?? undefined) : undefined}>
                <CalendarPlus className="size-4" /> Novo agendamento
              </Button>
            )}
          </>
        }
      />

      <AvisoLimite codigo="max_agendamentos" className="mb-4" />

      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-2">
          {!profissionalFixo && (
            <Select value={filtroProf} onValueChange={setFiltroProf}>
              <SelectTrigger className="w-full sm:w-72" aria-label="Filtrar por profissional">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={TODOS}>Todos os profissionais</SelectItem>
                {listaProfissionais.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    <span className="size-2.5 rounded-full" style={{ backgroundColor: p.cor_agenda }} />
                    {p.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {ocupado && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Atualizando" />}
        </div>

        <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground" aria-label="Legenda de status">
          {ORDEM_STATUS.map((s) => (
            <li key={s} className="flex items-center gap-1.5" title={ESTILO_STATUS[s].descricao}>
              <span className={cn('size-2.5 rounded-full', ESTILO_STATUS[s].ponto)} />
              <span className={cn(s === 'cancelado' && 'line-through')}>{ROTULOS_STATUS_AGENDAMENTO[s]}</span>
            </li>
          ))}
          <li className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-slate-400/60" />
            Bloqueio
          </li>
        </ul>
      </div>

      {(agendamentos.isError || bloqueios.isError) && (
        <Alert variant="destructive" className="mb-4">
          <AlertTriangle className="size-4" />
          <AlertTitle>Não foi possível carregar a agenda</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-2">
            {mensagemDeErro(agendamentos.error ?? bloqueios.error)}
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                agendamentos.refetch();
                bloqueios.refetch();
              }}
            >
              <RefreshCw className="size-4" /> Tentar novamente
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <Card className="py-0">
        <CardContent className="p-2 sm:p-4">
          <FullCalendar
            ref={calendario}
            plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
            locale={ptBrLocale}
            initialView={telaPequena ? 'timeGridDay' : 'timeGridWeek'}
            headerToolbar={
              telaPequena
                ? { left: 'prev,next', center: 'title', right: 'today' }
                : { left: 'prev,next today', center: 'title', right: 'timeGridDay,timeGridWeek,dayGridMonth' }
            }
            footerToolbar={telaPequena ? { center: 'timeGridDay,dayGridMonth' } : undefined}
            buttonText={{ today: 'Hoje', day: 'Dia', week: 'Semana', month: 'Mês' }}
            height={telaPequena ? 'auto' : 'calc(100vh - 17rem)'}
            expandRows
            stickyHeaderDates
            allDaySlot={false}
            slotMinTime="06:00:00"
            slotMaxTime="22:00:00"
            scrollTime="07:30:00"
            slotDuration="00:15:00"
            slotLabelInterval="01:00"
            slotLabelFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
            eventTimeFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
            nowIndicator
            dayMaxEvents={4}
            eventDisplay="block"
            events={eventos}
            eventContent={conteudoEvento}
            selectable={podeAlterar}
            selectMirror
            selectAllow={(info) => info.end.getTime() > Date.now()}
            select={aoSelecionar}
            eventClick={(info: EventClickArg) => {
              if (info.event.display === 'background') return;
              setSelecionadoId(info.event.id);
            }}
            eventAllow={(drop) => drop.start.getTime() > Date.now()}
            eventDrop={remarcar}
            eventResize={remarcar}
            datesSet={aoDatas}
          />
        </CardContent>
      </Card>

      <PainelAgendamento
        agendamento={selecionado}
        onOpenChange={(a) => !a && setSelecionadoId(null)}
        podeAlterar={podeAlterar}
        onEditar={(a) => {
          setSelecionadoId(null);
          setDialogo({ aberto: true, edicao: a });
        }}
      />

      <DialogoAgendamento
        aberto={dialogo.aberto}
        onOpenChange={(aberto) => setDialogo((d) => ({ ...d, aberto }))}
        profissionais={listaProfissionais}
        sugestao={dialogo.sugestao}
        agendamento={dialogo.edicao}
        ehAdmin={papel === 'admin'}
        profissionalFixo={profissionalFixo}
      />
    </div>
  );
}
