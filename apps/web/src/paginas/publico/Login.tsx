import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Building2, Loader2 } from 'lucide-react';
import { useLoginClinica } from '@/api/auth';
import { mensagemDeErro } from '@/api/cliente';
import { useAuth } from '@/contextos/AuthContext';
import { Button } from '@/componentes/ui/button';
import { Input } from '@/componentes/ui/input';
import { Alert, AlertDescription } from '@/componentes/ui/alert';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/componentes/ui/form';
import { LayoutPublico } from './LayoutPublico';

const esquema = z.object({
  email: z.string().trim().min(1, 'Informe o e-mail').pipe(z.email('E-mail inválido')),
  senha: z.string().min(1, 'Informe a senha'),
});
type Dados = z.infer<typeof esquema>;

export default function PaginaLogin() {
  const navigate = useNavigate();
  const location = useLocation();
  const { entrarClinica } = useAuth();
  const login = useLoginClinica();
  const [clinicas, setClinicas] = useState<{ id: string; nome: string }[] | null>(null);
  const form = useForm<Dados>({ resolver: zodResolver(esquema), defaultValues: { email: '', senha: '' } });

  const destino = (location.state as { de?: string } | null)?.de ?? '/agenda';

  async function entrar(dados: Dados, clinicaId?: string) {
    const r = await login.mutateAsync({ ...dados, clinicaId }).catch(() => null);
    if (!r) return;
    if ('selecionarClinica' in r) {
      setClinicas(r.clinicas);
      return;
    }
    entrarClinica(r.token);
    navigate(destino, { replace: true });
  }

  return (
    <LayoutPublico
      titulo={clinicas ? 'Escolha a clínica' : 'Entrar'}
      subtitulo={
        clinicas ? 'Seu e-mail está cadastrado em mais de uma clínica.' : 'Acesse a área da sua clínica.'
      }
      rodape={
        <>
          Ainda não tem conta?{' '}
          <Link to="/cadastro" className="font-medium text-primary hover:underline">
            Teste grátis
          </Link>
        </>
      }
    >
      {login.isError && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{mensagemDeErro(login.error)}</AlertDescription>
        </Alert>
      )}

      {clinicas ? (
        <div className="space-y-2">
          {clinicas.map((c) => (
            <Button
              key={c.id}
              variant="outline"
              className="h-12 w-full justify-start gap-3"
              disabled={login.isPending}
              onClick={() => entrar(form.getValues(), c.id)}
            >
              <Building2 className="size-4 text-primary" />
              <span className="truncate">{c.nome}</span>
            </Button>
          ))}
          <Button variant="ghost" className="w-full" onClick={() => setClinicas(null)}>
            Voltar
          </Button>
        </div>
      ) : (
        <Form {...form}>
          <form onSubmit={form.handleSubmit((d) => entrar(d))} className="space-y-4" noValidate>
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>E-mail</FormLabel>
                  <FormControl>
                    <Input type="email" autoComplete="email" placeholder="voce@clinica.com.br" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="senha"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-center justify-between gap-2">
                    <FormLabel>Senha</FormLabel>
                    <Link to="/esqueci-senha" className="text-xs font-medium text-primary hover:underline">
                      Esqueci minha senha
                    </Link>
                  </div>
                  <FormControl>
                    <Input type="password" autoComplete="current-password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" className="w-full" disabled={login.isPending}>
              {login.isPending && <Loader2 className="size-4 animate-spin" />}
              Entrar
            </Button>
          </form>
        </Form>
      )}
    </LayoutPublico>
  );
}
