// Contas a pagar / a receber (títulos). Usado por ContasPagar.tsx e ContasReceber.tsx.
// Admin cria/edita/cancela; admin e recepção dão baixa (o backend garante). "Vencido" é derivado pela API.
import { useState } from 'react';
import { toast } from 'sonner';
import {
  AlertTriangle,
  CalendarCheck,
  CalendarClock,
  CalendarX,
  CheckCircle2,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Repeat,
  Search,
  XCircle,
} from 'lucide-react';
import { ErroApi } from '@/api/cliente';
import { useMe } from '@/api/me';
import {
  useBaixarTitulo,
  useCancelarTitulo,
  useContasFinanceiras,
  useCriarTitulo,
  useEditarTitulo,
  useTitulos,
  type FiltroStatusTitulo,
  type Periodo,
  type Titulo,
} from '@/api/financeiro';
import type { FormaPagamento, TipoTitulo } from '@/api/tipos';
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/componentes/ui/dropdown-menu';
import { formatarMoeda } from '@/lib/formatos';
import { cn } from '@/lib/utils';
import { BuscaPaciente, type PacienteSelecionado } from '../agenda/BuscaPaciente';
import {
  BadgeStatusTitulo,
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
  formatarDataCurta,
  hojeIso,
  idOuNull,
  lerValor,
  mesDe,
  toastErro,
  useConfirmacao,
} from './comum';

const POR_PAGINA = 20;

const TEXTOS: Record<TipoTitulo, { novo: string; vazio: string; pago: string; pagos: string; baixar: string; contraparte: string }> = {
  pagar: {
    novo: 'Nova conta a pagar',
    vazio: 'Cadastre despesas como aluguel, fornecedores e impostos para não perder vencimentos.',
    pago: 'Pago',
    pagos: 'Pagos no período',
    baixar: 'Registrar pagamento',
    contraparte: 'Fornecedor / credor',
  },
  receber: {
    novo: 'Nova conta a receber',
    vazio: 'Cadastre valores a receber de pacientes, convênios e pacotes parcelados.',
    pago: 'Recebido',
    pagos: 'Recebidos no período',
    baixar: 'Registrar recebimento',
    contraparte: 'Devedor (convênio, empresa…)',
  },
};

const ABAS_STATUS: { valor: FiltroStatusTitulo | 'todos'; rotulo: string }[] = [
  { valor: 'aberto', rotulo: 'Em aberto' },
  { valor: 'vencido', rotulo: 'Vencidos' },
  { valor: 'a_vencer', rotulo: 'A vencer' },
  { valor: 'pago', rotulo: 'Pagos' },
  { valor: 'cancelado', rotulo: 'Cancelados' },
  { valor: 'todos', rotulo: 'Todos' },
];

export function Titulos({ tipo }: { tipo: TipoTitulo }) {
  const { data: me } = useMe();
  const ehAdmin = me?.papel === 'admin';
  const t = TEXTOS[tipo];
  const [periodo, setPeriodo] = useState<Periodo | null>(null);
  const [status, setStatus] = useState<FiltroStatusTitulo | 'todos'>('aberto');
  const [busca, setBusca] = useState('');
  const [pagina, setPagina] = useState(1);
  const [criando, setCriando] = useState(false);
  const [editando, setEditando] = useState<Titulo | null>(null);
  const [baixando, setBaixando] = useState<Titulo | null>(null);
  const cancelar = useCancelarTitulo();
  const { confirmar, dialogo } = useConfirmacao();

  const lista = useTitulos({
    tipo,
    ...(periodo ?? {}),
    status: status === 'todos' ? undefined : status,
    busca: busca.trim() || undefined,
    pagina,
    por_pagina: POR_PAGINA,
  });
  const totais = lista.data?.totais;

  function pedirCancelamento(titulo: Titulo) {
    confirmar({
      titulo: 'Cancelar título?',
      descricao: `"${titulo.descricao}" (${formatarMoeda(titulo.valor)}) deixará de aparecer como pendente. Esta ação não pode ser desfeita.`,
      rotuloConfirmar: 'Cancelar título',
      destrutivo: true,
      acao: async () => {
        try {
          await cancelar.mutateAsync(titulo.id);
          toast.success('Título cancelado.');
        } catch (e) {
          toastErro(e);
          throw e;
        }
      },
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {periodo ? (
            <>
              <SeletorPeriodo valor={periodo} onChange={(p) => { setPeriodo(p); setPagina(1); }} />
              <Button variant="ghost" size="sm" onClick={() => { setPeriodo(null); setPagina(1); }}>
                Qualquer vencimento
              </Button>
            </>
          ) : (
            <Button variant="outline" onClick={() => { setPeriodo(mesDe(hojeIso())); setPagina(1); }}>
              <CalendarClock className="size-4" />
              Filtrar por mês de vencimento
            </Button>
          )}
        </div>
        {ehAdmin && (
          <Button onClick={() => setCriando(true)}>
            <Plus className="size-4" />
            {t.novo}
          </Button>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <CartaoKpi
          titulo="A vencer"
          valor={formatarMoeda(totais?.a_vencer.valor ?? 0)}
          icone={<CalendarClock />}
          tom="primario"
          carregando={lista.isFetching}
          detalhe={`${totais?.a_vencer.quantidade ?? 0} título(s)${periodo ? ' no período' : ''}`}
        />
        <CartaoKpi
          titulo="Vencidos"
          valor={<span className={cn(Number(totais?.vencidos.valor ?? 0) > 0 && 'text-destructive')}>{formatarMoeda(totais?.vencidos.valor ?? 0)}</span>}
          icone={<CalendarX />}
          tom={Number(totais?.vencidos.valor ?? 0) > 0 ? 'negativo' : 'neutro'}
          carregando={lista.isFetching}
          detalhe={`${totais?.vencidos.quantidade ?? 0} título(s) em atraso`}
        />
        <CartaoKpi
          titulo={t.pagos}
          valor={formatarMoeda(totais?.pagos_periodo.valor ?? 0)}
          icone={<CalendarCheck />}
          tom="positivo"
          carregando={lista.isFetching}
          detalhe={periodo ? `${totais?.pagos_periodo.quantidade ?? 0} baixa(s)` : `${totais?.pagos_periodo.quantidade ?? 0} baixa(s) neste mês`}
        />
      </div>

      <Card className="gap-0 py-0">
        <div className="flex flex-col gap-3 border-b p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex gap-1 overflow-x-auto">
            {ABAS_STATUS.map((a) => (
              <button
                key={a.valor}
                type="button"
                onClick={() => {
                  setStatus(a.valor);
                  setPagina(1);
                }}
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors',
                  status === a.valor ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                {a.valor === 'pago' ? (tipo === 'pagar' ? 'Pagos' : 'Recebidos') : a.rotulo}
                {a.valor === 'vencido' && (totais?.vencidos.quantidade ?? 0) > 0 && (
                  <span className="ml-1.5 rounded-full bg-destructive px-1.5 text-[11px] text-white">{totais!.vencidos.quantidade}</span>
                )}
              </button>
            ))}
          </div>
          <div className="relative lg:w-72">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar descrição, fornecedor ou paciente"
              className="pl-8"
              value={busca}
              onChange={(e) => {
                setBusca(e.target.value);
                setPagina(1);
              }}
            />
          </div>
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
              icone={<CalendarClock className="size-5" />}
              titulo="Nenhum título encontrado"
              descricao={status === 'aberto' && !busca && !periodo ? t.vazio : 'Ajuste os filtros para ver outros títulos.'}
              acao={
                ehAdmin && status === 'aberto' && !busca ? (
                  <Button size="sm" onClick={() => setCriando(true)}>
                    <Plus className="size-4" /> {t.novo}
                  </Button>
                ) : undefined
              }
            />
          </div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-28 pl-4">Vencimento</TableHead>
                  <TableHead>Descrição</TableHead>
                  <TableHead className="hidden md:table-cell">Categoria</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead className="w-28">Situação</TableHead>
                  <TableHead className="w-10 pr-4" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {lista.data.itens.map((titulo) => {
                  const contraparte = titulo.paciente?.nome ?? titulo.fornecedor ?? titulo.profissional?.nome;
                  const aberto = titulo.status === 'aberto';
                  return (
                    <TableRow key={titulo.id} className={cn(titulo.status === 'cancelado' && 'opacity-60')}>
                      <TableCell
                        className={cn(
                          'pl-4 text-sm tabular-nums',
                          titulo.status_exibicao === 'vencido' && 'font-medium text-destructive',
                        )}
                      >
                        {formatarDataCurta(titulo.vencimento)}
                      </TableCell>
                      <TableCell className="max-w-80">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate font-medium">{titulo.descricao}</span>
                          {titulo.parcela_total && (
                            <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground tabular-nums">
                              {titulo.parcela_numero}/{titulo.parcela_total}
                            </span>
                          )}
                          {titulo.recorrencia_id && (
                            <Repeat className="size-3.5 shrink-0 text-muted-foreground" aria-label="Recorrente" />
                          )}
                        </div>
                        {contraparte && <p className="truncate text-xs text-muted-foreground">{contraparte}</p>}
                      </TableCell>
                      <TableCell className="hidden text-sm md:table-cell">
                        {titulo.categoria?.nome ?? <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="font-medium tabular-nums">{formatarMoeda(titulo.valor)}</span>
                        {titulo.status === 'pago' && titulo.valor_pago && titulo.valor_pago !== titulo.valor && (
                          <p className="text-xs text-muted-foreground tabular-nums">
                            {t.pago}: {formatarMoeda(titulo.valor_pago)}
                          </p>
                        )}
                      </TableCell>
                      <TableCell>
                        <BadgeStatusTitulo status={titulo.status_exibicao} />
                        {titulo.status === 'pago' && titulo.pago_em && (
                          <p className="mt-0.5 text-[11px] text-muted-foreground">
                            em {formatarDataCurta(titulo.pago_em.slice(0, 10))}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="pr-4">
                        {aberto && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="size-8" aria-label="Ações">
                                <MoreHorizontal className="size-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => setBaixando(titulo)}>
                                <CheckCircle2 className="size-4" /> {t.baixar}
                              </DropdownMenuItem>
                              {ehAdmin && (
                                <>
                                  <DropdownMenuItem onClick={() => setEditando(titulo)}>
                                    <Pencil className="size-4" /> Editar
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    onClick={() => pedirCancelamento(titulo)}
                                    className="text-destructive focus:text-destructive"
                                  >
                                    <XCircle className="size-4" /> Cancelar título
                                  </DropdownMenuItem>
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <Paginacao pagina={pagina} porPagina={POR_PAGINA} total={lista.data.total} onChange={setPagina} />
          </>
        )}
      </Card>

      {criando && <DialogoTitulo tipo={tipo} aoFechar={() => setCriando(false)} />}
      {editando && <DialogoTitulo tipo={tipo} titulo={editando} aoFechar={() => setEditando(null)} />}
      {baixando && <DialogoBaixa titulo={baixando} aoFechar={() => setBaixando(null)} />}
      {dialogo}
    </div>
  );
}

// ----------------------------------------------------------------------------- criar/editar

const CAMPO_ERRO_API: Record<string, string> = {
  'body.descricao': 'descricao',
  'body.valor': 'valor',
  'body.vencimento': 'vencimento',
  'body.parcelas': 'parcelas',
};

function DialogoTitulo({ tipo, titulo, aoFechar }: { tipo: TipoTitulo; titulo?: Titulo; aoFechar: () => void }) {
  const criar = useCriarTitulo();
  const editar = useEditarTitulo();
  const salvando = criar.isPending || editar.isPending;
  const t = TEXTOS[tipo];
  const [descricao, setDescricao] = useState(titulo?.descricao ?? '');
  const [valor, setValor] = useState(titulo ? String(Number(titulo.valor)) : '');
  const [vencimento, setVencimento] = useState(titulo?.vencimento ?? hojeIso());
  const [parcelas, setParcelas] = useState('1');
  const [categoria, setCategoria] = useState<string>(titulo?.categoria_id ?? NENHUM);
  const [fornecedor, setFornecedor] = useState(titulo?.fornecedor ?? '');
  const [paciente, setPaciente] = useState<PacienteSelecionado | null>(titulo?.paciente ?? null);
  const [profissional, setProfissional] = useState<string>(titulo?.profissional_id ?? NENHUM);
  const [forma, setForma] = useState<string>(titulo?.forma_pagamento ?? NENHUM);
  const [observacoes, setObservacoes] = useState(titulo?.observacoes ?? '');
  const [erros, setErros] = useState<Record<string, string>>({});

  const n = Number(parcelas) || 1;
  const v = lerValor(valor);
  const previa = n > 1 && v > 0 ? dividir(v, n) : null;

  async function salvar() {
    const e: Record<string, string> = {};
    if (descricao.trim().length < 2) e.descricao = 'Informe a descrição.';
    if (!(v > 0)) e.valor = 'Informe um valor maior que zero.';
    if (!vencimento) e.vencimento = 'Informe o vencimento.';
    if (!titulo && (!Number.isInteger(n) || n < 1 || n > 48)) e.parcelas = 'Entre 1 e 48 parcelas.';
    setErros(e);
    if (Object.keys(e).length) return;
    const dados = {
      descricao: descricao.trim(),
      valor: v,
      vencimento,
      categoria_id: idOuNull(categoria),
      paciente_id: paciente?.id ?? null,
      profissional_id: idOuNull(profissional),
      fornecedor: fornecedor.trim() || null,
      forma_pagamento: idOuNull(forma) as FormaPagamento | null,
      observacoes: observacoes.trim() || null,
    };
    try {
      if (titulo) {
        await editar.mutateAsync({ id: titulo.id, ...dados });
        toast.success('Título atualizado.');
      } else {
        const criados = await criar.mutateAsync({ tipo, ...dados, parcelas: n });
        toast.success(criados.length > 1 ? `${criados.length} parcelas criadas.` : 'Título criado.');
      }
      aoFechar();
    } catch (err) {
      if (err instanceof ErroApi) {
        const mapa: Record<string, string> = {};
        for (const d of err.detalhes) if (CAMPO_ERRO_API[d.campo]) mapa[CAMPO_ERRO_API[d.campo]!] = d.mensagem;
        if (err.codigo === 'categoria_incompativel') mapa.categoria = err.mensagem;
        if (Object.keys(mapa).length) return setErros(mapa);
      }
      toastErro(err);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !salvando && aoFechar()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{titulo ? 'Editar título' : t.novo}</DialogTitle>
          <DialogDescription>
            {titulo?.parcela_total
              ? `Parcela ${titulo.parcela_numero} de ${titulo.parcela_total}. As demais parcelas não são alteradas.`
              : tipo === 'pagar'
                ? 'Despesa com vencimento. Ao pagar, registre a baixa para lançar a saída no caixa.'
                : 'Valor a receber. Ao receber, registre a baixa para lançar a entrada no caixa.'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Campo rotulo="Descrição" htmlFor="tit-desc" erro={erros.descricao}>
            <Input
              id="tit-desc"
              autoFocus
              value={descricao}
              maxLength={200}
              placeholder={tipo === 'pagar' ? 'Ex.: Aluguel da sala' : 'Ex.: Pacote de 10 sessões'}
              onChange={(e) => setDescricao(e.target.value)}
            />
          </Campo>
          <div className="grid gap-4 sm:grid-cols-3">
            <Campo rotulo={n > 1 ? 'Valor total' : 'Valor'} htmlFor="tit-valor" erro={erros.valor} className="sm:col-span-1">
              <InputValor id="tit-valor" valor={valor} onChange={setValor} invalido={!!erros.valor} />
            </Campo>
            <Campo rotulo={n > 1 ? '1º vencimento' : 'Vencimento'} htmlFor="tit-venc" erro={erros.vencimento}>
              <Input id="tit-venc" type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)} />
            </Campo>
            {!titulo && (
              <Campo rotulo="Parcelas" htmlFor="tit-parc" erro={erros.parcelas}>
                <Input
                  id="tit-parc"
                  type="number"
                  min={1}
                  max={48}
                  value={parcelas}
                  onChange={(e) => setParcelas(e.target.value)}
                />
              </Campo>
            )}
          </div>
          {previa && (
            <p className="rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
              {n} parcelas mensais de <strong className="text-foreground">{formatarMoeda(previa[0]!)}</strong>
              {previa[n - 1] !== previa[0] && (
                <>
                  {' '}(última de <strong className="text-foreground">{formatarMoeda(previa[n - 1]!)}</strong>)
                </>
              )}
              .
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo rotulo="Categoria" erro={erros.categoria}>
              <SelectCategoria
                valor={categoria}
                onChange={setCategoria}
                tipo={tipo === 'pagar' ? 'despesa' : 'receita'}
                vazio={{ valor: NENHUM, rotulo: 'Sem categoria' }}
              />
            </Campo>
            <Campo rotulo="Forma prevista">
              <SelectForma valor={forma} onChange={setForma} vazio={{ valor: NENHUM, rotulo: 'Não definida' }} />
            </Campo>
          </div>
          <Campo rotulo={t.contraparte} htmlFor="tit-forn">
            <Input id="tit-forn" value={fornecedor} maxLength={150} onChange={(e) => setFornecedor(e.target.value)} />
          </Campo>
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo rotulo="Paciente (opcional)">
              <BuscaPaciente valor={paciente} onChange={setPaciente} />
            </Campo>
            <Campo rotulo="Profissional (opcional)">
              <SelectProfissional valor={profissional} onChange={setProfissional} vazio={{ valor: NENHUM, rotulo: 'Nenhum' }} />
            </Campo>
          </div>
          <Campo rotulo="Observações" htmlFor="tit-obs">
            <Textarea id="tit-obs" rows={2} maxLength={1000} value={observacoes} onChange={(e) => setObservacoes(e.target.value)} />
          </Campo>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={aoFechar} disabled={salvando}>
            Cancelar
          </Button>
          <Button onClick={salvar} disabled={salvando}>
            {salvando && <Loader2 className="size-4 animate-spin" />}
            {titulo ? 'Salvar' : n > 1 ? `Criar ${n} parcelas` : 'Criar título'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Mesma regra da API: base arredondada para baixo, centavos restantes na última. */
function dividir(total: number, n: number): number[] {
  const centavos = Math.round(total * 100);
  const base = Math.floor(centavos / n);
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? centavos - base * (n - 1) : base) / 100);
}

// ----------------------------------------------------------------------------- baixa

export function DialogoBaixa({ titulo, aoFechar }: { titulo: Titulo; aoFechar: () => void }) {
  const baixar = useBaixarTitulo();
  const contas = useContasFinanceiras();
  const t = TEXTOS[titulo.tipo];
  const [data, setData] = useState(hojeIso());
  const [conta, setConta] = useState('');
  const [forma, setForma] = useState<string>(titulo.forma_pagamento ?? 'pix');
  const [juros, setJuros] = useState('');
  const [desconto, setDesconto] = useState('');
  const [erros, setErros] = useState<Record<string, string>>({});

  const contaEfetiva = conta || contas.data?.find((c) => c.ativo)?.id || '';
  const j = juros ? lerValor(juros) : 0;
  const d = desconto ? lerValor(desconto) : 0;
  const total = Math.round((Number(titulo.valor) + (j || 0) - (d || 0)) * 100) / 100;

  async function confirmar() {
    const e: Record<string, string> = {};
    if (!data) e.data = 'Informe a data.';
    else if (data > hojeIso()) e.data = 'A data não pode ser no futuro.';
    if (!contaEfetiva) e.conta = 'Escolha a conta.';
    if (Number.isNaN(j) || j < 0) e.juros = 'Valor inválido.';
    if (Number.isNaN(d) || d < 0) e.desconto = 'Valor inválido.';
    if (!(total > 0)) e.desconto = 'O total deve ser maior que zero.';
    setErros(e);
    if (Object.keys(e).length) return;
    try {
      await baixar.mutateAsync({
        id: titulo.id,
        data,
        conta_financeira_id: contaEfetiva,
        forma_pagamento: forma as FormaPagamento,
        juros: j || 0,
        desconto: d || 0,
      });
      toast.success(titulo.tipo === 'pagar' ? 'Pagamento registrado.' : 'Recebimento registrado.', {
        description: `${formatarMoeda(total)} lançado no caixa.`,
      });
      aoFechar();
    } catch (err) {
      toastErro(err);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !baixar.isPending && aoFechar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t.baixar}</DialogTitle>
          <DialogDescription>
            Dá baixa no título e lança {titulo.tipo === 'pagar' ? 'a saída' : 'a entrada'} no caixa.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-lg border bg-muted/40 p-3 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate font-medium">
              {titulo.descricao}
              {titulo.parcela_total && ` (${titulo.parcela_numero}/${titulo.parcela_total})`}
            </span>
            <span className="font-semibold tabular-nums">{formatarMoeda(titulo.valor)}</span>
          </div>
          <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
            Vencimento {formatarDataCurta(titulo.vencimento)}
            {titulo.status_exibicao === 'vencido' && (
              <span className="inline-flex items-center gap-1 text-destructive">
                <AlertTriangle className="size-3" /> vencido
              </span>
            )}
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo rotulo="Data" htmlFor="baixa-data" erro={erros.data}>
            <Input id="baixa-data" type="date" value={data} max={hojeIso()} onChange={(e) => setData(e.target.value)} />
          </Campo>
          <Campo rotulo="Forma de pagamento">
            <SelectForma valor={forma} onChange={setForma} />
          </Campo>
          <Campo rotulo="Conta" erro={erros.conta} className="sm:col-span-2">
            <SelectConta valor={contaEfetiva} onChange={setConta} somenteAtivas />
          </Campo>
          <Campo rotulo="Juros / multa" htmlFor="baixa-juros" erro={erros.juros}>
            <InputValor id="baixa-juros" valor={juros} onChange={setJuros} />
          </Campo>
          <Campo rotulo="Desconto" htmlFor="baixa-desc" erro={erros.desconto}>
            <InputValor id="baixa-desc" valor={desconto} onChange={setDesconto} />
          </Campo>
        </div>
        <div className="flex items-center justify-between rounded-lg border px-3 py-2">
          <span className="text-sm text-muted-foreground">Total {titulo.tipo === 'pagar' ? 'pago' : 'recebido'}</span>
          <span className="text-lg font-semibold tabular-nums">{formatarMoeda(total > 0 ? total : 0)}</span>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={aoFechar} disabled={baixar.isPending}>
            Cancelar
          </Button>
          <Button onClick={confirmar} disabled={baixar.isPending}>
            {baixar.isPending && <Loader2 className="size-4 animate-spin" />}
            Confirmar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

