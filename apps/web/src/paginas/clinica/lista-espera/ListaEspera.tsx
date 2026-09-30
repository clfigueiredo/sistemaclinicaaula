// Lista de espera (/lista-espera — admin e recepção). Contrato: docs/FASE2.md §3.
// Pacientes aguardando vaga, por ordem de entrada, com preferências (profissional, dias da semana e turnos).
// Quando um horário é liberado (cancelamento/falta), a agenda sugere os pacientes compatíveis
// (SugestoesListaEspera) e o topo do app mostra o aviso (AvisoTopoListaEspera).
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import {
  CalendarCheck,
  CalendarPlus,
  ListOrdered,
  Loader2,
  MessageCircle,
  MessageCircleOff,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { useProfissionaisAgenda } from '@/api/agendamentos';
import { mensagemDeErro } from '@/api/cliente';
import {
  DIAS_SEMANA_CURTOS,
  descreverPreferencias,
  useCriarItemListaEspera,
  useEditarItemListaEspera,
  useListaEspera,
  useMudarStatusListaEspera,
  type FiltroListaEspera,
  type ItemListaEspera,
} from '@/api/listaEspera';
import { ROTULOS_STATUS_LISTA_ESPERA, ROTULOS_TURNO, type StatusListaEspera, type Turno } from '@/api/tipos';
import { CabecalhoPagina, Carregando, EstadoVazio } from '@/componentes/comum';
import { Badge } from '@/componentes/ui/badge';
import { Button } from '@/componentes/ui/button';
import { Card } from '@/componentes/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/componentes/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/componentes/ui/dropdown-menu';
import { Label } from '@/componentes/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/componentes/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/componentes/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/componentes/ui/tabs';
import { Textarea } from '@/componentes/ui/textarea';
import { mascararTelefone } from '@/lib/formatos';
import { cn } from '@/lib/utils';
import { BuscaPaciente, type PacienteSelecionado } from '../agenda/BuscaPaciente';

const POR_PAGINA = 20;
const TODOS_PROF = 'todos';
const QUALQUER = 'qualquer';
const TURNOS: Turno[] = ['manha', 'tarde', 'noite'];
const ORDEM_DIAS = [1, 2, 3, 4, 5, 6, 0];

type Aba = StatusListaEspera | 'todos';

function telefone(p: ItemListaEspera['paciente']) {
  const t = p.whatsapp || p.telefone;
  return t ? mascararTelefone(t.replace(/^55(?=\d{10,11}$)/, '')) : '—';
}

export default function PaginaListaEspera() {
  const [aba, setAba] = useState<Aba>('aguardando');
  const [profissional, setProfissional] = useState(TODOS_PROF);
  const [pagina, setPagina] = useState(1);
  const [editando, setEditando] = useState<ItemListaEspera | 'novo' | null>(null);
  const filtros: FiltroListaEspera = {
    status: aba,
    profissional_id: profissional === TODOS_PROF ? undefined : profissional,
    pagina,
    por_pagina: POR_PAGINA,
  };
  const { data, isLoading, isError, isFetching } = useListaEspera(filtros);
  const { data: profissionais } = useProfissionaisAgenda();
  const mudar = useMudarStatusListaEspera();
  const totalPaginas = data ? Math.max(1, Math.ceil(data.total / POR_PAGINA)) : 1;

  function alterarStatus(item: ItemListaEspera, status: StatusListaEspera) {
    mudar.mutate(
      { id: item.id, status },
      {
        onSuccess: () =>
          toast.success(
            status === 'removido'
              ? 'Paciente removido da lista de espera.'
              : status === 'agendado'
                ? 'Marcado como agendado.'
                : 'Paciente voltou para a lista de espera.',
          ),
        onError: (e) => toast.error(mensagemDeErro(e)),
      },
    );
  }

  return (
    <div>
      <CabecalhoPagina
        titulo="Lista de espera"
        descricao="Pacientes aguardando uma vaga. Quando um horário é liberado, a agenda sugere quem chamar primeiro."
        acoes={
          <Button onClick={() => setEditando('novo')}>
            <Plus className="size-4" /> Adicionar paciente
          </Button>
        }
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs
          value={aba}
          onValueChange={(v) => {
            setAba(v as Aba);
            setPagina(1);
          }}
        >
          <TabsList>
            <TabsTrigger value="aguardando">Aguardando</TabsTrigger>
            <TabsTrigger value="agendado">Agendados</TabsTrigger>
            <TabsTrigger value="removido">Removidos</TabsTrigger>
            <TabsTrigger value="todos">Todos</TabsTrigger>
          </TabsList>
        </Tabs>
        <Select
          value={profissional}
          onValueChange={(v) => {
            setProfissional(v);
            setPagina(1);
          }}
        >
          <SelectTrigger className="w-full sm:w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS_PROF}>Todos os profissionais</SelectItem>
            {(profissionais ?? []).map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.nome}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <Carregando />
      ) : isError ? (
        <EstadoVazio titulo="Não foi possível carregar a lista de espera" descricao="Tente novamente em instantes." />
      ) : !data || data.itens.length === 0 ? (
        <EstadoVazio
          icone={<ListOrdered className="size-5" />}
          titulo={aba === 'aguardando' ? 'Ninguém aguardando' : 'Nenhum registro'}
          descricao={
            aba === 'aguardando'
              ? 'Adicione pacientes que querem um horário antes do disponível. Eles serão sugeridos quando alguém cancelar.'
              : undefined
          }
          acao={
            aba === 'aguardando' ? (
              <Button variant="outline" onClick={() => setEditando('novo')}>
                <Plus className="size-4" /> Adicionar paciente
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Card className={cn('overflow-hidden py-0', isFetching && 'opacity-70')}>
          <Table>
            <TableHeader>
              <TableRow>
                {aba === 'aguardando' && <TableHead className="w-12">#</TableHead>}
                <TableHead>Paciente</TableHead>
                <TableHead className="hidden md:table-cell">Profissional</TableHead>
                <TableHead className="hidden lg:table-cell">Preferências</TableHead>
                <TableHead className="hidden sm:table-cell">Entrada</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.itens.map((item, i) => (
                <TableRow key={item.id}>
                  {aba === 'aguardando' && (
                    <TableCell className="font-medium text-muted-foreground tabular-nums">
                      {(pagina - 1) * POR_PAGINA + i + 1}
                    </TableCell>
                  )}
                  <TableCell className="max-w-64">
                    <Link to={`/pacientes/${item.paciente.id}`} className="block truncate font-medium hover:underline">
                      {item.paciente.nome}
                    </Link>
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      {telefone(item.paciente)}
                      {item.paciente.aceita_whatsapp ? (
                        <MessageCircle className="size-3.5 text-success" aria-label="Aceita WhatsApp" />
                      ) : (
                        <MessageCircleOff className="size-3.5" aria-label="Não aceita WhatsApp" />
                      )}
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground md:hidden">
                      {item.profissional?.nome ?? 'Qualquer profissional'}
                    </span>
                    <span className="block text-xs text-muted-foreground lg:hidden">
                      {descreverPreferencias(item, ROTULOS_TURNO)}
                    </span>
                    {item.observacao && (
                      <span className="mt-1 block truncate text-xs italic text-muted-foreground" title={item.observacao}>
                        {item.observacao}
                      </span>
                    )}
                    {aba !== 'aguardando' && (
                      <Badge variant="secondary" className="mt-1">
                        {ROTULOS_STATUS_LISTA_ESPERA[item.status]}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {item.profissional?.nome ?? <span className="text-muted-foreground">Qualquer</span>}
                  </TableCell>
                  <TableCell className="hidden text-sm lg:table-cell">{descreverPreferencias(item, ROTULOS_TURNO)}</TableCell>
                  <TableCell className="hidden text-sm sm:table-cell">
                    {format(new Date(item.criado_em), 'dd/MM/yyyy')}
                    {item.ultima_oferta_em && (
                      <span className="block text-xs text-muted-foreground">
                        Oferta em {format(new Date(item.ultima_oferta_em), "dd/MM 'às' HH:mm")}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" aria-label="Ações">
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => setEditando(item)}>
                          <Pencil className="size-4" /> Editar preferências
                        </DropdownMenuItem>
                        {item.status === 'aguardando' ? (
                          <>
                            <DropdownMenuItem asChild>
                              <Link
                                to={`/agenda?novo=1&paciente_id=${item.paciente.id}${item.profissional ? `&profissional_id=${item.profissional.id}` : ''}`}
                              >
                                <CalendarPlus className="size-4" /> Agendar na agenda
                              </Link>
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => alterarStatus(item, 'agendado')}>
                              <CalendarCheck className="size-4" /> Marcar como agendado
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem variant="destructive" onSelect={() => alterarStatus(item, 'removido')}>
                              <Trash2 className="size-4" /> Remover da lista
                            </DropdownMenuItem>
                          </>
                        ) : (
                          <DropdownMenuItem onSelect={() => alterarStatus(item, 'aguardando')}>
                            <RotateCcw className="size-4" /> Voltar para a lista
                          </DropdownMenuItem>
                        )}
                        {item.agendamento_id && (
                          <DropdownMenuItem asChild>
                            <Link to={`/agenda?agendamento=${item.agendamento_id}`}>
                              <CalendarCheck className="size-4" /> Ver agendamento
                            </Link>
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {totalPaginas > 1 && (
            <div className="flex items-center justify-end gap-2 border-t p-3 text-sm">
              <Button variant="outline" size="sm" disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)}>
                Anterior
              </Button>
              <span className="text-muted-foreground">
                Página {pagina} de {totalPaginas}
              </span>
              <Button variant="outline" size="sm" disabled={pagina >= totalPaginas} onClick={() => setPagina((p) => p + 1)}>
                Próxima
              </Button>
            </div>
          )}
        </Card>
      )}

      {editando && <DialogoItem item={editando === 'novo' ? null : editando} aoFechar={() => setEditando(null)} />}
    </div>
  );
}

// ----------------------------------------------------------------------------- formulário

function DialogoItem({ item, aoFechar }: { item: ItemListaEspera | null; aoFechar: () => void }) {
  const criar = useCriarItemListaEspera();
  const editar = useEditarItemListaEspera();
  const { data: profissionais } = useProfissionaisAgenda();
  const [paciente, setPaciente] = useState<PacienteSelecionado | null>(
    item ? { id: item.paciente.id, nome: item.paciente.nome } : null,
  );
  const [profissional, setProfissional] = useState(item?.profissional_id ?? QUALQUER);
  const [dias, setDias] = useState<number[]>(item?.dias_semana ?? []);
  const [turnos, setTurnos] = useState<Turno[]>(item?.turnos ?? []);
  const [observacao, setObservacao] = useState(item?.observacao ?? '');
  const salvando = criar.isPending || editar.isPending;

  const alternar = <T,>(lista: T[], v: T) => (lista.includes(v) ? lista.filter((x) => x !== v) : [...lista, v]);

  async function salvar() {
    if (!paciente) return;
    const dados = {
      profissional_id: profissional === QUALQUER ? null : profissional,
      dias_semana: dias,
      turnos,
      observacao: observacao.trim() || null,
    };
    try {
      if (item) await editar.mutateAsync({ id: item.id, ...dados });
      else await criar.mutateAsync({ paciente_id: paciente.id, ...dados });
      toast.success(item ? 'Preferências atualizadas.' : 'Paciente adicionado à lista de espera.');
      aoFechar();
    } catch (e) {
      toast.error(mensagemDeErro(e));
    }
  }

  return (
    <Dialog open onOpenChange={(a) => !a && aoFechar()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{item ? 'Editar preferências' : 'Adicionar à lista de espera'}</DialogTitle>
          <DialogDescription>
            Deixe dias e turnos em branco para aceitar qualquer horário.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Paciente</Label>
            {item ? (
              <p className="rounded-md border bg-muted/50 px-3 py-2 text-sm">{item.paciente.nome}</p>
            ) : (
              <BuscaPaciente valor={paciente} onChange={setPaciente} />
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Profissional</Label>
            <Select value={profissional} onValueChange={setProfissional}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={QUALQUER}>Qualquer profissional</SelectItem>
                {(profissionais ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Dias da semana</Label>
            <div className="flex flex-wrap gap-1.5">
              {ORDEM_DIAS.map((d) => (
                <Chip key={d} ativo={dias.includes(d)} onClick={() => setDias(alternar(dias, d))}>
                  {DIAS_SEMANA_CURTOS[d]}
                </Chip>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Turnos</Label>
            <div className="flex flex-wrap gap-1.5">
              {TURNOS.map((t) => (
                <Chip key={t} ativo={turnos.includes(t)} onClick={() => setTurnos(alternar(turnos, t))}>
                  {ROTULOS_TURNO[t]}
                </Chip>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">Manhã: antes das 12h · Tarde: 12h às 18h · Noite: a partir das 18h.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="le-obs">Observação</Label>
            <Textarea
              id="le-obs"
              rows={2}
              maxLength={1000}
              placeholder="Opcional — ex.: prefere ser chamado por ligação"
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={aoFechar}>
            Cancelar
          </Button>
          <Button onClick={salvar} disabled={!paciente || salvando}>
            {salvando && <Loader2 className="size-4 animate-spin" />}
            {item ? 'Salvar' : 'Adicionar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Chip({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={ativo}
      onClick={onClick}
      className={cn(
        'rounded-full border px-3 py-1 text-sm transition hover:border-primary/60',
        ativo && 'border-primary bg-primary text-primary-foreground hover:border-primary',
      )}
    >
      {children}
    </button>
  );
}
