import { useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useRedefinirSenha, useValidarTokenRedefinicao } from '@/api/auth';
import { ErroApi, mensagemDeErro } from '@/api/cliente';
import { useAuth } from '@/contextos/AuthContext';
import { Carregando } from '@/componentes/comum';
import { Button } from '@/componentes/ui/button';
import { Input } from '@/componentes/ui/input';
import { Alert, AlertDescription } from '@/componentes/ui/alert';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/componentes/ui/form';
import { LayoutPublico } from './LayoutPublico';

const esquema = z
  .object({
    senha: z.string().min(6, 'A senha deve ter pelo menos 6 caracteres').max(100, 'Senha longa demais'),
    confirmacao: z.string(),
  })
  .refine((d) => d.senha === d.confirmacao, { path: ['confirmacao'], message: 'As senhas não conferem' });
type Dados = z.infer<typeof esquema>;

/** Enquanto a página estiver aberta, o navegador não manda Referer (o token está na URL). */
function useSemReferer() {
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'referrer';
    meta.content = 'no-referrer';
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);
}

function LinkInvalido({ mensagem }: { mensagem: string }) {
  return (
    <LayoutPublico
      titulo="Link inválido"
      rodape={
        <Link to="/login" className="font-medium text-primary hover:underline">
          Voltar para o login
        </Link>
      }
    >
      <Alert variant="destructive" className="mb-4">
        <AlertDescription>{mensagem}</AlertDescription>
      </Alert>
      <Button asChild className="w-full">
        <Link to="/esqueci-senha">Pedir novo link</Link>
      </Button>
    </LayoutPublico>
  );
}

/** Página do link "redefinir senha" (e-mail): confere o link e grava a nova senha. */
export default function PaginaRedefinirSenha() {
  useSemReferer();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const { tokenClinica, sairClinica } = useAuth();
  const validacao = useValidarTokenRedefinicao(token);
  const redefinir = useRedefinirSenha();
  const form = useForm<Dados>({ resolver: zodResolver(esquema), defaultValues: { senha: '', confirmacao: '' } });

  const mensagemInvalido = 'Este link é inválido ou expirou. Peça um novo.';

  if (!token) return <LinkInvalido mensagem={mensagemInvalido} />;
  if (validacao.isPending) return <Carregando telaCheia texto="Conferindo o link…" />;
  if (validacao.isError) {
    const erro = validacao.error;
    return (
      <LinkInvalido
        mensagem={erro instanceof ErroApi && erro.codigo === 'token_invalido' ? erro.mensagem : mensagemDeErro(erro)}
      />
    );
  }

  async function salvar(dados: Dados) {
    try {
      await redefinir.mutateAsync({ token, senha: dados.senha });
    } catch {
      return; // o erro aparece no alerta abaixo
    }
    // A troca de senha invalidou as sessões abertas: limpa a deste navegador, se houver.
    if (tokenClinica) sairClinica();
    toast.success('Senha alterada. Entre com a nova senha.');
    navigate('/login', { replace: true });
  }

  const linkExpirou = redefinir.error instanceof ErroApi && redefinir.error.codigo === 'token_invalido';

  return (
    <LayoutPublico
      titulo="Criar nova senha"
      subtitulo={
        <>
          Acesso de <strong className="text-foreground">{validacao.data.email}</strong> na{' '}
          <strong className="text-foreground">{validacao.data.clinica}</strong>.
        </>
      }
      rodape={
        <Link to="/login" className="font-medium text-primary hover:underline">
          Voltar para o login
        </Link>
      }
    >
      {redefinir.isError && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>
            <p>
              {mensagemDeErro(redefinir.error)}{' '}
              {linkExpirou && (
                <Link to="/esqueci-senha" className="font-medium underline">
                  Pedir novo link
                </Link>
              )}
            </p>
          </AlertDescription>
        </Alert>
      )}
      <Form {...form}>
        <form onSubmit={form.handleSubmit(salvar)} className="space-y-4" noValidate>
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
                <FormLabel>Confirmar nova senha</FormLabel>
                <FormControl>
                  <Input type="password" autoComplete="new-password" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button type="submit" className="w-full" disabled={redefinir.isPending}>
            {redefinir.isPending && <Loader2 className="size-4 animate-spin" />}
            Salvar nova senha
          </Button>
        </form>
      </Form>
    </LayoutPublico>
  );
}
