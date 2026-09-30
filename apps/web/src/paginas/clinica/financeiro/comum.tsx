// Componentes e utilitários compartilhados pelas abas de /financeiro (DONO: módulo financeiro).
import { useState, type ReactNode } from 'react';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { CalendarRange, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  useCategoriasFinanceiras,
  useContasFinanceiras,
  type Periodo,
} from '@/api/financeiro';
import { useListaProfissionais } from '@/api/profissionais';
import {
  ROTULOS_FORMA_PAGAMENTO,
  ROTULOS_STATUS_TITULO,
  type FormaPagamento,
  type StatusTitulo,
  type TipoCategoriaFinanceira,
} from '@/api/tipos';
import { Button } from '@/componentes/ui/button';
import { Card } from '@/componentes/ui/card';
import { Input } from '@/componentes/ui/input';
import { Label } from '@/componentes/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/componentes/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/componentes/ui/select';
import { formatarMoeda } from '@/lib/formatos';
import { cn } from '@/lib/utils';

export { ErroCarregamento, toastErro, useConfirmacao } from '../profissionais/comum';

// ----------------------------------------------------------------------------- datas

/** Hoje ('YYYY-MM-DD') no fuso do navegador (a clínica e a equipe normalmente estão no mesmo fuso). */
export function hojeIso(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

function dois(n: number) {
  return String(n).padStart(2, '0');
}

export function mesDe(iso: string, deslocamento = 0): Periodo {
  const [a, m] = iso.split('-').map(Number) as [number, number];
  const total = a * 12 + (m - 1) + deslocamento;
  const ano = Math.floor(total / 12);
  const mes = (total % 12) + 1;
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return { inicio: `${ano}-${dois(mes)}-01`, fim: `${ano}-${dois(mes)}-${dois(ultimo)}` };
}

export function ehMesInteiro(p: Periodo): boolean {
  const m = mesDe(p.inicio);
  return m.inicio === p.inicio && m.fim === p.fim;
}

export function rotuloPeriodo(p: Periodo): string {
  if (ehMesInteiro(p)) {
    const t = format(parseISO(p.inicio), "MMMM 'de' yyyy", { locale: ptBR });
    return t.charAt(0).toUpperCase() + t.slice(1);
  }
  if (p.inicio === p.fim) return formatarDataCurta(p.inicio);
  return `${formatarDataCurta(p.inicio)} – ${formatarDataCurta(p.fim)}`;
}

/** 'YYYY-MM-DD' → 30/09/2026. */
export function formatarDataCurta(iso: string | null | undefined): string {
  if (!iso) return '—';
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

/** Seletor de período: navegação por mês + intervalo personalizado. */
export function SeletorPeriodo({ valor, onChange }: { valor: Periodo; onChange: (p: Periodo) => void }) {
  const [aberto, setAberto] = useState(false);
  const [inicio, setInicio] = useState(valor.inicio);
  const [fim, setFim] = useState(valor.fim);
  const mensal = ehMesInteiro(valor);

  function navegar(delta: number) {
    onChange(mesDe(valor.inicio, delta));
  }

  return (
    <div className="flex items-center gap-1">
      <Button variant="outline" size="icon" onClick={() => navegar(-1)} aria-label="Mês anterior" disabled={!mensal}>
        <ChevronLeft className="size-4" />
      </Button>
      <Popover
        open={aberto}
        onOpenChange={(v) => {
          setAberto(v);
          if (v) {
            setInicio(valor.inicio);
            setFim(valor.fim);
          }
        }}
      >
        <PopoverTrigger asChild>
          <Button variant="outline" className="min-w-44 justify-center font-medium">
            <CalendarRange className="size-4 text-muted-foreground" />
            {rotuloPeriodo(valor)}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72" align="center">
          <div className="space-y-3">
            <p className="text-sm font-medium">Período personalizado</p>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor="periodo-inicio" className="text-xs">
                  De
                </Label>
                <Input id="periodo-inicio" type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="periodo-fim" className="text-xs">
                  Até
                </Label>
                <Input id="periodo-fim" type="date" value={fim} onChange={(e) => setFim(e.target.value)} />
              </div>
            </div>
            <div className="flex flex-wrap gap-1">
              <Button size="sm" variant="ghost" onClick={() => { onChange(mesDe(hojeIso())); setAberto(false); }}>
                Este mês
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { onChange(mesDe(hojeIso(), -1)); setAberto(false); }}>
                Mês passado
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  const h = hojeIso();
                  onChange({ inicio: `${h.slice(0, 4)}-01-01`, fim: `${h.slice(0, 4)}-12-31` });
                  setAberto(false);
                }}
              >
                Este ano
              </Button>
            </div>
            <Button
              className="w-full"
              size="sm"
              disabled={!inicio || !fim || fim < inicio}
              onClick={() => {
                onChange({ inicio, fim });
                setAberto(false);
              }}
            >
              Aplicar
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      <Button variant="outline" size="icon" onClick={() => navegar(1)} aria-label="Próximo mês" disabled={!mensal}>
        <ChevronRight className="size-4" />
      </Button>
    </div>
  );
}

// ----------------------------------------------------------------------------- visual

type Tom = 'neutro' | 'positivo' | 'negativo' | 'alerta' | 'primario';

const TONS: Record<Tom, string> = {
  neutro: 'bg-muted text-muted-foreground',
  positivo: 'bg-success/15 text-success',
  negativo: 'bg-destructive/10 text-destructive',
  alerta: 'bg-warning/20 text-foreground',
  primario: 'bg-primary/10 text-primary',
};

export function CartaoKpi({
  titulo,
  valor,
  icone,
  tom = 'neutro',
  detalhe,
  carregando,
}: {
  titulo: string;
  valor: ReactNode;
  icone: ReactNode;
  tom?: Tom;
  detalhe?: ReactNode;
  carregando?: boolean;
}) {
  return (
    <Card className="gap-0 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{titulo}</p>
          <p className={cn('mt-1 truncate text-2xl font-semibold tracking-tight tabular-nums', carregando && 'opacity-40')}>
            {valor}
          </p>
        </div>
        <span className={cn('grid size-9 shrink-0 place-items-center rounded-lg [&>svg]:size-4', TONS[tom])}>{icone}</span>
      </div>
      {detalhe && <div className="mt-2 text-xs text-muted-foreground">{detalhe}</div>}
    </Card>
  );
}

/** Valor com sinal e cor (entrada verde, saída vermelha). */
export function ValorMovimento({ valor, tipo, riscado }: { valor: string | number; tipo: 'entrada' | 'saida'; riscado?: boolean }) {
  return (
    <span
      className={cn(
        'font-medium tabular-nums whitespace-nowrap',
        tipo === 'entrada' ? 'text-success' : 'text-destructive',
        riscado && 'text-muted-foreground line-through',
      )}
    >
      {tipo === 'entrada' ? '+' : '−'} {formatarMoeda(valor)}
    </span>
  );
}

const ESTILO_STATUS_TITULO: Record<StatusTitulo, string> = {
  aberto: 'bg-primary/10 text-primary',
  vencido: 'bg-destructive/15 text-destructive',
  pago: 'bg-success/15 text-success',
  cancelado: 'bg-muted text-muted-foreground',
};

export function BadgeStatusTitulo({ status }: { status: StatusTitulo }) {
  return (
    <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap', ESTILO_STATUS_TITULO[status])}>
      {ROTULOS_STATUS_TITULO[status]}
    </span>
  );
}

export function Paginacao({
  pagina,
  porPagina,
  total,
  onChange,
}: {
  pagina: number;
  porPagina: number;
  total: number;
  onChange: (p: number) => void;
}) {
  const paginas = Math.max(1, Math.ceil(total / porPagina));
  if (total <= porPagina) return null;
  return (
    <div className="flex items-center justify-between gap-2 border-t px-4 py-3 text-sm text-muted-foreground">
      <span>
        {(pagina - 1) * porPagina + 1}–{Math.min(total, pagina * porPagina)} de {total}
      </span>
      <div className="flex gap-1">
        <Button variant="outline" size="sm" disabled={pagina <= 1} onClick={() => onChange(pagina - 1)}>
          Anterior
        </Button>
        <Button variant="outline" size="sm" disabled={pagina >= paginas} onClick={() => onChange(pagina + 1)}>
          Próxima
        </Button>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------- selects

export const NENHUM = '__nenhum__';
export const TODOS = '__todos__';

export const FORMAS: FormaPagamento[] = [
  'pix',
  'dinheiro',
  'cartao_credito',
  'cartao_debito',
  'transferencia',
  'boleto',
  'convenio',
  'outro',
];

type PropsSelect = {
  valor: string;
  onChange: (v: string) => void;
  /** Rótulo da opção vazia (NENHUM/TODOS). Sem ele, não há opção vazia. */
  vazio?: { valor: string; rotulo: string };
  id?: string;
  className?: string;
  invalido?: boolean;
  disabled?: boolean;
};

function Base({
  valor,
  onChange,
  vazio,
  id,
  className,
  invalido,
  disabled,
  placeholder,
  opcoes,
}: PropsSelect & { placeholder: string; opcoes: { valor: string; rotulo: ReactNode; desabilitado?: boolean }[] }) {
  return (
    <Select value={valor} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id={id} className={cn('w-full', className)} aria-invalid={invalido || undefined}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {vazio && <SelectItem value={vazio.valor}>{vazio.rotulo}</SelectItem>}
        {opcoes.map((o) => (
          <SelectItem key={o.valor} value={o.valor} disabled={o.desabilitado}>
            {o.rotulo}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function SelectConta(props: PropsSelect & { somenteAtivas?: boolean }) {
  const { data } = useContasFinanceiras();
  const opcoes = (data ?? [])
    .filter((c) => !props.somenteAtivas || c.ativo || c.id === props.valor)
    .map((c) => ({ valor: c.id, rotulo: c.ativo ? c.nome : `${c.nome} (desativada)` }));
  return <Base {...props} placeholder="Conta" opcoes={opcoes} />;
}

export function SelectCategoria(props: PropsSelect & { tipo?: TipoCategoriaFinanceira }) {
  const { data } = useCategoriasFinanceiras();
  const opcoes = (data ?? [])
    .filter((c) => (!props.tipo || c.tipo === props.tipo) && (c.ativo || c.id === props.valor))
    .map((c) => ({ valor: c.id, rotulo: props.tipo ? c.nome : `${c.nome} · ${c.tipo === 'receita' ? 'receita' : 'despesa'}` }));
  return <Base {...props} placeholder="Categoria" opcoes={opcoes} />;
}

export function SelectForma(props: PropsSelect) {
  return (
    <Base
      {...props}
      placeholder="Forma de pagamento"
      opcoes={FORMAS.map((f) => ({ valor: f, rotulo: ROTULOS_FORMA_PAGAMENTO[f] }))}
    />
  );
}

export function SelectProfissional(props: PropsSelect) {
  const { data } = useListaProfissionais();
  const opcoes = (data ?? [])
    .filter((p) => p.ativo || p.id === props.valor)
    .map((p) => ({ valor: p.id, rotulo: p.nome }));
  return <Base {...props} placeholder="Profissional" opcoes={opcoes} />;
}

/** Converte o valor de um <Select> com sentinela em id | null. */
export function idOuNull(v: string): string | null {
  return v === NENHUM || v === TODOS || !v ? null : v;
}
export function idOuUndefined(v: string): string | undefined {
  return v === NENHUM || v === TODOS || !v ? undefined : v;
}

/** Input de dinheiro (number com 2 casas). */
export function InputValor({
  valor,
  onChange,
  id,
  invalido,
  autoFocus,
  placeholder = '0,00',
}: {
  valor: string;
  onChange: (v: string) => void;
  id?: string;
  invalido?: boolean;
  autoFocus?: boolean;
  placeholder?: string;
}) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">R$</span>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        step="0.01"
        min="0"
        className="pl-9 tabular-nums"
        value={valor}
        placeholder={placeholder}
        autoFocus={autoFocus}
        aria-invalid={invalido || undefined}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

/** Texto do campo de valor → número com 2 casas (NaN se inválido). */
export function lerValor(v: string): number {
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : Number.NaN;
}

/** Campo com rótulo + mensagem de erro (formulários simples sem react-hook-form). */
export function Campo({
  rotulo,
  htmlFor,
  erro,
  dica,
  children,
  className,
}: {
  rotulo: ReactNode;
  htmlFor?: string;
  erro?: string | null;
  dica?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={htmlFor}>{rotulo}</Label>
      {children}
      {erro ? <p className="text-sm text-destructive">{erro}</p> : dica ? <p className="text-xs text-muted-foreground">{dica}</p> : null}
    </div>
  );
}
