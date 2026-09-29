// Planos da plataforma: lista com preço, clínicas vinculadas, resumo dos recursos e ações.
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { MoreHorizontal, Package, Pencil, Plus, Power, Star, Trash2 } from 'lucide-react';
import {
  useAlterarAtivoPlano,
  useExcluirPlano,
  useListaPlanos,
  useMarcarPlanoCadastro,
  type Plano,
} from '@/api/adminPlanos';
import { mensagemDeErro } from '@/api/cliente';
import { CabecalhoPagina, Carregando, EstadoVazio } from '@/componentes/comum';
import { Badge } from '@/componentes/ui/badge';
import { Button } from '@/componentes/ui/button';
import { Card } from '@/componentes/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/componentes/ui/dropdown-menu';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/componentes/ui/table';
import { formatarMoeda } from '@/lib/formatos';
import { BadgeSituacao, DialogoConfirmacao, ErroCarregar } from '../comum';

/** Resumo curto dos recursos: "2 profissionais · 1 recepcionista · WhatsApp". */
function resumoRecursos(plano: Plano): string[] {
  return plano.recursos
    .filter((r) => r.habilitado)
    .map((r) =>
      r.tipo === 'booleano'
        ? r.nome
        : `${r.limite === null ? '∞' : r.limite} ${r.nome.toLowerCase()}${r.periodo === 'mensal' && r.limite !== null ? '/mês' : ''}`,
    );
}

type Acao = { tipo: 'excluir' | 'ativo' | 'cadastro'; plano: Plano } | null;

export default function PaginaListaPlanos() {
  const navigate = useNavigate();
  const { data: planos, isLoading, isError, error, refetch } = useListaPlanos();
  const alterarAtivo = useAlterarAtivoPlano();
  const marcarCadastro = useMarcarPlanoCadastro();
  const excluir = useExcluirPlano();
  const [acao, setAcao] = useState<Acao>(null);

  const executando = alterarAtivo.isPending || marcarCadastro.isPending || excluir.isPending;

  async function confirmar() {
    if (!acao) return;
    const { plano } = acao;
    try {
      if (acao.tipo === 'excluir') {
        await excluir.mutateAsync(plano.id);
        toast.success(`Plano "${plano.nome}" excluído.`);
      } else if (acao.tipo === 'ativo') {
        await alterarAtivo.mutateAsync({ id: plano.id, ativo: !plano.ativo });
        toast.success(`Plano "${plano.nome}" ${plano.ativo ? 'desativado' : 'ativado'}.`);
      } else {
        await marcarCadastro.mutateAsync(plano.id);
        toast.success(`"${plano.nome}" agora é o plano de cadastro.`);
      }
      setAcao(null);
    } catch (e) {
      toast.error(mensagemDeErro(e));
    }
  }

  const novoPlano = (
    <Button asChild>
      <Link to="/admin/planos/novo">
        <Plus /> Novo plano
      </Link>
    </Button>
  );

  return (
    <div>
      <CabecalhoPagina
        titulo="Planos"
        descricao="Planos da plataforma e seus recursos/limites. O plano de cadastro é atribuído no auto-cadastro."
        acoes={novoPlano}
      />

      {isLoading ? (
        <Carregando />
      ) : isError ? (
        <ErroCarregar mensagem={mensagemDeErro(error)} aoTentar={() => refetch()} />
      ) : !planos?.length ? (
        <EstadoVazio
          icone={<Package className="size-5" />}
          titulo="Nenhum plano cadastrado"
          descricao="Crie o primeiro plano e marque-o como plano de cadastro para liberar o auto-cadastro."
          acao={novoPlano}
        />
      ) : (
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Plano</TableHead>
                <TableHead>Preço</TableHead>
                <TableHead className="hidden lg:table-cell">Recursos</TableHead>
                <TableHead className="text-right">Clínicas</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead className="w-12 pr-4" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {planos.map((p) => {
                const resumo = resumoRecursos(p);
                return (
                  <TableRow
                    key={p.id}
                    className="cursor-pointer"
                    onClick={() => navigate(`/admin/planos/${p.id}`)}
                  >
                    <TableCell className="pl-4">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{p.nome}</span>
                        {p.plano_cadastro && (
                          <Badge className="gap-1">
                            <Star className="fill-current" /> Plano de cadastro
                          </Badge>
                        )}
                      </div>
                      {p.descricao && (
                        <p className="mt-0.5 max-w-xs truncate text-xs text-muted-foreground">{p.descricao}</p>
                      )}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {Number(p.preco) > 0 ? (
                        <>
                          {formatarMoeda(p.preco)}
                          <span className="text-xs text-muted-foreground">/mês</span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">Gratuito</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden max-w-md lg:table-cell">
                      {resumo.length ? (
                        <div className="flex flex-wrap gap-1">
                          {resumo.slice(0, 5).map((t) => (
                            <Badge key={t} variant="secondary" className="font-normal">
                              {t}
                            </Badge>
                          ))}
                          {resumo.length > 5 && (
                            <Badge variant="outline" className="font-normal">
                              +{resumo.length - 5}
                            </Badge>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">Nenhum recurso habilitado</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{p.total_clinicas}</TableCell>
                    <TableCell>
                      <BadgeSituacao ativa={p.ativo} rotuloAtivo="Ativo" rotuloInativo="Inativo" />
                    </TableCell>
                    <TableCell className="pr-4" onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm" aria-label={`Ações do plano ${p.nome}`}>
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => navigate(`/admin/planos/${p.id}`)}>
                            <Pencil /> Editar
                          </DropdownMenuItem>
                          {!p.plano_cadastro && (
                            <DropdownMenuItem disabled={!p.ativo} onSelect={() => setAcao({ tipo: 'cadastro', plano: p })}>
                              <Star /> Marcar como plano de cadastro
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            disabled={p.plano_cadastro && p.ativo}
                            onSelect={() => setAcao({ tipo: 'ativo', plano: p })}
                          >
                            <Power /> {p.ativo ? 'Desativar' : 'Ativar'}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant="destructive"
                            disabled={p.plano_cadastro || p.total_clinicas > 0}
                            onSelect={() => setAcao({ tipo: 'excluir', plano: p })}
                          >
                            <Trash2 /> Excluir
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}

      <DialogoConfirmacao
        aberto={!!acao}
        aoMudar={(v) => !v && setAcao(null)}
        carregando={executando}
        aoConfirmar={confirmar}
        perigo={acao?.tipo === 'excluir' || (acao?.tipo === 'ativo' && acao.plano.ativo)}
        titulo={
          acao?.tipo === 'excluir'
            ? 'Excluir plano?'
            : acao?.tipo === 'cadastro'
              ? 'Trocar plano de cadastro?'
              : acao?.plano.ativo
                ? 'Desativar plano?'
                : 'Ativar plano?'
        }
        textoConfirmar={
          acao?.tipo === 'excluir'
            ? 'Excluir'
            : acao?.tipo === 'cadastro'
              ? 'Marcar como plano de cadastro'
              : acao?.plano.ativo
                ? 'Desativar'
                : 'Ativar'
        }
        descricao={
          acao?.tipo === 'excluir'
            ? `O plano "${acao.plano.nome}" será excluído definitivamente. Esta ação não pode ser desfeita.`
            : acao?.tipo === 'cadastro'
              ? `Novas clínicas que se cadastrarem sozinhas passarão a receber o plano "${acao.plano.nome}". O plano de cadastro atual será desmarcado.`
              : acao?.plano.ativo
                ? `O plano "${acao.plano.nome}" deixará de poder ser atribuído a clínicas. As ${acao.plano.total_clinicas} clínica(s) que já o usam continuam com ele.`
                : `O plano "${acao?.plano.nome}" voltará a poder ser atribuído a clínicas.`
        }
      />
    </div>
  );
}
