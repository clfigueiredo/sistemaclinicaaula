// Clínicas cadastradas: busca, filtros (status da assinatura, plano, situação) e paginação.
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Building2, ChevronLeft, ChevronRight, Loader2, Search, X } from 'lucide-react';
import { useListaClinicasAdmin, type FiltrosClinicas } from '@/api/adminClinicas';
import { useListaPlanos } from '@/api/adminPlanos';
import { mensagemDeErro } from '@/api/cliente';
import { ROTULOS_STATUS_ASSINATURA, type StatusAssinatura } from '@/api/tipos';
import { CabecalhoPagina, Carregando, EstadoVazio } from '@/componentes/comum';
import { Button } from '@/componentes/ui/button';
import { Card } from '@/componentes/ui/card';
import { Input } from '@/componentes/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/componentes/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/componentes/ui/table';
import { formatarData, mascararCpfCnpj } from '@/lib/formatos';
import { BadgeSituacao, BadgeStatusAssinatura, ErroCarregar } from '../comum';

const POR_PAGINA = 20;
const TODOS = 'todos';

export default function PaginaListaClinicas() {
  const navigate = useNavigate();
  // Filtros na URL: voltar do detalhe mantém a busca/página.
  const [params, setParams] = useSearchParams();
  const busca = params.get('busca') ?? '';
  const status = (params.get('status') ?? '') as FiltrosClinicas['status'] | '';
  const planoId = params.get('plano') ?? '';
  const situacao = (params.get('situacao') ?? '') as FiltrosClinicas['situacao'] | '';
  const pagina = Math.max(1, Number(params.get('pagina')) || 1);

  const [textoBusca, setTextoBusca] = useState(busca);
  const planos = useListaPlanos();

  function atualizar(novos: Record<string, string | number | undefined>) {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(novos)) {
      if (v === undefined || v === '' || v === TODOS) p.delete(k);
      else p.set(k, String(v));
    }
    if (!('pagina' in novos)) p.delete('pagina');
    setParams(p, { replace: true });
  }

  // Busca com debounce.
  useEffect(() => {
    if (textoBusca.trim() === busca) return;
    const t = setTimeout(() => atualizar({ busca: textoBusca.trim() }), 350);
    return () => clearTimeout(t);
  }, [textoBusca]);

  const filtros: FiltrosClinicas = {
    busca: busca || undefined,
    status: status || undefined,
    planoId: planoId || undefined,
    situacao: situacao || undefined,
    pagina,
    porPagina: POR_PAGINA,
  };
  const { data, isLoading, isError, error, refetch, isFetching } = useListaClinicasAdmin(filtros);

  const totalPaginas = data ? Math.max(1, Math.ceil(data.total / POR_PAGINA)) : 1;
  const temFiltro = !!(busca || status || planoId || situacao);

  return (
    <div>
      <CabecalhoPagina
        titulo="Clínicas"
        descricao="Clínicas cadastradas, plano atual e status da assinatura."
      />

      <div className="mb-4 flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={textoBusca}
            onChange={(e) => setTextoBusca(e.target.value)}
            placeholder="Buscar por nome, CNPJ/CPF, e-mail, responsável ou cidade…"
            className="pl-9"
            aria-label="Buscar clínicas"
          />
          {isFetching && !isLoading && (
            <Loader2 className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
          )}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <Select value={status || TODOS} onValueChange={(v) => atualizar({ status: v })}>
            <SelectTrigger className="w-full sm:w-44" aria-label="Status da assinatura">
              <SelectValue placeholder="Assinatura" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todas as assinaturas</SelectItem>
              {(Object.keys(ROTULOS_STATUS_ASSINATURA) as StatusAssinatura[]).map((s) => (
                <SelectItem key={s} value={s}>
                  {ROTULOS_STATUS_ASSINATURA[s]}
                </SelectItem>
              ))}
              <SelectItem value="sem_assinatura">Sem assinatura</SelectItem>
            </SelectContent>
          </Select>
          <Select value={planoId || TODOS} onValueChange={(v) => atualizar({ plano: v })}>
            <SelectTrigger className="w-full sm:w-44" aria-label="Plano">
              <SelectValue placeholder="Plano" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todos os planos</SelectItem>
              {planos.data?.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={situacao || TODOS} onValueChange={(v) => atualizar({ situacao: v })}>
            <SelectTrigger className="w-full sm:w-36" aria-label="Situação da clínica">
              <SelectValue placeholder="Situação" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Ativas e inativas</SelectItem>
              <SelectItem value="ativa">Ativas</SelectItem>
              <SelectItem value="inativa">Inativas</SelectItem>
            </SelectContent>
          </Select>
          {temFiltro && (
            <Button
              variant="ghost"
              onClick={() => {
                setTextoBusca('');
                setParams(new URLSearchParams(), { replace: true });
              }}
            >
              <X /> Limpar
            </Button>
          )}
        </div>
      </div>

      {isLoading ? (
        <Carregando />
      ) : isError || !data ? (
        <ErroCarregar mensagem={mensagemDeErro(error)} aoTentar={() => refetch()} />
      ) : data.itens.length === 0 ? (
        <EstadoVazio
          icone={<Building2 className="size-5" />}
          titulo={temFiltro ? 'Nenhuma clínica encontrada' : 'Nenhuma clínica cadastrada'}
          descricao={
            temFiltro
              ? 'Tente outra busca ou limpe os filtros.'
              : 'As clínicas aparecem aqui assim que se cadastrarem pelo site.'
          }
        />
      ) : (
        <>
          <Card className="py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Clínica</TableHead>
                  <TableHead>Plano</TableHead>
                  <TableHead>Assinatura</TableHead>
                  <TableHead className="hidden text-right md:table-cell">Profissionais</TableHead>
                  <TableHead className="hidden text-right md:table-cell">Pacientes</TableHead>
                  <TableHead className="hidden text-right xl:table-cell">Agendamentos</TableHead>
                  <TableHead className="hidden lg:table-cell">Criada em</TableHead>
                  <TableHead className="pr-4">Situação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.itens.map((c) => (
                  <TableRow key={c.id} className="cursor-pointer" onClick={() => navigate(`/admin/clinicas/${c.id}`)}>
                    <TableCell className="max-w-72 pl-4">
                      {/* Link acessível por teclado; a linha inteira continua clicável. */}
                      <Link
                        to={`/admin/clinicas/${c.id}`}
                        className="block truncate font-medium hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {c.nome}
                      </Link>
                      <p className="truncate text-xs text-muted-foreground">
                        {mascararCpfCnpj(c.documento)}
                        {c.cidade && ` · ${c.cidade}${c.uf ? `/${c.uf}` : ''}`}
                      </p>
                    </TableCell>
                    <TableCell>{c.assinatura?.plano.nome ?? <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell>
                      <BadgeStatusAssinatura status={c.assinatura?.status ?? null} />
                      {c.assinatura?.expira_em && (
                        <p className="mt-0.5 text-xs text-muted-foreground">até {formatarData(c.assinatura.expira_em)}</p>
                      )}
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums md:table-cell">{c.contadores.profissionais}</TableCell>
                    <TableCell className="hidden text-right tabular-nums md:table-cell">{c.contadores.pacientes}</TableCell>
                    <TableCell className="hidden text-right tabular-nums xl:table-cell">{c.contadores.agendamentos}</TableCell>
                    <TableCell className="hidden text-muted-foreground lg:table-cell">{formatarData(c.criado_em)}</TableCell>
                    <TableCell className="pr-4">
                      <BadgeSituacao ativa={c.status === 'ativa'} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          <div className="mt-4 flex flex-col items-center justify-between gap-2 text-sm text-muted-foreground sm:flex-row">
            <span>
              {data.total} {data.total === 1 ? 'clínica' : 'clínicas'}
              {totalPaginas > 1 && ` · página ${pagina} de ${totalPaginas}`}
            </span>
            {totalPaginas > 1 && (
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={pagina <= 1} onClick={() => atualizar({ pagina: pagina - 1 })}>
                  <ChevronLeft /> Anterior
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pagina >= totalPaginas}
                  onClick={() => atualizar({ pagina: pagina + 1 })}
                >
                  Próxima <ChevronRight />
                </Button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
