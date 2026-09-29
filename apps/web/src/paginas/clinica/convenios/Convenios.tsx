// Convênios aceitos pela clínica (apenas o nome; sem TISS). Admin e recepção gerenciam.
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Loader2, MoreHorizontal, Pencil, Plus, Power, PowerOff, Search, ShieldCheck, Trash2 } from 'lucide-react';
import { ErroApi, mensagemDeErro } from '@/api/cliente';
import {
  useCriarConvenio,
  useEditarConvenio,
  useExcluirConvenio,
  useListaConvenios,
  type Convenio,
} from '@/api/convenios';
import { CabecalhoPagina, Carregando, EstadoVazio } from '@/componentes/comum';
import { Button } from '@/componentes/ui/button';
import { Card, CardContent } from '@/componentes/ui/card';
import { Input } from '@/componentes/ui/input';
import { Label } from '@/componentes/ui/label';
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
import { cn } from '@/lib/utils';
import { BadgeStatus, ErroCarregamento, toastErro, useConfirmacao } from '../profissionais/comum';

function descreverUso(c: Convenio): string {
  const partes: string[] = [];
  if (c.uso.pacientes) partes.push(`${c.uso.pacientes} ${c.uso.pacientes === 1 ? 'paciente' : 'pacientes'}`);
  if (c.uso.agendamentos) partes.push(`${c.uso.agendamentos} ${c.uso.agendamentos === 1 ? 'agendamento' : 'agendamentos'}`);
  return partes.length ? partes.join(' · ') : 'Sem uso';
}

function validarNome(nome: string): string | null {
  const n = nome.trim();
  if (n.length < 2) return 'Informe o nome do convênio (mínimo 2 caracteres).';
  if (n.length > 100) return 'Máximo de 100 caracteres.';
  return null;
}

function DialogoEditar({ convenio, aoFechar }: { convenio: Convenio; aoFechar: () => void }) {
  const editar = useEditarConvenio();
  const [nome, setNome] = useState(convenio.nome);
  const [erro, setErro] = useState<string | null>(null);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    const problema = validarNome(nome);
    if (problema) return setErro(problema);
    try {
      await editar.mutateAsync({ id: convenio.id, nome: nome.trim() });
      toast.success('Convênio atualizado.');
      aoFechar();
    } catch (err) {
      if (err instanceof ErroApi && (err.status === 409 || err.status === 400)) setErro(err.mensagem);
      else toastErro(err);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && !editar.isPending && aoFechar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Editar convênio</DialogTitle>
          <DialogDescription>O novo nome aparece em pacientes e agendamentos já vinculados.</DialogDescription>
        </DialogHeader>
        <form onSubmit={enviar} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="nome-convenio">Nome</Label>
            <Input
              id="nome-convenio"
              value={nome}
              autoFocus
              onChange={(e) => {
                setNome(e.target.value);
                setErro(null);
              }}
              aria-invalid={!!erro}
            />
            {erro && <p className="text-sm text-destructive">{erro}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={aoFechar} disabled={editar.isPending}>
              Cancelar
            </Button>
            <Button type="submit" disabled={editar.isPending || nome.trim() === convenio.nome}>
              {editar.isPending && <Loader2 className="size-4 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function PaginaConvenios() {
  const [busca, setBusca] = useState('');
  const [mostrarInativos, setMostrarInativos] = useState(true);
  const [novoNome, setNovoNome] = useState('');
  const [erroNovo, setErroNovo] = useState<string | null>(null);
  const [editando, setEditando] = useState<Convenio | null>(null);

  const consulta = useListaConvenios();
  const criar = useCriarConvenio();
  const editar = useEditarConvenio();
  const excluir = useExcluirConvenio();
  const { confirmar, dialogo } = useConfirmacao();

  const todos = consulta.data ?? [];
  const termo = busca.trim().toLowerCase();
  const lista = todos.filter((c) => (mostrarInativos || c.ativo) && (!termo || c.nome.toLowerCase().includes(termo)));
  const ativos = todos.filter((c) => c.ativo).length;

  async function adicionar(e: FormEvent) {
    e.preventDefault();
    const problema = validarNome(novoNome);
    if (problema) return setErroNovo(problema);
    try {
      await criar.mutateAsync({ nome: novoNome.trim() });
      toast.success(`Convênio “${novoNome.trim()}” adicionado.`);
      setNovoNome('');
    } catch (err) {
      if (err instanceof ErroApi && (err.status === 409 || err.status === 400)) setErroNovo(err.mensagem);
      else toastErro(err);
    }
  }

  function alternarStatus(c: Convenio) {
    confirmar({
      titulo: c.ativo ? `Desativar “${c.nome}”?` : `Reativar “${c.nome}”?`,
      descricao: c.ativo
        ? 'O convênio deixa de aparecer nas seleções de pacientes e agendamentos. Os registros já vinculados são mantidos.'
        : 'O convênio volta a aparecer nas seleções.',
      rotuloConfirmar: c.ativo ? 'Desativar' : 'Reativar',
      destrutivo: c.ativo,
      acao: async () => {
        try {
          await editar.mutateAsync({ id: c.id, ativo: !c.ativo });
          toast.success(c.ativo ? 'Convênio desativado.' : 'Convênio reativado.');
        } catch (e) {
          toastErro(e);
          throw e;
        }
      },
    });
  }

  function pedirExclusao(c: Convenio) {
    confirmar({
      titulo: `Excluir “${c.nome}”?`,
      descricao: 'Esta ação não pode ser desfeita.',
      rotuloConfirmar: 'Excluir',
      destrutivo: true,
      acao: async () => {
        try {
          await excluir.mutateAsync(c.id);
          toast.success('Convênio excluído.');
        } catch (e) {
          toastErro(e);
          throw e;
        }
      },
    });
  }

  return (
    <div className="mx-auto max-w-4xl">
      <CabecalhoPagina
        titulo="Convênios"
        descricao="Planos de saúde aceitos pela clínica. Usados no cadastro de pacientes e nos agendamentos."
      />

      <Card className="mb-6 py-0">
        <CardContent className="p-4">
          <form onSubmit={adicionar} className="flex flex-col gap-2 sm:flex-row sm:items-start" noValidate>
            <div className="flex-1">
              <Label htmlFor="novo-convenio" className="sr-only">
                Nome do convênio
              </Label>
              <Input
                id="novo-convenio"
                value={novoNome}
                onChange={(e) => {
                  setNovoNome(e.target.value);
                  setErroNovo(null);
                }}
                placeholder="Nome do convênio (ex.: Unimed, Bradesco Saúde…)"
                aria-invalid={!!erroNovo}
              />
              {erroNovo && <p className="mt-1.5 text-sm text-destructive">{erroNovo}</p>}
            </div>
            <Button type="submit" disabled={criar.isPending || !novoNome.trim()}>
              {criar.isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              Adicionar
            </Button>
          </form>
        </CardContent>
      </Card>

      {consulta.isLoading ? (
        <Carregando texto="Carregando convênios…" />
      ) : consulta.isError ? (
        <ErroCarregamento mensagem={mensagemDeErro(consulta.error)} tentarNovamente={() => consulta.refetch()} />
      ) : todos.length === 0 ? (
        <EstadoVazio
          icone={<ShieldCheck className="size-5" />}
          titulo="Nenhum convênio cadastrado"
          descricao="Se a clínica atende apenas particular, pode pular esta etapa. Adicione convênios no campo acima."
        />
      ) : (
        <>
          <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              {ativos} {ativos === 1 ? 'convênio ativo' : 'convênios ativos'} de {todos.length}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setMostrarInativos((v) => !v)}
                className="text-muted-foreground"
              >
                {mostrarInativos ? 'Ocultar inativos' : 'Mostrar inativos'}
              </Button>
              <div className="relative sm:w-64">
                <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar…" className="pl-9" />
              </div>
            </div>
          </div>

          <Card className="py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Convênio</TableHead>
                  <TableHead className="hidden sm:table-cell">Uso</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {lista.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="py-10 text-center text-sm text-muted-foreground">
                      Nenhum convênio encontrado.
                    </TableCell>
                  </TableRow>
                ) : (
                  lista.map((c) => {
                    const emUso = c.uso.pacientes > 0 || c.uso.agendamentos > 0;
                    return (
                      <TableRow key={c.id} className={cn(!c.ativo && 'text-muted-foreground')}>
                        <TableCell className="pl-4 font-medium">
                          <div className="flex items-center gap-3">
                            <span className="grid size-8 place-items-center rounded-md bg-primary/10 text-primary">
                              <ShieldCheck className="size-4" />
                            </span>
                            <span>
                              {c.nome}
                              <span className="block text-xs font-normal text-muted-foreground sm:hidden">
                                {descreverUso(c)}
                              </span>
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">{descreverUso(c)}</TableCell>
                        <TableCell>
                          <BadgeStatus ativo={c.ativo} />
                        </TableCell>
                        <TableCell className="pr-4 text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon-sm" aria-label={`Ações de ${c.nome}`}>
                                <MoreHorizontal className="size-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => setEditando(c)}>
                                <Pencil className="size-4" />
                                Renomear
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => alternarStatus(c)}>
                                {c.ativo ? <PowerOff className="size-4" /> : <Power className="size-4" />}
                                {c.ativo ? 'Desativar' : 'Reativar'}
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                disabled={emUso}
                                onClick={() => pedirExclusao(c)}
                                className="text-destructive focus:text-destructive"
                                title={emUso ? 'Em uso: desative em vez de excluir' : undefined}
                              >
                                <Trash2 className="size-4" />
                                {emUso ? 'Excluir (em uso)' : 'Excluir'}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </Card>
          <p className="mt-3 text-xs text-muted-foreground">
            Convênios vinculados a pacientes ou agendamentos não podem ser excluídos — desative-os para escondê-los das
            seleções.
          </p>
        </>
      )}

      {editando && <DialogoEditar convenio={editando} aoFechar={() => setEditando(null)} />}
      {dialogo}
    </div>
  );
}
