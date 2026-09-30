// Gráficos do dashboard em CSS puro (sem biblioteca), no mesmo padrão do painel do super admin.
// Cada gráfico tem rótulos acessíveis (role="img" + aria-label) e uma tabela alternativa.
import { useState, type ReactNode } from 'react';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ArrowDownRight, ArrowRight, ArrowUpRight } from 'lucide-react';
import type { DashboardClinica } from '@/api/dashboard';
import { ROTULOS_STATUS_AGENDAMENTO, type StatusAgendamento } from '@/api/tipos';
import { Card, CardContent } from '@/componentes/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/componentes/ui/table';
import { DIAS_SEMANA, DIAS_SEMANA_CURTO } from '@/api/profissionais';
import { ESTILO_STATUS } from '@/paginas/clinica/agenda/utilidades';
import { cn } from '@/lib/utils';
import { formatarDiaCurto, formatarNumero, formatarPercentual, type Variacao } from './periodo';

// ----------------------------------------------------------------------------- KPI

export function CardIndicador({
  titulo,
  valor,
  icone,
  variacao,
  melhorQuando = 'maior',
  detalhe,
}: {
  titulo: string;
  valor: ReactNode;
  icone: ReactNode;
  variacao?: Variacao;
  /** Define se alta é boa (verde) ou ruim (vermelho). */
  melhorQuando?: 'maior' | 'menor' | 'neutro';
  detalhe?: ReactNode;
}) {
  const bom =
    variacao && variacao.direcao !== 'igual' && melhorQuando !== 'neutro'
      ? (variacao.direcao === 'alta') === (melhorQuando === 'maior')
      : null;
  const Icone = !variacao || variacao.direcao === 'igual' ? ArrowRight : variacao.direcao === 'alta' ? ArrowUpRight : ArrowDownRight;
  return (
    <Card className="gap-0 py-4">
      <CardContent className="px-4">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm leading-tight text-muted-foreground">{titulo}</p>
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary [&_svg]:size-4">
            {icone}
          </span>
        </div>
        <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{valor}</p>
        {variacao ? (
          <p className="mt-1 flex flex-wrap items-center gap-x-1 text-xs text-muted-foreground">
            <span
              className={cn(
                'inline-flex items-center gap-0.5 font-medium',
                bom === true && 'text-success',
                bom === false && 'text-destructive',
              )}
            >
              <Icone className="size-3.5" aria-hidden />
              {variacao.texto}
            </span>
            <span>vs. período anterior</span>
          </p>
        ) : (
          detalhe && <p className="mt-1 text-xs text-muted-foreground">{detalhe}</p>
        )}
        {variacao && detalhe && <p className="mt-0.5 text-xs text-muted-foreground">{detalhe}</p>}
      </CardContent>
    </Card>
  );
}

// ----------------------------------------------------------------------------- tabela alternativa

export function DetalhesTabela({ resumo, children }: { resumo: string; children: ReactNode }) {
  const [aberto, setAberto] = useState(false);
  return (
    <details className="mt-3 text-sm" open={aberto} onToggle={(e) => setAberto(e.currentTarget.open)}>
      <summary className="cursor-pointer text-xs text-muted-foreground select-none hover:text-foreground">{resumo}</summary>
      {aberto && <div className="mt-2 max-h-72 overflow-auto rounded-md border">{children}</div>}
    </details>
  );
}

// ----------------------------------------------------------------------------- série diária

type Ponto = DashboardClinica['por_dia'][number];
type Grupo = Ponto & { rotulo: string; rotuloCurto: string };

const SEGMENTOS = [
  { chave: 'realizados', rotulo: 'Realizados', classe: 'bg-primary' },
  { chave: 'pendentes', rotulo: 'Agendados/confirmados', classe: 'bg-primary/35' },
  { chave: 'faltas', rotulo: 'Faltas', classe: 'bg-destructive' },
  { chave: 'cancelados', rotulo: 'Cancelados', classe: 'bg-muted-foreground/35' },
] as const;

/** Agrupa a série por semana (> 62 dias) ou mês (> 180 dias) para caber na tela. */
function agrupar(serie: Ponto[]): { grupos: Grupo[]; unidade: 'dia' | 'semana' | 'mês' } {
  const unidade = serie.length > 180 ? 'mês' : serie.length > 62 ? 'semana' : 'dia';
  if (unidade === 'dia') {
    return {
      unidade,
      grupos: serie.map((p) => ({
        ...p,
        rotulo: format(parseISO(p.data), "EEE, dd 'de' MMM", { locale: ptBR }),
        rotuloCurto: formatarDiaCurto(p.data),
      })),
    };
  }
  const mapa = new Map<string, Grupo>();
  serie.forEach((p, i) => {
    const chave = unidade === 'mês' ? p.data.slice(0, 7) : serie[i - (i % 7)]!.data;
    const g = mapa.get(chave);
    if (g) {
      g.total += p.total;
      g.atendidos += p.atendidos;
      g.faltas += p.faltas;
      g.cancelados += p.cancelados;
    } else {
      const d = parseISO(p.data);
      mapa.set(chave, {
        ...p,
        rotulo: unidade === 'mês' ? format(d, 'MMMM yyyy', { locale: ptBR }) : `Semana de ${format(d, 'dd/MM/yyyy')}`,
        rotuloCurto: unidade === 'mês' ? format(d, 'MMM/yy', { locale: ptBR }) : format(d, 'dd/MM'),
      });
    }
  });
  return { unidade, grupos: [...mapa.values()] };
}

export function GraficoSerieDiaria({ serie }: { serie: Ponto[] }) {
  const { grupos, unidade } = agrupar(serie);
  const maximo = Math.max(1, ...grupos.map((g) => g.total));
  const total = grupos.reduce((s, g) => s + g.total, 0);
  const grade = [maximo, Math.round(maximo / 2), 0].filter((v, i, a) => a.indexOf(v) === i);

  if (total === 0) {
    return <p className="py-12 text-center text-sm text-muted-foreground">Nenhum agendamento no período.</p>;
  }

  return (
    <div>
      <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Legenda">
        {SEGMENTOS.map((s) => (
          <li key={s.chave} className="flex items-center gap-1.5">
            <span className={cn('size-2.5 rounded-sm', s.classe)} aria-hidden />
            {s.rotulo}
          </li>
        ))}
      </ul>
      <div
        className="flex gap-2"
        role="img"
        aria-label={`Agendamentos por ${unidade}: ${formatarNumero(total)} no período, máximo de ${maximo} em um(a) ${unidade}. Detalhes na tabela abaixo.`}
      >
        <div className="flex h-48 flex-col justify-between py-0.5 text-right text-xs text-muted-foreground tabular-nums" aria-hidden>
          {grade.map((v) => (
            <span key={v}>{v}</span>
          ))}
        </div>
        <div
          className={cn(
            'relative flex h-48 flex-1 items-end border-b border-l border-border pl-1',
            grupos.length > 45 ? 'gap-px' : 'gap-[3px]',
          )}
          aria-hidden
        >
          {grupos.map((g) => {
            const realizados = g.atendidos;
            const pendentes = Math.max(0, g.total - g.atendidos - g.faltas - g.cancelados);
            const valores = { realizados, pendentes, faltas: g.faltas, cancelados: g.cancelados };
            const dica = `${g.rotulo}: ${g.total} (${realizados} realizados, ${g.faltas} faltas, ${g.cancelados} cancelados)`;
            return (
              <div key={g.data} className="group relative flex h-full min-w-0 flex-1 items-end" title={dica}>
                {g.total === 0 ? (
                  <div className="h-0.5 w-full bg-muted" />
                ) : (
                  <div
                    className="flex w-full flex-col-reverse gap-px overflow-hidden rounded-t-[3px] transition-opacity group-hover:opacity-80"
                    style={{ height: `${(g.total / maximo) * 100}%` }}
                  >
                    {SEGMENTOS.map((s) =>
                      valores[s.chave] > 0 ? (
                        <div key={s.chave} className={s.classe} style={{ flexGrow: valores[s.chave], flexBasis: 0 }} />
                      ) : null,
                    )}
                  </div>
                )}
                <span className="pointer-events-none absolute -top-8 left-1/2 z-10 hidden -translate-x-1/2 rounded bg-foreground px-1.5 py-0.5 text-[11px] whitespace-nowrap text-background group-hover:block">
                  {g.rotuloCurto}: {g.total}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      <div className="mt-2 flex justify-between pl-8 text-xs text-muted-foreground">
        <span>{grupos[0]?.rotuloCurto}</span>
        <span>
          {formatarNumero(total)} {total === 1 ? 'agendamento' : 'agendamentos'}
          {unidade !== 'dia' && ` · por ${unidade}`}
        </span>
        <span>{grupos.at(-1)?.rotuloCurto}</span>
      </div>
      <DetalhesTabela resumo="Ver dados em tabela">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{unidade === 'dia' ? 'Dia' : unidade === 'semana' ? 'Semana' : 'Mês'}</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Realizados</TableHead>
              <TableHead className="text-right">Faltas</TableHead>
              <TableHead className="text-right">Cancelados</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {grupos.map((g) => (
              <TableRow key={g.data}>
                <TableCell>{g.rotulo}</TableCell>
                <TableCell className="text-right tabular-nums">{g.total}</TableCell>
                <TableCell className="text-right tabular-nums">{g.atendidos}</TableCell>
                <TableCell className="text-right tabular-nums">{g.faltas}</TableCell>
                <TableCell className="text-right tabular-nums">{g.cancelados}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </DetalhesTabela>
    </div>
  );
}

// ----------------------------------------------------------------------------- status

const ORDEM_STATUS: { status: StatusAgendamento; campo: keyof DashboardClinica['agenda'] }[] = [
  { status: 'agendado', campo: 'agendados' },
  { status: 'confirmado', campo: 'confirmados' },
  { status: 'compareceu', campo: 'compareceram' },
  { status: 'atendido', campo: 'atendidos' },
  { status: 'faltou', campo: 'faltas' },
  { status: 'cancelado', campo: 'cancelados' },
];

export function DistribuicaoStatus({ agenda }: { agenda: DashboardClinica['agenda'] }) {
  if (agenda.total === 0) {
    return <p className="py-12 text-center text-sm text-muted-foreground">Nenhum agendamento no período.</p>;
  }
  const maximo = Math.max(1, ...ORDEM_STATUS.map((s) => agenda[s.campo] as number));
  return (
    <ul className="space-y-3" aria-label="Agendamentos por status">
      {ORDEM_STATUS.map(({ status, campo }) => {
        const valor = agenda[campo] as number;
        return (
          <li key={status}>
            <div className="mb-1 flex items-center justify-between gap-2 text-sm">
              <span className="flex items-center gap-2">
                <span className={cn('size-2.5 rounded-full', ESTILO_STATUS[status].ponto)} aria-hidden />
                {ROTULOS_STATUS_AGENDAMENTO[status]}
              </span>
              <span className="text-muted-foreground tabular-nums">
                <span className="font-medium text-foreground">{valor}</span> ·{' '}
                {formatarPercentual(valor / agenda.total)}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
              <div
                className={cn('h-full rounded-full', ESTILO_STATUS[status].ponto)}
                style={{ width: `${(valor / maximo) * 100}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ----------------------------------------------------------------------------- dias e horários

export function PicosAgenda({
  porDiaSemana,
  porHora,
}: {
  porDiaSemana: DashboardClinica['por_dia_semana'];
  porHora: DashboardClinica['por_hora'];
}) {
  const totalSemana = porDiaSemana.reduce((s, d) => s + d.total, 0);
  if (totalSemana === 0) {
    return <p className="py-12 text-center text-sm text-muted-foreground">Sem agendamentos ativos no período.</p>;
  }
  const maxDia = Math.max(1, ...porDiaSemana.map((d) => d.total));
  const topHoras = [...porHora].sort((a, b) => b.total - a.total || a.hora - b.hora).slice(0, 5);
  const maxHora = Math.max(1, ...topHoras.map((h) => h.total));
  const diaPico = porDiaSemana.reduce((a, b) => (b.total > a.total ? b : a));

  return (
    <div className="space-y-6">
      <div>
        <p className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">Dias da semana</p>
        <div
          className="flex h-28 items-end gap-2"
          role="img"
          aria-label={`Agendamentos por dia da semana. Mais movimentado: ${DIAS_SEMANA[diaPico.dia_semana]} (${diaPico.total}). ${porDiaSemana
            .map((d) => `${DIAS_SEMANA[d.dia_semana]}: ${d.total}`)
            .join(', ')}.`}
        >
          {porDiaSemana.map((d) => (
            <div key={d.dia_semana} className="flex h-full flex-1 flex-col items-center justify-end gap-1" title={`${DIAS_SEMANA[d.dia_semana]}: ${d.total}`}>
              <span className="text-[11px] text-muted-foreground tabular-nums" aria-hidden>
                {d.total || ''}
              </span>
              <div
                className={cn('w-full rounded-t-[3px]', d.total ? 'bg-chart-1' : 'bg-muted')}
                style={{ height: d.total ? `${(d.total / maxDia) * 70}%` : '2px' }}
                aria-hidden
              />
              <span className="text-[11px] text-muted-foreground" aria-hidden>
                {DIAS_SEMANA_CURTO[d.dia_semana]}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div>
        <p className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">Horários mais procurados</p>
        <ul className="space-y-2" aria-label="Horários mais procurados">
          {topHoras.map((h) => (
            <li key={h.hora} className="flex items-center gap-3 text-sm">
              <span className="w-12 shrink-0 tabular-nums">{String(h.hora).padStart(2, '0')}h</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden>
                <div className="h-full rounded-full bg-chart-1" style={{ width: `${(h.total / maxHora) * 100}%` }} />
              </div>
              <span className="w-8 shrink-0 text-right text-muted-foreground tabular-nums">{h.total}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------- barras simples (financeiro)

export function BarrasValores({
  itens,
  formatar,
  vazio,
}: {
  itens: { chave: string; rotulo: ReactNode; valor: number; cor?: string | null }[];
  formatar: (v: number) => string;
  vazio: string;
}) {
  if (!itens.length) return <p className="py-6 text-center text-sm text-muted-foreground">{vazio}</p>;
  const maximo = Math.max(1, ...itens.map((i) => i.valor));
  return (
    <ul className="space-y-3">
      {itens.map((i) => (
        <li key={i.chave}>
          <div className="mb-1 flex items-center justify-between gap-2 text-sm">
            <span className="flex min-w-0 items-center gap-2">
              {i.cor && <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: i.cor }} aria-hidden />}
              <span className="truncate">{i.rotulo}</span>
            </span>
            <span className="shrink-0 font-medium tabular-nums">{formatar(i.valor)}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
            <div className="h-full rounded-full bg-chart-1" style={{ width: `${(i.valor / maximo) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
