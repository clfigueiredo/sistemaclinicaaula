/**
 * Formulário completo de paciente (usado no cadastro — dialog da lista — e na aba "Dados" da ficha).
 * Telefones vão com máscara; a API normaliza para dígitos com DDI 55.
 */
import { useMemo, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2, MessageCircle } from 'lucide-react';
import { ErroApi } from '@/api/cliente';
import { useConveniosAtivos, type DadosPaciente, type Paciente } from '@/api/pacientes';
import { Button } from '@/componentes/ui/button';
import { Input } from '@/componentes/ui/input';
import { Textarea } from '@/componentes/ui/textarea';
import { Switch } from '@/componentes/ui/switch';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/componentes/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/componentes/ui/select';
import { mascararCpf, mascararTelefone, somenteDigitos, validarCpf } from '@/lib/formatos';
import { telefoneParaCampo } from './utils';

const NENHUM = '__nenhum__';

const telefoneValido = (t: string) => {
  const n = somenteDigitos(t).length;
  return n === 0 || n === 10 || n === 11;
};

const esquema = z
  .object({
    nome: z.string().trim().min(2, 'Informe o nome do paciente'),
    cpf: z.string().refine((v) => !somenteDigitos(v) || validarCpf(v), 'CPF inválido'),
    nascimento: z
      .string()
      .refine((v) => !v || new Date(`${v}T00:00:00`).getTime() <= Date.now(), 'Data no futuro'),
    sexo: z.string(),
    telefone: z.string().refine(telefoneValido, 'Telefone inválido'),
    whatsapp: z.string().refine(telefoneValido, 'Número inválido'),
    email: z.string().trim().refine((v) => !v || z.email().safeParse(v).success, 'E-mail inválido'),
    endereco: z.string(),
    convenio_id: z.string(),
    numero_carteirinha: z.string(),
    contato_emergencia: z.string(),
    aceita_whatsapp: z.boolean(),
    observacoes: z.string(),
  })
  .refine((d) => !d.aceita_whatsapp || somenteDigitos(d.whatsapp).length > 0, {
    path: ['whatsapp'],
    message: 'Informe o WhatsApp para registrar o consentimento',
  });
type Campos = z.infer<typeof esquema>;

const CAMPOS_API: Record<string, keyof Campos> = Object.fromEntries(
  [
    'nome',
    'cpf',
    'nascimento',
    'sexo',
    'telefone',
    'whatsapp',
    'email',
    'endereco',
    'convenio_id',
    'numero_carteirinha',
    'contato_emergencia',
    'observacoes',
  ].map((c) => [`body.${c}`, c as keyof Campos]),
);

function valoresIniciais(p?: Paciente): Campos {
  return {
    nome: p?.nome ?? '',
    cpf: p?.cpf ? mascararCpf(p.cpf) : '',
    nascimento: p?.nascimento ?? '',
    sexo: p?.sexo ?? NENHUM,
    telefone: telefoneParaCampo(p?.telefone),
    whatsapp: telefoneParaCampo(p?.whatsapp),
    email: p?.email ?? '',
    endereco: p?.endereco ?? '',
    convenio_id: p?.convenio_id ?? NENHUM,
    numero_carteirinha: p?.numero_carteirinha ?? '',
    contato_emergencia: p?.contato_emergencia ?? '',
    aceita_whatsapp: p?.aceita_whatsapp ?? false,
    observacoes: p?.observacoes ?? '',
  };
}

const vazioParaNull = (v: string) => (v.trim() ? v.trim() : null);

function paraApi(c: Campos): DadosPaciente {
  return {
    nome: c.nome.trim(),
    cpf: somenteDigitos(c.cpf) || null,
    nascimento: c.nascimento || null,
    sexo: c.sexo === NENHUM ? null : (c.sexo as DadosPaciente['sexo']),
    telefone: somenteDigitos(c.telefone) || null,
    whatsapp: somenteDigitos(c.whatsapp) || null,
    email: vazioParaNull(c.email),
    endereco: vazioParaNull(c.endereco),
    convenio_id: c.convenio_id === NENHUM ? null : c.convenio_id,
    numero_carteirinha: c.convenio_id === NENHUM ? null : vazioParaNull(c.numero_carteirinha),
    contato_emergencia: vazioParaNull(c.contato_emergencia),
    aceita_whatsapp: c.aceita_whatsapp,
    observacoes: vazioParaNull(c.observacoes),
  };
}

export function FormularioPaciente({
  paciente,
  onSalvar,
  salvando,
  somenteLeitura = false,
  rotuloSalvar = 'Salvar',
  acoesExtras,
}: {
  paciente?: Paciente;
  onSalvar: (dados: DadosPaciente) => Promise<unknown>;
  salvando?: boolean;
  somenteLeitura?: boolean;
  rotuloSalvar?: string;
  acoesExtras?: ReactNode;
}) {
  const convenios = useConveniosAtivos();
  const iniciais = useMemo(() => valoresIniciais(paciente), [paciente]);
  const form = useForm<Campos>({ resolver: zodResolver(esquema), values: iniciais });
  const convenioSelecionado = form.watch('convenio_id');
  const aceita = form.watch('aceita_whatsapp');

  // Garante que o convênio atual apareça mesmo se estiver inativo.
  const opcoesConvenio = [...(convenios.data ?? [])];
  if (paciente?.convenio && !opcoesConvenio.some((c) => c.id === paciente.convenio!.id)) {
    opcoesConvenio.push({ ...paciente.convenio, nome: `${paciente.convenio.nome} (inativo)` });
  }

  async function enviar(campos: Campos) {
    try {
      await onSalvar(paraApi(campos));
    } catch (e) {
      if (e instanceof ErroApi) {
        if (e.codigo === 'cpf_em_uso') form.setError('cpf', { message: e.mensagem });
        for (const d of e.detalhes) {
          const campo = CAMPOS_API[d.campo];
          if (campo) form.setError(campo, { message: d.mensagem });
        }
      }
    }
  }

  function copiarTelefone() {
    const tel = form.getValues('telefone');
    if (somenteDigitos(tel).length === 11) form.setValue('whatsapp', tel, { shouldDirty: true, shouldValidate: true });
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(enviar)} noValidate>
        <fieldset disabled={somenteLeitura} className="grid gap-4 sm:grid-cols-6">
          <FormField
            control={form.control}
            name="nome"
            render={({ field }) => (
              <FormItem className="sm:col-span-4">
                <FormLabel>Nome completo</FormLabel>
                <FormControl>
                  <Input autoComplete="off" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="cpf"
            render={({ field }) => (
              <FormItem className="sm:col-span-2">
                <FormLabel>CPF</FormLabel>
                <FormControl>
                  <Input
                    inputMode="numeric"
                    placeholder="000.000.000-00"
                    {...field}
                    onChange={(e) => field.onChange(mascararCpf(e.target.value))}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="nascimento"
            render={({ field }) => (
              <FormItem className="sm:col-span-2">
                <FormLabel>Nascimento</FormLabel>
                <FormControl>
                  <Input type="date" max={new Date().toISOString().slice(0, 10)} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="sexo"
            render={({ field }) => (
              <FormItem className="sm:col-span-2">
                <FormLabel>Sexo</FormLabel>
                <Select value={field.value} onValueChange={field.onChange} disabled={somenteLeitura}>
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value={NENHUM}>Não informado</SelectItem>
                    <SelectItem value="feminino">Feminino</SelectItem>
                    <SelectItem value="masculino">Masculino</SelectItem>
                    <SelectItem value="outro">Outro</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem className="sm:col-span-2">
                <FormLabel>E-mail</FormLabel>
                <FormControl>
                  <Input type="email" autoComplete="off" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="telefone"
            render={({ field }) => (
              <FormItem className="sm:col-span-3">
                <FormLabel>Telefone</FormLabel>
                <FormControl>
                  <Input
                    inputMode="tel"
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
            name="whatsapp"
            render={({ field }) => (
              <FormItem className="sm:col-span-3">
                <div className="flex items-center justify-between gap-2">
                  <FormLabel>WhatsApp</FormLabel>
                  {!somenteLeitura && (
                    <button
                      type="button"
                      onClick={copiarTelefone}
                      className="text-xs text-primary underline-offset-4 hover:underline"
                    >
                      Usar o telefone
                    </button>
                  )}
                </div>
                <FormControl>
                  <Input
                    inputMode="tel"
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
            name="aceita_whatsapp"
            render={({ field }) => (
              <FormItem className="rounded-lg border bg-muted/30 p-4 sm:col-span-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <FormLabel className="flex items-center gap-2">
                      <MessageCircle className="size-4 text-primary" />
                      Aceita receber mensagens pelo WhatsApp
                    </FormLabel>
                    <FormDescription>
                      Marque somente com a autorização expressa do paciente (LGPD). Com o consentimento, a clínica
                      pode enviar lembretes e pedidos de confirmação de consulta para o número informado. O paciente
                      pode revogar a autorização a qualquer momento.
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      disabled={somenteLeitura}
                      aria-label="Consentimento para mensagens de WhatsApp"
                    />
                  </FormControl>
                </div>
                {aceita && !somenteDigitos(form.watch('whatsapp')) && (
                  <p className="text-xs text-warning">Informe o número de WhatsApp acima.</p>
                )}
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="convenio_id"
            render={({ field }) => (
              <FormItem className="sm:col-span-3">
                <FormLabel>Convênio</FormLabel>
                <Select value={field.value} onValueChange={field.onChange} disabled={somenteLeitura}>
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={convenios.isLoading ? 'Carregando…' : 'Particular'} />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value={NENHUM}>Particular (sem convênio)</SelectItem>
                    {opcoesConvenio.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {convenios.isError && (
                  <FormDescription>Não foi possível carregar a lista de convênios.</FormDescription>
                )}
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="numero_carteirinha"
            render={({ field }) => (
              <FormItem className="sm:col-span-3">
                <FormLabel>Número da carteirinha</FormLabel>
                <FormControl>
                  <Input disabled={somenteLeitura || convenioSelecionado === NENHUM} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="endereco"
            render={({ field }) => (
              <FormItem className="sm:col-span-4">
                <FormLabel>Endereço</FormLabel>
                <FormControl>
                  <Input autoComplete="off" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="contato_emergencia"
            render={({ field }) => (
              <FormItem className="sm:col-span-2">
                <FormLabel>Contato de emergência</FormLabel>
                <FormControl>
                  <Input placeholder="Nome e telefone" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="observacoes"
            render={({ field }) => (
              <FormItem className="sm:col-span-6">
                <FormLabel>Observações administrativas</FormLabel>
                <FormControl>
                  <Textarea rows={3} {...field} />
                </FormControl>
                <FormDescription>Não registre informações clínicas aqui — use o prontuário.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </fieldset>
        {!somenteLeitura && (
          <div className="mt-6 flex flex-wrap items-center justify-end gap-2">
            {acoesExtras}
            <Button type="submit" disabled={salvando}>
              {salvando && <Loader2 className="size-4 animate-spin" />}
              {rotuloSalvar}
            </Button>
          </div>
        )}
      </form>
    </Form>
  );
}
