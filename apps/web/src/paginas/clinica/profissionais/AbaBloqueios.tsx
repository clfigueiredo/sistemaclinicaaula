// Bloqueios de agenda: do profissional e da clínica toda (feriados/recessos).
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { addDays, differenceInCalendarDays, format, isSameDay, parseISO, subDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Ban, Building2, CalendarOff, Loader2, Plus, Trash2, User } from 'lucide-react';
import { mensagemDeErro } from '@/api/cliente';
import { useBloqueios, useCriarBloqueio, useRemoverBloqueio, type BloqueioAgenda } from '@/api/profissionais';
import { Carregando, EstadoVazio } from '@/componentes/comum';
import { Button } from '@/componentes/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/componentes/ui/card';
import { Input } from '@/componentes/ui/input';
import { Switch } from '@/componentes/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/componentes/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/componentes/ui/form';
import { cn } from '@/lib/utils';
import { toastErro, useConfirmacao } from './comum';

/** Intervalo é "dia inteiro" quando começa e termina à meia-noite (horário local). */
function ehDiaInteiro(b: BloqueioAgenda) {
  const i = parseISO(b.inicio);
  const f = parseISO(b.fim);
  return i.getHours() === 0 && i.getMinutes() === 0 && f.getHours() === 0 && f.getMinutes() === 0;
}

export function descreverPeriodo(b: BloqueioAgenda): string {
  const i = parseISO(b.inicio);
  const f = parseISO(b.fim);
  if (ehDiaInteiro(b)) {
    const ultimoDia = subDays(f, 1);
    const dias = differenceInCalendarDays(f, i);
    return dias <= 1
      ? format(i, "EEEE, dd 'de' MMMM 'de' yyyy", { locale: ptBR })
      : `${format(i, 'dd/MM/yyyy')} a ${format(ultimoDia, 'dd/MM/yyyy')} (${dias} dias)`;
  }
  if (isSameDay(i, f)) return `${format(i, "EEE, dd/MM/yyyy", { locale: ptBR })} · ${format(i, 'HH:mm')} às ${format(f, 'HH:mm')}`;
  return `${format(i, 'dd/MM/yyyy HH:mm')} até ${format(f, 'dd/MM/yyyy HH:mm')}`;
}

const esquema = z
  .object({
    clinicaToda: z.boolean(),
    diaInteiro: z.boolean(),
    dataInicio: z.string(),
    dataFim: z.string(),
    inicio: z.string(),
    fim: z.string(),
    motivo: z.string().trim().max(200, 'Máximo de 200 caracteres'),
  })
  .superRefine((d, ctx) => {
    if (d.diaInteiro) {
      if (!d.dataInicio) ctx.addIssue({ code: 'custom', path: ['dataInicio'], message: 'Informe a data inicial' });
      if (!d.dataFim) ctx.addIssue({ code: 'custom', path: ['dataFim'], message: 'Informe a data final' });
      if (d.dataInicio && d.dataFim && d.dataFim < d.dataInicio) {
        ctx.addIssue({ code: 'custom', path: ['dataFim'], message: 'A data final deve ser igual ou posterior à inicial' });
      }
    } else {
      if (!d.inicio) ctx.addIssue({ code: 'custom', path: ['inicio'], message: 'Informe o início' });
      if (!d.fim) ctx.addIssue({ code: 'custom', path: ['fim'], message: 'Informe o fim' });
      if (d.inicio && d.fim && d.fim <= d.inicio) {
        ctx.addIssue({ code: 'custom', path: ['fim'], message: 'O fim deve ser depois do início' });
      }
    }
  });
type Dados = z.infer<typeof esquema>;

function hojeISO() {
  return format(new Date(), 'yyyy-MM-dd');
}

function DialogoNovoBloqueio({
  aberto,
  aoFechar,
  profissional,
}: {
  aberto: boolean;
  aoFechar: () => void;
  profissional: { id: string; nome: string };
}) {
  const criar = useCriarBloqueio();
  const form = useForm<Dados>({
    resolver: zodResolver(esquema),
    defaultValues: {
      clinicaToda: false,
      diaInteiro: true,
      dataInicio: hojeISO(),
      dataFim: hojeISO(),
      inicio: `${hojeISO()}T08:00`,
      fim: `${hojeISO()}T12:00`,
      motivo: '',
    },
  });
  const diaInteiro = form.watch('diaInteiro');
  const clinicaToda = form.watch('clinicaToda');

  async function enviar(d: Dados) {
    const inicio = d.diaInteiro ? new Date(`${d.dataInicio}T00:00`) : new Date(d.inicio);
    const fim = d.diaInteiro ? addDays(new Date(`${d.dataFim}T00:00`), 1) : new Date(d.fim);
    try {
      await criar.mutateAsync({
        profissional_id: d.clinicaToda ? null : profissional.id,
        inicio: inicio.toISOString(),
        fim: fim.toISOString(),
        motivo: d.motivo || null,
      });
      toast.success(d.clinicaToda ? 'Bloqueio da clínica criado.' : 'Bloqueio criado.');
      form.reset();
      aoFechar();
    } catch (e) {
      toastErro(e);
    }
  }

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && !criar.isPending && aoFechar()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Novo bloqueio de agenda</DialogTitle>
          <DialogDescription>Nenhum agendamento poderá ser marcado no período bloqueado.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(enviar)} className="space-y-4" noValidate>
            <div className="grid grid-cols-2 gap-2">
              {[
                { valor: false, rotulo: profissional.nome, detalhe: 'Somente este profissional', icone: User },
                { valor: true, rotulo: 'Clínica toda', detalhe: 'Feriado, recesso…', icone: Building2 },
              ].map((op) => (
                <button
                  key={String(op.valor)}
                  type="button"
                  onClick={() => form.setValue('clinicaToda', op.valor)}
                  className={cn(
                    'flex items-start gap-2 rounded-lg border p-3 text-left transition-colors hover:bg-accent',
                    clinicaToda === op.valor && 'border-primary bg-primary/5 ring-1 ring-primary',
                  )}
                  aria-pressed={clinicaToda === op.valor}
                >
                  <op.icone className="mt-0.5 size-4 shrink-0 text-primary" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{op.rotulo}</span>
                    <span className="block text-xs text-muted-foreground">{op.detalhe}</span>
                  </span>
                </button>
              ))}
            </div>

            <FormField
              control={form.control}
              name="diaInteiro"
              render={({ field }) => (
                <FormItem className="flex items-center gap-3">
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                  <FormLabel className="!mt-0">Dia inteiro</FormLabel>
                </FormItem>
              )}
            />

            {diaInteiro ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="dataInicio"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>De</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="dataFim"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Até (inclusive)</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="inicio"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Início</FormLabel>
                      <FormControl>
                        <Input type="datetime-local" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="fim"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Fim</FormLabel>
                      <FormControl>
                        <Input type="datetime-local" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            )}

            <FormField
              control={form.control}
              name="motivo"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Motivo (opcional)</FormLabel>
                  <FormControl>
                    <Input placeholder={clinicaToda ? 'Feriado de Finados' : 'Férias, congresso…'} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={aoFechar} disabled={criar.isPending}>
                Cancelar
              </Button>
              <Button type="submit" disabled={criar.isPending}>
                {criar.isPending && <Loader2 className="size-4 animate-spin" />}
                Bloquear agenda
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function ItemBloqueio({
  bloqueio,
  podeEditar,
  aoRemover,
}: {
  bloqueio: BloqueioAgenda;
  podeEditar: boolean;
  aoRemover: (b: BloqueioAgenda) => void;
}) {
  const daClinica = bloqueio.profissional_id === null;
  return (
    <li className="flex items-center gap-3 py-3">
      <div
        className={cn(
          'grid size-9 shrink-0 place-items-center rounded-full',
          daClinica ? 'bg-warning/15 text-warning' : 'bg-primary/10 text-primary',
        )}
      >
        {daClinica ? <Building2 className="size-4" /> : <Ban className="size-4" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium first-letter:uppercase">{descreverPeriodo(bloqueio)}</p>
        <p className="truncate text-xs text-muted-foreground">{bloqueio.motivo || 'Sem motivo informado'}</p>
      </div>
      {podeEditar && (
        <Button variant="ghost" size="icon-sm" onClick={() => aoRemover(bloqueio)} aria-label="Remover bloqueio" title="Remover">
          <Trash2 className="size-4" />
        </Button>
      )}
    </li>
  );
}

export function AbaBloqueios({
  profissional,
  bloqueios,
  podeEditar,
}: {
  profissional: { id: string; nome: string };
  bloqueios: BloqueioAgenda[];
  podeEditar: boolean;
}) {
  const [criando, setCriando] = useState(false);
  const [agora] = useState(() => new Date().toISOString());
  const daClinica = useBloqueios({ somenteClinica: true, inicio: agora });
  const remover = useRemoverBloqueio();
  const { confirmar, dialogo } = useConfirmacao();

  function pedirRemocao(b: BloqueioAgenda) {
    confirmar({
      titulo: 'Remover bloqueio?',
      descricao: `${descreverPeriodo(b)}${b.profissional_id === null ? ' — vale para a clínica toda.' : ''} O horário volta a ficar disponível para agendamentos.`,
      rotuloConfirmar: 'Remover',
      destrutivo: true,
      acao: async () => {
        try {
          await remover.mutateAsync(b.id);
          toast.success('Bloqueio removido.');
        } catch (e) {
          toastErro(e);
          throw e;
        }
      },
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <Card className="lg:col-span-3">
        <CardHeader className="flex flex-row items-start justify-between gap-2">
          <div>
            <CardTitle>Bloqueios do profissional</CardTitle>
            <CardDescription>Férias, congressos e ausências — vigentes e futuros.</CardDescription>
          </div>
          {podeEditar && (
            <Button size="sm" onClick={() => setCriando(true)}>
              <Plus className="size-4" />
              Novo bloqueio
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {bloqueios.length === 0 ? (
            <EstadoVazio
              icone={<CalendarOff className="size-5" />}
              titulo="Nenhum bloqueio programado"
              descricao="A agenda deste profissional segue a grade de horários normalmente."
            />
          ) : (
            <ul className="divide-y">
              {bloqueios.map((b) => (
                <ItemBloqueio key={b.id} bloqueio={b} podeEditar={podeEditar} aoRemover={pedirRemocao} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="size-4 text-warning" />
            Bloqueios da clínica toda
          </CardTitle>
          <CardDescription>Feriados e recessos também valem para este profissional.</CardDescription>
        </CardHeader>
        <CardContent>
          {daClinica.isLoading ? (
            <Carregando />
          ) : daClinica.isError ? (
            <p className="text-sm text-destructive">{mensagemDeErro(daClinica.error)}</p>
          ) : (daClinica.data ?? []).length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Nenhum feriado ou recesso programado.</p>
          ) : (
            <ul className="divide-y">
              {daClinica.data!.map((b) => (
                <ItemBloqueio key={b.id} bloqueio={b} podeEditar={podeEditar} aoRemover={pedirRemocao} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {criando && <DialogoNovoBloqueio aberto={criando} aoFechar={() => setCriando(false)} profissional={profissional} />}
      {dialogo}
    </div>
  );
}
