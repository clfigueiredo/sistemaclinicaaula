// Aba "Caixa" de /financeiro: saldos por conta, entradas/saídas do período, lançamentos, edição e estorno.
// Admin e recepção lançam; só o admin edita (descrição/categoria) e estorna — o backend garante.
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  ArrowDownCircle,
  ArrowUpCircle,
  Landmark,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Scale,
  Search,
  Undo2,
  Wallet,
} from 'lucide-react';
import { ErroApi } from '@/api/cliente';
import { useMe } from '@/api/me';
import {
  useContasFinanceiras,
  useCriarMovimentacao,
  useEditarMovimentacao,
  useEstornarMovimentacao,
  useMovimentacoes,
  type FiltrosMovimentacoes,
  type Movimentacao,
  type Periodo,
} from '@/api/financeiro';
import {
  ROTULOS_FORMA_PAGAMENTO,
  ROTULOS_ORIGEM_MOVIMENTACAO,
  ROTULOS_TIPO_CONTA,
  type FormaPagamento,
  type TipoMovimentacao,
} from '@/api/tipos';
import { Carregando, EstadoVazio } from '@/componentes/comum';
import { Button } from '@/componentes/ui/button';
import { Card } from '@/componentes/ui/card';
import { Input } from '@/componentes/ui/input';
import { Textarea } from '@/componentes/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/componentes/ui/table';
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
  DropdownMenuTrigger,
} from '@/componentes/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/componentes/ui/select';
import { formatarMoeda } from '@/lib/formatos';
import { cn } from '@/lib/utils';
import { BuscaPaciente, type PacienteSelecionado } from '../agenda/BuscaPaciente';
import {
  Campo,
  CartaoKpi,
  ErroCarregamento,
  InputValor,
  NENHUM,
  Paginacao,
  SeletorPeriodo,
  SelectCategoria,
  SelectConta,
  SelectForma,
  SelectProfissional,
  TODOS,
  ValorMovimento,
  formatarDataCurta,
  hojeIso,
  idOuNull,
  idOuUndefined,
  lerValor,
  mesDe,
  toastErro,
} from './comum';

const POR_PAGINA = 20;

export default function Caixa() {
  const { data: me } = useMe();
  const ehAdmin = me?.papel === 'admin';
  const [periodo, setPeriodo] = useState<Periodo>(() => mesDe(hojeIso()));
  const [tipo, setTipo] = useState<string>(TODOS);
  const [conta, setConta] = useState<string>(TODOS);
  const [categoria, setCategoria] = useState<string>(TODOS);
  const [forma, setForma] = useState<string>(TODOS);
  const [profissional, setProfissional] = useState<string>(TODOS);
  const [busca, setBusca] = useState('');
  const [pagina, setPagina] = useState(1);
  const [novo, setNovo] = useState<TipoMovimentacao | null>(null);
  const [estornando, setEstornando] = useState<Movimentacao | null>(null);
  const [editando, setEditando] = useState<Movimentacao | null>(null);

  const filtros: FiltrosMovimentacoes = {
    ...periodo,
    tipo: idOuUndefined(tipo) as TipoMovimentacao | undefined,
    conta_id: idOuUndefined(conta),
    categoria_id: idOuUndefined(categoria),
    forma_pagamento: idOuUndefined(forma) as FormaPagamento | undefined,
    profissional_id: idOuUndefined(profissional),
    busca: busca.trim() || undefined,
    pagina,
    por_pagina: POR_PAGINA,
  };
  const contas = useContasFinanceiras();
  const lista = useMovimentacoes(filtros);

  const saldoTotal = useMemo(
    () => (contas.data ?? []).filter((c) => c.ativo).reduce((s, c) => s + Number(c.saldo_atual), 0),
    [contas.data],
  );
  const filtrando = [tipo, conta, categoria, forma, profissional].some((v) => v !== TODOS) || !!busca.trim();

  function mudar<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      setPagina(1);
    };
  }

  const totais = lista.data?.totais;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SeletorPeriodo valor={periodo} onChange={mudar(setPeriodo)} />
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setNovo('saida')}>
            <ArrowDownCircle className="size-4 text-destructive" />
            Nova saída
          </Button>
          <Button onClick={() => setNovo('entrada')}>
            <Plus className="size-4" />
            Nova entrada
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <CartaoKpi
          titulo="Saldo em contas"
          valor={formatarMoeda(saldoTotal)}
          icone={<Wallet />}
          tom="primario"
          carregando={contas.isLoading}
          detalhe="Saldo atual somando as contas ativas"
        />
        <CartaoKpi
          titulo="Entradas no período"
          valor={formatarMoeda(totais?.entradas ?? 0)}
          icone={<ArrowUpCircle />}
          tom="positivo"
          carregando={lista.isFetching}
          detalhe={filtrando ? 'Considerando os filtros' : 'Sem estornos'}
        />
        <CartaoKpi
          titulo="Saídas no período"
          valor={formatarMoeda(totais?.saidas ?? 0)}
          icone={<ArrowDownCircle />}
          tom="negativo"
          carregando={lista.isFetching}
          detalhe={filtrando ? 'Considerando os filtros' : 'Sem estornos'}
        />
        <CartaoKpi
          titulo="Resultado do período"
          valor={
            <span className={cn(Number(totais?.saldo ?? 0) < 0 ? 'text-destructive' : 'text-foreground')}>
              {formatarMoeda(totais?.saldo ?? 0)}
            </span>
          }
          icone={<Scale />}
          tom={Number(totais?.saldo ?? 0) < 0 ? 'negativo' : 'neutro'}
          carregando={lista.isFetching}
          detalhe="Entradas − saídas"
        />
      </div>

      {contas.data && contas.data.filter((c) => c.ativo).length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {contas.data
            .filter((c) => c.ativo)
            .map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => mudar(setConta)(conta === c.id ? TODOS : c.id)}
                className={cn(
                  'flex min-w-40 shrink-0 items-center gap-3 rounded-lg border bg-card px-3 py-2 text-left transition-colors hover:bg-accent',
                  conta === c.id && 'border-primary ring-1 ring-primary',
                )}
              >
                <Landmark className="size-4 text-muted-foreground" />
                <span className="min-w-0">
                  <span className="block truncate text-xs text-muted-foreground">
                    {c.nome} · {ROTULOS_TIPO_CONTA[c.tipo]}
                  </span>
                  <span className={cn('block text-sm font-semibold tabular-nums', Number(c.saldo_atual) < 0 && 'text-destructive')}>
                    {formatarMoeda(c.saldo_atual)}
                  </span>
                </span>
              </button>
            ))}
        </div>
      )}

      <Card className="gap-0 py-0">
        <div className="grid gap-2 border-b p-4 sm:grid-cols-2 lg:grid-cols-6">
          <div className="relative sm:col-span-2 lg:col-span-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar descrição ou paciente"
              className="pl-8"
              value={busca}
              onChange={(e) => mudar(setBusca)(e.target.value)}
            />
          </div>
          <Select value={tipo} onValueChange={mudar(setTipo)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Entradas e saídas</SelectItem>
              <SelectItem value="entrada">Só entradas</SelectItem>
              <SelectItem value="saida">Só saídas</SelectItem>
            </SelectContent>
          </Select>
          <SelectConta valor={conta} onChange={mudar(setConta)} vazio={{ valor: TODOS, rotulo: 'Todas as contas' }} />
          <SelectCategoria valor={categoria} onChange={mudar(setCategoria)} vazio={{ valor: TODOS, rotulo: 'Todas as categorias' }} />
          <SelectForma valor={forma} onChange={mudar(setForma)} vazio={{ valor: TODOS, rotulo: 'Todas as formas' }} />
          <SelectProfissional
            valor={profissional}
            onChange={mudar(setProfissional)}
            vazio={{ valor: TODOS, rotulo: 'Todos os profissionais' }}
          />
        </div>

        {lista.isLoading ? (
          <Carregando />
        ) : lista.isError ? (
          <div className="p-4">
            <ErroCarregamento mensagem="Tente novamente em instantes." tentarNovamente={() => lista.refetch()} />
          </div>
        ) : !lista.data || lista.data.itens.length === 0 ? (
          <div className="p-4">
            <EstadoVazio
              icone={<Wallet className="size-5" />}
              titulo={filtrando ? 'Nenhuma movimentação encontrada' : 'Nenhuma movimentação no período'}
              descricao={
                filtrando
                  ? 'Ajuste os filtros para ver outros lançamentos.'
                  : 'Registre recebimentos de consultas pela agenda ou lance entradas e saídas avulsas.'
              }
              acao={
                !filtrando && (
                  <Button size="sm" onClick={() => setNovo('entrada')}>
                    <Plus className="size-4" /> Nova entrada
                  </Button>
                )
              }
            />
          </div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24 pl-4">Data</TableHead>
                  <TableHead>Descrição</TableHead>
                  <TableHead className="hidden md:table-cell">Categoria</TableHead>
                  <TableHead className="hidden lg:table-cell">Conta · forma</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead className="w-10 pr-4" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {lista.data.itens.map((m) => (
                  <LinhaMovimentacao
                    key={m.id}
                    m={m}
                    ehAdmin={ehAdmin}
                    onEstornar={() => setEstornando(m)}
                    onEditar={() => setEditando(m)}
                  />
                ))}
              </TableBody>
            </Table>
            <Paginacao pagina={pagina} porPagina={POR_PAGINA} total={lista.data.total} onChange={setPagina} />
          </>
        )}
      </Card>

      {novo && <DialogoMovimentacao tipoInicial={novo} aoFechar={() => setNovo(null)} />}
      {estornando && <DialogoEstorno m={estornando} aoFechar={() => setEstornando(null)} />}
      {editando && <DialogoEditar m={editando} aoFechar={() => setEditando(null)} />}
    </div>
  );
}

function LinhaMovimentacao({
  m,
  ehAdmin,
  onEstornar,
  onEditar,
}: {
  m: Movimentacao;
  ehAdmin: boolean;
  onEstornar: () => void;
  onEditar: () => void;
}) {
  const vinculos = [m.paciente?.nome, m.profissional?.nome].filter(Boolean).join(' · ');
  const podeEstornar = ehAdmin && !m.estornada && m.origem !== 'estorno';
  return (
    <TableRow className={cn(m.estornada && 'opacity-60')}>
      <TableCell className="pl-4 text-sm tabular-nums">{formatarDataCurta(m.data)}</TableCell>
      <TableCell className="max-w-80">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate font-medium">{m.descricao || ROTULOS_ORIGEM_MOVIMENTACAO[m.origem]}</span>
          {m.origem !== 'manual' && m.origem !== 'estorno' && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
              {ROTULOS_ORIGEM_MOVIMENTACAO[m.origem]}
            </span>
          )}
          {m.origem === 'estorno' && (
            <span className="rounded bg-warning/20 px-1.5 py-0.5 text-[11px] font-medium">Estorno</span>
          )}
          {m.estornada && (
            <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-[11px] font-medium text-destructive">Estornada</span>
          )}
        </div>
        {vinculos && <p className="truncate text-xs text-muted-foreground">{vinculos}</p>}
      </TableCell>
      <TableCell className="hidden text-sm md:table-cell">
        {m.categoria?.nome ?? <span className="text-muted-foreground">—</span>}
      </TableCell>
      <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">
        {m.conta.nome} · {ROTULOS_FORMA_PAGAMENTO[m.forma_pagamento]}
      </TableCell>
      <TableCell className="text-right">
        <ValorMovimento valor={m.valor} tipo={m.tipo} riscado={m.estornada} />
      </TableCell>
      <TableCell className="pr-4">
        {ehAdmin && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-8" aria-label="Ações">
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onEditar}>
                <Pencil className="size-4" /> Editar descrição/categoria
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onEstornar} disabled={!podeEstornar} className="text-destructive focus:text-destructive">
                <Undo2 className="size-4" /> Estornar
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </TableCell>
    </TableRow>
  );
}

// ----------------------------------------------------------------------------- diálogos

function DialogoMovimentacao({ tipoInicial, aoFechar }: { tipoInicial: TipoMovimentacao; aoFechar: () => void }) {
  const criar = useCriarMovimentacao();
  const contas = useContasFinanceiras();
  const [tipo, setTipo] = useState<TipoMovimentacao>(tipoInicial);
  const [data, setData] = useState(hojeIso());
  const [valor, setValor] = useState('');
  const [conta, setConta] = useState<string>(() => contas.data?.find((c) => c.ativo)?.id ?? '');
  const [forma, setForma] = useState<string>('pix');
  const [categoria, setCategoria] = useState<string>(NENHUM);
  const [descricao, setDescricao] = useState('');
  const [profissional, setProfissional] = useState<string>(NENHUM);
  const [paciente, setPaciente] = useState<PacienteSelecionado | null>(null);
  const [erros, setErros] = useState<Record<string, string>>({});

  const contaEfetiva = conta || contas.data?.find((c) => c.ativo)?.id || '';

  async function salvar() {
    const e: Record<string, string> = {};
    const v = lerValor(valor);
    if (!(v > 0)) e.valor = 'Informe um valor maior que zero.';
    if (!data) e.data = 'Informe a data.';
    else if (data > hojeIso()) e.data = 'A data não pode ser no futuro.';
    if (!contaEfetiva) e.conta = 'Escolha a conta.';
    setErros(e);
    if (Object.keys(e).length) return;
    try {
      await criar.mutateAsync({
        tipo,
        data,
        valor: v,
        conta_financeira_id: contaEfetiva,
        forma_pagamento: forma as FormaPagamento,
        categoria_id: idOuNull(categoria),
        descricao: descricao.trim() || null,
        profissional_id: idOuNull(profissional),
        paciente_id: paciente?.id ?? null,
      });
      toast.success(tipo === 'entrada' ? 'Entrada lançada.' : 'Saída lançada.');
      aoFechar();
    } catch (err) {
      if (err instanceof ErroApi && ['categoria_incompativel', 'data_futura', 'conta_inativa'].includes(err.codigo)) {
        setErros({ [err.codigo === 'categoria_incompativel' ? 'categoria' : err.codigo === 'data_futura' ? 'data' : 'conta']: err.mensagem });
        return;
      }
      toastErro(err);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && !criar.isPending && aoFechar()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{tipo === 'entrada' ? 'Nova entrada' : 'Nova saída'}</DialogTitle>
          <DialogDescription>Lançamento avulso no caixa. Recebimentos de consultas ficam na agenda.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            {(['entrada', 'saida'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  setTipo(t);
                  setCategoria(NENHUM);
                }}
                className={cn(
                  'flex items-center justify-center gap-2 rounded-lg border p-2.5 text-sm font-medium transition-colors hover:bg-accent',
                  tipo === t && (t === 'entrada' ? 'border-success bg-success/10 ring-1 ring-success' : 'border-destructive bg-destructive/5 ring-1 ring-destructive'),
                )}
                aria-pressed={tipo === t}
              >
                {t === 'entrada' ? <ArrowUpCircle className="size-4 text-success" /> : <ArrowDownCircle className="size-4 text-destructive" />}
                {t === 'entrada' ? 'Entrada' : 'Saída'}
              </button>
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo rotulo="Valor" htmlFor="mov-valor" erro={erros.valor}>
              <InputValor id="mov-valor" valor={valor} onChange={setValor} invalido={!!erros.valor} autoFocus />
            </Campo>
            <Campo rotulo="Data" htmlFor="mov-data" erro={erros.data}>
              <Input id="mov-data" type="date" value={data} max={hojeIso()} onChange={(e) => setData(e.target.value)} />
            </Campo>
            <Campo rotulo="Conta" erro={erros.conta}>
              <SelectConta valor={contaEfetiva} onChange={setConta} somenteAtivas invalido={!!erros.conta} />
            </Campo>
            <Campo rotulo="Forma de pagamento">
              <SelectForma valor={forma} onChange={setForma} />
            </Campo>
          </div>
          <Campo rotulo="Categoria" erro={erros.categoria}>
            <SelectCategoria
              valor={categoria}
              onChange={setCategoria}
              tipo={tipo === 'entrada' ? 'receita' : 'despesa'}
              vazio={{ valor: NENHUM, rotulo: 'Sem categoria' }}
            />
          </Campo>
          <Campo rotulo="Descrição" htmlFor="mov-desc">
            <Input
              id="mov-desc"
              value={descricao}
              maxLength={300}
              placeholder={tipo === 'entrada' ? 'Ex.: Venda de produto' : 'Ex.: Conta de luz'}
              onChange={(e) => setDescricao(e.target.value)}
            />
          </Campo>
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo rotulo="Profissional (opcional)" dica={tipo === 'entrada' ? 'Entradas vinculadas entram no repasse.' : undefined}>
              <SelectProfissional valor={profissional} onChange={setProfissional} vazio={{ valor: NENHUM, rotulo: 'Nenhum' }} />
            </Campo>
            <Campo rotulo="Paciente (opcional)">
              <BuscaPaciente valor={paciente} onChange={setPaciente} />
            </Campo>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={aoFechar} disabled={criar.isPending}>
            Cancelar
          </Button>
          <Button onClick={salvar} disabled={criar.isPending}>
            {criar.isPending && <Loader2 className="size-4 animate-spin" />}
            Lançar {tipo === 'entrada' ? 'entrada' : 'saída'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DialogoEstorno({ m, aoFechar }: { m: Movimentacao; aoFechar: () => void }) {
  const estornar = useEstornarMovimentacao();
  const [motivo, setMotivo] = useState('');
  async function confirmar() {
    try {
      await estornar.mutateAsync({ id: m.id, motivo: motivo.trim() || null });
      toast.success('Movimentação estornada.', {
        description: m.titulo ? 'O título voltou a ficar em aberto.' : undefined,
      });
      aoFechar();
    } catch (e) {
      toastErro(e);
    }
  }
  return (
    <Dialog open onOpenChange={(v) => !v && !estornar.isPending && aoFechar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Estornar movimentação</DialogTitle>
          <DialogDescription>
            Será lançada uma {m.tipo === 'entrada' ? 'saída' : 'entrada'} de mesmo valor, com a data de hoje. A movimentação
            original é mantida no histórico e as duas deixam de contar nos relatórios.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-lg border bg-muted/40 p-3 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate font-medium">{m.descricao || ROTULOS_ORIGEM_MOVIMENTACAO[m.origem]}</span>
            <ValorMovimento valor={m.valor} tipo={m.tipo} />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {formatarDataCurta(m.data)} · {m.conta.nome} · {ROTULOS_FORMA_PAGAMENTO[m.forma_pagamento]}
          </p>
          {m.titulo && (
            <p className="mt-2 text-xs">
              Esta movimentação é a baixa de um título: ele voltará a ficar <strong>em aberto</strong>.
            </p>
          )}
        </div>
        <Campo rotulo="Motivo (opcional)" htmlFor="estorno-motivo">
          <Textarea id="estorno-motivo" rows={2} maxLength={300} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        </Campo>
        <DialogFooter>
          <Button variant="outline" onClick={aoFechar} disabled={estornar.isPending}>
            Cancelar
          </Button>
          <Button variant="destructive" onClick={confirmar} disabled={estornar.isPending}>
            {estornar.isPending && <Loader2 className="size-4 animate-spin" />}
            Estornar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DialogoEditar({ m, aoFechar }: { m: Movimentacao; aoFechar: () => void }) {
  const editar = useEditarMovimentacao();
  const [descricao, setDescricao] = useState(m.descricao ?? '');
  const [categoria, setCategoria] = useState<string>(m.categoria_id ?? NENHUM);
  async function salvar() {
    try {
      await editar.mutateAsync({ id: m.id, descricao: descricao.trim() || null, categoria_id: idOuNull(categoria) });
      toast.success('Movimentação atualizada.');
      aoFechar();
    } catch (e) {
      toastErro(e);
    }
  }
  return (
    <Dialog open onOpenChange={(v) => !v && !editar.isPending && aoFechar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Editar movimentação</DialogTitle>
          <DialogDescription>
            Valor, data, conta e forma de pagamento não podem ser alterados — para corrigir, estorne e lance de novo.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Campo rotulo="Descrição" htmlFor="edit-desc">
            <Input id="edit-desc" value={descricao} maxLength={300} onChange={(e) => setDescricao(e.target.value)} />
          </Campo>
          <Campo rotulo="Categoria">
            <SelectCategoria
              valor={categoria}
              onChange={setCategoria}
              tipo={m.tipo === 'entrada' ? 'receita' : 'despesa'}
              vazio={{ valor: NENHUM, rotulo: 'Sem categoria' }}
            />
          </Campo>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={aoFechar} disabled={editar.isPending}>
            Cancelar
          </Button>
          <Button onClick={salvar} disabled={editar.isPending}>
            {editar.isPending && <Loader2 className="size-4 animate-spin" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
