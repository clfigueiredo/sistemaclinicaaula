import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2, ShieldCheck } from 'lucide-react';
import { useLoginAdmin } from '@/api/auth';
import { mensagemDeErro } from '@/api/cliente';
import { useAuth } from '@/contextos/AuthContext';
import { Logo } from '@/componentes/comum';
import { Button } from '@/componentes/ui/button';
import { Input } from '@/componentes/ui/input';
import { Alert, AlertDescription } from '@/componentes/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/componentes/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/componentes/ui/form';

const esquema = z.object({
  email: z.string().trim().min(1, 'Informe o e-mail').pipe(z.email('E-mail inválido')),
  senha: z.string().min(1, 'Informe a senha'),
});
type Dados = z.infer<typeof esquema>;

export default function PaginaLoginAdmin() {
  const navigate = useNavigate();
  const location = useLocation();
  const { entrarAdmin } = useAuth();
  const login = useLoginAdmin();
  const form = useForm<Dados>({ resolver: zodResolver(esquema), defaultValues: { email: '', senha: '' } });
  const destino = (location.state as { de?: string } | null)?.de ?? '/admin';

  async function entrar(dados: Dados) {
    const r = await login.mutateAsync(dados).catch(() => null);
    if (!r) return;
    entrarAdmin(r.token);
    navigate(destino, { replace: true });
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-muted/40 px-4 py-10">
      <Logo className="mb-8" />
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="mb-2 grid size-10 place-items-center rounded-full bg-primary/10 text-primary">
            <ShieldCheck className="size-5" />
          </div>
          <CardTitle>Painel administrativo</CardTitle>
          <CardDescription>Acesso restrito à administração da plataforma.</CardDescription>
        </CardHeader>
        <CardContent>
          {login.isError && (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>{mensagemDeErro(login.error)}</AlertDescription>
            </Alert>
          )}
          <Form {...form}>
            <form onSubmit={form.handleSubmit(entrar)} className="space-y-4" noValidate>
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>E-mail</FormLabel>
                    <FormControl>
                      <Input type="email" autoComplete="username" {...field} />
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
                    <FormLabel>Senha</FormLabel>
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
        </CardContent>
      </Card>
      <Link to="/login" className="mt-6 text-sm text-muted-foreground hover:text-foreground">
        Sou usuário de uma clínica
      </Link>
    </div>
  );
}
