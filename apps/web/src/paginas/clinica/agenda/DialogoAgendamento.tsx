// Diálogo "Novo agendamento" / "Editar agendamento".
import { useEffect, useMemo } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery } from '@tanstack/react-query';
import { differenceInMinutes } from 'date-fns';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { api, mensagemDeErro } from '@/api/cliente';
import {
  STATUS_REMARCAVEIS,
  useCriarAgendamento,
  useDisponibilidade,
  useEditarAgendamento,
  type Agendamento,
  type ProfissionalAgenda,
} from '@/api/agendamentos';
import { usePodeUsar } from '@/api/me';
import { AvisoLimite } from '@/componentes/comum';
import { Button } from '@/componentes/ui/button';
import { Checkbox } from '@/componentes/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/componentes/ui/dialog';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/componentes/ui/form';
import { Input } from '@/componentes/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/componentes/ui/select';
import { Textarea } from '@/componentes/ui/textarea';
import { cn } from '@/lib/utils';
import { BuscaPaciente } from './BuscaPaciente';
import { diaLocal, horaLocal, instante, type ConvenioResumo } from './utilidades';

const esquema = z
  .object({
    paciente: z.object({ id: z.string(), nome: z.string(), convenio_id: z.string().nullish() }).nullable(),
    profissional_id: z.string().min(1, 'Selecione o profissional.'),
    dia: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Informe a data.'),
    hora: z.string().regex(/^\d{2}:\d{2}$/, 'Informe o horário.'),
    duracao: z.coerce.number<number>().int().min(5, 'Mínimo de 5 minutos.').max(720, 'Máximo de 12 horas.'),
    tipo: z.enum(['particular', 'convenio']),
    convenio_id: z.string().optional(),
    observacoes: z.string().max(2000, 'Máximo de 2000 caracteres.').optional(),
    encaixe: z.boolean(),
  })
  .refine((v) => !!v.paciente, { message: 'Selecione o paciente.', path: ['paciente'] })
  .refine((v) => v.tipo === 'particular' || !!v.convenio_id, {
    message: 'Selecione o convênio.',
    path: ['convenio_id'],
  });

type Dados = z.infer<typeof esquema>;

export type SugestaoNovo = {
  inicio?: Date;
  fim?: Date;
  profissionalId?: string;
  /** Paciente já escolhido (ex.: "Agendar" em Retornos / Lista de espera). */
  paciente?: { id: string; nome: string; convenio_id?: string | null } | null;
};

export function DialogoAgendamento({
  aberto,
  onOpenChange,
  profissionais,
  sugestao,
  agendamento,
  ehAdmin,
  profissionalFixo,
}: {
  aberto: boolean;
  onOpenChange: (a: boolean) => void;
  profissionais: ProfissionalAgenda[];
  /** Pré-preenchimento ao criar (clique em horário vazio). */
  sugestao?: SugestaoNovo | null;
  /** Presente = modo edição. */
  agendamento?: Agendamento | null;
  ehAdmin: boolean;
  /** Papel profissional: só pode usar a própria agenda. */
  profissionalFixo?: string | null;
}) {
  const edicao = !!agendamento;
  const { pode, mensagem } = usePodeUsar('max_agendamentos');
  const criar = useCriarAgendamento();
  const editar = useEditarAgendamento();
  const salvando = criar.isPending || editar.isPending;
  const remarcavel = !agendamento || STATUS_REMARCAVEIS.includes(agendamento.status);

  const { data: convenios = [] } = useQuery({
    queryKey: ['agendamentos', 'convenios'],
    queryFn: () => api.get<ConvenioResumo[]>('/convenios', { ativos: true }, { silencioso: true }),
    enabled: aberto,
    staleTime: 60_000,
    retry: false,
  });

  const valoresIniciais = useMemo<Dados>(() => {
    if (agendamento) {
      const ini = new Date(agendamento.inicio);
      return {
        paciente: { id: agendamento.paciente.id, nome: agendamento.paciente.nome },
        profissional_id: agendamento.profissional_id,
        dia: diaLocal(ini),
        hora: horaLocal(ini),
        duracao: differenceInMinutes(new Date(agendamento.fim), ini),
        tipo: agendamento.tipo,
        convenio_id: agendamento.convenio_id ?? undefined,
        observacoes: agendamento.observacoes ?? '',
        encaixe: false,
      };
    }
    const profId = profissionalFixo ?? sugestao?.profissionalId ?? (profissionais.length === 1 ? profissionais[0]!.id : '');
    const prof = profissionais.find((p) => p.id === profId);
    const ini = sugestao?.inicio;
    const temHora = !!ini && (ini.getHours() !== 0 || ini.getMinutes() !== 0 || !!sugestao?.fim);
    const duracaoSel = ini && sugestao?.fim ? differenceInMinutes(sugestao.fim, ini) : 0;
    return {
      paciente: sugestao?.paciente ?? null,
      profissional_id: profId,
      dia: ini ? diaLocal(ini) : diaLocal(new Date()),
      hora: ini && temHora && duracaoSel < 24 * 60 ? horaLocal(ini) : '',
      // seleção maior que um slot vira a duração; senão a duração padrão do profissional
      duracao:
        duracaoSel > (prof?.duracao_consulta_min ?? 30) && duracaoSel < 24 * 60 ? duracaoSel : (prof?.duracao_consulta_min ?? 30),
      tipo: 'particular',
      convenio_id: undefined,
      observacoes: '',
      encaixe: false,
    };
  }, [agendamento, sugestao, profissionais, profissionalFixo]);

  const form = useForm<Dados>({ resolver: zodResolver(esquema), defaultValues: valoresIniciais });

  useEffect(() => {
    if (aberto) form.reset(valoresIniciais);
  }, [aberto, valoresIniciais, form]);

  const [profissionalId, dia, hora, tipo, paciente] = useWatch({
    control: form.control,
    name: ['profissional_id', 'dia', 'hora', 'tipo', 'paciente'],
  });

  // Ao escolher o paciente, sugere o convênio dele (só na criação).
  useEffect(() => {
    if (!edicao && paciente?.convenio_id && convenios.some((c) => c.id === paciente.convenio_id)) {
      form.setValue('tipo', 'convenio');
      form.setValue('convenio_id', paciente.convenio_id);
    }
  }, [paciente, convenios, edicao, form]);

  const disp = useDisponibilidade(aberto && remarcavel ? profissionalId : null, dia, agendamento?.id);

  async function salvar(v: Dados) {
    const inicio = instante(v.dia, v.hora);
    const fim = new Date(inicio.getTime() + v.duracao * 60_000);
    const corpo = {
      paciente_id: v.paciente!.id,
      profissional_id: v.profissional_id,
      inicio: inicio.toISOString(),
      fim: fim.toISOString(),
      tipo: v.tipo,
      convenio_id: v.tipo === 'convenio' ? (v.convenio_id ?? null) : null,
      observacoes: v.observacoes?.trim() || null,
      ...(v.encaixe ? { encaixe: true } : {}),
    };
    try {
      if (agendamento) {
        await editar.mutateAsync({ id: agendamento.id, ...corpo });
        toast.success('Agendamento atualizado.');
      } else {
        await criar.mutateAsync(corpo);
        toast.success('Agendamento criado.');
      }
      onOpenChange(false);
    } catch (e) {
      // limite/assinatura já geram toast automático no cliente
      const codigo = (e as { codigo?: string }).codigo;
      if (codigo !== 'limite_atingido' && codigo !== 'assinatura_inativa') toast.error(mensagemDeErro(e));
    }
  }

  const bloqueadoPorLimite = !edicao && !pode;

  return (
    <Dialog open={aberto} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{edicao ? 'Editar agendamento' : 'Novo agendamento'}</DialogTitle>
          <DialogDescription>
            {edicao
              ? remarcavel
                ? 'Altere os dados ou remarque para outro horário.'
                : 'Este agendamento não pode mais ser remarcado; só os dados complementares podem ser editados.'
              : 'Escolha o paciente, o profissional e um horário livre.'}
          </DialogDescription>
        </DialogHeader>

        {!edicao && <AvisoLimite codigo="max_agendamentos" />}

        <Form {...form}>
          <form onSubmit={form.handleSubmit(salvar)} className="space-y-4">
            <FormField
              control={form.control}
              name="paciente"
              render={({ field, fieldState }) => (
                <FormItem>
                  <FormLabel>Paciente</FormLabel>
                  <BuscaPaciente valor={field.value} onChange={field.onChange} invalido={!!fieldState.error} />
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="profissional_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Profissional</FormLabel>
                  <Select
                    value={field.value}
                    onValueChange={(v) => {
                      field.onChange(v);
                      // na criação, aplica a duração padrão do profissional escolhido
                      const prof = profissionais.find((p) => p.id === v);
                      if (!edicao && prof) form.setValue('duracao', prof.duracao_consulta_min);
                    }}
                    disabled={!!profissionalFixo || !remarcavel}
                  >
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Selecione" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {profissionais.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          <span className="size-2.5 rounded-full" style={{ backgroundColor: p.cor_agenda }} />
                          {p.nome}
                          {p.especialidade && <span className="text-muted-foreground">· {p.especialidade}</span>}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <FormField
                control={form.control}
                name="dia"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Data</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} disabled={!remarcavel} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="hora"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Horário</FormLabel>
                    <FormControl>
                      <Input type="time" step={300} {...field} disabled={!remarcavel} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="duracao"
                render={({ field }) => (
                  <FormItem className="col-span-2 sm:col-span-1">
                    <FormLabel>Duração (min)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={5}
                        step={5}
                        name={field.name}
                        ref={field.ref}
                        onBlur={field.onBlur}
                        value={field.value ?? ''}
                        onChange={(e) => field.onChange(e.target.value)}
                        disabled={!remarcavel}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {remarcavel && profissionalId && dia && (
              <div className="space-y-2">
                <p className="text-sm font-medium">Horários livres</p>
                {disp.isLoading ? (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" /> Consultando disponibilidade…
                  </p>
                ) : disp.isError ? (
                  <p className="text-sm text-destructive">{mensagemDeErro(disp.error)}</p>
                ) : disp.data && disp.data.horarios.length > 0 ? (
                  <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
                    {disp.data.horarios.map((s) => (
                      <Button
                        key={s.inicio}
                        type="button"
                        size="sm"
                        variant={hora === horaLocal(new Date(s.inicio)) ? 'default' : 'outline'}
                        className="h-7 px-2 tabular-nums"
                        onClick={() => {
                          form.setValue('hora', horaLocal(new Date(s.inicio)), { shouldValidate: true });
                          form.setValue('duracao', disp.data!.duracao_min, { shouldValidate: true });
                        }}
                      >
                        {horaLocal(new Date(s.inicio))}
                      </Button>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Nenhum horário livre nesta data (fora da grade, bloqueado ou lotado).
                  </p>
                )}
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="tipo"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tipo</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="particular">Particular</SelectItem>
                        <SelectItem value="convenio">Convênio</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {tipo === 'convenio' && (
                <FormField
                  control={form.control}
                  name="convenio_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Convênio</FormLabel>
                      <Select value={field.value ?? ''} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder={convenios.length ? 'Selecione' : 'Nenhum convênio ativo'} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {agendamento?.convenio && !convenios.some((c) => c.id === agendamento.convenio!.id) && (
                            <SelectItem value={agendamento.convenio.id}>{agendamento.convenio.nome}</SelectItem>
                          )}
                          {convenios.map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.nome}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
            </div>

            <FormField
              control={form.control}
              name="observacoes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Observações</FormLabel>
                  <FormControl>
                    <Textarea rows={3} placeholder="Opcional" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {ehAdmin && remarcavel && (
              <FormField
                control={form.control}
                name="encaixe"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-start gap-2 space-y-0">
                    <FormControl>
                      <Checkbox checked={field.value} onCheckedChange={(v) => field.onChange(v === true)} />
                    </FormControl>
                    <div className="space-y-0.5">
                      <FormLabel className="font-normal">Encaixe</FormLabel>
                      <FormDescription>
                        Permite horário fora da grade ou retroativo. Bloqueios e conflitos continuam valendo.
                      </FormDescription>
                    </div>
                  </FormItem>
                )}
              />
            )}

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={salvando || bloqueadoPorLimite}
                title={bloqueadoPorLimite ? (mensagem ?? undefined) : undefined}
                className={cn(bloqueadoPorLimite && 'cursor-not-allowed')}
              >
                {salvando && <Loader2 className="size-4 animate-spin" />}
                {edicao ? 'Salvar alterações' : 'Agendar'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
