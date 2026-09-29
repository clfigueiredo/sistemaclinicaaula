// Formulário de dados do profissional (usado no diálogo de criação e na aba "Dados").
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Check, Loader2 } from 'lucide-react';
import { ErroApi } from '@/api/cliente';
import { PALETA_CORES_AGENDA, type DadosProfissional, type Profissional } from '@/api/profissionais';
import { Button } from '@/componentes/ui/button';
import { Input } from '@/componentes/ui/input';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/componentes/ui/form';
import { mascararTelefone, somenteDigitos } from '@/lib/formatos';
import { cn } from '@/lib/utils';

const esquema = z.object({
  nome: z.string().trim().min(2, 'Informe o nome do profissional').max(150, 'Máximo de 150 caracteres'),
  especialidade: z.string().trim().max(100, 'Máximo de 100 caracteres'),
  registro: z.string().trim().max(50, 'Máximo de 50 caracteres'),
  telefone: z.string().refine((t) => {
    const n = somenteDigitos(t).length;
    return n === 0 || (n >= 10 && n <= 11);
  }, 'Telefone inválido'),
  email: z.string().trim().refine((e) => e === '' || z.email().safeParse(e).success, 'E-mail inválido'),
  duracao_consulta_min: z.string().refine((v) => {
    const n = Number(v);
    return Number.isInteger(n) && n >= 5 && n <= 480;
  }, 'Entre 5 e 480 minutos'),
  cor_agenda: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Cor inválida'),
});
type Dados = z.infer<typeof esquema>;

const DURACOES_SUGERIDAS = [15, 20, 30, 40, 45, 60];

const CAMPOS_API: Record<string, keyof Dados> = {
  'body.nome': 'nome',
  'body.especialidade': 'especialidade',
  'body.registro': 'registro',
  'body.telefone': 'telefone',
  'body.email': 'email',
  'body.duracao_consulta_min': 'duracao_consulta_min',
  'body.cor_agenda': 'cor_agenda',
};

export function FormularioProfissional({
  inicial,
  corSugerida,
  somenteLeitura = false,
  salvando,
  rotuloSalvar = 'Salvar',
  aoSalvar,
  aoCancelar,
}: {
  inicial?: Profissional;
  corSugerida?: string;
  somenteLeitura?: boolean;
  salvando: boolean;
  rotuloSalvar?: string;
  aoSalvar: (dados: DadosProfissional) => Promise<unknown>;
  aoCancelar?: () => void;
}) {
  const form = useForm<Dados>({
    resolver: zodResolver(esquema),
    defaultValues: {
      nome: inicial?.nome ?? '',
      especialidade: inicial?.especialidade ?? '',
      registro: inicial?.registro ?? '',
      telefone: inicial?.telefone ? mascararTelefone(inicial.telefone) : '',
      email: inicial?.email ?? '',
      duracao_consulta_min: String(inicial?.duracao_consulta_min ?? 30),
      cor_agenda: inicial?.cor_agenda ?? corSugerida ?? PALETA_CORES_AGENDA[0]!,
    },
  });

  async function enviar(d: Dados) {
    try {
      await aoSalvar({
        nome: d.nome,
        especialidade: d.especialidade || null,
        registro: d.registro || null,
        telefone: somenteDigitos(d.telefone) || null,
        email: d.email || null,
        duracao_consulta_min: Number(d.duracao_consulta_min),
        cor_agenda: d.cor_agenda,
      });
      if (inicial) form.reset(d);
    } catch (e) {
      if (e instanceof ErroApi) {
        for (const det of e.detalhes) {
          const campo = CAMPOS_API[det.campo];
          if (campo) form.setError(campo, { message: det.mensagem });
        }
      }
    }
  }

  const duracao = form.watch('duracao_consulta_min');

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(enviar)} className="grid gap-4 sm:grid-cols-2" noValidate>
        <fieldset disabled={somenteLeitura} className="contents">
          <FormField
            control={form.control}
            name="nome"
            render={({ field }) => (
              <FormItem className="sm:col-span-2">
                <FormLabel>Nome</FormLabel>
                <FormControl>
                  <Input placeholder="Dra. Ana Souza" autoFocus={!inicial} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="especialidade"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Especialidade</FormLabel>
                <FormControl>
                  <Input placeholder="Cardiologia" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="registro"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Registro profissional</FormLabel>
                <FormControl>
                  <Input placeholder="CRM 123456/SP" {...field} />
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
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>E-mail</FormLabel>
                <FormControl>
                  <Input type="email" placeholder="ana@clinica.com.br" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="duracao_consulta_min"
            render={({ field }) => (
              <FormItem className="sm:col-span-2">
                <FormLabel>Duração padrão da consulta</FormLabel>
                <div className="flex flex-wrap items-center gap-2">
                  {DURACOES_SUGERIDAS.map((m) => (
                    <Button
                      key={m}
                      type="button"
                      size="sm"
                      variant={Number(duracao) === m ? 'default' : 'outline'}
                      onClick={() => field.onChange(String(m))}
                    >
                      {m} min
                    </Button>
                  ))}
                  <div className="flex items-center gap-2">
                    <FormControl>
                      <Input type="number" min={5} max={480} step={5} className="w-24" {...field} />
                    </FormControl>
                    <span className="text-sm text-muted-foreground">minutos</span>
                  </div>
                </div>
                <FormDescription>Usada para sugerir o fim do horário ao agendar.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="cor_agenda"
            render={({ field }) => (
              <FormItem className="sm:col-span-2">
                <FormLabel>Cor na agenda</FormLabel>
                <div className="flex flex-wrap items-center gap-2">
                  {PALETA_CORES_AGENDA.map((cor) => {
                    const selecionada = field.value.toLowerCase() === cor;
                    return (
                      <button
                        key={cor}
                        type="button"
                        onClick={() => field.onChange(cor)}
                        className={cn(
                          'grid size-8 place-items-center rounded-full ring-offset-2 ring-offset-background transition-transform hover:scale-110 disabled:pointer-events-none',
                          selecionada && 'ring-2 ring-foreground/70',
                        )}
                        style={{ backgroundColor: cor }}
                        aria-label={`Cor ${cor}`}
                        aria-pressed={selecionada}
                      >
                        {selecionada && <Check className="size-4 text-white" />}
                      </button>
                    );
                  })}
                  <label className="relative ml-1 flex items-center gap-2 text-sm text-muted-foreground">
                    <FormControl>
                      <input
                        type="color"
                        value={field.value}
                        onChange={(e) => field.onChange(e.target.value)}
                        className="size-8 cursor-pointer rounded-full border bg-transparent p-0.5"
                        aria-label="Escolher outra cor"
                      />
                    </FormControl>
                    Outra
                  </label>
                </div>
                <FormMessage />
              </FormItem>
            )}
          />
        </fieldset>
        {!somenteLeitura && (
          <div className="flex justify-end gap-2 sm:col-span-2">
            {aoCancelar && (
              <Button type="button" variant="outline" onClick={aoCancelar} disabled={salvando}>
                Cancelar
              </Button>
            )}
            <Button type="submit" disabled={salvando || (!!inicial && !form.formState.isDirty)}>
              {salvando && <Loader2 className="size-4 animate-spin" />}
              {rotuloSalvar}
            </Button>
          </div>
        )}
      </form>
    </Form>
  );
}
