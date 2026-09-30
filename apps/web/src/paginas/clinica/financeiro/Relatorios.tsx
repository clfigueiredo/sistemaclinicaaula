// Aba "Relatórios" de /financeiro (admin): resumo do período (valores efetivos — sem estornos), fluxo de caixa
// por dia/mês (gráficos SVG sem lib), receitas/despesas por categoria, forma de pagamento e profissional; CSV.
import { useState } from 'react';
import {
  ArrowDownCircle,
  ArrowUpCircle,
  CalendarClock,
  Download,
  Loader2,
  Scale,
  TableIcon,
  BarChart3,
} from 'lucide-react';
import {
  exportarCsv,
  useFluxoCaixa,
  useResumoFinanceiro,
  type FluxoCaixa,
  type Periodo,
  type TipoExportacao,
} from '@/api/financeiro';
import { ROTULOS_FORMA_PAGAMENTO } from '@/api/tipos';
import { Carregando, EstadoVazio } from '@/componentes/comum';
import { Button } from '@/componentes/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/componentes/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/componentes/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/componentes/ui/dropdown-menu';
import { formatarMoeda } from '@/lib/formatos';
import { cn } from '@/lib/utils';
import {
  CartaoKpi,
  ErroCarregamento,
  SeletorPeriodo,
  formatarDataCurta,
  hojeIso,
  mesDe,
  toastErro,
} from './comum';

const EXPORTACOES: { tipo: TipoExportacao; rotulo: string }[] = [
  { tipo: 'movimentacoes', rotulo: 'Movimentações do período' },
  { tipo: 'fluxo', rotulo: 'Fluxo de caixa' },
  { tipo: 'categorias', rotulo: 'Por categoria' },
  { tipo: 'formas', rotulo: 'Por forma de pagamento' },
  { tipo: 'profissionais', rotulo: 'Por profissional' },
  { tipo: 'repasses', rotulo: 'Repasses' },
];

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
function rotuloBucket(chave: string, curto = false): string {
  if (chave.length === 7) return `${MESES[Number(chave.slice(5, 7)) - 1]}/${chave.slice(2, 4)}`;
  return curto ? chave.slice(8, 10) : formatarDataCurta(chave);
}

export default function Relatorios() {
  const [periodo, setPeriodo] = useState<Periodo>(() => mesDe(hojeIso()));
  const [agrupamento, setAgrupamento] = useState<'dia' | 'mes'>('dia');
  const [exportando, setExportando] = useState<TipoExportacao | null>(null);
  const resumo = useResumoFinanceiro(periodo);
  const fluxo = useFluxoCaixa({ ...periodo, agrupamento });
  const r = resumo.data;

  async function exportar(tipo: TipoExportacao) {
    setExportando(tipo);
    try {
      await exportarCsv(tipo, periodo, agrupamento);
    } catch (e) {
      toastErro(e);
    } finally {
      setExportando(null);
    }
  }

  function mudarPeriodo(p: Periodo) {
    setPeriodo(p);
    const dias = (Date.parse(p.fim) - Date.parse(p.inicio)) / 86_400_000;
    if (dias > 62) setAgrupamento('mes');
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <SeletorPeriodo valor={periodo} onChange={mudarPeriodo} />
          <div className="flex rounded-md border p-0.5">
            {(['dia', 'mes'] as const).map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => setAgrupamento(a)}
                className={cn(
                  'rounded px-2.5 py-1 text-sm font-medium transition-colors',
                  agrupamento === a ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {a === 'dia' ? 'Por dia' : 'Por mês'}
              </button>
            ))}
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" disabled={!!exportando}>
              {exportando ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
              Exportar CSV
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {EXPORTACOES.map((e) => (
              <DropdownMenuItem key={e.tipo} onClick={() => exportar(e.tipo)}>
                {e.rotulo}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {resumo.isError ? (
        <ErroCarregamento mensagem="Não foi possível gerar o relatório." tentarNovamente={() => resumo.refetch()} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <CartaoKpi titulo="Receitas" valor={formatarMoeda(r?.receitas ?? 0)} icone={<ArrowUpCircle />} tom="positivo" carregando={resumo.isFetching} />
          <CartaoKpi titulo="Despesas" valor={formatarMoeda(r?.despesas ?? 0)} icone={<ArrowDownCircle />} tom="negativo" carregando={resumo.isFetching} />
          <CartaoKpi
            titulo="Resultado"
            valor={<span className={cn(Number(r?.saldo ?? 0) < 0 && 'text-destructive')}>{formatarMoeda(r?.saldo ?? 0)}</span>}
            icone={<Scale />}
            tom="primario"
            carregando={resumo.isFetching}
            detalhe="Receitas − despesas (sem estornos)"
          />
          <CartaoKpi
            titulo="Em aberto"
            valor={formatarMoeda(Number(r?.a_receber_aberto ?? 0) - Number(r?.a_pagar_aberto ?? 0))}
            icone={<CalendarClock />}
            tom={(r?.vencidos ?? 0) > 0 ? 'alerta' : 'neutro'}
            carregando={resumo.isFetching}
            detalhe={
              <>
                A receber {formatarMoeda(r?.a_receber_aberto ?? 0)} · a pagar {formatarMoeda(r?.a_pagar_aberto ?? 0)}
                {(r?.vencidos ?? 0) > 0 && <span className="block text-destructive">{r!.vencidos} título(s) vencido(s)</span>}
              </>
            }
          />
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Fluxo de caixa</CardTitle>
          <CardDescription>
            {fluxo.data
              ? `Saldo inicial ${formatarMoeda(fluxo.data.saldo_inicial)} → saldo final ${formatarMoeda(fluxo.data.saldo_final)}`
              : 'Entradas, saídas e saldo acumulado de todas as contas.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {fluxo.isLoading ? (
            <Carregando />
          ) : fluxo.isError ? (
            <ErroCarregamento mensagem="Tente novamente." tentarNovamente={() => fluxo.refetch()} />
          ) : fluxo.data ? (
            <GraficosFluxo fluxo={fluxo.data} />
          ) : null}
        </CardContent>
      </Card>

      {resumo.isLoading ? (
        <Carregando />
      ) : r ? (
        <>
          <div className="grid gap-6 lg:grid-cols-2">
            <CardBarras
              titulo="Receitas por categoria"
              itens={r.por_categoria.filter((c) => c.tipo === 'receita').map((c) => ({ rotulo: c.categoria, valor: Number(c.total), extra: `${c.quantidade}×` }))}
              cor="bg-success"
            />
            <CardBarras
              titulo="Despesas por categoria"
              itens={r.por_categoria.filter((c) => c.tipo === 'despesa').map((c) => ({ rotulo: c.categoria, valor: Number(c.total), extra: `${c.quantidade}×` }))}
              cor="bg-destructive"
            />
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Por forma de pagamento</CardTitle>
              </CardHeader>
              <CardContent>
                {r.por_forma_pagamento.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">Sem movimentações no período.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Forma</TableHead>
                        <TableHead className="text-right">Entradas</TableHead>
                        <TableHead className="text-right">Saídas</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {r.por_forma_pagamento.map((f) => (
                        <TableRow key={f.forma_pagamento}>
                          <TableCell>{ROTULOS_FORMA_PAGAMENTO[f.forma_pagamento]}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatarMoeda(f.entradas)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatarMoeda(f.saidas)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
            <CardBarras
              titulo="Receitas por profissional"
              itens={r.por_profissional.map((p) => ({ rotulo: p.profissional.nome, valor: Number(p.entradas), extra: `${p.quantidade}×` }))}
              cor="bg-primary"
              vazio="Nenhuma entrada vinculada a profissionais no período."
            />
          </div>
        </>
      ) : null}
    </div>
  );
}

// ----------------------------------------------------------------------------- barras horizontais

function CardBarras({
  titulo,
  itens,
  cor,
  vazio = 'Sem valores no período.',
}: {
  titulo: string;
  itens: { rotulo: string; valor: number; extra?: string }[];
  cor: string;
  vazio?: string;
}) {
  const total = itens.reduce((s, i) => s + i.valor, 0);
  const max = Math.max(1, ...itens.map((i) => i.valor));
  return (
    <Card>
      <CardHeader>
        <CardTitle>{titulo}</CardTitle>
        {total > 0 && <CardDescription>Total {formatarMoeda(total)}</CardDescription>}
      </CardHeader>
      <CardContent>
        {itens.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{vazio}</p>
        ) : (
          <ul className="space-y-3">
            {itens.map((i) => (
              <li key={i.rotulo} title={`${i.rotulo}: ${formatarMoeda(i.valor)}`}>
                <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
                  <span className="truncate">{i.rotulo}</span>
                  <span className="shrink-0 tabular-nums">
                    {formatarMoeda(i.valor)}
                    <span className="ml-1.5 text-xs text-muted-foreground">{total > 0 ? Math.round((i.valor / total) * 100) : 0}%</span>
                  </span>
                </div>
                <div className="h-2 rounded-full bg-muted">
                  <div className={cn('h-2 rounded-full', cor)} style={{ width: `${Math.max(2, (i.valor / max) * 100)}%` }} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ----------------------------------------------------------------------------- gráficos SVG do fluxo

function GraficosFluxo({ fluxo }: { fluxo: FluxoCaixa }) {
  const [emTabela, setEmTabela] = useState(false);
  const [foco, setFoco] = useState<number | null>(null);
  const dados = fluxo.dias.map((d) => ({ ...d, e: Number(d.entradas), s: Number(d.saidas), saldo: Number(d.saldo) }));
  const semMovimento = dados.every((d) => d.e === 0 && d.s === 0);
  const atual = foco !== null ? dados[foco] : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-success" /> Entradas
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-destructive" /> Saídas
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-3 rounded bg-primary" /> Saldo acumulado
          </span>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setEmTabela((v) => !v)}>
          {emTabela ? <BarChart3 className="size-4" /> : <TableIcon className="size-4" />}
          {emTabela ? 'Ver gráfico' : 'Ver tabela'}
        </Button>
      </div>

      {emTabela ? (
        <div className="max-h-96 overflow-y-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{fluxo.agrupamento === 'mes' ? 'Mês' : 'Data'}</TableHead>
                <TableHead className="text-right">Entradas</TableHead>
                <TableHead className="text-right">Saídas</TableHead>
                <TableHead className="text-right">Saldo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dados.map((d) => (
                <TableRow key={d.data}>
                  <TableCell>{rotuloBucket(d.data)}</TableCell>
                  <TableCell className="text-right tabular-nums text-success">{formatarMoeda(d.e)}</TableCell>
                  <TableCell className="text-right tabular-nums text-destructive">{formatarMoeda(d.s)}</TableCell>
                  <TableCell className={cn('text-right font-medium tabular-nums', d.saldo < 0 && 'text-destructive')}>
                    {formatarMoeda(d.saldo)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : semMovimento ? (
        <EstadoVazio titulo="Sem movimentações no período" descricao="O saldo se manteve estável." />
      ) : (
        <>
          <div className="h-5 text-sm">
            {atual ? (
              <span>
                <strong>{rotuloBucket(atual.data)}</strong>
                <span className="ml-3 text-muted-foreground">Entradas</span> <span className="tabular-nums">{formatarMoeda(atual.e)}</span>
                <span className="ml-3 text-muted-foreground">Saídas</span> <span className="tabular-nums">{formatarMoeda(atual.s)}</span>
                <span className="ml-3 text-muted-foreground">Saldo</span>{' '}
                <span className={cn('font-medium tabular-nums', atual.saldo < 0 && 'text-destructive')}>{formatarMoeda(atual.saldo)}</span>
              </span>
            ) : (
              <span className="text-muted-foreground">Passe o mouse sobre o gráfico para ver os valores.</span>
            )}
          </div>
          <BarrasEntradasSaidas dados={dados} foco={foco} setFoco={setFoco} />
          <LinhaSaldo dados={dados} foco={foco} setFoco={setFoco} />
          <EixoX dados={dados} />
        </>
      )}
    </div>
  );
}

type Ponto = { data: string; e: number; s: number; saldo: number };
const L = 1000; // largura lógica do viewBox

function BarrasEntradasSaidas({ dados, foco, setFoco }: { dados: Ponto[]; foco: number | null; setFoco: (i: number | null) => void }) {
  const H = 160;
  const max = Math.max(1, ...dados.map((d) => Math.max(d.e, d.s)));
  const passo = L / dados.length;
  const larg = Math.max(1, Math.min(18, (passo - 4) / 2));
  return (
    <div>
      <p className="mb-1 text-xs text-muted-foreground">Entradas × saídas · máx. {formatarMoeda(max)}</p>
      <svg viewBox={`0 0 ${L} ${H}`} preserveAspectRatio="none" className="h-40 w-full" onMouseLeave={() => setFoco(null)} role="img" aria-label="Entradas e saídas por período">
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={0} x2={L} y1={H * f} y2={H * f} className="stroke-border" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        ))}
        {dados.map((d, i) => {
          const cx = i * passo + passo / 2;
          const he = (d.e / max) * (H - 4);
          const hs = (d.s / max) * (H - 4);
          return (
            <g key={d.data} onMouseEnter={() => setFoco(i)}>
              <rect x={i * passo} y={0} width={passo} height={H} className={cn('fill-transparent', foco === i && 'fill-muted')} />
              {d.e > 0 && <rect x={cx - larg - 1} y={H - he} width={larg} height={he} rx={2} className="fill-success" />}
              {d.s > 0 && <rect x={cx + 1} y={H - hs} width={larg} height={hs} rx={2} className="fill-destructive" />}
            </g>
          );
        })}
        <line x1={0} x2={L} y1={H} y2={H} className="stroke-border" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}

function LinhaSaldo({ dados, foco, setFoco }: { dados: Ponto[]; foco: number | null; setFoco: (i: number | null) => void }) {
  const H = 110;
  const valores = dados.map((d) => d.saldo);
  const min = Math.min(0, ...valores);
  const max = Math.max(0, ...valores);
  const faixa = max - min || 1;
  const passo = L / dados.length;
  const y = (v: number) => 6 + (1 - (v - min) / faixa) * (H - 12);
  const pontos = dados.map((d, i) => `${i * passo + passo / 2},${y(d.saldo)}`).join(' ');
  return (
    <div>
      <p className="mb-1 text-xs text-muted-foreground">
        Saldo acumulado · de {formatarMoeda(min)} a {formatarMoeda(max)}
      </p>
      <svg viewBox={`0 0 ${L} ${H}`} preserveAspectRatio="none" className="h-28 w-full" onMouseLeave={() => setFoco(null)} role="img" aria-label="Saldo acumulado">
        {min < 0 && (
          <line x1={0} x2={L} y1={y(0)} y2={y(0)} className="stroke-muted-foreground" strokeDasharray="4 4" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        )}
        {dados.map((d, i) => (
          <rect
            key={d.data}
            x={i * passo}
            y={0}
            width={passo}
            height={H}
            className={cn('fill-transparent', foco === i && 'fill-muted')}
            onMouseEnter={() => setFoco(i)}
          />
        ))}
        <polyline points={pontos} fill="none" className="stroke-primary" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        {foco !== null && dados[foco] && (
          <line
            x1={foco * passo + passo / 2}
            x2={foco * passo + passo / 2}
            y1={0}
            y2={H}
            className="stroke-muted-foreground"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
    </div>
  );
}

function EixoX({ dados }: { dados: Ponto[] }) {
  const n = dados.length;
  const alvo = Math.min(n, 8);
  const indices = new Set(Array.from({ length: alvo }, (_, k) => Math.round((k * (n - 1)) / Math.max(1, alvo - 1))));
  return (
    <div className="relative h-4 text-[11px] text-muted-foreground">
      {[...indices].map((i) => (
        <span
          key={i}
          className="absolute -translate-x-1/2 whitespace-nowrap tabular-nums"
          style={{ left: `${((i + 0.5) / n) * 100}%` }}
        >
          {rotuloBucket(dados[i]!.data, n > 12 && dados[i]!.data.length === 10)}
        </span>
      ))}
    </div>
  );
}
