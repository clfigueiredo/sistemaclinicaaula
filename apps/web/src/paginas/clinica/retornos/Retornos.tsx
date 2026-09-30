// Retornos (/retornos): retornos previstos com filtros (status, período, profissional), vencidos em destaque e
// ações (agendar, marcar como agendado, convidar pelo WhatsApp, cancelar, reabrir). Admin configura o convite
// automático. Profissional vê só os da própria agenda (garantido pela API). Contrato: docs/FASE2.md §5.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import {
  CalendarCheck2,
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  Loader2,
  MessageCircle,
  MoreHorizontal,
  Repeat,
  RotateCcw,
  Settings2,
  X,
} from 'lucide-react';
import { useProfissionaisAgenda } from '@/api/agendamentos';
import { mensagemDeErro } from '@/api/cliente';
import { useMe } from '@/api/me';
import {
  mensagemErroWhatsapp,
  useConvidarRetorno,
  useMudarStatusRetorno,
  useRetornos,
  type FiltroStatusRetorno,
  type Retorno,
} from '@/api/retornos';
import { CabecalhoPagina, Carregando, EstadoVazio } from '@/componentes/comum';
import { Alert, AlertDescription } from '@/componentes/ui/alert';
import { Button } from '@/componentes/ui/button';
import { Card } from '@/componentes/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/componentes/ui/dropdown-menu';
import { Input } from '@/componentes/ui/input';
import { Label } from '@/componentes/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/componentes/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/componentes/ui/table';
import { formatarData, formatarDataHora } from '@/lib/formatos';
import { cn } from '@/lib/utils';
import { BadgeStatusRetorno } from './BadgeStatusRetorno';
import { ConfigRetornos } from './ConfigRetornos';
import { MarcarAgendado } from './MarcarAgendado';

const POR_PAGINA = 20;
const TODOS = '__todos__';

const OPCOES_STATUS: { valor: FiltroStatusRetorno | typeof TODOS; rotulo: string }[] = [
  { valor: 'abertos', rotulo: 'Em aberto' },
  { valor: 'vencidos', rotulo: 'Vencidos' },
  { valor: 'pendente', rotulo: 'Pendentes' },
  { valor: 'lembrado', rotulo: 'Convidados' },
  { valor: 'agendado', rotulo: 'Agendados' },
  { valor: 'cancelado', rotulo: 'Cancelados' },
  { valor: TODOS, rotulo: 'Todos' },
];

export default function PaginaRetornos() {
  const { data: me } = useMe();
  const papel = me?.papel;
  const equipe = papel === 'admin' || papel === 'recepcao';
  const [status, setStatus] = useState<FiltroStatusRetorno | typeof TODOS>('abertos');
  const [inicio, setInicio] = useState('');
  const [fim, setFim] = useState('');
  const [profissionalId, setProfissionalId] = useState(TODOS);
  const [pagina, setPagina] = useState(1);
  const [configAberta, setConfigAberta] = useState(false);
  const [marcando, setMarcando] = useState<Retorno | null>(null);

  const profissionais = useProfissionaisAgenda();
  const { data, isLoading, isFetching, error } = useRetornos({
    status: status === TODOS ? undefined : status,
    inicio: inicio || undefined,
    fim: fim || undefined,
    profissional_id: equipe && profissionalId !== TODOS ? profissionalId : undefined,
    pagina,
    por_pagina: POR_PAGINA,
  });
  const mudarStatus = useMudarStatusRetorno();
  const convidar = useConvidarRetorno();

  const total = data?.total ?? 0;
  const totalPaginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const filtrosAtivos = status !== 'abertos' || !!inicio || !!fim || profissionalId !== TODOS;

  function mudarFiltro<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      setPagina(1);
    };
  }

  async function aplicarStatus(r: Retorno, novo: 'cancelado' | 'pendente') {
    try {
      await mudarStatus.mutateAsync({ id: r.id, status: novo });
      toast.success(novo === 'cancelado' ? 'Retorno cancelado.' : 'Retorno reaberto.');
    } catch (e) {
      toast.error(mensagemDeErro(e));
    }
  }

  async function enviarConvite(r: Retorno) {
    try {
      const res = await convidar.mutateAsync(r.id);
      if (res.whatsapp.enfileirada) toast.success(`Convite enviado para ${r.paciente.nome}.`);
      else toast.error(mensagemErroWhatsapp(res.whatsapp.erro));
    } catch (e) {
      toast.error(mensagemDeErro(e));
    }
  }

  return (
    <div>
      <CabecalhoPagina
        titulo="Retornos"
        descricao={
          papel === 'profissional'
            ? 'Retornos previstos dos seus pacientes. Defina um retorno pelo painel da consulta, na agenda.'
            : 'Retornos previstos, convites enviados e pendências. Defina um retorno pelo painel da consulta, na agenda.'
        }
        acoes={
          papel === 'admin' && (
            <Button variant="outline" onClick={() => setConfigAberta(true)}>
              <Settings2 className="size-4" /> Convite automático
            </Button>
          )
        }
      />

      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Status</Label>
          <Select value={status} onValueChange={mudarFiltro((v: string) => setStatus(v as FiltroStatusRetorno))}>
            <SelectTrigger className="w-full lg:w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {OPCOES_STATUS.map((o) => (
                <SelectItem key={o.valor} value={o.valor}>
                  {o.rotulo}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:flex">
          <div className="space-y-1.5">
            <Label htmlFor="retornos-inicio" className="text-xs text-muted-foreground">
              Previsto de
            </Label>
            <Input id="retornos-inicio" type="date" value={inicio} onChange={(e) => mudarFiltro(setInicio)(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="retornos-fim" className="text-xs text-muted-foreground">
              até
            </Label>
            <Input id="retornos-fim" type="date" value={fim} onChange={(e) => mudarFiltro(setFim)(e.target.value)} />
          </div>
        </div>
        {equipe && (
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Profissional</Label>
            <Select value={profissionalId} onValueChange={mudarFiltro(setProfissionalId)}>
              <SelectTrigger className="w-full lg:w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={TODOS}>Todos os profissionais</SelectItem>
                {(profissionais.data ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {filtrosAtivos && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setStatus('abertos');
              setInicio('');
              setFim('');
              setProfissionalId(TODOS);
              setPagina(1);
            }}
          >
            <X /> Limpar filtros
          </Button>
        )}
        {isFetching && !isLoading && <Loader2 className="size-4 animate-spin text-muted-foreground lg:mb-2.5" />}
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{mensagemDeErro(error)}</AlertDescription>
        </Alert>
      ) : isLoading ? (
        <Carregando />
      ) : !data || data.itens.length === 0 ? (
        <EstadoVazio
          icone={<Repeat className="size-5" />}
          titulo={filtrosAtivos ? 'Nenhum retorno encontrado' : 'Nenhum retorno em aberto'}
          descricao={
            filtrosAtivos
              ? 'Ajuste os filtros para ver outros retornos.'
              : 'Ao marcar uma consulta como "Compareceu" ou "Atendido", defina o retorno no painel da agenda.'
          }
        />
      ) : (
        <Card className="gap-0 overflow-hidden py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Paciente</TableHead>
                <TableHead className="hidden md:table-cell">Profissional</TableHead>
                <TableHead>Previsto para</TableHead>
                <TableHead className="hidden lg:table-cell">Consulta de origem</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-12 text-right">
                  <span className="sr-only">Ações</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.itens.map((r) => {
                const aberto = r.status === 'pendente' || r.status === 'lembrado';
                return (
                  <TableRow key={r.id} className={cn(r.vencido && 'bg-destructive/5 hover:bg-destructive/10')}>
                    <TableCell>
                      <Link to={`/pacientes/${r.paciente.id}`} className="font-medium hover:underline">
                        {r.paciente.nome}
                      </Link>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        {r.paciente.aceita_whatsapp && <MessageCircle className="size-3 text-success" aria-label="Aceita WhatsApp" />}
                        <span className="md:hidden">{r.profissional.nome}</span>
                      </div>
                      {r.observacao && (
                        <p className="mt-0.5 line-clamp-2 max-w-xs text-xs text-muted-foreground" title={r.observacao}>
                          {r.observacao}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <span className="flex items-center gap-2">
                        <span className="size-2.5 rounded-full" style={{ backgroundColor: r.profissional.cor_agenda }} />
                        {r.profissional.nome}
                      </span>
                    </TableCell>
                    <TableCell className={cn('tabular-nums', r.vencido && 'font-medium text-destructive')}>
                      {formatarData(r.data_prevista)}
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground tabular-nums lg:table-cell">
                      {formatarDataHora(r.agendamento_origem.inicio)}
                    </TableCell>
                    <TableCell>
                      <BadgeStatusRetorno retorno={r} />
                      {r.agendamento_retorno && (
                        <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                          <CalendarCheck2 className="size-3" /> {formatarDataHora(r.agendamento_retorno.inicio)}
                        </div>
                      )}
                      {r.convite_enviado_em && r.status === 'lembrado' && (
                        <div className="mt-1 text-xs text-muted-foreground">Convite em {formatarData(r.convite_enviado_em)}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm" aria-label={`Ações do retorno de ${r.paciente.nome}`}>
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {aberto && (
                            <>
                              <DropdownMenuItem asChild>
                                <Link
                                  to={`/agenda?novo=1&paciente_id=${r.paciente.id}&profissional_id=${r.profissional.id}&data=${r.data_prevista}`}
                                >
                                  <CalendarPlus /> Agendar na agenda
                                </Link>
                              </DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => setMarcando(r)}>
                                <CalendarCheck2 /> Marcar como agendado
                              </DropdownMenuItem>
                              {equipe && (
                                <DropdownMenuItem onSelect={() => enviarConvite(r)} disabled={convidar.isPending}>
                                  <MessageCircle /> {r.status === 'lembrado' ? 'Reenviar convite' : 'Enviar convite'}
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuSeparator />
                              <DropdownMenuItem variant="destructive" onSelect={() => aplicarStatus(r, 'cancelado')}>
                                <X /> Cancelar retorno
                              </DropdownMenuItem>
                            </>
                          )}
                          {!aberto && (
                            <DropdownMenuItem onSelect={() => aplicarStatus(r, 'pendente')}>
                              <RotateCcw /> Reabrir
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <div className="flex items-center justify-between gap-2 border-t px-4 py-3 text-sm text-muted-foreground">
            <span>
              {total} {total === 1 ? 'retorno' : 'retornos'}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon-sm"
                disabled={pagina <= 1}
                onClick={() => setPagina((p) => p - 1)}
                aria-label="Página anterior"
              >
                <ChevronLeft />
              </Button>
              <span>
                Página {pagina} de {totalPaginas}
              </span>
              <Button
                variant="outline"
                size="icon-sm"
                disabled={pagina >= totalPaginas}
                onClick={() => setPagina((p) => p + 1)}
                aria-label="Próxima página"
              >
                <ChevronRight />
              </Button>
            </div>
          </div>
        </Card>
      )}

      {papel === 'admin' && <ConfigRetornos aberto={configAberta} onOpenChange={setConfigAberta} />}
      <MarcarAgendado retorno={marcando} onFechar={() => setMarcando(null)} />
    </div>
  );
}
