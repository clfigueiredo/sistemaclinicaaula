// Lista de pacientes (/pacientes): busca com debounce, tabela paginada e cadastro em diálogo.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ChevronLeft, ChevronRight, Loader2, MessageCircle, Plus, Search, UserRound } from 'lucide-react';
import { useMe } from '@/api/me';
import { mensagemDeErro } from '@/api/cliente';
import { useCriarPaciente, useListaPacientes } from '@/api/pacientes';
import { CabecalhoPagina, Carregando, EstadoVazio } from '@/componentes/comum';
import { Button } from '@/componentes/ui/button';
import { Input } from '@/componentes/ui/input';
import { Badge } from '@/componentes/ui/badge';
import { Card } from '@/componentes/ui/card';
import { Alert, AlertDescription } from '@/componentes/ui/alert';
import { Switch } from '@/componentes/ui/switch';
import { Label } from '@/componentes/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/componentes/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/componentes/ui/table';
import { FormularioPaciente } from './FormularioPaciente';
import { calcularIdade, exibirCpf, exibirTelefone, useDebounce } from './utils';

const POR_PAGINA = 20;

export default function PaginaListaPacientes() {
  const navigate = useNavigate();
  const { data: me } = useMe();
  const podeCadastrar = me?.papel === 'admin' || me?.papel === 'recepcao';
  const [busca, setBusca] = useState('');
  const [pagina, setPagina] = useState(1);
  const [inativos, setInativos] = useState(false);
  const [novoAberto, setNovoAberto] = useState(false);
  const buscaDebounced = useDebounce(busca.trim());

  const { data, isLoading, isFetching, error } = useListaPacientes({
    busca: buscaDebounced || undefined,
    pagina,
    porPagina: POR_PAGINA,
    inativos,
  });
  const criar = useCriarPaciente();

  const total = data?.total ?? 0;
  const totalPaginas = Math.max(1, Math.ceil(total / POR_PAGINA));

  return (
    <div>
      <CabecalhoPagina
        titulo="Pacientes"
        descricao="Busque por nome, CPF ou telefone. Clique em um paciente para abrir a ficha."
        acoes={
          podeCadastrar && (
            <Button onClick={() => setNovoAberto(true)}>
              <Plus className="size-4" />
              Novo paciente
            </Button>
          )
        }
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(e) => {
              setBusca(e.target.value);
              setPagina(1);
            }}
            placeholder="Nome, CPF ou telefone"
            className="pl-9"
            aria-label="Buscar pacientes"
          />
          {isFetching && !isLoading && (
            <Loader2 className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
          )}
        </div>
        <div className="flex items-center gap-2">
          <Switch
            id="mostrar-inativos"
            checked={inativos}
            onCheckedChange={(v) => {
              setInativos(v);
              setPagina(1);
            }}
          />
          <Label htmlFor="mostrar-inativos" className="text-sm font-normal text-muted-foreground">
            Mostrar inativos
          </Label>
        </div>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{mensagemDeErro(error)}</AlertDescription>
        </Alert>
      ) : isLoading ? (
        <Carregando />
      ) : !data || data.itens.length === 0 ? (
        <EstadoVazio
          icone={<UserRound className="size-5" />}
          titulo={buscaDebounced ? 'Nenhum paciente encontrado' : 'Nenhum paciente cadastrado'}
          descricao={
            buscaDebounced
              ? 'Confira a grafia ou busque pelo CPF ou telefone.'
              : 'Cadastre o primeiro paciente para começar a agendar consultas.'
          }
          acao={
            podeCadastrar && !buscaDebounced ? (
              <Button onClick={() => setNovoAberto(true)}>
                <Plus className="size-4" />
                Novo paciente
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Card className="gap-0 overflow-hidden py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead className="hidden md:table-cell">CPF</TableHead>
                <TableHead className="hidden sm:table-cell">Telefone</TableHead>
                <TableHead className="hidden lg:table-cell">Convênio</TableHead>
                <TableHead className="w-10 text-right">
                  <span className="sr-only">WhatsApp</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.itens.map((p) => {
                const idade = calcularIdade(p.nascimento);
                return (
                  <TableRow
                    key={p.id}
                    className="cursor-pointer"
                    tabIndex={0}
                    onClick={() => navigate(`/pacientes/${p.id}`)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') navigate(`/pacientes/${p.id}`);
                    }}
                  >
                    <TableCell>
                      <div className="flex items-center gap-2 font-medium">
                        {p.nome}
                        {!p.ativo && <Badge variant="outline">Inativo</Badge>}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {idade !== null ? `${idade} ${idade === 1 ? 'ano' : 'anos'}` : 'Idade não informada'}
                        <span className="sm:hidden"> · {exibirTelefone(p.telefone ?? p.whatsapp)}</span>
                      </div>
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">{exibirCpf(p.cpf)}</TableCell>
                    <TableCell className="hidden sm:table-cell">{exibirTelefone(p.telefone ?? p.whatsapp)}</TableCell>
                    <TableCell className="hidden lg:table-cell">
                      {p.convenio ? p.convenio.nome : <span className="text-muted-foreground">Particular</span>}
                    </TableCell>
                    <TableCell className="text-right">
                      {p.aceita_whatsapp && (
                        <MessageCircle className="ml-auto size-4 text-success" aria-label="Aceita WhatsApp" />
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <div className="flex items-center justify-between gap-2 border-t px-4 py-3 text-sm text-muted-foreground">
            <span>
              {total} {total === 1 ? 'paciente' : 'pacientes'}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon-sm"
                disabled={pagina <= 1}
                onClick={() => setPagina((p) => p - 1)}
                aria-label="Página anterior"
              >
                <ChevronLeft />
              </Button>
              <span>
                Página {pagina} de {totalPaginas}
              </span>
              <Button
                variant="outline"
                size="icon-sm"
                disabled={pagina >= totalPaginas}
                onClick={() => setPagina((p) => p + 1)}
                aria-label="Próxima página"
              >
                <ChevronRight />
              </Button>
            </div>
          </div>
        </Card>
      )}

      <Dialog open={novoAberto} onOpenChange={setNovoAberto}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Novo paciente</DialogTitle>
            <DialogDescription>Somente o nome é obrigatório. Os demais dados podem ser completados depois.</DialogDescription>
          </DialogHeader>
          {novoAberto && (
            <FormularioPaciente
              rotuloSalvar="Cadastrar paciente"
              salvando={criar.isPending}
              acoesExtras={
                <Button type="button" variant="outline" onClick={() => setNovoAberto(false)}>
                  Cancelar
                </Button>
              }
              onSalvar={async (dados) => {
                try {
                  const p = await criar.mutateAsync(dados);
                  toast.success('Paciente cadastrado.');
                  setNovoAberto(false);
                  navigate(`/pacientes/${p.id}`);
                } catch (e) {
                  toast.error(mensagemDeErro(e));
                  throw e;
                }
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
