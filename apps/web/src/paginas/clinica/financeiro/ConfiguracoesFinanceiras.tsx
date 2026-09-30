// Aba "Configurações" de /financeiro (admin): contas financeiras, categorias de receita/despesa e
// percentual de repasse dos profissionais.
import { useState } from 'react';
import { toast } from 'sonner';
import { Landmark, Loader2, Pencil, Plus, Power, PowerOff, Tags, Users } from 'lucide-react';
import { ErroApi } from '@/api/cliente';
import {
  useCategoriasFinanceiras,
  useContasFinanceiras,
  useDefinirPercentualRepasse,
  useProfissionaisRepasse,
  useSalvarCategoria,
  useSalvarConta,
  type CategoriaFinanceira,
  type ContaFinanceira,
} from '@/api/financeiro';
import { ROTULOS_TIPO_CONTA, type TipoCategoriaFinanceira, type TipoContaFinanceira } from '@/api/tipos';
import { Carregando } from '@/componentes/comum';
import { Button } from '@/componentes/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/componentes/ui/card';
import { Input } from '@/componentes/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/componentes/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/componentes/ui/select';
import { formatarMoeda } from '@/lib/formatos';
import { cn } from '@/lib/utils';
import { Campo, ErroCarregamento, InputValor, lerValor, toastErro } from './comum';

export default function ConfiguracoesFinanceiras() {
  return (
    <div className="space-y-6">
      <Contas />
      <Categorias />
      <Percentuais />
    </div>
  );
}

// ----------------------------------------------------------------------------- contas

function Contas() {
  const contas = useContasFinanceiras();
  const salvar = useSalvarConta();
  const [editando, setEditando] = useState<ContaFinanceira | 'nova' | null>(null);

  async function alternar(c: ContaFinanceira) {
    try {
      await salvar.mutateAsync({ id: c.id, ativo: !c.ativo });
      toast.success(c.ativo ? 'Conta desativada.' : 'Conta reativada.');
    } catch (e) {
      toastErro(e);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Landmark className="size-4 text-muted-foreground" /> Contas financeiras
        </CardTitle>
        <CardDescription>Onde o dinheiro entra e sai: caixa da recepção, conta bancária, maquininha…</CardDescription>
        <CardAction>
          <Button size="sm" onClick={() => setEditando('nova')}>
            <Plus className="size-4" /> Nova conta
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {contas.isLoading ? (
          <Carregando />
        ) : contas.isError ? (
          <ErroCarregamento mensagem="Tente novamente." tentarNovamente={() => contas.refetch()} />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(contas.data ?? []).map((c) => (
              <div key={c.id} className={cn('rounded-lg border p-4', !c.ativo && 'opacity-60')}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{c.nome}</p>
                    <p className="text-xs text-muted-foreground">
                      {ROTULOS_TIPO_CONTA[c.tipo]}
                      {!c.ativo && ' · desativada'}
                    </p>
                  </div>
                  <div className="flex shrink-0">
                    <Button variant="ghost" size="icon" className="size-8" onClick={() => setEditando(c)} aria-label="Editar">
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      onClick={() => alternar(c)}
                      aria-label={c.ativo ? 'Desativar' : 'Reativar'}
                      title={c.ativo ? 'Desativar' : 'Reativar'}
                    >
                      {c.ativo ? <PowerOff className="size-4" /> : <Power className="size-4" />}
                    </Button>
                  </div>
                </div>
                <p className={cn('mt-3 text-xl font-semibold tabular-nums', Number(c.saldo_atual) < 0 && 'text-destructive')}>
                  {formatarMoeda(c.saldo_atual)}
                </p>
                <p className="text-xs text-muted-foreground">Saldo inicial {formatarMoeda(c.saldo_inicial)}</p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
      {editando && <DialogoConta conta={editando === 'nova' ? undefined : editando} aoFechar={() => setEditando(null)} />}
    </Card>
  );
}

function DialogoConta({ conta, aoFechar }: { conta?: ContaFinanceira; aoFechar: () => void }) {
  const salvar = useSalvarConta();
  const [nome, setNome] = useState(conta?.nome ?? '');
  const [tipo, setTipo] = useState<TipoContaFinanceira>(conta?.tipo ?? 'banco');
  const [saldo, setSaldo] = useState(conta ? String(Number(conta.saldo_inicial)) : '');
  const [erros, setErros] = useState<Record<string, string>>({});

  async function enviar() {
    const e: Record<string, string> = {};
    const s = saldo ? lerValor(saldo) : 0;
    if (nome.trim().length < 2) e.nome = 'Informe o nome da conta.';
    if (Number.isNaN(s) || s < 0) e.saldo = 'Valor inválido.';
    setErros(e);
    if (Object.keys(e).length) return;
    try {
      await salvar.mutateAsync({ id: conta?.id, nome: nome.trim(), tipo, saldo_inicial: s });
      toast.success(conta ? 'Conta atualizada.' : 'Conta criada.');
      aoFechar();
    } catch (err) {
      if (err instanceof ErroApi && err.codigo === 'conta_duplicada') return setErros({ nome: err.mensagem });
      toastErro(err);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !salvar.isPending && aoFechar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{conta ? 'Editar conta' : 'Nova conta financeira'}</DialogTitle>
          <DialogDescription>O saldo atual é calculado: saldo inicial + entradas − saídas.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Campo rotulo="Nome" htmlFor="conta-nome" erro={erros.nome}>
            <Input id="conta-nome" autoFocus value={nome} maxLength={80} placeholder="Ex.: Banco do Brasil" onChange={(e) => setNome(e.target.value)} />
          </Campo>
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo rotulo="Tipo">
              <Select value={tipo} onValueChange={(v) => setTipo(v as TipoContaFinanceira)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(ROTULOS_TIPO_CONTA) as TipoContaFinanceira[]).map((t) => (
                    <SelectItem key={t} value={t}>
                      {ROTULOS_TIPO_CONTA[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Campo>
            <Campo rotulo="Saldo inicial" htmlFor="conta-saldo" erro={erros.saldo}>
              <InputValor id="conta-saldo" valor={saldo} onChange={setSaldo} />
            </Campo>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={aoFechar} disabled={salvar.isPending}>
            Cancelar
          </Button>
          <Button onClick={enviar} disabled={salvar.isPending}>
            {salvar.isPending && <Loader2 className="size-4 animate-spin" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ----------------------------------------------------------------------------- categorias

function Categorias() {
  const categorias = useCategoriasFinanceiras();
  const salvar = useSalvarCategoria();
  const [editando, setEditando] = useState<CategoriaFinanceira | TipoCategoriaFinanceira | null>(null);

  async function alternar(c: CategoriaFinanceira) {
    try {
      await salvar.mutateAsync({ id: c.id, ativo: !c.ativo });
      toast.success(c.ativo ? 'Categoria desativada.' : 'Categoria reativada.');
    } catch (e) {
      toastErro(e);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Tags className="size-4 text-muted-foreground" /> Categorias
        </CardTitle>
        <CardDescription>Classificam receitas e despesas nos relatórios. Categorias em uso podem ser desativadas.</CardDescription>
      </CardHeader>
      <CardContent>
        {categorias.isLoading ? (
          <Carregando />
        ) : categorias.isError ? (
          <ErroCarregamento mensagem="Tente novamente." tentarNovamente={() => categorias.refetch()} />
        ) : (
          <div className="grid gap-6 md:grid-cols-2">
            {(['receita', 'despesa'] as const).map((tipo) => (
              <div key={tipo}>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className={cn('text-sm font-semibold', tipo === 'receita' ? 'text-success' : 'text-destructive')}>
                    {tipo === 'receita' ? 'Receitas' : 'Despesas'}
                  </h3>
                  <Button variant="ghost" size="sm" onClick={() => setEditando(tipo)}>
                    <Plus className="size-4" /> Adicionar
                  </Button>
                </div>
                <ul className="divide-y rounded-lg border">
                  {(categorias.data ?? [])
                    .filter((c) => c.tipo === tipo)
                    .map((c) => (
                      <li key={c.id} className={cn('flex items-center justify-between gap-2 px-3 py-1.5', !c.ativo && 'opacity-50')}>
                        <span className="truncate text-sm">
                          {c.nome}
                          {!c.ativo && <span className="ml-1 text-xs text-muted-foreground">(desativada)</span>}
                        </span>
                        <span className="flex shrink-0">
                          <Button variant="ghost" size="icon" className="size-7" onClick={() => setEditando(c)} aria-label="Renomear">
                            <Pencil className="size-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            onClick={() => alternar(c)}
                            aria-label={c.ativo ? 'Desativar' : 'Reativar'}
                            title={c.ativo ? 'Desativar' : 'Reativar'}
                          >
                            {c.ativo ? <PowerOff className="size-3.5" /> : <Power className="size-3.5" />}
                          </Button>
                        </span>
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </CardContent>
      {editando && (
        <DialogoCategoria
          categoria={typeof editando === 'string' ? undefined : editando}
          tipo={typeof editando === 'string' ? editando : editando.tipo}
          aoFechar={() => setEditando(null)}
        />
      )}
    </Card>
  );
}

function DialogoCategoria({
  categoria,
  tipo,
  aoFechar,
}: {
  categoria?: CategoriaFinanceira;
  tipo: TipoCategoriaFinanceira;
  aoFechar: () => void;
}) {
  const salvar = useSalvarCategoria();
  const [nome, setNome] = useState(categoria?.nome ?? '');
  const [erro, setErro] = useState<string | null>(null);
  async function enviar() {
    if (nome.trim().length < 2) return setErro('Informe o nome.');
    try {
      await salvar.mutateAsync(categoria ? { id: categoria.id, nome: nome.trim() } : { nome: nome.trim(), tipo });
      toast.success(categoria ? 'Categoria renomeada.' : 'Categoria criada.');
      aoFechar();
    } catch (e) {
      if (e instanceof ErroApi && e.codigo === 'categoria_duplicada') return setErro(e.mensagem);
      toastErro(e);
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && !salvar.isPending && aoFechar()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{categoria ? 'Renomear categoria' : `Nova categoria de ${tipo}`}</DialogTitle>
          {categoria?.padrao && <DialogDescription>Categoria padrão do sistema.</DialogDescription>}
        </DialogHeader>
        <Campo rotulo="Nome" htmlFor="cat-nome" erro={erro}>
          <Input
            id="cat-nome"
            autoFocus
            value={nome}
            maxLength={80}
            onChange={(e) => setNome(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && enviar()}
          />
        </Campo>
        <DialogFooter>
          <Button variant="outline" onClick={aoFechar} disabled={salvar.isPending}>
            Cancelar
          </Button>
          <Button onClick={enviar} disabled={salvar.isPending}>
            {salvar.isPending && <Loader2 className="size-4 animate-spin" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ----------------------------------------------------------------------------- percentuais de repasse

function Percentuais() {
  const lista = useProfissionaisRepasse();
  const definir = useDefinirPercentualRepasse();
  const [valores, setValores] = useState<Record<string, string>>({});

  async function salvar(id: string, atual: string | null) {
    const bruto = valores[id];
    if (bruto === undefined) return;
    const pct = bruto.trim() === '' ? null : lerValor(bruto);
    if (pct !== null && (Number.isNaN(pct) || pct < 0 || pct > 100)) {
      toast.error('Informe um percentual entre 0 e 100.');
      return;
    }
    if ((pct === null ? null : pct.toFixed(2)) === (atual === null ? null : Number(atual).toFixed(2))) return;
    try {
      await definir.mutateAsync({ id, percentual_repasse: pct });
      toast.success('Percentual de repasse atualizado.');
      setValores((v) => {
        const { [id]: _, ...resto } = v;
        return resto;
      });
    } catch (e) {
      toastErro(e);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="size-4 text-muted-foreground" /> Repasse dos profissionais
        </CardTitle>
        <CardDescription>
          Percentual sobre as entradas vinculadas a cada profissional (deixe em branco para não calcular repasse).
        </CardDescription>
      </CardHeader>
      <CardContent>
        {lista.isLoading ? (
          <Carregando />
        ) : lista.isError ? (
          <ErroCarregamento mensagem="Tente novamente." tentarNovamente={() => lista.refetch()} />
        ) : (lista.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum profissional cadastrado.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {(lista.data ?? []).map((p) => (
              <li key={p.id} className={cn('flex items-center justify-between gap-3 px-3 py-2', !p.ativo && 'opacity-60')}>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{p.nome}</p>
                  {p.especialidade && <p className="truncate text-xs text-muted-foreground">{p.especialidade}</p>}
                </div>
                <div className="relative w-28 shrink-0">
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step="0.01"
                    aria-label={`Percentual de repasse de ${p.nome}`}
                    className="pr-7 text-right tabular-nums"
                    placeholder="—"
                    value={valores[p.id] ?? (p.percentual_repasse !== null ? String(Number(p.percentual_repasse)) : '')}
                    onChange={(e) => setValores((v) => ({ ...v, [p.id]: e.target.value }))}
                    onBlur={() => salvar(p.id, p.percentual_repasse)}
                    onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                  />
                  <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-sm text-muted-foreground">%</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
