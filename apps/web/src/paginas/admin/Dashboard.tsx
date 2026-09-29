// Dashboard do super admin: visão geral da plataforma (clínicas, assinaturas, planos e oportunidades de upsell).
import { Link } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ArrowRight, Building2, CircleDollarSign, FlaskConical, Rocket, TrendingUp } from 'lucide-react';
import { useDashboardAdmin, type DashboardAdmin } from '@/api/adminClinicas';
import { mensagemDeErro } from '@/api/cliente';
import { ROTULOS_STATUS_ASSINATURA, type StatusAssinatura } from '@/api/tipos';
import { CabecalhoPagina, Carregando, EstadoVazio } from '@/componentes/comum';
import { Badge } from '@/componentes/ui/badge';
import { Button } from '@/componentes/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/componentes/ui/card';
import { formatarMoeda } from '@/lib/formatos';
import { cn } from '@/lib/utils';
import { BadgeStatusAssinatura, CardKpi, COR_BARRA_STATUS, ErroCarregar } from './comum';

const ORDEM_STATUS: StatusAssinatura[] = ['ativa', 'teste', 'vencida', 'bloqueada', 'cancelada'];

export default function PaginaAdminDashboard() {
  const { data, isLoading, isError, error, refetch } = useDashboardAdmin();

  return (
    <div>
      <CabecalhoPagina
        titulo="Dashboard"
        descricao="Visão geral da plataforma: clínicas, assinaturas e planos."
        acoes={
          <Button variant="outline" asChild>
            <Link to="/admin/clinicas">
              Ver clínicas <ArrowRight />
            </Link>
          </Button>
        }
      />
      {isLoading ? (
        <Carregando />
      ) : isError || !data ? (
        <ErroCarregar mensagem={mensagemDeErro(error)} aoTentar={() => refetch()} />
      ) : (
        <ConteudoDashboard d={data} />
      )}
    </div>
  );
}

function ConteudoDashboard({ d }: { d: DashboardAdmin }) {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <CardKpi
          titulo="Clínicas"
          valor={d.total_clinicas}
          detalhe={`${d.clinicas_ativas} ativas · ${d.clinicas_inativas} inativas`}
          icone={<Building2 className="size-5" />}
        />
        <CardKpi
          titulo="Assinaturas pagas"
          valor={d.por_status.ativa}
          detalhe={`${d.por_status.vencida} vencidas · ${d.por_status.bloqueada} bloqueadas`}
          icone={<TrendingUp className="size-5" />}
          destaque="sucesso"
        />
        <CardKpi
          titulo="Em teste grátis"
          valor={d.por_status.teste}
          detalhe={`${d.novos_30_dias} cadastros nos últimos 30 dias`}
          icone={<FlaskConical className="size-5" />}
          destaque="alerta"
        />
        <CardKpi
          titulo="Receita mensal estimada"
          valor={formatarMoeda(d.receita_mensal_estimada)}
          detalhe="Assinaturas ativas × preço do plano"
          icone={<CircleDollarSign className="size-5" />}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Novos cadastros</CardTitle>
            <CardDescription>Clínicas criadas por dia nos últimos 30 dias</CardDescription>
          </CardHeader>
          <CardContent>
            <GraficoCadastros serie={d.cadastros_30_dias} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Assinaturas por status</CardTitle>
            <CardDescription>Considera a data de expiração</CardDescription>
          </CardHeader>
          <CardContent>
            <DistribuicaoStatus porStatus={d.por_status} semAssinatura={d.sem_assinatura} />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Clínicas por plano</CardTitle>
            <CardDescription>Assinaturas atuais em cada plano</CardDescription>
          </CardHeader>
          <CardContent>
            <PorPlano porPlano={d.por_plano} />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Rocket className="size-4 text-primary" />
              Clínicas no limite do plano
            </CardTitle>
            <CardDescription>Oportunidades de upgrade: alguma métrica com uso igual ou acima do limite</CardDescription>
          </CardHeader>
          <CardContent>
            <ClinicasNoLimite lista={d.clinicas_no_limite} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function GraficoCadastros({ serie }: { serie: DashboardAdmin['cadastros_30_dias'] }) {
  const maximo = Math.max(1, ...serie.map((s) => s.total));
  const total = serie.reduce((s, x) => s + x.total, 0);
  // Linhas de grade: 0, metade e máximo.
  const grade = [maximo, Math.round(maximo / 2), 0].filter((v, i, a) => a.indexOf(v) === i);

  return (
    <div>
      <div className="flex gap-3">
        <div className="flex h-48 flex-col justify-between py-0.5 text-right text-xs text-muted-foreground tabular-nums">
          {grade.map((v) => (
            <span key={v}>{v}</span>
          ))}
        </div>
        <div className="relative flex h-48 flex-1 items-end gap-[3px] border-b border-l border-border pl-1">
          {serie.map((s) => {
            const altura = (s.total / maximo) * 100;
            const rotulo = format(parseISO(s.data), "dd 'de' MMM", { locale: ptBR });
            return (
              <div key={s.data} className="group relative flex h-full flex-1 items-end" title={`${rotulo}: ${s.total}`}>
                <div
                  className={cn(
                    'w-full rounded-t-sm transition-colors',
                    s.total > 0 ? 'bg-primary/70 group-hover:bg-primary' : 'bg-muted',
                  )}
                  style={{ height: s.total > 0 ? `${altura}%` : '2px' }}
                />
                <span className="pointer-events-none absolute -top-7 left-1/2 z-10 hidden -translate-x-1/2 rounded bg-foreground px-1.5 py-0.5 text-[11px] whitespace-nowrap text-background group-hover:block">
                  {rotulo}: {s.total}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      <div className="mt-2 flex justify-between pl-8 text-xs text-muted-foreground">
        <span>{serie[0] && format(parseISO(serie[0].data), 'dd/MM')}</span>
        <span>
          {total} {total === 1 ? 'cadastro' : 'cadastros'} no período
        </span>
        <span>{serie.at(-1) && format(parseISO(serie.at(-1)!.data), 'dd/MM')}</span>
      </div>
    </div>
  );
}

function DistribuicaoStatus({
  porStatus,
  semAssinatura,
}: {
  porStatus: Record<StatusAssinatura, number>;
  semAssinatura: number;
}) {
  const total = ORDEM_STATUS.reduce((s, k) => s + porStatus[k], 0);
  if (total === 0) return <p className="py-8 text-center text-sm text-muted-foreground">Nenhuma assinatura ainda.</p>;
  return (
    <div className="space-y-5">
      <div className="flex h-3 overflow-hidden rounded-full bg-muted">
        {ORDEM_STATUS.filter((s) => porStatus[s] > 0).map((s) => (
          <div
            key={s}
            className={COR_BARRA_STATUS[s]}
            style={{ width: `${(porStatus[s] / total) * 100}%` }}
            title={`${ROTULOS_STATUS_ASSINATURA[s]}: ${porStatus[s]}`}
          />
        ))}
      </div>
      <ul className="space-y-2.5 text-sm">
        {ORDEM_STATUS.map((s) => (
          <li key={s} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <span className={cn('size-2.5 rounded-full', COR_BARRA_STATUS[s])} />
              {ROTULOS_STATUS_ASSINATURA[s]}
            </span>
            <span className="text-muted-foreground tabular-nums">
              <span className="font-medium text-foreground">{porStatus[s]}</span> ·{' '}
              {Math.round((porStatus[s] / total) * 100)}%
            </span>
          </li>
        ))}
        {semAssinatura > 0 && (
          <li className="flex items-center justify-between gap-2 text-muted-foreground">
            <span>Sem assinatura</span>
            <span className="tabular-nums">{semAssinatura}</span>
          </li>
        )}
      </ul>
    </div>
  );
}

function PorPlano({ porPlano }: { porPlano: DashboardAdmin['por_plano'] }) {
  if (!porPlano.length) return <p className="py-8 text-center text-sm text-muted-foreground">Nenhum plano cadastrado.</p>;
  const maximo = Math.max(1, ...porPlano.map((p) => p.total));
  return (
    <ul className="space-y-4">
      {porPlano.map((p) => (
        <li key={p.plano_id}>
          <div className="mb-1.5 flex items-center justify-between gap-2 text-sm">
            <Link to={`/admin/planos/${p.plano_id}`} className="truncate font-medium hover:text-primary hover:underline">
              {p.nome}
              {!p.ativo && <span className="ml-1.5 text-xs font-normal text-muted-foreground">(inativo)</span>}
            </Link>
            <span className="shrink-0 text-muted-foreground tabular-nums">{p.total}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-chart-1" style={{ width: `${(p.total / maximo) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function ClinicasNoLimite({ lista }: { lista: DashboardAdmin['clinicas_no_limite'] }) {
  if (!lista.length) {
    return (
      <EstadoVazio
        icone={<Rocket className="size-5" />}
        titulo="Nenhuma clínica no limite"
        descricao="Quando uma clínica atingir algum limite do plano, ela aparece aqui."
      />
    );
  }
  return (
    <ul className="divide-y">
      {lista.slice(0, 10).map((c) => (
        <li key={c.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <Link to={`/admin/clinicas/${c.id}`} className="font-medium hover:text-primary hover:underline">
              {c.nome}
            </Link>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <span>Plano {c.plano.nome}</span>
              <BadgeStatusAssinatura status={c.status} />
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5 sm:justify-end">
            {c.recursos.map((r) => (
              <Badge key={r.codigo} variant="outline" className="border-destructive/30 bg-destructive/5 text-destructive">
                {r.nome}: {r.uso}/{r.limite}
                {r.periodo === 'mensal' ? ' no mês' : ''}
              </Badge>
            ))}
          </div>
        </li>
      ))}
      {lista.length > 10 && (
        <li className="pt-3 text-center text-xs text-muted-foreground">e mais {lista.length - 10} clínica(s)…</li>
      )}
    </ul>
  );
}
