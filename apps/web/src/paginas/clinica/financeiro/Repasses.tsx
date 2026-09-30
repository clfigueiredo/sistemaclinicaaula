// Aba "Repasses" de /financeiro. Admin: repasse de todos os profissionais no período, percentual editável,
// detalhe das entradas e pagamento (saída "Repasses a profissionais"). Profissional: só o próprio (a API força).
import { useState } from 'react';
import { toast } from 'sonner';
import { Coins, Download, HandCoins, ListChecks, Loader2, MoreHorizontal, Percent, Receipt, Users, Wallet } from 'lucide-react';
import { useMe } from '@/api/me';
import {
  exportarCsv,
  useDefinirPercentualRepasse,
  useEntradasRepasse,
  useMeusRecebimentos,
  usePagarRepasse,
  useRepasses,
  type EntradaRepasse,
  type LinhaRepasse,
  type Periodo,
} from '@/api/financeiro';
import { ROTULOS_FORMA_PAGAMENTO, type FormaPagamento } from '@/api/tipos';
import { Carregando, EstadoVazio } from '@/componentes/comum';
import { Button } from '@/componentes/ui/button';
import { Card } from '@/componentes/ui/card';
import { Input } from '@/componentes/ui/input';
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
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/componentes/ui/sheet';
import { formatarMoeda } from '@/lib/formatos';
import { cn } from '@/lib/utils';
import {
  Campo,
  CartaoKpi,
  ErroCarregamento,
  InputValor,
  SeletorPeriodo,
  SelectConta,
  SelectForma,
  formatarDataCurta,
  hojeIso,
  lerValor,
  mesDe,
  rotuloPeriodo,
  toastErro,
} from './comum';

export default function Repasses() {
  const { data: me } = useMe();
  const [periodo, setPeriodo] = useState<Periodo>(() => mesDe(hojeIso()));
  if (!me) return <Carregando />;
  return me.papel === 'profissional' ? (
    <MeusRepasses periodo={periodo} setPeriodo={setPeriodo} />
  ) : (
    <RepassesAdmin periodo={periodo} setPeriodo={setPeriodo} />
  );
}

type PropsPeriodo = { periodo: Periodo; setPeriodo: (p: Periodo) => void };

// ----------------------------------------------------------------------------- admin

function RepassesAdmin({ periodo, setPeriodo }: PropsPeriodo) {
  const lista = useRepasses(periodo);
  const [percentual, setPercentual] = useState<LinhaRepasse | null>(null);
  const [pagando, setPagando] = useState<LinhaRepasse | null>(null);
  const [detalhe, setDetalhe] = useState<LinhaRepasse | null>(null);
  const [exportando, setExportando] = useState(false);

  const linhas = lista.data ?? [];
  const soma = (k: 'total_entradas' | 'valor_repasse' | 'pago' | 'saldo') => linhas.reduce((s, l) => s + Number(l[k]), 0);
  const semPercentual = linhas.filter((l) => l.percentual === null && Number(l.total_entradas) > 0).length;

  async function exportar() {
    setExportando(true);
    try {
      await exportarCsv('repasses', periodo);
    } catch (e) {
      toastErro(e);
    } finally {
      setExportando(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SeletorPeriodo valor={periodo} onChange={setPeriodo} />
        <Button variant="outline" onClick={exportar} disabled={exportando || linhas.length === 0}>
          {exportando ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
          Exportar CSV
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <CartaoKpi
          titulo="Recebido (vinculado)"
          valor={formatarMoeda(soma('total_entradas'))}
          icone={<Receipt />}
          tom="primario"
          carregando={lista.isFetching}
          detalhe="Entradas com profissional, sem estornos"
        />
        <CartaoKpi titulo="Repasse do período" valor={formatarMoeda(soma('valor_repasse'))} icone={<Coins />} carregando={lista.isFetching} />
        <CartaoKpi titulo="Já pago" valor={formatarMoeda(soma('pago'))} icone={<HandCoins />} tom="positivo" carregando={lista.isFetching} />
        <CartaoKpi
          titulo="Saldo a pagar"
          valor={formatarMoeda(soma('saldo'))}
          icone={<Wallet />}
          tom={soma('saldo') > 0 ? 'alerta' : 'neutro'}
          carregando={lista.isFetching}
        />
      </div>

      {semPercentual > 0 && (
        <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          {semPercentual} profissional(is) com recebimentos no período ainda sem percentual de repasse definido.
        </p>
      )}

      {lista.isLoading ? (
        <Carregando />
      ) : lista.isError ? (
        <ErroCarregamento mensagem="Tente novamente em instantes." tentarNovamente={() => lista.refetch()} />
      ) : linhas.length === 0 ? (
        <EstadoVazio icone={<Users className="size-5" />} titulo="Nenhum profissional cadastrado" />
      ) : (
        <Card className="gap-0 py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Profissional</TableHead>
                <TableHead className="w-24">Percentual</TableHead>
                <TableHead className="text-right">Recebido</TableHead>
                <TableHead className="hidden text-right md:table-cell">Repasse</TableHead>
                <TableHead className="hidden text-right md:table-cell">Pago</TableHead>
                <TableHead className="text-right">Saldo</TableHead>
                <TableHead className="w-10 pr-4" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {linhas.map((l) => (
                <TableRow key={l.profissional.id} className={cn(!l.profissional.ativo && 'opacity-60')}>
                  <TableCell className="pl-4 font-medium">
                    {l.profissional.nome}
                    {!l.profissional.ativo && <span className="ml-1 text-xs font-normal text-muted-foreground">(inativo)</span>}
                  </TableCell>
                  <TableCell>
                    <button
                      type="button"
                      onClick={() => setPercentual(l)}
                      className="rounded px-1.5 py-0.5 text-sm tabular-nums hover:bg-accent"
                      title="Alterar percentual"
                    >
                      {l.percentual !== null ? `${Number(l.percentual).toLocaleString('pt-BR')}%` : <span className="text-muted-foreground">definir</span>}
                    </button>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatarMoeda(l.total_entradas)}
                    <p className="text-[11px] text-muted-foreground">{l.quantidade_entradas} lançamento(s)</p>
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums md:table-cell">{formatarMoeda(l.valor_repasse)}</TableCell>
                  <TableCell className="hidden text-right tabular-nums md:table-cell">{formatarMoeda(l.pago)}</TableCell>
                  <TableCell
                    className={cn(
                      'text-right font-semibold tabular-nums',
                      Number(l.saldo) > 0 && 'text-foreground',
                      Number(l.saldo) < 0 && 'text-destructive',
                      Number(l.saldo) === 0 && 'text-muted-foreground',
                    )}
                  >
                    {formatarMoeda(l.saldo)}
                  </TableCell>
                  <TableCell className="pr-4">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="size-8" aria-label="Ações">
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setPagando(l)}>
                          <HandCoins className="size-4" /> Registrar pagamento de repasse
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setDetalhe(l)}>
                          <ListChecks className="size-4" /> Ver recebimentos
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setPercentual(l)}>
                          <Percent className="size-4" /> Alterar percentual
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {percentual && <DialogoPercentual linha={percentual} aoFechar={() => setPercentual(null)} />}
      {pagando && <DialogoPagamento linha={pagando} periodo={periodo} aoFechar={() => setPagando(null)} />}
      <Sheet open={!!detalhe} onOpenChange={(v) => !v && setDetalhe(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          {detalhe && (
            <>
              <SheetHeader>
                <SheetTitle>{detalhe.profissional.nome}</SheetTitle>
                <SheetDescription>
                  Recebimentos vinculados · {rotuloPeriodo(periodo)}
                </SheetDescription>
              </SheetHeader>
              <div className="px-4 pb-6">
                <ListaEntradas profissionalId={detalhe.profissional.id} periodo={periodo} />
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function ListaEntradas({ profissionalId, periodo }: { profissionalId: string; periodo: Periodo }) {
  const q = useEntradasRepasse({ ...periodo, profissional_id: profissionalId });
  if (q.isLoading) return <Carregando />;
  if (q.isError) return <ErroCarregamento mensagem="Tente novamente." tentarNovamente={() => q.refetch()} />;
  return <TabelaEntradas itens={q.data ?? []} />;
}

function TabelaEntradas({ itens }: { itens: EntradaRepasse[] }) {
  if (itens.length === 0) {
    return <EstadoVazio icone={<Receipt className="size-5" />} titulo="Nenhum recebimento no período" />;
  }
  return (
    <div className="divide-y rounded-lg border">
      {itens.map((e) => (
        <div key={e.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{e.paciente?.nome ?? e.descricao ?? 'Entrada'}</p>
            <p className="truncate text-xs text-muted-foreground">
              {formatarDataCurta(e.data)} · {ROTULOS_FORMA_PAGAMENTO[e.forma_pagamento]}
              {e.categoria && ` · ${e.categoria.nome}`}
            </p>
          </div>
          <span className="shrink-0 font-medium text-success tabular-nums">{formatarMoeda(e.valor)}</span>
        </div>
      ))}
    </div>
  );
}

function DialogoPercentual({ linha, aoFechar }: { linha: LinhaRepasse; aoFechar: () => void }) {
  const definir = useDefinirPercentualRepasse();
  const [valor, setValor] = useState(linha.percentual !== null ? String(Number(linha.percentual)) : '');
  const [erro, setErro] = useState<string | null>(null);
  async function salvar(semRepasse = false) {
    let pct: number | null = null;
    if (!semRepasse) {
      pct = lerValor(valor);
      if (Number.isNaN(pct) || pct < 0 || pct > 100) return setErro('Informe um percentual entre 0 e 100.');
    }
    try {
      await definir.mutateAsync({ id: linha.profissional.id, percentual_repasse: pct });
      toast.success(pct === null ? 'Repasse removido.' : `Repasse de ${pct.toLocaleString('pt-BR')}% definido.`);
      aoFechar();
    } catch (e) {
      toastErro(e);
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && !definir.isPending && aoFechar()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Percentual de repasse</DialogTitle>
          <DialogDescription>
            {linha.profissional.nome}: percentual sobre as entradas vinculadas a ele(a). Vale para todos os períodos.
          </DialogDescription>
        </DialogHeader>
        <Campo rotulo="Percentual" htmlFor="pct" erro={erro}>
          <div className="relative">
            <Input
              id="pct"
              type="number"
              min={0}
              max={100}
              step="0.01"
              autoFocus
              className="pr-8 tabular-nums"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
            />
            <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-muted-foreground">%</span>
          </div>
        </Campo>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" onClick={() => salvar(true)} disabled={definir.isPending}>
            Sem repasse
          </Button>
          <Button onClick={() => salvar()} disabled={definir.isPending}>
            {definir.isPending && <Loader2 className="size-4 animate-spin" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DialogoPagamento({ linha, periodo, aoFechar }: { linha: LinhaRepasse; periodo: Periodo; aoFechar: () => void }) {
  const pagar = usePagarRepasse();
  const saldo = Number(linha.saldo);
  const [valor, setValor] = useState(saldo > 0 ? saldo.toFixed(2) : '');
  const [data, setData] = useState(hojeIso());
  const [conta, setConta] = useState('');
  const [forma, setForma] = useState<string>('pix');
  const [erros, setErros] = useState<Record<string, string>>({});
  const v = lerValor(valor);

  async function confirmar() {
    const e: Record<string, string> = {};
    if (!(v > 0)) e.valor = 'Informe um valor maior que zero.';
    if (!data || data > hojeIso()) e.data = 'Informe uma data até hoje.';
    if (!conta) e.conta = 'Escolha a conta de onde sai o pagamento.';
    setErros(e);
    if (Object.keys(e).length) return;
    try {
      await pagar.mutateAsync({
        profissional_id: linha.profissional.id,
        ...periodo,
        valor: v,
        data,
        conta_financeira_id: conta,
        forma_pagamento: forma as FormaPagamento,
      });
      toast.success('Pagamento de repasse registrado.', { description: `${formatarMoeda(v)} lançado como saída no caixa.` });
      aoFechar();
    } catch (err) {
      toastErro(err);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !pagar.isPending && aoFechar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Pagamento de repasse</DialogTitle>
          <DialogDescription>
            {linha.profissional.nome} · referente a {rotuloPeriodo(periodo)}. Gera uma saída na categoria "Repasses a
            profissionais".
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-3 gap-2 rounded-lg border bg-muted/40 p-3 text-center text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Repasse</p>
            <p className="font-medium tabular-nums">{formatarMoeda(linha.valor_repasse)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Pago</p>
            <p className="font-medium tabular-nums">{formatarMoeda(linha.pago)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Saldo</p>
            <p className="font-semibold tabular-nums">{formatarMoeda(linha.saldo)}</p>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo
            rotulo="Valor"
            htmlFor="rep-valor"
            erro={erros.valor}
            dica={v > saldo ? <span>Acima do saldo (fica como adiantamento).</span> : undefined}
          >
            <InputValor id="rep-valor" valor={valor} onChange={setValor} autoFocus />
          </Campo>
          <Campo rotulo="Data" htmlFor="rep-data" erro={erros.data}>
            <Input id="rep-data" type="date" value={data} max={hojeIso()} onChange={(e) => setData(e.target.value)} />
          </Campo>
          <Campo rotulo="Conta" erro={erros.conta}>
            <SelectConta valor={conta} onChange={setConta} somenteAtivas invalido={!!erros.conta} />
          </Campo>
          <Campo rotulo="Forma de pagamento">
            <SelectForma valor={forma} onChange={setForma} />
          </Campo>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={aoFechar} disabled={pagar.isPending}>
            Cancelar
          </Button>
          <Button onClick={confirmar} disabled={pagar.isPending}>
            {pagar.isPending && <Loader2 className="size-4 animate-spin" />}
            Registrar pagamento
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ----------------------------------------------------------------------------- profissional

function MeusRepasses({ periodo, setPeriodo }: PropsPeriodo) {
  const q = useMeusRecebimentos(periodo);
  const d = q.data;
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SeletorPeriodo valor={periodo} onChange={setPeriodo} />
        {d && (
          <p className="text-sm text-muted-foreground">
            Seu percentual de repasse:{' '}
            <strong className="text-foreground">{d.percentual !== null ? `${Number(d.percentual).toLocaleString('pt-BR')}%` : 'não definido'}</strong>
          </p>
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <CartaoKpi titulo="Recebido pela clínica" valor={formatarMoeda(d?.total_entradas ?? 0)} icone={<Receipt />} tom="primario" carregando={q.isFetching} />
        <CartaoKpi titulo="Seu repasse" valor={formatarMoeda(d?.valor_repasse ?? 0)} icone={<Coins />} carregando={q.isFetching} />
        <CartaoKpi titulo="Já pago a você" valor={formatarMoeda(d?.pago ?? 0)} icone={<HandCoins />} tom="positivo" carregando={q.isFetching} />
        <CartaoKpi titulo="A receber" valor={formatarMoeda(d?.saldo ?? 0)} icone={<Wallet />} tom="alerta" carregando={q.isFetching} />
      </div>
      {q.isLoading ? (
        <Carregando />
      ) : q.isError ? (
        <ErroCarregamento mensagem="Tente novamente em instantes." tentarNovamente={() => q.refetch()} />
      ) : (
        <div className="space-y-2">
          <h2 className="text-sm font-medium">Recebimentos das suas consultas</h2>
          <TabelaEntradas itens={d?.itens ?? []} />
        </div>
      )}
    </div>
  );
}
