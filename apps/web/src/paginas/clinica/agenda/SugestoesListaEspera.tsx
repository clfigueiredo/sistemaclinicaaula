// Bloco do PainelAgendamento (agenda) exibido quando o agendamento está `cancelado` ou `faltou` e o plano tem
// `lista_espera` (admin e recepção). Dono: lista-espera (docs/FASE2.md §3).
// Mostra os pacientes da lista compatíveis com o horário liberado (ordem de entrada) com as ações
// "Oferecer por WhatsApp" (só com consentimento) e "Agendar" (cria o agendamento pela rota normal da agenda
// no mesmo horário e marca a entrada da lista como `agendado`). Se o horário já foi ocupado, avisa e não sugere.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { CalendarPlus, ListOrdered, Loader2, MessageCircle, MessageCircleOff, Send } from 'lucide-react';
import { toast } from 'sonner';
import { useCriarAgendamento, type Agendamento } from '@/api/agendamentos';
import { mensagemDeErro } from '@/api/cliente';
import { ERROS_WHATSAPP } from '@/api/agendamentoOnline';
import {
  descreverPreferencias,
  useMudarStatusListaEspera,
  useOferecerHorario,
  useSugestoesListaEspera,
  type ItemListaEspera,
} from '@/api/listaEspera';
import { usePodeUsar } from '@/api/me';
import { ROTULOS_TURNO } from '@/api/tipos';
import { Button } from '@/componentes/ui/button';
import { Separator } from '@/componentes/ui/separator';

const MAX_VISIVEIS = 5;

export function SugestoesListaEspera({ agendamento }: { agendamento: Agendamento }) {
  const { data, isLoading, isError } = useSugestoesListaEspera(agendamento.id);
  const [todos, setTodos] = useState(false);
  const passou = new Date(agendamento.inicio).getTime() <= Date.now();

  if (passou) return null;

  return (
    <>
      <Separator />
      <div className="space-y-2">
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <ListOrdered className="size-3.5" /> Lista de espera — horário liberado
        </p>
        {isLoading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Buscando pacientes compatíveis…
          </p>
        ) : isError || !data ? (
          <p className="text-sm text-muted-foreground">Não foi possível carregar as sugestões.</p>
        ) : !data.horario_livre ? (
          <p className="rounded-md bg-muted/60 p-3 text-sm text-muted-foreground">
            Este horário já foi ocupado por outro agendamento (ou está bloqueado).
          </p>
        ) : data.sugestoes.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum paciente compatível na{' '}
            <Link to="/lista-espera" className="text-primary hover:underline">
              lista de espera
            </Link>
            .
          </p>
        ) : (
          <>
            <ul className="space-y-2">
              {(todos ? data.sugestoes : data.sugestoes.slice(0, MAX_VISIVEIS)).map((item, i) => (
                <li key={item.id}>
                  <Sugestao item={item} posicao={i + 1} agendamento={agendamento} />
                </li>
              ))}
            </ul>
            {data.sugestoes.length > MAX_VISIVEIS && (
              <Button variant="link" size="sm" className="h-auto px-0" onClick={() => setTodos((t) => !t)}>
                {todos ? 'Mostrar menos' : `Ver todos (${data.sugestoes.length})`}
              </Button>
            )}
          </>
        )}
      </div>
    </>
  );
}

function Sugestao({ item, posicao, agendamento }: { item: ItemListaEspera; posicao: number; agendamento: Agendamento }) {
  const oferecer = useOferecerHorario();
  const criar = useCriarAgendamento();
  const marcar = useMudarStatusListaEspera();
  const limite = usePodeUsar('max_agendamentos');
  const [confirmando, setConfirmando] = useState(false);
  const agendando = criar.isPending || marcar.isPending;

  function ofertar() {
    oferecer.mutate(
      { id: item.id, agendamento_id: agendamento.id },
      {
        onSuccess: (r) =>
          r.whatsapp.enfileirada
            ? toast.success(`Horário oferecido a ${item.paciente.nome} pelo WhatsApp.`)
            : toast.error('WhatsApp não enviado', {
                description: ERROS_WHATSAPP[r.whatsapp.erro ?? ''] ?? r.whatsapp.erro,
              }),
        onError: (e) => toast.error(mensagemDeErro(e)),
      },
    );
  }

  async function agendar() {
    try {
      const novo = await criar.mutateAsync({
        paciente_id: item.paciente.id,
        profissional_id: agendamento.profissional_id,
        inicio: agendamento.inicio,
        fim: agendamento.fim,
        tipo: 'particular',
        observacoes: 'Encaixe da lista de espera',
      });
      await marcar.mutateAsync({ id: item.id, status: 'agendado', agendamento_id: novo.id });
      toast.success(`${item.paciente.nome} agendado(a) às ${format(new Date(novo.inicio), 'HH:mm')}.`);
      setConfirmando(false);
    } catch (e) {
      toast.error(mensagemDeErro(e));
    }
  }

  return (
    <div className="rounded-md border p-3 text-sm">
      <div className="flex items-start gap-2">
        <span className="grid size-5 shrink-0 place-items-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground">
          {posicao}
        </span>
        <div className="min-w-0 flex-1">
          <Link to={`/pacientes/${item.paciente.id}`} className="block truncate font-medium hover:underline">
            {item.paciente.nome}
          </Link>
          <p className="truncate text-xs text-muted-foreground">
            {item.profissional ? item.profissional.nome : 'Qualquer profissional'} · {descreverPreferencias(item, ROTULOS_TURNO)}
          </p>
          <p className="text-xs text-muted-foreground">
            Na lista desde {format(new Date(item.criado_em), 'dd/MM/yyyy')}
            {item.ultima_oferta_em && ` · oferta em ${format(new Date(item.ultima_oferta_em), "dd/MM 'às' HH:mm")}`}
          </p>
        </div>
      </div>
      {confirmando ? (
        <div className="mt-2 flex items-center justify-end gap-2">
          <span className="mr-auto text-xs">Agendar neste horário?</span>
          <Button variant="ghost" size="sm" onClick={() => setConfirmando(false)} disabled={agendando}>
            Não
          </Button>
          <Button size="sm" onClick={agendar} disabled={agendando}>
            {agendando && <Loader2 className="size-4 animate-spin" />}
            Confirmar
          </Button>
        </div>
      ) : (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={ofertar}
            disabled={!item.paciente.aceita_whatsapp || oferecer.isPending}
            title={item.paciente.aceita_whatsapp ? 'Enviar a oferta deste horário pelo WhatsApp' : 'O paciente não autorizou WhatsApp'}
          >
            {oferecer.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : item.paciente.aceita_whatsapp ? (
              item.ultima_oferta_em ? <Send className="size-4" /> : <MessageCircle className="size-4" />
            ) : (
              <MessageCircleOff className="size-4" />
            )}
            {item.ultima_oferta_em ? 'Oferecer de novo' : 'Oferecer'}
          </Button>
          <Button size="sm" onClick={() => setConfirmando(true)} disabled={!limite.pode} title={limite.mensagem ?? undefined}>
            <CalendarPlus className="size-4" /> Agendar
          </Button>
        </div>
      )}
    </div>
  );
}
