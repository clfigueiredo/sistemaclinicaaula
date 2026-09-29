// Lista de profissionais da clínica (limite max_profissionais). Admin cria/ativa/desativa; recepção só consulta.
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Clock, MoreHorizontal, Plus, Power, PowerOff, Search, Stethoscope } from 'lucide-react';
import { mensagemDeErro } from '@/api/cliente';
import { useMe, usePodeUsar } from '@/api/me';
import {
  PALETA_CORES_AGENDA,
  useAlterarStatusProfissional,
  useCriarProfissional,
  useListaProfissionais,
  type Profissional,
} from '@/api/profissionais';
import { AvisoLimite, CabecalhoPagina, Carregando, EstadoVazio, UsoRecurso } from '@/componentes/comum';
import { Button } from '@/componentes/ui/button';
import { Card, CardContent } from '@/componentes/ui/card';
import { Input } from '@/componentes/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/componentes/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/componentes/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { AvatarCor, BadgeStatus, ErroCarregamento, toastErro, useConfirmacao } from './comum';
import { FormularioProfissional } from './FormularioProfissional';

type FiltroStatus = 'ativos' | 'inativos' | 'todos';

const FILTROS: { valor: FiltroStatus; rotulo: string }[] = [
  { valor: 'ativos', rotulo: 'Ativos' },
  { valor: 'inativos', rotulo: 'Inativos' },
  { valor: 'todos', rotulo: 'Todos' },
];

export default function PaginaListaProfissionais() {
  const navigate = useNavigate();
  const { data: me } = useMe();
  const ehAdmin = me?.papel === 'admin';
  const podeCriar = usePodeUsar('max_profissionais');

  const [status, setStatus] = useState<FiltroStatus>('ativos');
  const [busca, setBusca] = useState('');
  const [criando, setCriando] = useState(false);

  const consulta = useListaProfissionais();
  const criar = useCriarProfissional();
  const alterarStatus = useAlterarStatusProfissional();
  const { confirmar, dialogo } = useConfirmacao();

  const todos = consulta.data ?? [];
  const termo = busca.trim().toLowerCase();
  const lista = todos.filter(
    (p) =>
      (status === 'todos' || (status === 'ativos' ? p.ativo : !p.ativo)) &&
      (!termo ||
        p.nome.toLowerCase().includes(termo) ||
        (p.especialidade ?? '').toLowerCase().includes(termo) ||
        (p.registro ?? '').toLowerCase().includes(termo)),
  );
  const contagem = {
    ativos: todos.filter((p) => p.ativo).length,
    inativos: todos.filter((p) => !p.ativo).length,
    todos: todos.length,
  };

  function pedirAlteracaoStatus(p: Profissional) {
    confirmar({
      titulo: p.ativo ? `Desativar ${p.nome}?` : `Reativar ${p.nome}?`,
      descricao: p.ativo
        ? 'O profissional deixa de aparecer na agenda para novos agendamentos. O histórico é mantido e você pode reativá-lo depois.'
        : 'O profissional volta a aparecer na agenda e passa a contar no limite do seu plano.',
      rotuloConfirmar: p.ativo ? 'Desativar' : 'Reativar',
      destrutivo: p.ativo,
      acao: async () => {
        try {
          await alterarStatus.mutateAsync({ id: p.id, ativo: !p.ativo });
          toast.success(p.ativo ? 'Profissional desativado.' : 'Profissional reativado.');
        } catch (e) {
          toastErro(e);
          throw e;
        }
      },
    });
  }

  const botaoNovo = ehAdmin && (
    <Button onClick={() => setCriando(true)} disabled={!podeCriar.pode} title={podeCriar.mensagem ?? undefined}>
      <Plus className="size-4" />
      Novo profissional
    </Button>
  );

  return (
    <div>
      <CabecalhoPagina
        titulo="Profissionais"
        descricao="Quem atende na clínica, com a cor na agenda, grade de horários e bloqueios."
        acoes={
          <>
            <UsoRecurso codigo="max_profissionais" />
            {botaoNovo}
          </>
        }
      />

      {ehAdmin && <AvisoLimite codigo="max_profissionais" className="mb-4" />}

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="inline-flex rounded-lg bg-muted p-1">
          {FILTROS.map((f) => (
            <button
              key={f.valor}
              type="button"
              onClick={() => setStatus(f.valor)}
              className={cn(
                'rounded-md px-3 py-1 text-sm font-medium text-muted-foreground transition-colors',
                status === f.valor && 'bg-background text-foreground shadow-sm',
              )}
            >
              {f.rotulo}
              <span className="ml-1.5 text-xs text-muted-foreground">{contagem[f.valor]}</span>
            </button>
          ))}
        </div>
        <div className="relative sm:w-72">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nome, especialidade…"
            className="pl-9"
          />
        </div>
      </div>

      {consulta.isLoading ? (
        <Carregando texto="Carregando profissionais…" />
      ) : consulta.isError ? (
        <ErroCarregamento mensagem={mensagemDeErro(consulta.error)} tentarNovamente={() => consulta.refetch()} />
      ) : todos.length === 0 ? (
        <EstadoVazio
          icone={<Stethoscope className="size-5" />}
          titulo="Nenhum profissional cadastrado"
          descricao="Cadastre quem atende na clínica para montar a grade de horários e começar a agendar."
          acao={botaoNovo}
        />
      ) : lista.length === 0 ? (
        <EstadoVazio titulo="Nenhum profissional encontrado" descricao="Ajuste a busca ou o filtro de status." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {lista.map((p) => (
            <Card
              key={p.id}
              className={cn(
                'group relative gap-0 overflow-hidden py-0 transition-shadow hover:shadow-md',
                !p.ativo && 'bg-muted/30',
              )}
            >
              <div className="h-1.5" style={{ backgroundColor: p.cor_agenda, opacity: p.ativo ? 1 : 0.4 }} />
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <AvatarCor nome={p.nome} cor={p.cor_agenda} apagado={!p.ativo} />
                  <div className="min-w-0 flex-1">
                    <Link
                      to={`/profissionais/${p.id}`}
                      className="block truncate font-medium after:absolute after:inset-0 hover:underline"
                    >
                      {p.nome}
                    </Link>
                    <p className="truncate text-sm text-muted-foreground">{p.especialidade || 'Sem especialidade'}</p>
                  </div>
                  {ehAdmin && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" className="relative z-10 -mt-1 -mr-2" aria-label="Ações">
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => navigate(`/profissionais/${p.id}`)}>Abrir cadastro</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => navigate(`/profissionais/${p.id}?aba=horarios`)}>
                          Grade de horários
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => pedirAlteracaoStatus(p)}
                          className={p.ativo ? 'text-destructive focus:text-destructive' : undefined}
                        >
                          {p.ativo ? <PowerOff className="size-4" /> : <Power className="size-4" />}
                          {p.ativo ? 'Desativar' : 'Reativar'}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted-foreground">
                  <BadgeStatus ativo={p.ativo} />
                  {p.registro && <span className="truncate">{p.registro}</span>}
                  <span className="inline-flex items-center gap-1">
                    <Clock className="size-3.5" />
                    {p.duracao_consulta_min} min
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={criando} onOpenChange={(aberto) => !criar.isPending && setCriando(aberto)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Novo profissional</DialogTitle>
            <DialogDescription>Depois de salvar, você define a grade de horários de atendimento.</DialogDescription>
          </DialogHeader>
          {criando && (
            <FormularioProfissional
              corSugerida={PALETA_CORES_AGENDA[todos.length % PALETA_CORES_AGENDA.length]}
              salvando={criar.isPending}
              rotuloSalvar="Cadastrar profissional"
              aoCancelar={() => setCriando(false)}
              aoSalvar={async (dados) => {
                try {
                  const novo = await criar.mutateAsync(dados);
                  toast.success('Profissional cadastrado!', { description: 'Agora defina a grade de horários.' });
                  setCriando(false);
                  navigate(`/profissionais/${novo.id}?aba=horarios`);
                } catch (e) {
                  toastErro(e);
                  throw e;
                }
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      {dialogo}
    </div>
  );
}
