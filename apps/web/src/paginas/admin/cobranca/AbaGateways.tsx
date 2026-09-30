/**
 * Aba "Gateways": configuração de Asaas, Stripe e Mercado Pago (credenciais cifradas no backend — nunca
 * voltam em claro), ativação (só um ativo), teste de conexão, URL do webhook e instruções de cada painel.
 */
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CheckCircle2, KeyRound, Loader2, PlugZap, Power, ShieldCheck, Trash2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import {
  useAtivarGateway,
  useDesativarGateway,
  useGatewaysPagamento,
  useSalvarGateway,
  useTestarGateway,
  type DadosGateway,
  type GatewayConfigurado,
} from '@/api/adminCobranca';
import { mensagemDeErro } from '@/api/cliente';
import { ROTULOS_METODO_COBRANCA, type MetodoCobranca, type ProvedorPagamento } from '@/api/tipos';
import { Carregando } from '@/componentes/comum';
import { Alert, AlertDescription, AlertTitle } from '@/componentes/ui/alert';
import { Badge } from '@/componentes/ui/badge';
import { Button } from '@/componentes/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/componentes/ui/card';
import { Checkbox } from '@/componentes/ui/checkbox';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/componentes/ui/form';
import { Input } from '@/componentes/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/componentes/ui/select';
import { Separator } from '@/componentes/ui/separator';
import { formatarDataHora } from '@/lib/formatos';
import { cn } from '@/lib/utils';
import { DialogoConfirmacao, ErroCarregar } from '../comum';
import { BotaoCopiar, LogoGateway } from './comum';

// ----------------------------------------------------------------------------- textos por gateway

type Campo = { chave: 'api_key' | 'secret_key' | 'publishable_key' | 'access_token' | 'public_key'; rotulo: string; dica?: string };

const CAMPOS: Record<ProvedorPagamento, { principal: Campo; publica?: Campo; webhook: { rotulo: string; dica: string } }> = {
  asaas: {
    principal: { chave: 'api_key', rotulo: 'Chave de API (API key)', dica: 'Começa com $aact_.' },
    webhook: {
      rotulo: 'Token de autenticação do webhook',
      dica: 'O mesmo token informado no cadastro do webhook no Asaas (enviado no header asaas-access-token).',
    },
  },
  stripe: {
    principal: { chave: 'secret_key', rotulo: 'Secret key', dica: 'sk_test_… em sandbox, sk_live_… em produção.' },
    publica: { chave: 'publishable_key', rotulo: 'Publishable key (opcional)', dica: 'pk_test_… / pk_live_…' },
    webhook: { rotulo: 'Signing secret do webhook', dica: 'Começa com whsec_. Aparece no endpoint criado no Stripe.' },
  },
  mercado_pago: {
    principal: { chave: 'access_token', rotulo: 'Access token', dica: 'Credencial de teste em sandbox; de produção em produção.' },
    publica: { chave: 'public_key', rotulo: 'Public key (opcional)' },
    webhook: { rotulo: 'Assinatura secreta do webhook', dica: 'Gerada em "Webhooks" na sua aplicação do Mercado Pago.' },
  },
};

const INSTRUCOES: Record<ProvedorPagamento, { painel: string; passos: string[] }> = {
  asaas: {
    painel: 'Sandbox: sandbox.asaas.com · Produção: www.asaas.com',
    passos: [
      'Em Integrações → Chaves de API, gere a chave e cole em "Chave de API".',
      'Em Integrações → Webhooks → Adicionar webhook: cole a URL abaixo, versão da API v3, fila de sincronização ativada.',
      'Marque os eventos de Cobranças (PAYMENT_RECEIVED, PAYMENT_CONFIRMED, PAYMENT_OVERDUE, PAYMENT_DELETED, PAYMENT_REFUNDED).',
      'Defina um "Token de autenticação" e cole o mesmo valor em "Token de autenticação do webhook".',
    ],
  },
  stripe: {
    painel: 'dashboard.stripe.com (ative o "Modo de teste" para sandbox)',
    passos: [
      'Em Desenvolvedores → Chaves de API, copie a chave secreta (sk_test_… ou sk_live_…).',
      'Em Desenvolvedores → Webhooks → Adicionar destino/endpoint: cole a URL abaixo.',
      'Selecione os eventos invoice.paid, invoice.overdue, invoice.voided, invoice.marked_uncollectible e charge.refunded.',
      'Copie o "Signing secret" (whsec_…) do endpoint e cole em "Signing secret do webhook". Pix não é oferecido em faturas do Stripe.',
    ],
  },
  mercado_pago: {
    painel: 'mercadopago.com.br/developers → Suas integrações',
    passos: [
      'Crie (ou abra) sua aplicação e copie o Access token em Credenciais de teste (sandbox) ou de produção.',
      'Em Webhooks → Configurar notificações: cole a URL abaixo no modo correspondente (teste ou produção).',
      'Marque o evento "Pagamentos" e salve.',
      'Copie a "Assinatura secreta" gerada e cole em "Assinatura secreta do webhook". Não use as notificações IPN (não são assinadas).',
    ],
  },
};

// ----------------------------------------------------------------------------- página

export default function AbaGateways() {
  const { data, isLoading, isError, error, refetch } = useGatewaysPagamento();
  const [selecionado, setSelecionado] = useState<ProvedorPagamento>('asaas');

  if (isLoading) return <Carregando />;
  if (isError || !data) return <ErroCarregar mensagem={mensagemDeErro(error)} aoTentar={() => refetch()} />;

  const ativo = data.find((g) => g.ativo);
  const gateway = data.find((g) => g.provedor === selecionado) ?? data[0]!;

  return (
    <div className="space-y-6">
      {!ativo && (
        <Alert>
          <PlugZap />
          <AlertTitle>Nenhum gateway ativo</AlertTitle>
          <AlertDescription>
            <p>Enquanto nenhum gateway estiver ativo, nenhuma cobrança é gerada (nem manual, nem automática). Configure as credenciais, teste a conexão e ative um gateway.</p>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-3 md:grid-cols-3" role="tablist" aria-label="Gateways de pagamento">
        {data.map((g) => (
          <button
            key={g.provedor}
            type="button"
            role="tab"
            aria-selected={g.provedor === selecionado}
            onClick={() => setSelecionado(g.provedor)}
            className={cn(
              'flex items-center gap-3 rounded-xl border bg-card p-4 text-left transition-colors hover:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
              g.provedor === selecionado && 'border-primary ring-1 ring-primary',
            )}
          >
            <LogoGateway provedor={g.provedor} />
            <div className="min-w-0 flex-1">
              <p className="font-medium">{g.nome}</p>
              <div className="mt-1 flex flex-wrap gap-1">
                <StatusConfiguracao gateway={g} />
                {g.configurado && (
                  <Badge variant="outline" className="text-muted-foreground">
                    {g.ambiente === 'sandbox' ? 'Sandbox' : 'Produção'}
                  </Badge>
                )}
              </div>
            </div>
          </button>
        ))}
      </div>

      <DetalheGateway key={`${gateway.provedor}-${gateway.atualizado_em ?? 'novo'}`} gateway={gateway} />
    </div>
  );
}

function StatusConfiguracao({ gateway }: { gateway: GatewayConfigurado }) {
  if (gateway.ativo) {
    return (
      <Badge variant="outline" className="border-success/30 bg-success/10 text-success">
        <span className="size-1.5 rounded-full bg-success" /> Ativo
      </Badge>
    );
  }
  if (gateway.credenciais_ilegiveis) {
    return (
      <Badge variant="outline" className="border-destructive/30 bg-destructive/10 text-destructive">
        Recadastrar credenciais
      </Badge>
    );
  }
  return gateway.configurado ? (
    <Badge variant="outline" className="border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300">
      Configurado
    </Badge>
  ) : (
    <Badge variant="outline" className="text-muted-foreground">
      Não configurado
    </Badge>
  );
}

// ----------------------------------------------------------------------------- detalhe + formulário

const esquema = z.object({
  ambiente: z.enum(['sandbox', 'producao']),
  principal: z.string().trim().max(1000, 'Valor muito longo'),
  publica: z.string().trim().max(1000, 'Valor muito longo'),
  segredo_webhook: z
    .string()
    .trim()
    .max(1000, 'Valor muito longo')
    .refine((v) => !v || v.length >= 8, 'Mínimo de 8 caracteres'),
  dias_tolerancia: z.string().trim().refine((v) => /^\d+$/.test(v) && Number(v) <= 60, 'Informe de 0 a 60 dias'),
  metodos: z.array(z.enum(['pix', 'boleto', 'cartao'])).min(1, 'Selecione ao menos um método'),
  dia_vencimento_padrao: z
    .string()
    .trim()
    .refine((v) => /^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= 28, 'Informe um dia entre 1 e 28'),
  descricao_cobranca: z.string().trim().min(3, 'Descrição muito curta').max(200, 'Máximo de 200 caracteres'),
});
type Campos = z.infer<typeof esquema>;

function DetalheGateway({ gateway }: { gateway: GatewayConfigurado }) {
  const p = gateway.provedor;
  const campos = CAMPOS[p];
  const salvar = useSalvarGateway(p);
  const ativar = useAtivarGateway();
  const desativar = useDesativarGateway();
  const testar = useTestarGateway();
  const [resultadoTeste, setResultadoTeste] = useState<{ ok: boolean; mensagem: string } | null>(null);
  const [confirmar, setConfirmar] = useState<'ativar' | 'desativar' | 'remover_webhook' | null>(null);

  const form = useForm<Campos>({
    resolver: zodResolver(esquema),
    defaultValues: {
      ambiente: gateway.ambiente,
      principal: '',
      publica: '',
      segredo_webhook: '',
      dias_tolerancia: String(gateway.dias_tolerancia),
      metodos: gateway.metodos,
      dia_vencimento_padrao: String(gateway.dia_vencimento_padrao),
      descricao_cobranca: gateway.descricao_cobranca,
    },
  });

  useEffect(() => setResultadoTeste(null), [p]);

  function aoSalvar(v: Campos) {
    if (!gateway.configurado && !v.principal) {
      form.setError('principal', { message: 'Informe a credencial para configurar o gateway.' });
      return;
    }
    const credenciais: NonNullable<DadosGateway['credenciais']> = {};
    if (v.principal) credenciais[campos.principal.chave] = v.principal;
    if (campos.publica && v.publica) credenciais[campos.publica.chave] = v.publica;
    salvar.mutate(
      {
        ambiente: v.ambiente,
        ...(Object.keys(credenciais).length && { credenciais }),
        ...(v.segredo_webhook && { segredo_webhook: v.segredo_webhook }),
        dias_tolerancia: Number(v.dias_tolerancia),
        metodos: v.metodos,
        dia_vencimento_padrao: Number(v.dia_vencimento_padrao),
        descricao_cobranca: v.descricao_cobranca,
      },
      {
        onSuccess: () => {
          toast.success(`Configuração do ${gateway.nome} salva.`);
          setResultadoTeste(null);
        },
        onError: (e) => toast.error(mensagemDeErro(e)),
      },
    );
  }

  function executarConfirmacao() {
    const fechar = { onSettled: () => setConfirmar(null), onError: (e: unknown) => toast.error(mensagemDeErro(e)) };
    if (confirmar === 'ativar') {
      ativar.mutate(p, { ...fechar, onSuccess: () => toast.success(`${gateway.nome} ativado. As próximas cobranças usam este gateway.`) });
    } else if (confirmar === 'desativar') {
      desativar.mutate(p, { ...fechar, onSuccess: () => toast.success(`${gateway.nome} desativado.`) });
    } else if (confirmar === 'remover_webhook') {
      salvar.mutate({ segredo_webhook: null }, { ...fechar, onSuccess: () => toast.success('Segredo do webhook removido.') });
    }
  }

  function aoTestar() {
    setResultadoTeste(null);
    testar.mutate(p, {
      onSuccess: (r) => setResultadoTeste(r),
      onError: (e) => setResultadoTeste({ ok: false, mensagem: mensagemDeErro(e) }),
    });
  }

  const salvo = (final: string | null) => (final !== null ? `Salvo (termina em ${final || '••••'}) — deixe em branco para manter` : undefined);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-3">
            <LogoGateway provedor={p} className="size-12 text-lg" />
            <div>
              <CardTitle className="flex items-center gap-2">
                {gateway.nome} <StatusConfiguracao gateway={gateway} />
              </CardTitle>
              <CardDescription>
                {gateway.atualizado_em ? `Atualizado em ${formatarDataHora(gateway.atualizado_em)}` : 'Ainda não configurado.'}
              </CardDescription>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={aoTestar} disabled={!gateway.configurado || testar.isPending}>
              {testar.isPending ? <Loader2 className="animate-spin" /> : <PlugZap />}
              Testar conexão
            </Button>
            {gateway.ativo ? (
              <Button variant="outline" onClick={() => setConfirmar('desativar')}>
                <Power /> Desativar
              </Button>
            ) : (
              <Button
                onClick={() => setConfirmar('ativar')}
                disabled={!gateway.configurado}
                title={gateway.configurado ? undefined : 'Salve as credenciais antes de ativar'}
              >
                <Power /> Ativar
              </Button>
            )}
          </div>
        </div>
        {resultadoTeste && (
          <Alert variant={resultadoTeste.ok ? 'default' : 'destructive'} className="mt-3">
            {resultadoTeste.ok ? <CheckCircle2 className="text-success" /> : <XCircle />}
            <AlertTitle>{resultadoTeste.ok ? 'Conexão funcionando' : 'Falha na conexão'}</AlertTitle>
            <AlertDescription>
              <p>{resultadoTeste.mensagem}</p>
            </AlertDescription>
          </Alert>
        )}
        {gateway.credenciais_ilegiveis && (
          <Alert variant="destructive" className="mt-3">
            <XCircle />
            <AlertTitle>Credenciais ilegíveis</AlertTitle>
            <AlertDescription>
              <p>As credenciais salvas não puderam ser decifradas (a CHAVE_CRIPTOGRAFIA do servidor mudou?). Informe-as novamente.</p>
            </AlertDescription>
          </Alert>
        )}
      </CardHeader>

      <CardContent className="grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(aoSalvar)} className="space-y-6">
            <section className="space-y-4">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <KeyRound className="size-4 text-muted-foreground" /> Credenciais
              </h3>
              <FormField
                control={form.control}
                name="ambiente"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Ambiente</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full sm:w-60">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="sandbox">Sandbox (testes)</SelectItem>
                        <SelectItem value="producao">Produção</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <CampoSegredo
                form={form}
                nome="principal"
                rotulo={campos.principal.rotulo}
                dica={campos.principal.dica}
                placeholder={salvo(gateway.credenciais_final)}
              />
              {campos.publica && (
                <CampoSegredo form={form} nome="publica" rotulo={campos.publica.rotulo} dica={campos.publica.dica} placeholder={gateway.configurado ? 'Deixe em branco para manter' : undefined} />
              )}
              <div className="space-y-2">
                <CampoSegredo
                  form={form}
                  nome="segredo_webhook"
                  rotulo={campos.webhook.rotulo}
                  dica={campos.webhook.dica}
                  placeholder={salvo(gateway.segredo_webhook_final)}
                />
                {gateway.segredo_webhook_configurado && (
                  <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={() => setConfirmar('remover_webhook')}>
                    <Trash2 /> Remover segredo do webhook
                  </Button>
                )}
                {!gateway.segredo_webhook_configurado && gateway.configurado && (
                  <p className="text-xs text-amber-700 dark:text-amber-300">
                    Sem o segredo do webhook, todas as notificações do {gateway.nome} são recusadas e os pagamentos não são baixados automaticamente.
                  </p>
                )}
              </div>
            </section>

            <Separator />

            <section className="space-y-4">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <ShieldCheck className="size-4 text-muted-foreground" /> Opções de cobrança
              </h3>
              <FormField
                control={form.control}
                name="metodos"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Métodos permitidos</FormLabel>
                    <div className="flex flex-wrap gap-4">
                      {(Object.keys(ROTULOS_METODO_COBRANCA) as MetodoCobranca[]).map((m) => {
                        const indisponivel = p === 'stripe' && m === 'pix';
                        return (
                          <label key={m} className={cn('flex items-center gap-2 text-sm', indisponivel && 'opacity-50')}>
                            <Checkbox
                              checked={field.value.includes(m)}
                              disabled={indisponivel}
                              onCheckedChange={(c) =>
                                field.onChange(c ? [...field.value, m] : field.value.filter((x) => x !== m))
                              }
                            />
                            {ROTULOS_METODO_COBRANCA[m]}
                            {indisponivel && <span className="text-xs text-muted-foreground">(indisponível)</span>}
                          </label>
                        );
                      })}
                    </div>
                    <FormDescription>Quando há mais de um, o cliente escolhe na página de pagamento.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="dias_tolerancia"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Dias de tolerância</FormLabel>
                      <FormControl>
                        <Input type="number" min={0} max={60} inputMode="numeric" {...field} />
                      </FormControl>
                      <FormDescription>Após o vencimento, antes de a assinatura ficar vencida (somente leitura).</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="dia_vencimento_padrao"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Dia de vencimento padrão</FormLabel>
                      <FormControl>
                        <Input type="number" min={1} max={28} inputMode="numeric" {...field} />
                      </FormControl>
                      <FormDescription>Sugerido ao ligar a cobrança automática de uma clínica (1 a 28).</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="descricao_cobranca"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Descrição da cobrança</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormDescription>
                      Use <code className="rounded bg-muted px-1">{'{plano}'}</code> e{' '}
                      <code className="rounded bg-muted px-1">{'{competencia}'}</code> (MM/AAAA).
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </section>

            <div className="flex justify-end">
              <Button type="submit" disabled={salvar.isPending}>
                {salvar.isPending && <Loader2 className="animate-spin" />}
                Salvar configuração
              </Button>
            </div>
          </form>
        </Form>

        <aside className="space-y-4">
          <div className="rounded-lg border bg-muted/30 p-4">
            <p className="text-sm font-semibold">URL do webhook</p>
            <p className="mt-1 text-xs text-muted-foreground">Cadastre esta URL no painel do {gateway.nome}.</p>
            <div className="mt-3 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-md border bg-background px-2 py-1.5 text-xs" title={gateway.url_webhook}>
                {gateway.url_webhook}
              </code>
              <BotaoCopiar texto={gateway.url_webhook} mensagem="URL do webhook copiada." />
            </div>
            {gateway.url_webhook.startsWith('http://') && (
              <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                Endereço local/sem HTTPS: os gateways não conseguem chamá-lo. Em produção defina API_URL_PUBLICA com o domínio
                público (ex.: https://seudominio/api).
              </p>
            )}
          </div>
          <div className="rounded-lg border p-4">
            <p className="text-sm font-semibold">Como configurar no {gateway.nome}</p>
            <p className="mt-1 text-xs text-muted-foreground">{INSTRUCOES[p].painel}</p>
            <ol className="mt-3 list-decimal space-y-2 pl-4 text-sm text-muted-foreground">
              {INSTRUCOES[p].passos.map((passo) => (
                <li key={passo}>{passo}</li>
              ))}
            </ol>
          </div>
        </aside>
      </CardContent>

      <DialogoConfirmacao
        aberto={confirmar !== null}
        aoMudar={(v) => !v && setConfirmar(null)}
        titulo={
          confirmar === 'ativar'
            ? `Ativar ${gateway.nome}?`
            : confirmar === 'desativar'
              ? `Desativar ${gateway.nome}?`
              : 'Remover o segredo do webhook?'
        }
        descricao={
          confirmar === 'ativar'
            ? `Só um gateway fica ativo: ${gateway.nome} passa a gerar todas as novas cobranças (manuais e automáticas). Os outros são desativados; as cobranças já geradas continuam no gateway de origem.`
            : confirmar === 'desativar'
              ? 'Sem gateway ativo nenhuma cobrança nova é gerada. Webhooks das cobranças já emitidas continuam sendo aceitos.'
              : `Sem o segredo, todos os webhooks do ${gateway.nome} passam a ser recusados.`
        }
        perigo={confirmar !== 'ativar'}
        textoConfirmar={confirmar === 'ativar' ? 'Ativar' : confirmar === 'desativar' ? 'Desativar' : 'Remover'}
        carregando={ativar.isPending || desativar.isPending || salvar.isPending}
        aoConfirmar={executarConfirmacao}
      />
    </Card>
  );
}

function CampoSegredo({
  form,
  nome,
  rotulo,
  dica,
  placeholder,
}: {
  form: ReturnType<typeof useForm<Campos>>;
  nome: 'principal' | 'publica' | 'segredo_webhook';
  rotulo: string;
  dica?: string;
  placeholder?: string;
}) {
  return (
    <FormField
      control={form.control}
      name={nome}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{rotulo}</FormLabel>
          <FormControl>
            <Input type="password" autoComplete="new-password" spellCheck={false} placeholder={placeholder} {...field} />
          </FormControl>
          {dica && <FormDescription>{dica}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
