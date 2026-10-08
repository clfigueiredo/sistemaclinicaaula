import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2, MailCheck } from 'lucide-react';
import { useEsqueciSenha } from '@/api/auth';
import { mensagemDeErro } from '@/api/cliente';
import { Button } from '@/componentes/ui/button';
import { Input } from '@/componentes/ui/input';
import { Alert, AlertDescription } from '@/componentes/ui/alert';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/componentes/ui/form';
import { LayoutPublico } from './LayoutPublico';

const esquema = z.object({
  email: z.string().trim().min(1, 'Informe o e-mail').pipe(z.email('E-mail inválido')),
});
type Dados = z.infer<typeof esquema>;

/** "Esqueci minha senha": pede o link por e-mail. A resposta é sempre a mesma (não revela se o e-mail existe). */
export default function PaginaEsqueciSenha() {
  const pedir = useEsqueciSenha();
  const form = useForm<Dados>({ resolver: zodResolver(esquema), defaultValues: { email: '' } });

  const rodape = (
    <Link to="/login" className="font-medium text-primary hover:underline">
      Voltar para o login
    </Link>
  );

  if (pedir.isSuccess) {
    return (
      <LayoutPublico titulo="Confira seu e-mail" rodape={rodape}>
        <Alert>
          <MailCheck className="size-4" />
          <AlertDescription>
            <p>
              Se este e-mail estiver cadastrado, você vai receber em instantes um link para criar uma nova senha.
              Confira também a caixa de spam.
            </p>
          </AlertDescription>
        </Alert>
      </LayoutPublico>
    );
  }

  return (
    <LayoutPublico
      titulo="Esqueci minha senha"
      subtitulo="Informe o e-mail que você usa para entrar. Vamos enviar um link para criar uma nova senha."
      rodape={rodape}
    >
      {pedir.isError && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{mensagemDeErro(pedir.error)}</AlertDescription>
        </Alert>
      )}
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit((d) => pedir.mutate({ email: d.email }))}
          className="space-y-4"
          noValidate
        >
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>E-mail</FormLabel>
                <FormControl>
                  <Input type="email" autoComplete="email" placeholder="voce@clinica.com.br" autoFocus {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button type="submit" className="w-full" disabled={pedir.isPending}>
            {pedir.isPending && <Loader2 className="size-4 animate-spin" />}
            Enviar link
          </Button>
        </form>
      </Form>
    </LayoutPublico>
  );
}
