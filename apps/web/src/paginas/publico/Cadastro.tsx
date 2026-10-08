import { Link, useLocation, useNavigate } from 'react-router-dom';
import { destinoAposCadastro } from '@/componentes/layout/Guardas';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { useCadastro } from '@/api/auth';
import { ErroApi, mensagemDeErro } from '@/api/cliente';
import { useAuth } from '@/contextos/AuthContext';
import { Button } from '@/componentes/ui/button';
import { Input } from '@/componentes/ui/input';
import { Alert, AlertDescription } from '@/componentes/ui/alert';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/componentes/ui/form';
import { mascararCpfCnpj, mascararTelefone, somenteDigitos, validarCpfOuCnpj } from '@/lib/formatos';
import { LayoutPublico } from './LayoutPublico';

const esquema = z
  .object({
    nomeClinica: z.string().trim().min(2, 'Informe o nome da clínica'),
    documento: z.string().refine(validarCpfOuCnpj, 'CPF ou CNPJ inválido'),
    responsavel: z.string().trim().min(2, 'Informe seu nome'),
    email: z.string().trim().min(1, 'Informe o e-mail').pipe(z.email('E-mail inválido')),
    telefone: z.string().refine((t) => {
      const n = somenteDigitos(t).length;
      return n >= 10 && n <= 11;
    }, 'Telefone inválido'),
    senha: z.string().min(6, 'A senha deve ter pelo menos 6 caracteres'),
    confirmacao: z.string(),
  })
  .refine((d) => d.senha === d.confirmacao, { path: ['confirmacao'], message: 'As senhas não conferem' });
type Dados = z.infer<typeof esquema>;

const CAMPOS_API: Record<string, keyof Dados> = {
  'body.nomeClinica': 'nomeClinica',
  'body.documento': 'documento',
  'body.responsavel': 'responsavel',
  'body.email': 'email',
  'body.telefone': 'telefone',
  'body.senha': 'senha',
};

export default function PaginaCadastro() {
  const navigate = useNavigate();
  const location = useLocation();
  const { entrarClinica } = useAuth();
  const cadastro = useCadastro();
  const form = useForm<Dados>({
    resolver: zodResolver(esquema),
    defaultValues: { nomeClinica: '', documento: '', responsavel: '', email: '', telefone: '', senha: '', confirmacao: '' },
  });

  async function cadastrar({ confirmacao: _c, ...dados }: Dados) {
    try {
      const r = await cadastro.mutateAsync({
        ...dados,
        documento: somenteDigitos(dados.documento),
        telefone: somenteDigitos(dados.telefone),
      });
      entrarClinica(r.token);
      navigate(destinoAposCadastro(location.search), { replace: true });
    } catch (e) {
      if (e instanceof ErroApi) {
        if (e.codigo === 'email_em_uso') form.setError('email', { message: e.mensagem });
        if (e.codigo === 'documento_em_uso') form.setError('documento', { message: e.mensagem });
        for (const d of e.detalhes) {
          const campo = CAMPOS_API[d.campo];
          if (campo) form.setError(campo, { message: d.mensagem });
        }
      }
    }
  }

  const erroGeral =
    cadastro.error instanceof ErroApi && ['email_em_uso', 'documento_em_uso', 'validacao'].includes(cadastro.error.codigo)
      ? null
      : cadastro.error;

  return (
    <LayoutPublico
      largo
      titulo="Comece seu teste grátis"
      subtitulo={
        <span className="inline-flex items-center gap-1.5">
          <CheckCircle2 className="size-4 text-primary" />
          Todas as funções liberadas, sem cartão de crédito e sem prazo.
        </span>
      }
      rodape={
        <>
          Já tem conta?{' '}
          <Link to="/login" className="font-medium text-primary hover:underline">
            Entrar
          </Link>
        </>
      }
    >
      {erroGeral && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{mensagemDeErro(erroGeral)}</AlertDescription>
        </Alert>
      )}
      <Form {...form}>
        <form onSubmit={form.handleSubmit(cadastrar)} className="grid gap-4 sm:grid-cols-2" noValidate>
          <FormField
            control={form.control}
            name="nomeClinica"
            render={({ field }) => (
              <FormItem className="sm:col-span-2">
                <FormLabel>Nome da clínica</FormLabel>
                <FormControl>
                  <Input autoComplete="organization" placeholder="Clínica Bem Estar" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="documento"
            render={({ field }) => (
              <FormItem>
                <FormLabel>CNPJ ou CPF</FormLabel>
                <FormControl>
                  <Input
                    inputMode="numeric"
                    placeholder="00.000.000/0000-00"
                    {...field}
                    onChange={(e) => field.onChange(mascararCpfCnpj(e.target.value))}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="telefone"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Telefone</FormLabel>
                <FormControl>
                  <Input
                    inputMode="tel"
                    autoComplete="tel"
                    placeholder="(11) 99999-9999"
                    {...field}
                    onChange={(e) => field.onChange(mascararTelefone(e.target.value))}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="responsavel"
            render={({ field }) => (
              <FormItem className="sm:col-span-2">
                <FormLabel>Seu nome (responsável)</FormLabel>
                <FormControl>
                  <Input autoComplete="name" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem className="sm:col-span-2">
                <FormLabel>E-mail de acesso</FormLabel>
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
                <FormLabel>Senha</FormLabel>
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
          <Button type="submit" className="w-full sm:col-span-2" disabled={cadastro.isPending}>
            {cadastro.isPending && <Loader2 className="size-4 animate-spin" />}
            Criar conta grátis
          </Button>
          <p className="text-center text-xs text-muted-foreground sm:col-span-2">
            Ao criar a conta você concorda com os termos de uso e a política de privacidade.
          </p>
        </form>
      </Form>
    </LayoutPublico>
  );
}
