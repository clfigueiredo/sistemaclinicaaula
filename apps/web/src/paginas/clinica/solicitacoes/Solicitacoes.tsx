// Solicitações do agendamento online (/solicitacoes — admin e recepção). Contrato: docs/FASE2.md §2.
// Pendentes primeiro (por horário). Aprovar: escolhe paciente existente sugerido (CPF/telefone) ou cadastra um
// novo com os dados da solicitação, cria o agendamento (consome o limite do plano) e envia a confirmação pelo
// WhatsApp se o paciente autorizou. Recusar: motivo opcional + aviso pelo WhatsApp.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  CalendarCheck,
  CalendarClock,
  Check,
  ExternalLink,
  Globe,
  Loader2,
  Mail,
  MessageCircle,
  MessageCircleOff,
  Phone,
  UserPlus,
  UserRound,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  descreverWhatsapp,
  useAprovarSolicitacao,
  useRecusarSolicitacao,
  useSolicitacao,
  useSolicitacoes,
  type Solicitacao,
} from '@/api/agendamentoOnline';
import { ErroApi, mensagemDeErro } from '@/api/cliente';
import { useListaConvenios } from '@/api/convenios';
import { usePodeUsar, useMe } from '@/api/me';
import { ROTULOS_STATUS_SOLICITACAO, type StatusSolicitacaoAgendamento, type TipoAgendamento } from '@/api/tipos';
import { AvisoLimite, CabecalhoPagina, Carregando, EstadoVazio } from '@/componentes/comum';
import { Alert, AlertDescription } from '@/componentes/ui/alert';
import { Badge } from '@/componentes/ui/badge';
import { Button } from '@/componentes/ui/button';
import { Card, CardContent } from '@/componentes/ui/card';
import { Checkbox } from '@/componentes/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/componentes/ui/dialog';
import { Label } from '@/componentes/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/componentes/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/componentes/ui/tabs';
import { Textarea } from '@/componentes/ui/textarea';
import { formatarData, mascararCpf, mascararTelefone } from '@/lib/formatos';
import { cn } from '@/lib/utils';

const POR_PAGINA = 20;
type Aba = StatusSolicitacaoAgendamento | 'todas';
const ABAS: { valor: Aba; rotulo: string }[] = [
  { valor: 'pendente', rotulo: 'Pendentes' },
  { valor: 'aprovada', rotulo: 'Aprovadas' },
  { valor: 'recusada', rotulo: 'Recusadas' },
  { valor: 'expirada', rotulo: 'Expiradas' },
  { valor: 'todas', rotulo: 'Todas' },
];

const VARIANTE_STATUS: Record<StatusSolicitacaoAgendamento, string> = {
  pendente: 'border-warning/40 bg-warning/15 text-foreground',
  aprovada: 'border-success/40 bg-success/15 text-foreground',
  recusada: 'border-destructive/30 bg-destructive/10 text-destructive',
  expirada: 'bg-muted text-muted-foreground',
};

export function telefoneExibicao(t: string | null | undefined) {
  if (!t) return '—';
  return mascararTelefone(t.replace(/^55(?=\d{10,11}$)/, ''));
}

function dataHora(iso: string) {
  const t = format(new Date(iso), "EEEE, dd/MM/yyyy 'às' HH:mm", { locale: ptBR });
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export default function PaginaSolicitacoes() {
  const [aba, setAba] = useState<Aba>('pendente');
  const [pagina, setPagina] = useState(1);
  const [aprovando, setAprovando] = useState<Solicitacao | null>(null);
  const [recusando, setRecusando] = useState<Solicitacao | null>(null);
  const { data: me } = useMe();
  const filtros = { status: aba === 'todas' ? undefined : aba, pagina, por_pagina: POR_PAGINA };
  const { data, isLoading, isError, isFetching } = useSolicitacoes(filtros);
  const totalPaginas = data ? Math.max(1, Math.ceil(data.total / POR_PAGINA)) : 1;

  return (
    <div>
      <CabecalhoPagina
        titulo="Solicitações online"
        descricao="Pedidos de agendamento feitos pelos pacientes na página pública da clínica."
        acoes={
          me?.clinica.slug ? (
            <Button variant="outline" asChild>
              <a href={`/agendar/${me.clinica.slug}`} target="_blank" rel="noreferrer">
                <Globe className="size-4" /> Ver página pública <ExternalLink className="size-3.5" />
              </a>
            </Button>
          ) : null
        }
      />
      <AvisoLimite codigo="max_agendamentos" className="mb-4" />

      <Tabs
        value={aba}
        onValueChange={(v) => {
          setAba(v as Aba);
          setPagina(1);
        }}
        className="mb-4"
      >
        <TabsList className="w-full justify-start overflow-x-auto sm:w-auto">
          {ABAS.map((a) => (
            <TabsTrigger key={a.valor} value={a.valor}>
              {a.rotulo}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {isLoading ? (
        <Carregando />
      ) : isError ? (
        <EstadoVazio titulo="Não foi possível carregar as solicitações" descricao="Tente novamente em instantes." />
      ) : !data || data.itens.length === 0 ? (
        <EstadoVazio
          icone={<CalendarCheck className="size-5" />}
          titulo={aba === 'pendente' ? 'Nenhuma solicitação pendente' : 'Nenhuma solicitação'}
          descricao={
            aba === 'pendente'
              ? 'Quando um paciente pedir um horário pela página pública, ele aparece aqui para você aprovar ou recusar.'
              : undefined
          }
        />
      ) : (
        <>
          <ul className={cn('grid gap-3 lg:grid-cols-2', isFetching && 'opacity-70')}>
            {data.itens.map((s) => (
              <li key={s.id}>
                <CartaoSolicitacao s={s} onAprovar={() => setAprovando(s)} onRecusar={() => setRecusando(s)} />
              </li>
            ))}
          </ul>
          {totalPaginas > 1 && (
            <div className="mt-4 flex items-center justify-end gap-2 text-sm">
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
        </>
      )}

      {aprovando && <DialogoAprovar solicitacao={aprovando} aoFechar={() => setAprovando(null)} />}
      {recusando && <DialogoRecusar solicitacao={recusando} aoFechar={() => setRecusando(null)} />}
    </div>
  );
}

function CartaoSolicitacao({
  s,
  onAprovar,
  onRecusar,
}: {
  s: Solicitacao;
  onAprovar: () => void;
  onRecusar: () => void;
}) {
  const passou = new Date(s.inicio).getTime() < Date.now();
  return (
    <Card className="h-full py-0">
      <CardContent className="flex h-full flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-medium">{s.nome}</p>
            <p className="text-xs text-muted-foreground">Recebida em {format(new Date(s.criado_em), "dd/MM 'às' HH:mm")}</p>
          </div>
          <Badge variant="outline" className={VARIANTE_STATUS[s.status]}>
            {ROTULOS_STATUS_SOLICITACAO[s.status]}
          </Badge>
        </div>

        <div className="rounded-lg bg-muted/60 p-3 text-sm">
          <p className="flex items-center gap-2 font-medium">
            <CalendarClock className="size-4 shrink-0 text-primary" />
            {dataHora(s.inicio)}
          </p>
          <p className="mt-1 flex items-center gap-2 text-muted-foreground">
            <UserRound className="size-4 shrink-0" /> {s.profissional.nome}
          </p>
        </div>

        <div className="grid gap-1 text-sm">
          <p className="flex items-center gap-2">
            <Phone className="size-4 shrink-0 text-muted-foreground" /> {telefoneExibicao(s.telefone)}
            {s.aceita_whatsapp ? (
              <span className="inline-flex items-center gap-1 text-xs text-success">
                <MessageCircle className="size-3.5" /> aceita WhatsApp
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <MessageCircleOff className="size-3.5" /> sem WhatsApp
              </span>
            )}
          </p>
          {s.email && (
            <p className="flex items-center gap-2 truncate">
              <Mail className="size-4 shrink-0 text-muted-foreground" /> {s.email}
            </p>
          )}
          {(s.cpf || s.nascimento) && (
            <p className="text-xs text-muted-foreground">
              {s.cpf && <>CPF {mascararCpf(s.cpf)}</>}
              {s.cpf && s.nascimento && ' · '}
              {s.nascimento && <>Nascimento {formatarData(s.nascimento.slice(0, 10) + 'T12:00:00')}</>}
            </p>
          )}
        </div>

        {s.observacoes && <p className="rounded-md border border-dashed p-2 text-sm whitespace-pre-wrap">{s.observacoes}</p>}
        {s.status === 'recusada' && s.motivo_recusa && (
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Motivo da recusa:</span> {s.motivo_recusa}
          </p>
        )}

        <div className="mt-auto flex flex-wrap items-center justify-end gap-2 pt-1">
          {s.status === 'aprovada' && s.agendamento_id && (
            <Button variant="outline" size="sm" asChild>
              <Link to={`/agenda?agendamento=${s.agendamento_id}`}>
                <CalendarCheck className="size-4" /> Ver na agenda
              </Link>
            </Button>
          )}
          {s.status === 'aprovada' && s.paciente && (
            <Button variant="ghost" size="sm" asChild>
              <Link to={`/pacientes/${s.paciente.id}`}>{s.paciente.nome}</Link>
            </Button>
          )}
          {s.status === 'pendente' && passou && (
            <span className="mr-auto text-xs text-muted-foreground">O horário já passou — será expirada.</span>
          )}
          {s.status === 'pendente' && (
            <>
              <Button variant="outline" size="sm" onClick={onRecusar}>
                <X className="size-4" /> Recusar
              </Button>
              <Button size="sm" onClick={onAprovar} disabled={passou}>
                <Check className="size-4" /> Aprovar
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ----------------------------------------------------------------------------- aprovar

const NOVO = 'novo';

function DialogoAprovar({ solicitacao, aoFechar }: { solicitacao: Solicitacao; aoFechar: () => void }) {
  const { data: det, isLoading } = useSolicitacao(solicitacao.id);
  const { data: convenios } = useListaConvenios({ ativos: true });
  const aprovar = useAprovarSolicitacao();
  const limite = usePodeUsar('max_agendamentos');
  const [escolha, setEscolha] = useState<string | null>(null);
  const [tipo, setTipo] = useState<TipoAgendamento>('particular');
  const [convenioId, setConvenioId] = useState<string>('');
  const [erro, setErro] = useState<string | null>(null);

  const candidatos = det?.pacientes_candidatos ?? [];
  const porCpf = candidatos.find((c) => c.motivo === 'cpf');
  // Padrão: o paciente com o mesmo CPF (o backend usaria ele de qualquer forma); senão cadastrar novo.
  const selecionado = escolha ?? (porCpf ? porCpf.id : NOVO);
  const conveniosAtivos = (convenios ?? []).filter((c) => c.ativo);

  async function confirmar() {
    setErro(null);
    try {
      const r = await aprovar.mutateAsync({
        id: solicitacao.id,
        paciente_id: selecionado === NOVO ? null : selecionado,
        tipo,
        convenio_id: tipo === 'convenio' ? convenioId || null : null,
      });
      const w = descreverWhatsapp(r.whatsapp);
      toast.success(r.paciente_criado ? 'Agendamento criado e paciente cadastrado.' : 'Agendamento criado.', {
        description: w ?? 'O paciente não autorizou WhatsApp: avise-o por outro meio.',
      });
      if (r.aviso) toast.warning('Telefone da solicitação difere do cadastro', { description: r.aviso.mensagem, duration: 12_000 });
      aoFechar();
    } catch (e) {
      if (e instanceof ErroApi && ['horario_ocupado', 'horario_bloqueado', 'fora_da_grade', 'horario_passado'].includes(e.codigo)) {
        setErro(`${e.mensagem} Recuse a solicitação informando o motivo, para o paciente escolher outro horário.`);
        return;
      }
      if (e instanceof ErroApi && e.codigo === 'limite_atingido') {
        setErro(e.mensagem);
        return;
      }
      setErro(mensagemDeErro(e));
    }
  }

  return (
    <Dialog open onOpenChange={(a) => !a && aoFechar()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Aprovar solicitação</DialogTitle>
          <DialogDescription>
            {dataHora(solicitacao.inicio)} com {solicitacao.profissional.nome}.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <Carregando />
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Paciente</Label>
              {candidatos.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Encontramos {candidatos.length === 1 ? 'um paciente parecido' : 'pacientes parecidos'} com os dados
                  informados. Confira antes de cadastrar um novo.
                </p>
              )}
              <div className="space-y-2" role="radiogroup">
                {candidatos.map((c) => (
                  <OpcaoPaciente
                    key={c.id}
                    ativo={selecionado === c.id}
                    onClick={() => setEscolha(c.id)}
                    titulo={c.nome}
                    detalhe={[
                      c.cpf ? `CPF ${mascararCpf(c.cpf)}` : null,
                      telefoneExibicao(c.whatsapp || c.telefone),
                      c.nascimento ? `nasc. ${formatarData(c.nascimento.slice(0, 10) + 'T12:00:00')}` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                    selo={c.motivo === 'cpf' ? 'Mesmo CPF' : 'Mesmo telefone'}
                  />
                ))}
                <OpcaoPaciente
                  ativo={selecionado === NOVO}
                  desabilitado={!!porCpf}
                  onClick={() => setEscolha(NOVO)}
                  icone={<UserPlus className="size-4" />}
                  titulo="Cadastrar novo paciente"
                  detalhe={
                    porCpf
                      ? 'Já existe um paciente com este CPF — use o cadastro existente.'
                      : `${solicitacao.nome} · ${telefoneExibicao(solicitacao.telefone)}`
                  }
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Tipo</Label>
                <Select value={tipo} onValueChange={(v) => setTipo(v as TipoAgendamento)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="particular">Particular</SelectItem>
                    <SelectItem value="convenio" disabled={conveniosAtivos.length === 0}>
                      Convênio
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {tipo === 'convenio' && (
                <div className="space-y-1.5">
                  <Label>Convênio</Label>
                  <Select value={convenioId} onValueChange={setConvenioId}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      {conveniosAtivos.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            <p className="flex items-start gap-2 rounded-md bg-muted/60 p-3 text-xs text-muted-foreground">
              {selecionado !== NOVO ? (
                <>
                  <MessageCircle className="mt-0.5 size-4 shrink-0" />
                  Paciente já cadastrado: a confirmação vai para o WhatsApp do cadastro (se ele autorizou) ou para o
                  telefone da solicitação só se for o mesmo do cadastro. Se o telefone da solicitação for diferente,
                  você será avisado para confirmar por outro meio.
                </>
              ) : solicitacao.aceita_whatsapp ? (
                <>
                  <MessageCircle className="mt-0.5 size-4 shrink-0 text-success" />O paciente receberá a confirmação pelo
                  WhatsApp.
                </>
              ) : (
                <>
                  <MessageCircleOff className="mt-0.5 size-4 shrink-0" />O paciente não autorizou WhatsApp: avise-o por
                  telefone ou e-mail.
                </>
              )}
            </p>

            {!limite.pode && limite.mensagem && (
              <Alert className="border-warning/40 bg-warning/10">
                <AlertDescription>
                  <p>{limite.mensagem}</p>
                </AlertDescription>
              </Alert>
            )}
            {erro && (
              <Alert variant="destructive">
                <AlertDescription>
                  <p>{erro}</p>
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={aoFechar}>
            Cancelar
          </Button>
          <Button
            onClick={confirmar}
            disabled={isLoading || aprovar.isPending || !limite.pode || (tipo === 'convenio' && !convenioId)}
            title={limite.mensagem ?? undefined}
          >
            {aprovar.isPending && <Loader2 className="size-4 animate-spin" />}
            Aprovar e agendar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OpcaoPaciente({
  ativo,
  desabilitado,
  onClick,
  titulo,
  detalhe,
  selo,
  icone,
}: {
  ativo: boolean;
  desabilitado?: boolean;
  onClick: () => void;
  titulo: string;
  detalhe: string;
  selo?: string;
  icone?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={ativo}
      disabled={desabilitado}
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 rounded-lg border p-3 text-left text-sm transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50',
        ativo && 'border-primary bg-primary/5 hover:bg-primary/5',
      )}
    >
      <span
        className={cn(
          'grid size-5 shrink-0 place-items-center rounded-full border',
          ativo && 'border-primary bg-primary text-primary-foreground',
        )}
      >
        {ativo && <Check className="size-3" />}
      </span>
      {icone && <span className="text-muted-foreground">{icone}</span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{titulo}</span>
        <span className="block truncate text-xs text-muted-foreground">{detalhe}</span>
      </span>
      {selo && (
        <Badge variant="secondary" className="shrink-0">
          {selo}
        </Badge>
      )}
    </button>
  );
}

// ----------------------------------------------------------------------------- recusar

function DialogoRecusar({ solicitacao, aoFechar }: { solicitacao: Solicitacao; aoFechar: () => void }) {
  const recusar = useRecusarSolicitacao();
  const [motivo, setMotivo] = useState('');
  const [notificar, setNotificar] = useState(solicitacao.aceita_whatsapp);

  async function confirmar() {
    try {
      const r = await recusar.mutateAsync({ id: solicitacao.id, motivo: motivo.trim() || null, notificar });
      toast.success('Solicitação recusada.', { description: descreverWhatsapp(r.whatsapp) ?? undefined });
      aoFechar();
    } catch (e) {
      toast.error(mensagemDeErro(e));
    }
  }

  return (
    <Dialog open onOpenChange={(a) => !a && aoFechar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Recusar solicitação</DialogTitle>
          <DialogDescription>
            {solicitacao.nome} — {dataHora(solicitacao.inicio)}.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="motivo-recusa">Motivo</Label>
            <Textarea
              id="motivo-recusa"
              rows={3}
              maxLength={500}
              autoFocus
              placeholder="Opcional — ex.: o profissional não atende este tipo de consulta"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
            />
          </div>
          <label className={cn('flex items-start gap-2 text-sm', !solicitacao.aceita_whatsapp && 'opacity-60')}>
            <Checkbox
              checked={notificar}
              disabled={!solicitacao.aceita_whatsapp}
              onCheckedChange={(v) => setNotificar(v === true)}
              className="mt-0.5"
            />
            <span>
              Avisar o paciente pelo WhatsApp
              {!solicitacao.aceita_whatsapp && (
                <span className="block text-xs text-muted-foreground">O paciente não autorizou mensagens pelo WhatsApp.</span>
              )}
            </span>
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={aoFechar}>
            Voltar
          </Button>
          <Button variant="destructive" onClick={confirmar} disabled={recusar.isPending}>
            {recusar.isPending && <Loader2 className="size-4 animate-spin" />}
            Recusar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
