/**
 * Aba "Configuração": servidor SMTP (Resend por padrão), remetente, envio ativo e e-mail de teste.
 * A senha/API key nunca volta da API — o campo vazio mantém a salva.
 */
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CheckCircle2, Loader2, Mail, Send, Server, Wand2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import {
  useConfiguracaoEmail,
  useSalvarConfiguracaoEmail,
  useTestarConfiguracaoEmail,
  type ConfiguracaoEmail,
} from '@/api/adminEmail';
import { mensagemDeErro } from '@/api/cliente';
import { useAdminMe } from '@/api/me';
import { Carregando } from '@/componentes/comum';
import { Alert, AlertDescription, AlertTitle } from '@/componentes/ui/alert';
import { Badge } from '@/componentes/ui/badge';
import { Button } from '@/componentes/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/componentes/ui/card';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/componentes/ui/form';
import { Input } from '@/componentes/ui/input';
import { Label } from '@/componentes/ui/label';
import { Separator } from '@/componentes/ui/separator';
import { Switch } from '@/componentes/ui/switch';
import { formatarDataHora } from '@/lib/formatos';
import { ErroCarregar } from '../comum';
import { TutorialResend } from './TutorialResend';

const RESEND = { smtp_host: 'smtp.resend.com', smtp_porta: '465', smtp_seguro: true, smtp_usuario: 'resend' } as const;

const emailOpcional = z
  .string()
  .trim()
  .max(200, 'E-mail muito longo')
  .refine((v) => !v || z.email().safeParse(v).success, 'E-mail inválido');

const esquema = z.object({
  smtp_host: z
    .string()
    .trim()
    .min(1, 'Informe o servidor SMTP')
    .regex(/^[A-Za-z0-9.-]+$/, 'Servidor inválido (ex.: smtp.resend.com)'),
  smtp_porta: z
    .string()
    .trim()
    .refine((v) => /^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= 65535, 'Porta entre 1 e 65535'),
  smtp_seguro: z.boolean(),
  smtp_usuario: z.string().trim().min(1, 'Informe o usuário'),
  smtp_senha: z.string().trim().max(1000, 'Valor muito longo'),
  remetente_nome: z
    .string()
    .trim()
    .min(1, 'Informe o nome do remetente')
    .max(100, 'Máximo de 100 caracteres')
    .refine((v) => !/[<>"]/.test(v), 'Não use aspas nem < >'),
  remetente_email: emailOpcional,
  responder_para: emailOpcional,
  ativo: z.boolean(),
});
type Campos = z.infer<typeof esquema>;

function valoresIniciais(c: ConfiguracaoEmail): Campos {
  return {
    smtp_host: c.smtp_host,
    smtp_porta: String(c.smtp_porta),
    smtp_seguro: c.smtp_seguro,
    smtp_usuario: c.smtp_usuario,
    smtp_senha: '',
    remetente_nome: c.remetente_nome,
    remetente_email: c.remetente_email ?? '',
    responder_para: c.responder_para ?? '',
    ativo: c.ativo,
  };
}

export function BadgeStatusEnvio({ config }: { config: ConfiguracaoEmail }) {
  if (!config.completa) {
    return (
      <Badge variant="outline" className="border-warning/40 bg-warning/15 text-amber-700 dark:text-amber-300">
        Incompleto
      </Badge>
    );
  }
  return config.ativo ? (
    <Badge variant="outline" className="border-success/30 bg-success/10 text-success">
      <span className="size-1.5 rounded-full bg-success" /> Ativo
    </Badge>
  ) : (
    <Badge variant="outline" className="text-muted-foreground">
      Desativado
    </Badge>
  );
}

export default function AbaConfiguracao() {
  const { data, isLoading, isError, error, refetch } = useConfiguracaoEmail();
  if (isLoading) return <Carregando />;
  if (isError || !data) return <ErroCarregar mensagem={mensagemDeErro(error)} aoTentar={() => refetch()} />;
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <FormularioConfiguracao key={data.atualizado_em} config={data} />
      <div className="xl:sticky xl:top-4 xl:self-start">
        <TutorialResend abertoPorPadrao={!data.completa} />
      </div>
    </div>
  );
}

function FormularioConfiguracao({ config }: { config: ConfiguracaoEmail }) {
  const salvar = useSalvarConfiguracaoEmail();
  const form = useForm<Campos>({ resolver: zodResolver(esquema), defaultValues: valoresIniciais(config) });

  function preencherResend() {
    const opcoes = { shouldDirty: true, shouldValidate: true };
    form.setValue('smtp_host', RESEND.smtp_host, opcoes);
    form.setValue('smtp_porta', RESEND.smtp_porta, opcoes);
    form.setValue('smtp_seguro', RESEND.smtp_seguro, opcoes);
    form.setValue('smtp_usuario', RESEND.smtp_usuario, opcoes);
    toast.info('Servidor do Resend preenchido. Cole a API key no campo "Senha / API key" e salve.');
  }

  function aoSalvar(v: Campos) {
    if (v.ativo) {
      if (!config.senha_definida && !v.smtp_senha) {
        form.setError('smtp_senha', { message: 'Informe a senha (API key) para ativar o envio.' });
        return;
      }
      if (!v.remetente_email) {
        form.setError('remetente_email', { message: 'Informe o e-mail do remetente para ativar o envio.' });
        return;
      }
    }
    salvar.mutate(
      {
        smtp_host: v.smtp_host,
        smtp_porta: Number(v.smtp_porta),
        smtp_seguro: v.smtp_seguro,
        smtp_usuario: v.smtp_usuario,
        ...(v.smtp_senha && { smtp_senha: v.smtp_senha }),
        remetente_nome: v.remetente_nome,
        remetente_email: v.remetente_email,
        responder_para: v.responder_para,
        ativo: v.ativo,
      },
      {
        onSuccess: (salva) =>
          toast.success(salva.ativo ? 'Configuração salva. Envio de e-mails ativo.' : 'Configuração salva.'),
        onError: (e) => toast.error(mensagemDeErro(e)),
      },
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              Servidor de envio <BadgeStatusEnvio config={config} />
            </CardTitle>
            <CardDescription>Atualizado em {formatarDataHora(config.atualizado_em)}</CardDescription>
          </div>
          <Button type="button" variant="outline" onClick={preencherResend}>
            <Wand2 /> Preencher para o Resend
          </Button>
        </div>
        {!config.ativo && (
          <Alert className="mt-3">
            <Mail />
            <AlertTitle>Envio desligado</AlertTitle>
            <AlertDescription>
              <p>Nenhum e-mail sai enquanto o envio estiver desligado: eles ficam registrados como "Ignorado" na aba Envios.</p>
            </AlertDescription>
          </Alert>
        )}
      </CardHeader>
      <CardContent className="space-y-8">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(aoSalvar)} className="space-y-6">
            <section className="space-y-4">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <Server className="size-4 text-muted-foreground" /> Servidor SMTP
              </h3>
              <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_8rem]">
                <FormField
                  control={form.control}
                  name="smtp_host"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Servidor (host)</FormLabel>
                      <FormControl>
                        <Input placeholder="smtp.resend.com" autoComplete="off" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="smtp_porta"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Porta</FormLabel>
                      <FormControl>
                        <Input type="number" min={1} max={65535} inputMode="numeric" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="smtp_seguro"
                render={({ field }) => (
                  <FormItem className="flex items-start justify-between gap-4 rounded-lg border p-3">
                    <div className="space-y-0.5">
                      <FormLabel>TLS implícito (SSL)</FormLabel>
                      <FormDescription>Ligado para a porta 465. Desligado usa STARTTLS (porta 587).</FormDescription>
                    </div>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="smtp_usuario"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Usuário</FormLabel>
                      <FormControl>
                        <Input autoComplete="off" {...field} />
                      </FormControl>
                      <FormDescription>No Resend é sempre "resend".</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="smtp_senha"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Senha / API key</FormLabel>
                      <FormControl>
                        <Input
                          type="password"
                          autoComplete="new-password"
                          placeholder={config.senha_definida ? `${config.senha_mascarada} (salva)` : 're_…'}
                          {...field}
                        />
                      </FormControl>
                      <FormDescription>
                        {config.senha_definida ? 'Deixe em branco para manter a salva.' : 'No Resend, cole a API key (começa com re_).'}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </section>

            <Separator />

            <section className="space-y-4">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <Mail className="size-4 text-muted-foreground" /> Remetente
              </h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="remetente_nome"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Nome do remetente</FormLabel>
                      <FormControl>
                        <Input placeholder="Sistema Clínica" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="remetente_email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>E-mail do remetente</FormLabel>
                      <FormControl>
                        <Input type="email" placeholder="nao-responda@avisos.seudominio.com.br" {...field} />
                      </FormControl>
                      <FormDescription>Precisa ser do domínio verificado no Resend.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="responder_para"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Responder para (opcional)</FormLabel>
                    <FormControl>
                      <Input type="email" placeholder="suporte@seudominio.com.br" {...field} />
                    </FormControl>
                    <FormDescription>Quando a clínica responder um e-mail, a resposta vai para este endereço.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </section>

            <Separator />

            <FormField
              control={form.control}
              name="ativo"
              render={({ field }) => (
                <FormItem className="flex items-start justify-between gap-4 rounded-lg border p-3">
                  <div className="space-y-0.5">
                    <FormLabel>Envio ativo</FormLabel>
                    <FormDescription>Ligue depois de enviar um teste com sucesso.</FormDescription>
                  </div>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                </FormItem>
              )}
            />

            <div className="flex justify-end">
              <Button type="submit" disabled={salvar.isPending}>
                {salvar.isPending && <Loader2 className="animate-spin" />}
                Salvar
              </Button>
            </div>
          </form>
        </Form>

        <Separator />

        <EnviarTeste config={config} alterado={form.formState.isDirty} />
      </CardContent>
    </Card>
  );
}

function EnviarTeste({ config, alterado }: { config: ConfiguracaoEmail; alterado: boolean }) {
  const { data: adminMe } = useAdminMe();
  const testar = useTestarConfiguracaoEmail();
  const [para, setPara] = useState('');
  const [resultado, setResultado] = useState<{ ok: boolean; mensagem: string } | null>(null);
  const destino = para || adminMe?.usuario.email || '';
  const valido = z.email().safeParse(destino).success;

  function aoTestar() {
    setResultado(null);
    testar.mutate(destino, {
      onSuccess: () =>
        setResultado({ ok: true, mensagem: `E-mail de teste enviado para ${destino}. Confira a caixa de entrada (e o spam).` }),
      onError: (e) => setResultado({ ok: false, mensagem: mensagemDeErro(e) }),
    });
  }

  return (
    <section className="space-y-3">
      <div>
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Send className="size-4 text-muted-foreground" /> Enviar e-mail de teste
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Usa a configuração <strong>salva</strong> (funciona mesmo com o envio desligado).
          {alterado && ' Você tem alterações não salvas — salve antes de testar.'}
        </p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="email-teste">Enviar para</Label>
          <Input
            id="email-teste"
            type="email"
            value={para}
            placeholder={adminMe?.usuario.email ?? 'seu@email.com'}
            onChange={(e) => setPara(e.target.value)}
          />
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={aoTestar}
          disabled={!config.completa || !valido || testar.isPending}
          title={config.completa ? undefined : 'Salve a senha (API key) e o e-mail do remetente antes de testar'}
        >
          {testar.isPending ? <Loader2 className="animate-spin" /> : <Send />}
          Enviar e-mail de teste
        </Button>
      </div>
      {resultado && (
        <Alert variant={resultado.ok ? 'default' : 'destructive'}>
          {resultado.ok ? <CheckCircle2 className="text-success" /> : <XCircle />}
          <AlertTitle>{resultado.ok ? 'Teste enviado' : 'Falha no envio'}</AlertTitle>
          <AlertDescription>
            <p>{resultado.mensagem}</p>
          </AlertDescription>
        </Alert>
      )}
    </section>
  );
}
