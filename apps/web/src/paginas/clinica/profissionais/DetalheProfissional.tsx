// Detalhe do profissional (rota /profissionais/:id; "novo" para criar): abas Dados, Horários e Bloqueios.
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowLeft, CalendarClock, CalendarOff, Clock, IdCard, Power, PowerOff, UserRound } from 'lucide-react';
import { ErroApi, mensagemDeErro } from '@/api/cliente';
import { useMe, usePodeUsar } from '@/api/me';
import { useCriarProfissional, useEditarProfissional, useProfissional } from '@/api/profissionais';
import { ROTULOS_PAPEL } from '@/api/tipos';
import { AvisoLimite, CabecalhoPagina, Carregando, EstadoVazio } from '@/componentes/comum';
import { Button } from '@/componentes/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/componentes/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/componentes/ui/tabs';
import { AbaBloqueios } from './AbaBloqueios';
import { AvatarCor, BadgeStatus, ErroCarregamento, toastErro, useConfirmacao } from './comum';
import { EditorHorarios } from './EditorHorarios';
import { FormularioProfissional } from './FormularioProfissional';

const ABAS = ['dados', 'horarios', 'bloqueios'] as const;
type Aba = (typeof ABAS)[number];

function Voltar() {
  return (
    <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2 text-muted-foreground">
      <Link to="/profissionais">
        <ArrowLeft className="size-4" />
        Profissionais
      </Link>
    </Button>
  );
}

function NovoProfissional() {
  const navigate = useNavigate();
  const criar = useCriarProfissional();
  const { pode } = usePodeUsar('max_profissionais');
  return (
    <div className="mx-auto max-w-3xl">
      <Voltar />
      <CabecalhoPagina titulo="Novo profissional" descricao="Depois de salvar, defina a grade de horários de atendimento." />
      <AvisoLimite codigo="max_profissionais" className="mb-4" />
      <Card>
        <CardContent className="pt-6">
          <FormularioProfissional
            somenteLeitura={!pode}
            salvando={criar.isPending}
            rotuloSalvar="Cadastrar profissional"
            aoCancelar={() => navigate('/profissionais')}
            aoSalvar={async (dados) => {
              try {
                const novo = await criar.mutateAsync(dados);
                toast.success('Profissional cadastrado!', { description: 'Agora defina a grade de horários.' });
                navigate(`/profissionais/${novo.id}?aba=horarios`, { replace: true });
              } catch (e) {
                toastErro(e);
                throw e;
              }
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}

export default function PaginaDetalheProfissional() {
  const { id } = useParams<{ id: string }>();
  if (id === 'novo') return <NovoProfissional />;
  return <DetalheExistente id={id!} />;
}

function DetalheExistente({ id }: { id: string }) {
  const [params, setParams] = useSearchParams();
  const abaParam = params.get('aba') as Aba | null;
  const aba: Aba = abaParam && ABAS.includes(abaParam) ? abaParam : 'dados';

  const { data: me } = useMe();
  const ehAdmin = me?.papel === 'admin';
  const podeBloquear = me?.papel === 'admin' || me?.papel === 'recepcao';

  const consulta = useProfissional(id);
  const editar = useEditarProfissional(id);
  const { confirmar, dialogo } = useConfirmacao();

  if (consulta.isLoading) return <Carregando texto="Carregando profissional…" />;
  if (consulta.isError) {
    const naoEncontrado = consulta.error instanceof ErroApi && consulta.error.status === 404;
    return (
      <div>
        <Voltar />
        {naoEncontrado ? (
          <EstadoVazio titulo="Profissional não encontrado" descricao="Ele pode ter sido removido ou o link está incorreto." />
        ) : (
          <ErroCarregamento mensagem={mensagemDeErro(consulta.error)} tentarNovamente={() => consulta.refetch()} />
        )}
      </div>
    );
  }
  const p = consulta.data!;

  function alternarStatus() {
    confirmar({
      titulo: p.ativo ? `Desativar ${p.nome}?` : `Reativar ${p.nome}?`,
      descricao: p.ativo
        ? 'O profissional deixa de aparecer na agenda para novos agendamentos. O histórico é mantido.'
        : 'O profissional volta a aparecer na agenda e passa a contar no limite do seu plano.',
      rotuloConfirmar: p.ativo ? 'Desativar' : 'Reativar',
      destrutivo: p.ativo,
      acao: async () => {
        try {
          await editar.mutateAsync({ ativo: !p.ativo });
          toast.success(p.ativo ? 'Profissional desativado.' : 'Profissional reativado.');
        } catch (e) {
          toastErro(e);
          throw e;
        }
      },
    });
  }

  return (
    <div>
      <Voltar />
      <CabecalhoPagina
        titulo={
          <span className="flex items-center gap-3">
            <AvatarCor nome={p.nome} cor={p.cor_agenda} tamanho="lg" apagado={!p.ativo} />
            <span className="min-w-0">
              <span className="block truncate">{p.nome}</span>
              <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-normal text-muted-foreground">
                <BadgeStatus ativo={p.ativo} />
                {p.especialidade && <span>{p.especialidade}</span>}
                {p.registro && (
                  <span className="inline-flex items-center gap-1">
                    <IdCard className="size-3.5" />
                    {p.registro}
                  </span>
                )}
                <span className="inline-flex items-center gap-1">
                  <Clock className="size-3.5" />
                  {p.duracao_consulta_min} min
                </span>
              </span>
            </span>
          </span>
        }
        acoes={
          ehAdmin && (
            <Button variant={p.ativo ? 'outline' : 'default'} onClick={alternarStatus}>
              {p.ativo ? <PowerOff className="size-4" /> : <Power className="size-4" />}
              {p.ativo ? 'Desativar' : 'Reativar'}
            </Button>
          )
        }
      />

      {!p.ativo && ehAdmin && <AvisoLimite codigo="max_profissionais" className="mb-4" />}

      <Tabs
        value={aba}
        onValueChange={(v) => {
          const novo = new URLSearchParams(params);
          if (v === 'dados') novo.delete('aba');
          else novo.set('aba', v);
          setParams(novo, { replace: true });
        }}
      >
        <TabsList>
          <TabsTrigger value="dados">
            <UserRound className="size-4" />
            Dados
          </TabsTrigger>
          <TabsTrigger value="horarios">
            <CalendarClock className="size-4" />
            Horários
          </TabsTrigger>
          <TabsTrigger value="bloqueios">
            <CalendarOff className="size-4" />
            Bloqueios
            {p.bloqueios.length > 0 && (
              <span className="ml-1 rounded-full bg-primary/15 px-1.5 text-xs text-primary">{p.bloqueios.length}</span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="dados" className="mt-4">
          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Dados do profissional</CardTitle>
                <CardDescription>
                  {ehAdmin ? 'Informações exibidas na agenda e nos agendamentos.' : 'Somente o administrador pode editar.'}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <FormularioProfissional
                  key={p.atualizado_em}
                  inicial={p}
                  somenteLeitura={!ehAdmin}
                  salvando={editar.isPending}
                  rotuloSalvar="Salvar alterações"
                  aoSalvar={async (dados) => {
                    try {
                      await editar.mutateAsync(dados);
                      toast.success('Dados atualizados.');
                    } catch (e) {
                      toastErro(e);
                      throw e;
                    }
                  }}
                />
              </CardContent>
            </Card>
            <Card className="h-fit">
              <CardHeader>
                <CardTitle>Acesso ao sistema</CardTitle>
                <CardDescription>Usuário vinculado a este profissional.</CardDescription>
              </CardHeader>
              <CardContent>
                {p.usuario ? (
                  <div className="space-y-1 text-sm">
                    <p className="font-medium">{p.usuario.nome}</p>
                    <p className="text-muted-foreground">{p.usuario.email}</p>
                    <p className="text-muted-foreground">
                      {ROTULOS_PAPEL[p.usuario.papel]}
                      {!p.usuario.ativo && ' · inativo'}
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Nenhum usuário vinculado. Para que o profissional acesse a própria agenda e o prontuário, crie um
                    usuário com papel “Profissional”.
                  </p>
                )}
                {ehAdmin && (
                  <Button asChild variant="outline" size="sm" className="mt-4">
                    <Link to="/usuarios">Gerenciar usuários</Link>
                  </Button>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="horarios" className="mt-4">
          <EditorHorarios profissionalId={p.id} horarios={p.horarios} somenteLeitura={!ehAdmin} />
        </TabsContent>

        <TabsContent value="bloqueios" className="mt-4">
          <AbaBloqueios profissional={p} bloqueios={p.bloqueios} podeEditar={podeBloquear} />
        </TabsContent>
      </Tabs>

      {dialogo}
    </div>
  );
}
