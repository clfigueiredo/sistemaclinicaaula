// Aba "Recorrências" de /financeiro (admin): modelos mensais (aluguel, mensalidades) que geram títulos.
// Ao criar, gera o título do mês corrente (se o vencimento não passou) e do próximo; um job diário
// mantém o do próximo mês. Encerrar não apaga títulos já gerados.
import { useState } from 'react';
import { toast } from 'sonner';
import { ArrowDownCircle, ArrowUpCircle, Loader2, MoreHorizontal, Pencil, Play, Plus, Power, Repeat } from 'lucide-react';
import { ErroApi } from '@/api/cliente';
import { useRecorrencias, useSalvarRecorrencia, type Recorrencia } from '@/api/financeiro';
import type { FormaPagamento, TipoTitulo } from '@/api/tipos';
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
import { formatarMoeda } from '@/lib/formatos';
import { cn } from '@/lib/utils';
import { BuscaPaciente, type PacienteSelecionado } from '../agenda/BuscaPaciente';
import {
  Campo,
  CartaoKpi,
  ErroCarregamento,
  InputValor,
  NENHUM,
  SelectCategoria,
  SelectForma,
  SelectProfissional,
  formatarDataCurta,
  hojeIso,
  idOuNull,
  lerValor,
  toastErro,
  useConfirmacao,
} from './comum';

export default function Recorrencias() {
  const lista = useRecorrencias();
  const salvar = useSalvarRecorrencia();
  const { confirmar, dialogo } = useConfirmacao();
  const [editando, setEditando] = useState<Recorrencia | 'nova' | null>(null);
  const [mostrarEncerradas, setMostrarEncerradas] = useState(false);

  const ativas = (lista.data ?? []).filter((r) => r.ativo);
  const receitaMensal = ativas.filter((r) => r.tipo === 'receber').reduce((s, r) => s + Number(r.valor), 0);
  const despesaMensal = ativas.filter((r) => r.tipo === 'pagar').reduce((s, r) => s + Number(r.valor), 0);
  const visiveis = (lista.data ?? []).filter((r) => mostrarEncerradas || r.ativo);
  const encerradas = (lista.data ?? []).length - ativas.length;

  function alternar(r: Recorrencia) {
    if (r.ativo) {
      confirmar({
        titulo: 'Encerrar recorrência?',
        descricao: `"${r.descricao}" deixa de gerar títulos. Os ${r.titulos_gerados} título(s) já gerados continuam (os em aberto podem ser cancelados em Contas a ${r.tipo === 'pagar' ? 'pagar' : 'receber'}).`,
        rotuloConfirmar: 'Encerrar',
        destrutivo: true,
        acao: async () => {
          try {
            await salvar.mutateAsync({ id: r.id, ativo: false });
            toast.success('Recorrência encerrada.');
          } catch (e) {
            toastErro(e);
            throw e;
          }
        },
      });
    } else {
      salvar
        .mutateAsync({ id: r.id, ativo: true })
        .then(() => toast.success('Recorrência reativada.', { description: 'Os títulos do mês corrente/próximo foram gerados.' }))
        .catch(toastErro);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Cadastre receitas e despesas que se repetem todo mês. O sistema gera automaticamente o título do próximo mês em
          Contas a pagar/receber.
        </p>
        <Button onClick={() => setEditando('nova')}>
          <Plus className="size-4" />
          Nova recorrência
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <CartaoKpi titulo="Recorrências ativas" valor={ativas.length} icone={<Repeat />} tom="primario" carregando={lista.isLoading} />
        <CartaoKpi
          titulo="Receita mensal prevista"
          valor={formatarMoeda(receitaMensal)}
          icone={<ArrowUpCircle />}
          tom="positivo"
          carregando={lista.isLoading}
        />
        <CartaoKpi
          titulo="Despesa mensal prevista"
          valor={formatarMoeda(despesaMensal)}
          icone={<ArrowDownCircle />}
          tom="negativo"
          carregando={lista.isLoading}
        />
      </div>

      {lista.isLoading ? (
        <Carregando />
      ) : lista.isError ? (
        <ErroCarregamento mensagem="Tente novamente em instantes." tentarNovamente={() => lista.refetch()} />
      ) : (lista.data ?? []).length === 0 ? (
        <EstadoVazio
          icone={<Repeat className="size-5" />}
          titulo="Nenhuma recorrência cadastrada"
          descricao="Ex.: aluguel todo dia 5, mensalidade de um paciente, assinatura de software."
          acao={
            <Button size="sm" onClick={() => setEditando('nova')}>
              <Plus className="size-4" /> Nova recorrência
            </Button>
          }
        />
      ) : (
        <Card className="gap-0 py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Descrição</TableHead>
                <TableHead className="hidden md:table-cell">Vencimento</TableHead>
                <TableHead className="hidden lg:table-cell">Vigência</TableHead>
                <TableHead className="hidden sm:table-cell">Títulos</TableHead>
                <TableHead className="text-right">Valor mensal</TableHead>
                <TableHead className="w-10 pr-4" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {visiveis.map((r) => (
                <TableRow key={r.id} className={cn(!r.ativo && 'opacity-60')}>
                  <TableCell className="max-w-80 pl-4">
                    <div className="flex items-center gap-2">
                      {r.tipo === 'receber' ? (
                        <ArrowUpCircle className="size-4 shrink-0 text-success" aria-label="A receber" />
                      ) : (
                        <ArrowDownCircle className="size-4 shrink-0 text-destructive" aria-label="A pagar" />
                      )}
                      <span className="truncate font-medium">{r.descricao}</span>
                      {!r.ativo && <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">Encerrada</span>}
                    </div>
                    <p className="truncate pl-6 text-xs text-muted-foreground">
                      {[r.categoria?.nome, r.paciente?.nome ?? r.fornecedor, r.profissional?.nome].filter(Boolean).join(' · ') || '—'}
                    </p>
                  </TableCell>
                  <TableCell className="hidden text-sm md:table-cell">Todo dia {r.dia_vencimento}</TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">
                    {formatarDataCurta(r.inicio)} {r.fim ? `até ${formatarDataCurta(r.fim)}` : '· sem fim'}
                  </TableCell>
                  <TableCell className="hidden text-sm sm:table-cell">
                    {r.titulos_gerados} gerado(s)
                    {r.titulos_abertos > 0 && <span className="text-muted-foreground"> · {r.titulos_abertos} em aberto</span>}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{formatarMoeda(r.valor)}</TableCell>
                  <TableCell className="pr-4">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="size-8" aria-label="Ações">
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setEditando(r)}>
                          <Pencil className="size-4" /> Editar
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => alternar(r)}
                          className={r.ativo ? 'text-destructive focus:text-destructive' : undefined}
                        >
                          {r.ativo ? <Power className="size-4" /> : <Play className="size-4" />}
                          {r.ativo ? 'Encerrar' : 'Reativar'}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {encerradas > 0 && (
            <div className="border-t px-4 py-2">
              <Button variant="link" size="sm" className="px-0" onClick={() => setMostrarEncerradas((v) => !v)}>
                {mostrarEncerradas ? 'Ocultar encerradas' : `Mostrar ${encerradas} encerrada(s)`}
              </Button>
            </div>
          )}
        </Card>
      )}

      {editando && (
        <DialogoRecorrencia recorrencia={editando === 'nova' ? undefined : editando} aoFechar={() => setEditando(null)} />
      )}
      {dialogo}
    </div>
  );
}

function DialogoRecorrencia({ recorrencia: r, aoFechar }: { recorrencia?: Recorrencia; aoFechar: () => void }) {
  const salvar = useSalvarRecorrencia();
  const [tipo, setTipo] = useState<TipoTitulo>(r?.tipo ?? 'pagar');
  const [descricao, setDescricao] = useState(r?.descricao ?? '');
  const [valor, setValor] = useState(r ? String(Number(r.valor)) : '');
  const [dia, setDia] = useState(String(r?.dia_vencimento ?? 10));
  const [inicio, setInicio] = useState(r?.inicio ?? hojeIso());
  const [fim, setFim] = useState(r?.fim ?? '');
  const [categoria, setCategoria] = useState<string>(r?.categoria_id ?? NENHUM);
  const [fornecedor, setFornecedor] = useState(r?.fornecedor ?? '');
  const [paciente, setPaciente] = useState<PacienteSelecionado | null>(r?.paciente ?? null);
  const [profissional, setProfissional] = useState<string>(r?.profissional_id ?? NENHUM);
  const [forma, setForma] = useState<string>(r?.forma_pagamento ?? NENHUM);
  const [erros, setErros] = useState<Record<string, string>>({});

  async function enviar() {
    const e: Record<string, string> = {};
    const v = lerValor(valor);
    const d = Number(dia);
    if (descricao.trim().length < 2) e.descricao = 'Informe a descrição.';
    if (!(v > 0)) e.valor = 'Informe um valor maior que zero.';
    if (!Number.isInteger(d) || d < 1 || d > 31) e.dia = 'Dia entre 1 e 31.';
    if (!r && !inicio) e.inicio = 'Informe o início.';
    if (fim && fim < (r?.inicio ?? inicio)) e.fim = 'O fim deve ser depois do início.';
    setErros(e);
    if (Object.keys(e).length) return;
    const comuns = {
      descricao: descricao.trim(),
      valor: v,
      dia_vencimento: d,
      fim: fim || null,
      categoria_id: idOuNull(categoria),
      paciente_id: paciente?.id ?? null,
      profissional_id: idOuNull(profissional),
      fornecedor: fornecedor.trim() || null,
      forma_pagamento: idOuNull(forma) as FormaPagamento | null,
    };
    try {
      if (r) {
        await salvar.mutateAsync({ id: r.id, ...comuns });
        toast.success('Recorrência atualizada.', { description: 'As mudanças valem para os próximos títulos gerados.' });
      } else {
        const criada = (await salvar.mutateAsync({ tipo, inicio, ...comuns })) as Recorrencia & { titulos?: unknown[] };
        const n = criada.titulos?.length ?? 0;
        toast.success('Recorrência criada.', {
          description: n ? `${n} título(s) gerado(s) em Contas a ${tipo === 'pagar' ? 'pagar' : 'receber'}.` : undefined,
        });
      }
      aoFechar();
    } catch (err) {
      if (err instanceof ErroApi && err.codigo === 'categoria_incompativel') return setErros({ categoria: err.mensagem });
      if (err instanceof ErroApi && err.codigo === 'periodo_invalido') return setErros({ fim: err.mensagem });
      toastErro(err);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !salvar.isPending && aoFechar()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{r ? 'Editar recorrência' : 'Nova recorrência'}</DialogTitle>
          <DialogDescription>
            {r ? 'Títulos já gerados não são alterados.' : 'Gera um título por mês no dia escolhido (meses mais curtos: último dia).'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {!r && (
            <div className="grid grid-cols-2 gap-2">
              {(['pagar', 'receber'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    setTipo(t);
                    setCategoria(NENHUM);
                  }}
                  className={cn(
                    'flex items-center justify-center gap-2 rounded-lg border p-2.5 text-sm font-medium transition-colors hover:bg-accent',
                    tipo === t && 'border-primary bg-primary/5 ring-1 ring-primary',
                  )}
                  aria-pressed={tipo === t}
                >
                  {t === 'pagar' ? <ArrowDownCircle className="size-4 text-destructive" /> : <ArrowUpCircle className="size-4 text-success" />}
                  {t === 'pagar' ? 'Despesa (a pagar)' : 'Receita (a receber)'}
                </button>
              ))}
            </div>
          )}
          <Campo rotulo="Descrição" htmlFor="rec-desc" erro={erros.descricao}>
            <Input
              id="rec-desc"
              autoFocus
              value={descricao}
              maxLength={200}
              placeholder={tipo === 'pagar' ? 'Ex.: Aluguel' : 'Ex.: Mensalidade de acompanhamento'}
              onChange={(e) => setDescricao(e.target.value)}
            />
          </Campo>
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo rotulo="Valor mensal" htmlFor="rec-valor" erro={erros.valor}>
              <InputValor id="rec-valor" valor={valor} onChange={setValor} invalido={!!erros.valor} />
            </Campo>
            <Campo rotulo="Dia do vencimento" htmlFor="rec-dia" erro={erros.dia}>
              <Input id="rec-dia" type="number" min={1} max={31} value={dia} onChange={(e) => setDia(e.target.value)} />
            </Campo>
            <Campo rotulo="Início" htmlFor="rec-inicio" erro={erros.inicio}>
              <Input id="rec-inicio" type="date" value={inicio} disabled={!!r} onChange={(e) => setInicio(e.target.value)} />
            </Campo>
            <Campo rotulo="Fim (opcional)" htmlFor="rec-fim" erro={erros.fim}>
              <Input id="rec-fim" type="date" value={fim} onChange={(e) => setFim(e.target.value)} />
            </Campo>
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
          {tipo === 'receber' ? (
            <Campo rotulo="Paciente (opcional)">
              <BuscaPaciente valor={paciente} onChange={setPaciente} />
            </Campo>
          ) : (
            <Campo rotulo="Fornecedor / credor" htmlFor="rec-forn">
              <Input id="rec-forn" value={fornecedor} maxLength={150} onChange={(e) => setFornecedor(e.target.value)} />
            </Campo>
          )}
          <Campo rotulo="Profissional (opcional)">
            <SelectProfissional valor={profissional} onChange={setProfissional} vazio={{ valor: NENHUM, rotulo: 'Nenhum' }} />
          </Campo>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={aoFechar} disabled={salvar.isPending}>
            Cancelar
          </Button>
          <Button onClick={enviar} disabled={salvar.isPending}>
            {salvar.isPending && <Loader2 className="size-4 animate-spin" />}
            {r ? 'Salvar' : 'Criar recorrência'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
