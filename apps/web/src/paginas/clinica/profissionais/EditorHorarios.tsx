// Editor semanal da grade de horários do profissional (vários intervalos por dia).
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { AlertCircle, CalendarClock, Copy, Loader2, Plus, RotateCcw, Trash2, Wand2 } from 'lucide-react';
import { ErroApi } from '@/api/cliente';
import { DIAS_SEMANA, useSalvarHorarios, type HorarioProfissional } from '@/api/profissionais';
import { Button } from '@/componentes/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/componentes/ui/card';
import { Input } from '@/componentes/ui/input';
import { Switch } from '@/componentes/ui/switch';
import { cn } from '@/lib/utils';
import { toastErro } from './comum';

type Intervalo = { hora_inicio: string; hora_fim: string };
type Grade = Intervalo[][]; // índice = dia_semana (0 = domingo)

/** Ordem de exibição: segunda → domingo. */
const ORDEM_DIAS = [1, 2, 3, 4, 5, 6, 0];
const DIAS_UTEIS = [1, 2, 3, 4, 5];

function paraMinutos(h: string): number {
  const [hh, mm] = h.split(':').map(Number);
  return (hh ?? 0) * 60 + (mm ?? 0);
}

function paraHora(min: number): string {
  const m = Math.max(0, Math.min(23 * 60 + 59, min));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

function montarGrade(horarios: HorarioProfissional[]): Grade {
  const g: Grade = Array.from({ length: 7 }, () => []);
  for (const h of horarios) g[h.dia_semana]!.push({ hora_inicio: h.hora_inicio, hora_fim: h.hora_fim });
  for (const dia of g) dia.sort((a, b) => a.hora_inicio.localeCompare(b.hora_inicio));
  return g;
}

function paraLista(g: Grade): HorarioProfissional[] {
  return g.flatMap((intervalos, dia) => intervalos.map((i) => ({ dia_semana: dia, ...i })));
}

/** Erros por dia: mensagem ligada ao índice do intervalo. */
function validar(g: Grade): Record<number, Record<number, string>> {
  const erros: Record<number, Record<number, string>> = {};
  g.forEach((intervalos, dia) => {
    const errosDia: Record<number, string> = {};
    intervalos.forEach((i, idx) => {
      if (!/^\d{2}:\d{2}$/.test(i.hora_inicio) || !/^\d{2}:\d{2}$/.test(i.hora_fim)) {
        errosDia[idx] = 'Preencha início e fim.';
      } else if (i.hora_inicio >= i.hora_fim) {
        errosDia[idx] = 'O fim deve ser depois do início.';
      }
    });
    const ordenados = intervalos
      .map((i, idx) => ({ ...i, idx }))
      .sort((a, b) => a.hora_inicio.localeCompare(b.hora_inicio));
    for (let k = 1; k < ordenados.length; k++) {
      const ant = ordenados[k - 1]!;
      const atual = ordenados[k]!;
      if (atual.hora_inicio < ant.hora_fim && !errosDia[atual.idx]) {
        errosDia[atual.idx] = `Sobrepõe o intervalo ${ant.hora_inicio}–${ant.hora_fim}.`;
      }
    }
    if (Object.keys(errosDia).length) erros[dia] = errosDia;
  });
  return erros;
}

function formatarDuracao(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m} min`;
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

export function EditorHorarios({
  profissionalId,
  horarios,
  somenteLeitura,
}: {
  profissionalId: string;
  horarios: HorarioProfissional[];
  somenteLeitura: boolean;
}) {
  const original = useMemo(() => montarGrade(horarios), [horarios]);
  const [grade, setGrade] = useState<Grade>(original);
  const salvar = useSalvarHorarios(profissionalId);

  useEffect(() => setGrade(original), [original]);

  const erros = validar(grade);
  const temErros = Object.keys(erros).length > 0;
  const alterado = JSON.stringify(grade) !== JSON.stringify(original);
  const totalMin = grade
    .flat()
    .reduce((s, i) => s + Math.max(0, paraMinutos(i.hora_fim) - paraMinutos(i.hora_inicio)), 0);
  const diasComAtendimento = grade.filter((d) => d.length > 0).length;

  function alterarDia(dia: number, fn: (intervalos: Intervalo[]) => Intervalo[]) {
    setGrade((g) => g.map((intervalos, d) => (d === dia ? fn(intervalos) : intervalos)));
  }

  function adicionarIntervalo(dia: number) {
    alterarDia(dia, (intervalos) => {
      if (intervalos.length === 0) return [{ hora_inicio: '08:00', hora_fim: '12:00' }];
      const ultimoFim = Math.max(...intervalos.map((i) => paraMinutos(i.hora_fim)));
      const inicio = Math.min(ultimoFim + 60, 22 * 60);
      return [...intervalos, { hora_inicio: paraHora(inicio), hora_fim: paraHora(Math.min(inicio + 240, 23 * 60 + 59)) }];
    });
  }

  function copiarParaDiasUteis(origem: number) {
    const copia = grade[origem]!.map((i) => ({ ...i }));
    setGrade((g) => g.map((intervalos, d) => (DIAS_UTEIS.includes(d) && d !== origem ? copia.map((i) => ({ ...i })) : intervalos)));
    toast.info(`Horários de ${DIAS_SEMANA[origem]!.toLowerCase()} copiados para os dias úteis.`, {
      description: 'Revise e clique em "Salvar grade".',
    });
  }

  function aplicarHorarioComercial() {
    setGrade(
      Array.from({ length: 7 }, (_, d) =>
        DIAS_UTEIS.includes(d)
          ? [
              { hora_inicio: '08:00', hora_fim: '12:00' },
              { hora_inicio: '13:00', hora_fim: '18:00' },
            ]
          : [],
      ),
    );
  }

  async function enviar() {
    if (temErros) {
      toast.error('Corrija os horários destacados antes de salvar.');
      return;
    }
    try {
      await salvar.mutateAsync(paraLista(grade));
      toast.success('Grade de horários salva.');
    } catch (e) {
      if (!(e instanceof ErroApi && e.codigo === 'validacao')) toastErro(e);
      else toast.error('Há horários inválidos na grade.');
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <CalendarClock className="size-5 text-primary" />
            Grade semanal de atendimento
          </CardTitle>
          <CardDescription className="mt-1">
            {diasComAtendimento === 0
              ? 'Nenhum horário definido: o profissional não aparece como disponível na agenda.'
              : `${diasComAtendimento} ${diasComAtendimento === 1 ? 'dia' : 'dias'} de atendimento · ${formatarDuracao(totalMin)} por semana`}
          </CardDescription>
        </div>
        {!somenteLeitura && (
          <Button variant="outline" size="sm" onClick={aplicarHorarioComercial}>
            <Wand2 className="size-4" />
            Horário comercial
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        {ORDEM_DIAS.map((dia) => {
          const intervalos = grade[dia]!;
          const atende = intervalos.length > 0;
          const errosDia = erros[dia] ?? {};
          return (
            <div
              key={dia}
              className={cn(
                'flex flex-col gap-3 rounded-lg border p-3 transition-colors sm:flex-row sm:items-start',
                !atende && 'bg-muted/40',
              )}
            >
              <div className="flex w-40 shrink-0 items-center gap-3 pt-1.5">
                <Switch
                  checked={atende}
                  disabled={somenteLeitura}
                  onCheckedChange={(v) => (v ? adicionarIntervalo(dia) : alterarDia(dia, () => []))}
                  aria-label={`Atende ${DIAS_SEMANA[dia]}`}
                />
                <span className={cn('text-sm font-medium', !atende && 'text-muted-foreground')}>{DIAS_SEMANA[dia]}</span>
              </div>

              <div className="flex-1 space-y-2">
                {!atende && <p className="pt-1.5 text-sm text-muted-foreground">Não atende</p>}
                {intervalos.map((i, idx) => (
                  <div key={idx}>
                    <div className="flex flex-wrap items-center gap-2">
                      <Input
                        type="time"
                        value={i.hora_inicio}
                        disabled={somenteLeitura}
                        onChange={(e) =>
                          alterarDia(dia, (lst) => lst.map((x, k) => (k === idx ? { ...x, hora_inicio: e.target.value } : x)))
                        }
                        className={cn('w-32', errosDia[idx] && 'border-destructive')}
                        aria-label="Início"
                      />
                      <span className="text-sm text-muted-foreground">até</span>
                      <Input
                        type="time"
                        value={i.hora_fim}
                        disabled={somenteLeitura}
                        onChange={(e) =>
                          alterarDia(dia, (lst) => lst.map((x, k) => (k === idx ? { ...x, hora_fim: e.target.value } : x)))
                        }
                        className={cn('w-32', errosDia[idx] && 'border-destructive')}
                        aria-label="Fim"
                      />
                      {!somenteLeitura && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => alterarDia(dia, (lst) => lst.filter((_, k) => k !== idx))}
                          aria-label="Remover intervalo"
                          title="Remover intervalo"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      )}
                    </div>
                    {errosDia[idx] && (
                      <p className="mt-1 flex items-center gap-1 text-xs text-destructive">
                        <AlertCircle className="size-3.5" />
                        {errosDia[idx]}
                      </p>
                    )}
                  </div>
                ))}
              </div>

              {!somenteLeitura && (
                <div className="flex shrink-0 gap-1 sm:pt-0.5">
                  <Button variant="ghost" size="sm" onClick={() => adicionarIntervalo(dia)}>
                    <Plus className="size-4" />
                    Intervalo
                  </Button>
                  {atende && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => copiarParaDiasUteis(dia)}
                      title="Copiar estes horários para segunda a sexta"
                    >
                      <Copy className="size-4" />
                      <span className="hidden lg:inline">Copiar para dias úteis</span>
                    </Button>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {!somenteLeitura && (
          <div className="flex flex-col-reverse gap-2 pt-3 sm:flex-row sm:items-center sm:justify-end">
            {alterado && <span className="text-xs text-muted-foreground sm:mr-auto">Há alterações não salvas.</span>}
            <Button variant="outline" onClick={() => setGrade(original)} disabled={!alterado || salvar.isPending}>
              <RotateCcw className="size-4" />
              Descartar
            </Button>
            <Button onClick={enviar} disabled={!alterado || salvar.isPending || temErros}>
              {salvar.isPending && <Loader2 className="size-4 animate-spin" />}
              Salvar grade
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
