// Dashboard da clínica: indicadores da agenda, financeiro (admin) e pendências operacionais.
// Contrato da API: docs/FASE2.md §6 (GET /dashboard). Filtros ficam na URL (?periodo=&inicio=&fim=&profissional=).
import { useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { format } from 'date-fns';
import {
  AlertTriangle,
  ArrowRight,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  CircleDollarSign,
  ClipboardList,
  Hourglass,
  Inbox,
  Percent,
  RotateCcw,
  UserPlus,
  UserX,
  XCircle,
} from 'lucide-react';
import { useDashboard, type DashboardClinica } from '@/api/dashboard';
import { mensagemDeErro } from '@/api/cliente';
import { useMe } from '@/api/me';
import { useListaProfissionais } from '@/api/profissionais';
import { ROTULOS_STATUS_AGENDAMENTO } from '@/api/tipos';
import { CabecalhoPagina, Carregando, EstadoVazio } from '@/componentes/comum';
import { Button } from '@/componentes/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/componentes/ui/card';
import { Input } from '@/componentes/ui/input';
import { Label } from '@/componentes/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/componentes/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/componentes/ui/table';
import { ESTILO_STATUS } from '@/paginas/clinica/agenda/utilidades';
import { formatarMoeda } from '@/lib/formatos';
import { cn } from '@/lib/utils';
import {
  BarrasValores,
  CardIndicador,
  DistribuicaoStatus,
  GraficoSerieDiaria,
  PicosAgenda,
} from './graficos';
import {
  formatarDiaCurto,
  formatarNumero,
  formatarPercentual,
  intervaloDoPeriodo,
  ROTULOS_PERIODO,
  validarIntervalo,
  variacaoRelativa,
  variacaoTaxa,
  type ChavePeriodo,
} from './periodo';

const TODOS = 'todos';

export default function PaginaDashboard() {
  const { data: me } = useMe();
  const [params, setParams] = useSearchParams();
  const ehProfissional = me?.papel === 'profissional';

  const chave = (params.get('periodo') as ChavePeriodo | null) ?? 'este_mes';
  const periodoValido = chave in ROTULOS_PERIODO ? chave : 'este_mes';
  const profissionalId = ehProfissional ? undefined : (params.get('profissional') ?? undefined);

  // Intervalo personalizado: edita localmente e só aplica quando válido.
  const [inicioCustom, setInicioCustom] = useState(params.get('inicio') ?? '');
  const [fimCustom, setFimCustom] = useState(params.get('fim') ?? '');
  const erroCustom = periodoValido === 'personalizado' ? validarIntervalo(inicioCustom, fimCustom) : null;

  const intervalo = useMemo(() => {
    if (periodoValido !== 'personalizado') return intervaloDoPeriodo(periodoValido);
    const i = params.get('inicio') ?? '';
    const f = params.get('fim') ?? '';
    return validarIntervalo(i, f) ? null : { inicio: i, fim: f };
  }, [periodoValido, params]);

  const consulta = useDashboard(
    { inicio: intervalo?.inicio ?? '', fim: intervalo?.fim ?? '', profissionalId },
    !!intervalo && !!me,
  );

  function atualizar(mudancas: Record<string, string | null>) {
    const novo = new URLSearchParams(params);
    for (const [k, v] of Object.entries(mudancas)) {
      if (v === null) novo.delete(k);
      else novo.set(k, v);
    }
    setParams(novo, { replace: true });
  }

  function mudarPeriodo(valor: string) {
    if (valor === 'personalizado') {
      const base = intervalo ?? intervaloDoPeriodo('este_mes');
      setInicioCustom(base.inicio);
      setFimCustom(base.fim);
      atualizar({ periodo: valor, inicio: base.inicio, fim: base.fim });
    } else {
      atualizar({ periodo: valor === 'este_mes' ? null : valor, inicio: null, fim: null });
    }
  }

  function aplicarCustom(inicio: string, fim: string) {
    setInicioCustom(inicio);
    setFimCustom(fim);
    if (!validarIntervalo(inicio, fim)) atualizar({ inicio, fim });
  }

  return (
    <div>
      <CabecalhoPagina
        titulo="Dashboard"
        descricao={
          ehProfissional
            ? 'Seus indicadores de agenda no período.'
            : 'Indicadores da agenda, do financeiro e das pendências da clínica.'
        }
      />

      <div className="mb-6 flex flex-col gap-3 rounded-lg border bg-card p-3 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="grid gap-1.5">
          <Label htmlFor="dash-periodo" className="text-xs text-muted-foreground">
            Período
          </Label>
          <Select value={periodoValido} onValueChange={mudarPeriodo}>
            <SelectTrigger id="dash-periodo" className="w-full sm:w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(ROTULOS_PERIODO) as ChavePeriodo[]).map((k) => (
                <SelectItem key={k} value={k}>
                  {ROTULOS_PERIODO[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {periodoValido === 'personalizado' && (
          <div className="grid grid-cols-2 gap-2 sm:flex sm:items-end">
            <div className="grid gap-1.5">
              <Label htmlFor="dash-inicio" className="text-xs text-muted-foreground">
                De
              </Label>
              <Input
                id="dash-inicio"
                type="date"
                value={inicioCustom}
                max={fimCustom || undefined}
                onChange={(e) => aplicarCustom(e.target.value, fimCustom)}
                aria-invalid={!!erroCustom}
                className="sm:w-40"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="dash-fim" className="text-xs text-muted-foreground">
                Até
              </Label>
              <Input
                id="dash-fim"
                type="date"
                value={fimCustom}
                min={inicioCustom || undefined}
                onChange={(e) => aplicarCustom(inicioCustom, e.target.value)}
                aria-invalid={!!erroCustom}
                className="sm:w-40"
              />
            </div>
          </div>
        )}

        {!ehProfissional && <FiltroProfissional valor={profissionalId} aoMudar={(v) => atualizar({ profissional: v })} />}

        <p className="text-xs text-muted-foreground sm:ml-auto sm:self-center" aria-live="polite">
          {erroCustom ? (
            <span className="text-destructive">{erroCustom}</span>
          ) : consulta.data ? (
            <>
              {formatarDiaCurto(consulta.data.periodo.inicio)} a {formatarDiaCurto(consulta.data.periodo.fim)} ·{' '}
              {consulta.data.periodo.dias} {consulta.data.periodo.dias === 1 ? 'dia' : 'dias'}
              {consulta.isFetching && ' · atualizando…'}
            </>
          ) : null}
        </p>
      </div>

      {!intervalo ? (
        <EstadoVazio
          icone={<CalendarDays className="size-5" />}
          titulo="Escolha um período válido"
          descricao={erroCustom ?? 'Informe as datas inicial e final.'}
        />
      ) : consulta.isLoading || !me ? (
        <Carregando texto="Calculando indicadores…" />
      ) : consulta.isError || !consulta.data ? (
        <ErroCarregar mensagem={mensagemDeErro(consulta.error)} aoTentar={() => consulta.refetch()} />
      ) : (
        <div className={cn('transition-opacity', consulta.isPlaceholderData && 'opacity-60')}>
          <ConteudoDashboard d={consulta.data} />
        </div>
      )}
    </div>
  );
}

function FiltroProfissional({ valor, aoMudar }: { valor?: string; aoMudar: (v: string | null) => void }) {
  const { data: profissionais } = useListaProfissionais();
  return (
    <div className="grid gap-1.5">
      <Label htmlFor="dash-profissional" className="text-xs text-muted-foreground">
        Profissional
      </Label>
      <Select value={valor ?? TODOS} onValueChange={(v) => aoMudar(v === TODOS ? null : v)}>
        <SelectTrigger id="dash-profissional" className="w-full sm:w-56">
          <SelectValue placeholder="Todos" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={TODOS}>Todos os profissionais</SelectItem>
          {(profissionais ?? []).map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.nome}
              {!p.ativo && ' (inativo)'}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function ErroCarregar({ mensagem, aoTentar }: { mensagem: string; aoTentar: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-destructive/30 bg-destructive/5 px-6 py-12 text-center" role="alert">
      <div className="mb-3 grid size-11 place-items-center rounded-full bg-destructive/10 text-destructive">
        <AlertTriangle className="size-5" />
      </div>
      <p className="font-medium">Não foi possível carregar o dashboard</p>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{mensagem}</p>
      <Button variant="outline" size="sm" className="mt-4" onClick={aoTentar}>
        Tentar novamente
      </Button>
    </div>
  );
}

// ----------------------------------------------------------------------------- conteúdo

function ConteudoDashboard({ d }: { d: DashboardClinica }) {
  const a = d.agenda;
  const ant = d.agenda_anterior;
  const f = d.financeiro;
  const temPendencias = Object.values(d.pendencias).some((v) => v !== null);

  return (
    <div className="space-y-6">
      <section aria-label="Indicadores principais" className="grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-6">
        <CardIndicador
          titulo="Agendamentos"
          valor={formatarNumero(a.total)}
          icone={<CalendarDays />}
          variacao={variacaoRelativa(a.total, ant.total)}
          melhorQuando="neutro"
        />
        <CardIndicador
          titulo="Comparecimento"
          valor={formatarPercentual(a.taxa_comparecimento)}
          icone={<CalendarCheck />}
          variacao={variacaoTaxa(a.taxa_comparecimento, ant.taxa_comparecimento)}
          detalhe={a.realizados_base ? `${a.compareceram + a.atendidos} de ${a.realizados_base} já realizados` : 'Nenhum horário já realizado'}
        />
        <CardIndicador
          titulo="Faltas"
          valor={formatarPercentual(a.taxa_faltas)}
          icone={<UserX />}
          variacao={variacaoTaxa(a.taxa_faltas, ant.taxa_faltas)}
          melhorQuando="menor"
          detalhe={`${a.faltas} ${a.faltas === 1 ? 'falta' : 'faltas'}`}
        />
        <CardIndicador
          titulo="Confirmação"
          valor={formatarPercentual(a.taxa_confirmacao)}
          icone={<Percent />}
          variacao={variacaoTaxa(a.taxa_confirmacao, ant.taxa_confirmacao)}
        />
        <CardIndicador
          titulo={d.escopo.profissional_id ? 'Pacientes novos' : 'Novos pacientes'}
          valor={formatarNumero(a.novos_pacientes)}
          icone={<UserPlus />}
          variacao={variacaoRelativa(a.novos_pacientes, ant.novos_pacientes)}
        />
        {f ? (
          <CardIndicador
            titulo="Receitas"
            valor={formatarMoeda(f.receitas)}
            icone={<CircleDollarSign />}
            variacao={variacaoRelativa(Number(f.receitas), Number(f.anterior.receitas))}
          />
        ) : (
          <CardIndicador
            titulo="Cancelamentos"
            valor={formatarPercentual(a.taxa_cancelamento)}
            icone={<XCircle />}
            variacao={variacaoTaxa(a.taxa_cancelamento, ant.taxa_cancelamento)}
            melhorQuando="menor"
          />
        )}
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Agendamentos no período</CardTitle>
            <CardDescription>Pela data de início, no fuso da clínica</CardDescription>
          </CardHeader>
          <CardContent>
            <GraficoSerieDiaria serie={d.por_dia} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Por status</CardTitle>
            <CardDescription>{formatarNumero(a.total)} agendamentos no período</CardDescription>
          </CardHeader>
          <CardContent>
            <DistribuicaoStatus agenda={a} />
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Ocupação por profissional</CardTitle>
            <CardDescription>Agendamentos, realizados e faltas no período</CardDescription>
          </CardHeader>
          <CardContent>
            <TabelaProfissionais linhas={d.por_profissional} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Picos da agenda</CardTitle>
            <CardDescription>Sem contar cancelados</CardDescription>
          </CardHeader>
          <CardContent>
            <PicosAgenda porDiaSemana={d.por_dia_semana} porHora={d.por_hora} />
          </CardContent>
        </Card>
      </div>

      {f && <BlocoFinanceiro f={f} filtrado={!!d.escopo.profissional_id} />}

      <div className={cn('grid gap-6', temPendencias && 'lg:grid-cols-3')}>
        <Card className={cn(temPendencias && 'lg:col-span-2')}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarClock className="size-4 text-primary" /> Agenda de hoje
            </CardTitle>
            <CardDescription>{format(new Date(), "dd/MM/yyyy")}</CardDescription>
          </CardHeader>
          <CardContent>
            <AgendaHoje itens={d.hoje} mostrarProfissional={!d.escopo.profissional_id} />
          </CardContent>
        </Card>
        {temPendencias && <Pendencias p={d.pendencias} />}
      </div>
    </div>
  );
}

function TabelaProfissionais({ linhas }: { linhas: DashboardClinica['por_profissional'] }) {
  if (!linhas.length) {
    return <p className="py-8 text-center text-sm text-muted-foreground">Nenhum agendamento no período.</p>;
  }
  return (
    <div className="-mx-2 overflow-x-auto px-2">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Profissional</TableHead>
            <TableHead className="text-right">Agend.</TableHead>
            <TableHead className="text-right">Realizados</TableHead>
            <TableHead className="text-right">Faltas</TableHead>
            <TableHead className="text-right">Cancel.</TableHead>
            <TableHead className="text-right">Comparec.</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {linhas.map((l) => (
            <TableRow key={l.profissional.id}>
              <TableCell className="max-w-48">
                <span className="flex items-center gap-2">
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: l.profissional.cor_agenda ?? undefined }}
                    aria-hidden
                  />
                  <span className="truncate">{l.profissional.nome}</span>
                  {!l.profissional.ativo && <span className="text-xs text-muted-foreground">(inativo)</span>}
                </span>
              </TableCell>
              <TableCell className="text-right tabular-nums">{l.total}</TableCell>
              <TableCell className="text-right tabular-nums">{l.atendidos}</TableCell>
              <TableCell className="text-right tabular-nums">{l.faltas}</TableCell>
              <TableCell className="text-right tabular-nums">{l.cancelados}</TableCell>
              <TableCell className="text-right tabular-nums">{formatarPercentual(l.taxa_comparecimento)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ----------------------------------------------------------------------------- financeiro

function BlocoFinanceiro({ f, filtrado }: { f: NonNullable<DashboardClinica['financeiro']>; filtrado: boolean }) {
  const saldo = Number(f.saldo);
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div>
          <CardTitle className="flex items-center gap-2">
            <CircleDollarSign className="size-4 text-primary" /> Financeiro
          </CardTitle>
          <CardDescription>
            Valores efetivos do período (estornos desconsiderados)
            {filtrado && ' · da clínica inteira, sem filtro de profissional'}
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link to="/financeiro">
            Abrir financeiro <ArrowRight />
          </Link>
        </Button>
      </CardHeader>
      <CardContent className="space-y-6">
        <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <MiniValor rotulo="Receitas" valor={formatarMoeda(f.receitas)} anterior={f.anterior.receitas} atual={f.receitas} />
          <MiniValor
            rotulo="Despesas"
            valor={formatarMoeda(f.despesas)}
            anterior={f.anterior.despesas}
            atual={f.despesas}
            melhorQuando="menor"
          />
          <MiniValor
            rotulo="Saldo"
            valor={<span className={cn(saldo < 0 && 'text-destructive')}>{formatarMoeda(f.saldo)}</span>}
            anterior={f.anterior.saldo}
            atual={f.saldo}
          />
          <MiniValor
            rotulo="Ticket médio por atendimento"
            valor={f.ticket_medio ? formatarMoeda(f.ticket_medio) : '—'}
            nota={`${f.atendimentos_recebidos} ${f.atendimentos_recebidos === 1 ? 'atendimento recebido' : 'atendimentos recebidos'}`}
          />
        </dl>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div>
            <p className="mb-3 text-sm font-medium">Contas (hoje e próximos 7 dias)</p>
            <ul className="divide-y rounded-md border text-sm">
              <LinhaConta
                rotulo="A receber vencidas"
                v={f.receber_vencido}
                alerta
                para="/financeiro/contas-receber"
              />
              <LinhaConta rotulo="A receber nos próximos 7 dias" v={f.receber_proximos_7_dias} para="/financeiro/contas-receber" />
              <LinhaConta rotulo="A pagar vencidas" v={f.pagar_vencido} alerta para="/financeiro/contas-pagar" />
              <LinhaConta rotulo="A pagar nos próximos 7 dias" v={f.pagar_proximos_7_dias} para="/financeiro/contas-pagar" />
            </ul>
            <p className="mt-2 text-xs text-muted-foreground">
              Em aberto: {formatarMoeda(f.a_receber)} a receber · {formatarMoeda(f.a_pagar)} a pagar
            </p>
          </div>
          <div>
            <p className="mb-3 text-sm font-medium">Receita por profissional</p>
            <BarrasValores
              itens={f.receita_por_profissional.slice(0, 8).map((r) => ({
                chave: r.profissional.id,
                rotulo: r.profissional.nome,
                valor: Number(r.total),
                cor: r.profissional.cor_agenda,
              }))}
              formatar={(v) => formatarMoeda(v)}
              vazio="Nenhuma receita vinculada a profissional no período."
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function MiniValor({
  rotulo,
  valor,
  atual,
  anterior,
  melhorQuando = 'maior',
  nota,
}: {
  rotulo: string;
  valor: ReactNode;
  atual?: string;
  anterior?: string;
  melhorQuando?: 'maior' | 'menor';
  nota?: string;
}) {
  const v = atual !== undefined && anterior !== undefined ? variacaoRelativa(Number(atual), Number(anterior)) : null;
  const bom = v && v.direcao !== 'igual' ? (v.direcao === 'alta') === (melhorQuando === 'maior') : null;
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{rotulo}</dt>
      <dd className="mt-0.5 text-lg font-semibold tabular-nums">{valor}</dd>
      {v ? (
        <dd className="text-xs text-muted-foreground">
          <span className={cn('font-medium', bom === true && 'text-success', bom === false && 'text-destructive')}>
            {v.texto}
          </span>{' '}
          vs. anterior
        </dd>
      ) : (
        nota && <dd className="text-xs text-muted-foreground">{nota}</dd>
      )}
    </div>
  );
}

function LinhaConta({
  rotulo,
  v,
  alerta,
  para,
}: {
  rotulo: string;
  v: { valor: string; quantidade: number };
  alerta?: boolean;
  para: string;
}) {
  const destaque = alerta && v.quantidade > 0;
  return (
    <li>
      <Link to={para} className="flex items-center justify-between gap-2 px-3 py-2.5 hover:bg-muted/50">
        <span className="flex items-center gap-2">
          {destaque && <AlertTriangle className="size-3.5 text-destructive" aria-label="Atenção" />}
          {rotulo}
        </span>
        <span className="shrink-0 text-right tabular-nums">
          <span className={cn('font-medium', destaque && 'text-destructive')}>{formatarMoeda(v.valor)}</span>
          <span className="ml-1 text-xs text-muted-foreground">({v.quantidade})</span>
        </span>
      </Link>
    </li>
  );
}

// ----------------------------------------------------------------------------- operacional

function Pendencias({ p }: { p: DashboardClinica['pendencias'] }) {
  const itens: { chave: string; rotulo: string; valor: number; detalhe?: string; para: string; icone: ReactNode; alerta?: boolean }[] = [];
  if (p.solicitacoes_pendentes !== null) {
    itens.push({
      chave: 'solicitacoes',
      rotulo: 'Solicitações online pendentes',
      valor: p.solicitacoes_pendentes,
      para: '/solicitacoes',
      icone: <Inbox className="size-4" />,
      alerta: p.solicitacoes_pendentes > 0,
    });
  }
  if (p.lista_espera !== null) {
    itens.push({
      chave: 'espera',
      rotulo: 'Pessoas na lista de espera',
      valor: p.lista_espera,
      para: '/lista-espera',
      icone: <Hourglass className="size-4" />,
    });
  }
  if (p.retornos_pendentes !== null) {
    itens.push({
      chave: 'retornos',
      rotulo: 'Retornos pendentes',
      valor: p.retornos_pendentes,
      detalhe: p.retornos_vencidos ? `${p.retornos_vencidos} com data prevista vencida` : undefined,
      para: '/retornos',
      icone: <RotateCcw className="size-4" />,
      alerta: (p.retornos_vencidos ?? 0) > 0,
    });
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ClipboardList className="size-4 text-primary" /> Pendências
        </CardTitle>
        <CardDescription>Situação atual (independe do período)</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {itens.map((i) => (
            <li key={i.chave}>
              <Link
                to={i.para}
                className="flex items-center gap-3 rounded-lg border p-3 transition-colors hover:border-primary/40 hover:bg-muted/40"
              >
                <span
                  className={cn(
                    'grid size-9 shrink-0 place-items-center rounded-lg',
                    i.alerta ? 'bg-warning/15 text-amber-700 dark:text-amber-300' : 'bg-primary/10 text-primary',
                  )}
                >
                  {i.icone}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm">{i.rotulo}</span>
                  {i.detalhe && <span className="block text-xs text-destructive">{i.detalhe}</span>}
                </span>
                <span className="text-xl font-semibold tabular-nums">{i.valor}</span>
                <ArrowRight className="size-4 text-muted-foreground" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function AgendaHoje({ itens, mostrarProfissional }: { itens: DashboardClinica['hoje']; mostrarProfissional: boolean }) {
  if (!itens.length) {
    return (
      <EstadoVazio
        icone={<CalendarClock className="size-5" />}
        titulo="Nenhum agendamento para hoje"
        acao={
          <Button variant="outline" size="sm" asChild>
            <Link to="/agenda">Abrir agenda</Link>
          </Button>
        }
      />
    );
  }
  const ativos = itens.filter((i) => i.status !== 'cancelado');
  const cancelados = itens.length - ativos.length;
  return (
    <div>
      <ul className="divide-y">
        {ativos.map((a) => (
          <li key={a.id}>
            <Link
              to={`/agenda?agendamento=${a.id}`}
              className="-mx-2 flex items-center gap-3 rounded-md px-2 py-2.5 hover:bg-muted/50"
            >
              <span className="w-12 shrink-0 text-sm font-medium tabular-nums">{format(new Date(a.inicio), 'HH:mm')}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{a.paciente.nome}</span>
                {mostrarProfissional && (
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span
                      className="size-2 rounded-full"
                      style={{ backgroundColor: a.profissional.cor_agenda ?? undefined }}
                      aria-hidden
                    />
                    <span className="truncate">{a.profissional.nome}</span>
                  </span>
                )}
              </span>
              <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                <span className={cn('size-2 rounded-full', ESTILO_STATUS[a.status].ponto)} aria-hidden />
                {ROTULOS_STATUS_AGENDAMENTO[a.status]}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {ativos.length === 0 && <p className="py-4 text-center text-sm text-muted-foreground">Todos os horários de hoje foram cancelados.</p>}
      <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {ativos.length} {ativos.length === 1 ? 'agendamento' : 'agendamentos'}
          {cancelados > 0 && ` · ${cancelados} cancelado${cancelados > 1 ? 's' : ''}`}
        </span>
        <Link to="/agenda" className="inline-flex items-center gap-1 hover:text-foreground">
          Abrir agenda <ArrowRight className="size-3" />
        </Link>
      </div>
    </div>
  );
}
