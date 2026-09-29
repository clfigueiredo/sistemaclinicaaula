// Usuários da clínica e papéis (limite max_recepcionistas; admin não conta). Somente admin.
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { KeyRound, Loader2, MoreHorizontal, Pencil, Power, PowerOff, UserPlus, Users } from 'lucide-react';
import { ErroApi, mensagemDeErro } from '@/api/cliente';
import { useMe, usePodeUsar } from '@/api/me';
import { useListaProfissionais } from '@/api/profissionais';
import { ROTULOS_PAPEL, type Papel } from '@/api/tipos';
import {
  useCriarUsuario,
  useEditarUsuario,
  useListaUsuarios,
  useRedefinirSenha,
  type UsuarioClinica,
} from '@/api/usuarios';
import { AvisoLimite, CabecalhoPagina, Carregando, EstadoVazio, UsoRecurso } from '@/componentes/comum';
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/componentes/ui/dropdown-menu';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/componentes/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/componentes/ui/select';
import { cn } from '@/lib/utils';
import { BadgeStatus, BolinhaCor, ErroCarregamento, iniciais, toastErro, useConfirmacao } from '../profissionais/comum';

const ESTILO_PAPEL: Record<Papel, string> = {
  admin: 'bg-primary/15 text-primary',
  recepcao: 'bg-warning/20 text-foreground',
  profissional: 'bg-success/15 text-success',
};

const DESCRICAO_PAPEL: Record<Papel, string> = {
  admin: 'Acesso total: usuários, convênios, WhatsApp e configurações.',
  recepcao: 'Agenda, pacientes (dados cadastrais) e convênios. Não vê prontuário.',
  profissional: 'A própria agenda e o prontuário dos seus pacientes.',
};

function BadgePapel({ papel }: { papel: Papel }) {
  return (
    <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium', ESTILO_PAPEL[papel])}>
      {ROTULOS_PAPEL[papel]}
    </span>
  );
}

const SEM_VINCULO = 'nenhum';

// ----------------------------------------------------------------------------- criar/editar

const esquemaUsuario = (criando: boolean) =>
  z
    .object({
      nome: z.string().trim().min(2, 'Informe o nome').max(150, 'Máximo de 150 caracteres'),
      email: z.string().trim().min(1, 'Informe o e-mail').pipe(z.email('E-mail inválido')),
      papel: z.enum(['admin', 'recepcao', 'profissional']),
      profissional_id: z.string(),
      senha: z.string(),
      confirmacao: z.string(),
    })
    .superRefine((d, ctx) => {
      if (d.papel === 'profissional' && d.profissional_id === SEM_VINCULO) {
        ctx.addIssue({ code: 'custom', path: ['profissional_id'], message: 'Selecione o profissional vinculado' });
      }
      if (criando) {
        if (d.senha.length < 6) {
          ctx.addIssue({ code: 'custom', path: ['senha'], message: 'A senha deve ter pelo menos 6 caracteres' });
        }
        if (d.senha !== d.confirmacao) {
          ctx.addIssue({ code: 'custom', path: ['confirmacao'], message: 'As senhas não conferem' });
        }
      }
    });
type DadosUsuario = z.infer<ReturnType<typeof esquemaUsuario>>;

const CAMPOS_API: Record<string, keyof DadosUsuario> = {
  'body.nome': 'nome',
  'body.email': 'email',
  'body.senha': 'senha',
  'body.papel': 'papel',
  'body.profissional_id': 'profissional_id',
};

function DialogoUsuario({
  usuario,
  usuarios,
  euId,
  aoFechar,
}: {
  usuario: UsuarioClinica | null;
  usuarios: UsuarioClinica[];
  euId: string | undefined;
  aoFechar: () => void;
}) {
  const criando = !usuario;
  const ehEu = usuario?.id === euId;
  const criar = useCriarUsuario();
  const editar = useEditarUsuario();
  const salvando = criar.isPending || editar.isPending;
  const profissionais = useListaProfissionais();
  const vagaRecepcao = usePodeUsar('max_recepcionistas');

  const form = useForm<DadosUsuario>({
    resolver: zodResolver(esquemaUsuario(criando)),
    defaultValues: {
      nome: usuario?.nome ?? '',
      email: usuario?.email ?? '',
      papel: usuario?.papel ?? (vagaRecepcao.pode ? 'recepcao' : 'profissional'),
      profissional_id: usuario?.profissional_id ?? SEM_VINCULO,
      senha: '',
      confirmacao: '',
    },
  });
  const papel = form.watch('papel');

  // Recepção já ativa não consome vaga nova ao ser editada.
  const jaOcupaVaga = usuario?.papel === 'recepcao' && usuario.ativo;
  const recepcaoBloqueada = !vagaRecepcao.pode && !jaOcupaVaga;

  const vinculados = new Map(
    usuarios.filter((u) => u.profissional_id && u.id !== usuario?.id).map((u) => [u.profissional_id!, u.nome]),
  );
  const opcoesProfissionais = (profissionais.data ?? []).filter(
    (p) => p.ativo || p.id === usuario?.profissional_id,
  );

  async function enviar(d: DadosUsuario) {
    const profissional_id = d.papel === 'recepcao' || d.profissional_id === SEM_VINCULO ? null : d.profissional_id;
    try {
      if (criando) {
        await criar.mutateAsync({ nome: d.nome, email: d.email, senha: d.senha, papel: d.papel, profissional_id });
        toast.success('Usuário criado.', { description: `${d.email} já pode entrar no sistema.` });
      } else {
        await editar.mutateAsync({ id: usuario.id, nome: d.nome, email: d.email, papel: d.papel, profissional_id });
        toast.success('Usuário atualizado.');
      }
      aoFechar();
    } catch (e) {
      if (e instanceof ErroApi) {
        if (e.codigo === 'email_em_uso') return form.setError('email', { message: e.mensagem });
        if (['profissional_vinculado', 'profissional_obrigatorio'].includes(e.codigo)) {
          return form.setError('profissional_id', { message: e.mensagem });
        }
        let tratado = false;
        for (const det of e.detalhes) {
          const campo = CAMPOS_API[det.campo];
          if (campo) {
            form.setError(campo, { message: det.mensagem });
            tratado = true;
          }
        }
        if (tratado) return;
      }
      toastErro(e);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && !salvando && aoFechar()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{criando ? 'Novo usuário' : 'Editar usuário'}</DialogTitle>
          <DialogDescription>
            {criando ? 'Crie o acesso de alguém da equipe. O e-mail é usado para entrar no sistema.' : usuario.email}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(enviar)} className="space-y-4" noValidate>
            <FormField
              control={form.control}
              name="nome"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nome</FormLabel>
                  <FormControl>
                    <Input autoFocus {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>E-mail</FormLabel>
                  <FormControl>
                    <Input type="email" autoComplete="off" placeholder="nome@clinica.com.br" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="papel"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Papel</FormLabel>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {(['admin', 'recepcao', 'profissional'] as Papel[]).map((p) => {
                      const bloqueado = (p === 'recepcao' && recepcaoBloqueada && field.value !== 'recepcao') || (ehEu && p !== usuario?.papel);
                      return (
                        <button
                          key={p}
                          type="button"
                          disabled={bloqueado}
                          onClick={() => field.onChange(p)}
                          className={cn(
                            'rounded-lg border p-2.5 text-left text-sm transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50',
                            field.value === p && 'border-primary bg-primary/5 ring-1 ring-primary',
                          )}
                          aria-pressed={field.value === p}
                          title={
                            ehEu && p !== usuario?.papel
                              ? 'Você não pode alterar o seu próprio papel.'
                              : p === 'recepcao' && recepcaoBloqueada
                                ? (vagaRecepcao.mensagem ?? undefined)
                                : undefined
                          }
                        >
                          <span className="font-medium">{ROTULOS_PAPEL[p]}</span>
                        </button>
                      );
                    })}
                  </div>
                  <FormDescription>{DESCRICAO_PAPEL[papel]}</FormDescription>
                  {papel === 'recepcao' && recepcaoBloqueada && (
                    <p className="text-sm text-destructive">{vagaRecepcao.mensagem}</p>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />
            {papel !== 'recepcao' && (
              <FormField
                control={form.control}
                name="profissional_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Profissional vinculado{papel === 'admin' && ' (opcional)'}</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Selecione…" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {papel === 'admin' && <SelectItem value={SEM_VINCULO}>Nenhum (não atende)</SelectItem>}
                        {papel === 'profissional' && field.value === SEM_VINCULO && (
                          <SelectItem value={SEM_VINCULO} disabled>
                            Selecione…
                          </SelectItem>
                        )}
                        {opcoesProfissionais.map((p) => {
                          const dono = vinculados.get(p.id);
                          return (
                            <SelectItem key={p.id} value={p.id} disabled={!!dono}>
                              <BolinhaCor cor={p.cor_agenda} />
                              {p.nome}
                              {dono && <span className="text-xs text-muted-foreground"> · vinculado a {dono}</span>}
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      {papel === 'admin'
                        ? 'Vincule se o administrador também atende (dono que é profissional).'
                        : 'O usuário verá a agenda e os prontuários deste profissional.'}
                      {profissionais.data && opcoesProfissionais.length === 0 && ' Cadastre um profissional antes.'}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
            {criando && (
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="senha"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Senha inicial</FormLabel>
                      <FormControl>
                        <Input type="password" autoComplete="new-password" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="confirmacao"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Confirme a senha</FormLabel>
                      <FormControl>
                        <Input type="password" autoComplete="new-password" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={aoFechar} disabled={salvando}>
                Cancelar
              </Button>
              <Button type="submit" disabled={salvando || (papel === 'recepcao' && recepcaoBloqueada)}>
                {salvando && <Loader2 className="size-4 animate-spin" />}
                {criando ? 'Criar usuário' : 'Salvar'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// ----------------------------------------------------------------------------- senha

const esquemaSenha = z
  .object({
    senha: z.string().min(6, 'A senha deve ter pelo menos 6 caracteres').max(100),
    confirmacao: z.string(),
  })
  .refine((d) => d.senha === d.confirmacao, { path: ['confirmacao'], message: 'As senhas não conferem' });

function DialogoSenha({ usuario, aoFechar }: { usuario: UsuarioClinica; aoFechar: () => void }) {
  const redefinir = useRedefinirSenha();
  const form = useForm<z.infer<typeof esquemaSenha>>({
    resolver: zodResolver(esquemaSenha),
    defaultValues: { senha: '', confirmacao: '' },
  });

  async function enviar(d: z.infer<typeof esquemaSenha>) {
    try {
      await redefinir.mutateAsync({ id: usuario.id, senha: d.senha });
      toast.success('Senha redefinida.', { description: `Informe a nova senha a ${usuario.nome}.` });
      aoFechar();
    } catch (e) {
      toastErro(e);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && !redefinir.isPending && aoFechar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Redefinir senha</DialogTitle>
          <DialogDescription>
            Nova senha de acesso para {usuario.nome} ({usuario.email}).
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(enviar)} className="space-y-4" noValidate>
            <FormField
              control={form.control}
              name="senha"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nova senha</FormLabel>
                  <FormControl>
                    <Input type="password" autoComplete="new-password" autoFocus {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="confirmacao"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Confirme a nova senha</FormLabel>
                  <FormControl>
                    <Input type="password" autoComplete="new-password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={aoFechar} disabled={redefinir.isPending}>
                Cancelar
              </Button>
              <Button type="submit" disabled={redefinir.isPending}>
                {redefinir.isPending && <Loader2 className="size-4 animate-spin" />}
                Redefinir senha
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// ----------------------------------------------------------------------------- página

function ultimoAcesso(data: string | null) {
  if (!data) return 'Nunca acessou';
  return `há ${formatDistanceToNow(parseISO(data), { locale: ptBR })}`;
}

export default function PaginaUsuarios() {
  const { data: me } = useMe();
  const euId = me?.usuario.id;
  const consulta = useListaUsuarios();
  const editar = useEditarUsuario();
  const vagaRecepcao = usePodeUsar('max_recepcionistas');
  const { confirmar, dialogo } = useConfirmacao();

  const [dialogoUsuario, setDialogoUsuario] = useState<{ usuario: UsuarioClinica | null } | null>(null);
  const [senhaDe, setSenhaDe] = useState<UsuarioClinica | null>(null);

  const usuarios = consulta.data ?? [];
  const adminsAtivos = usuarios.filter((u) => u.papel === 'admin' && u.ativo).length;

  function alternarStatus(u: UsuarioClinica) {
    const reativandoRecepcao = !u.ativo && u.papel === 'recepcao';
    if (reativandoRecepcao && !vagaRecepcao.pode) {
      toast.error('Limite do plano', { description: vagaRecepcao.mensagem ?? undefined });
      return;
    }
    confirmar({
      titulo: u.ativo ? `Desativar ${u.nome}?` : `Reativar ${u.nome}?`,
      descricao: u.ativo
        ? 'O usuário perde o acesso ao sistema imediatamente. Os registros feitos por ele são mantidos.'
        : reativandoRecepcao
          ? 'O usuário volta a acessar o sistema e passa a contar no limite de recepcionistas do plano.'
          : 'O usuário volta a acessar o sistema.',
      rotuloConfirmar: u.ativo ? 'Desativar' : 'Reativar',
      destrutivo: u.ativo,
      acao: async () => {
        try {
          await editar.mutateAsync({ id: u.id, ativo: !u.ativo });
          toast.success(u.ativo ? 'Usuário desativado.' : 'Usuário reativado.');
        } catch (e) {
          toastErro(e);
          throw e;
        }
      },
    });
  }

  return (
    <div>
      <CabecalhoPagina
        titulo="Usuários"
        descricao="Quem acessa o sistema e com qual papel. O administrador não conta no limite de recepcionistas."
        acoes={
          <>
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              Recepcionistas
              <UsoRecurso codigo="max_recepcionistas" />
            </span>
            <Button onClick={() => setDialogoUsuario({ usuario: null })}>
              <UserPlus className="size-4" />
              Novo usuário
            </Button>
          </>
        }
      />

      <AvisoLimite codigo="max_recepcionistas" className="mb-4" />

      {consulta.isLoading ? (
        <Carregando texto="Carregando usuários…" />
      ) : consulta.isError ? (
        <ErroCarregamento mensagem={mensagemDeErro(consulta.error)} tentarNovamente={() => consulta.refetch()} />
      ) : usuarios.length === 0 ? (
        <EstadoVazio icone={<Users className="size-5" />} titulo="Nenhum usuário" />
      ) : (
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Usuário</TableHead>
                <TableHead>Papel</TableHead>
                <TableHead className="hidden md:table-cell">Profissional vinculado</TableHead>
                <TableHead className="hidden lg:table-cell">Último acesso</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {usuarios.map((u) => {
                const ehEu = u.id === euId;
                const ultimoAdmin = u.papel === 'admin' && u.ativo && adminsAtivos <= 1;
                return (
                  <TableRow key={u.id} className={cn(!u.ativo && 'text-muted-foreground')}>
                    <TableCell className="pl-4">
                      <div className="flex items-center gap-3">
                        <span
                          className={cn(
                            'grid size-9 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold',
                            !u.ativo && 'opacity-60',
                          )}
                        >
                          {iniciais(u.nome)}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate font-medium">
                            {u.nome}
                            {ehEu && <span className="ml-1.5 text-xs font-normal text-muted-foreground">(você)</span>}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <BadgePapel papel={u.papel} />
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {u.profissional ? (
                        <span className="inline-flex items-center gap-2 text-sm">
                          <BolinhaCor cor={u.profissional.cor_agenda} />
                          {u.profissional.nome}
                        </span>
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">
                      {ultimoAcesso(u.ultimo_acesso_em)}
                    </TableCell>
                    <TableCell>
                      <BadgeStatus ativo={u.ativo} />
                    </TableCell>
                    <TableCell className="pr-4 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm" aria-label={`Ações de ${u.nome}`}>
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setDialogoUsuario({ usuario: u })}>
                            <Pencil className="size-4" />
                            Editar
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setSenhaDe(u)}>
                            <KeyRound className="size-4" />
                            Redefinir senha
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            disabled={u.ativo && (ehEu || ultimoAdmin)}
                            onClick={() => alternarStatus(u)}
                            className={u.ativo ? 'text-destructive focus:text-destructive' : undefined}
                          >
                            {u.ativo ? <PowerOff className="size-4" /> : <Power className="size-4" />}
                            {u.ativo
                              ? ehEu
                                ? 'Desativar (não é possível para você)'
                                : ultimoAdmin
                                  ? 'Desativar (último administrador)'
                                  : 'Desativar'
                              : 'Reativar'}
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

      {dialogoUsuario && (
        <DialogoUsuario
          usuario={dialogoUsuario.usuario}
          usuarios={usuarios}
          euId={euId}
          aoFechar={() => setDialogoUsuario(null)}
        />
      )}
      {senhaDe && <DialogoSenha usuario={senhaDe} aoFechar={() => setSenhaDe(null)} />}
      {dialogo}
    </div>
  );
}
