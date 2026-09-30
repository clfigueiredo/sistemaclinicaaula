// Bloco "Retorno" do PainelAgendamento (agenda), exibido quando o agendamento está `compareceu`/`atendido` e o
// plano tem `retorno_automatico`. Mostra o retorno já definido (data prevista, status, convite) ou o formulário
// "Retorno em 7/15/30/60/90 dias | outra data" + observação. Contrato: docs/FASE2.md §5.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { addDays, format, parseISO } from 'date-fns';
import { toast } from 'sonner';
import { CalendarCheck2, CalendarClock, Loader2, MessageCircle, Pencil, Repeat, RotateCcw, X } from 'lucide-react';
import type { Agendamento } from '@/api/agendamentos';
import { mensagemDeErro } from '@/api/cliente';
import { useCriarRetorno, useEditarRetorno, useMudarStatusRetorno, useRetornoDoAgendamento, type Retorno } from '@/api/retornos';
import { Button } from '@/componentes/ui/button';
import { Input } from '@/componentes/ui/input';
import { Label } from '@/componentes/ui/label';
import { Separator } from '@/componentes/ui/separator';
import { Textarea } from '@/componentes/ui/textarea';
import { formatarData, formatarDataHora } from '@/lib/formatos';
import { cn } from '@/lib/utils';
import { BadgeStatusRetorno } from '../retornos/BadgeStatusRetorno';

const ATALHOS_DIAS = [7, 15, 30, 60, 90];

export function DefinirRetorno({ agendamento, podeAlterar }: { agendamento: Agendamento; podeAlterar: boolean }) {
  const { data: retorno, isLoading, error } = useRetornoDoAgendamento(agendamento.id);
  const [editando, setEditando] = useState(false);
  const mudarStatus = useMudarStatusRetorno();

  async function mudar(status: 'cancelado' | 'pendente') {
    if (!retorno) return;
    try {
      await mudarStatus.mutateAsync({ id: retorno.id, status });
      toast.success(status === 'cancelado' ? 'Retorno cancelado.' : 'Retorno reaberto.');
    } catch (e) {
      toast.error(mensagemDeErro(e));
    }
  }

  let conteudo;
  if (isLoading) {
    conteudo = (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" /> Carregando retorno…
      </p>
    );
  } else if (error) {
    conteudo = <p className="text-xs text-muted-foreground">{mensagemDeErro(error)}</p>;
  } else if (!retorno || editando) {
    conteudo = podeAlterar ? (
      <FormularioRetorno agendamento={agendamento} retorno={retorno ?? null} onConcluir={() => setEditando(false)} />
    ) : (
      <p className="text-xs text-muted-foreground">Nenhum retorno definido para esta consulta.</p>
    );
  } else {
    const aberto = retorno.status === 'pendente' || retorno.status === 'lembrado';
    conteudo = (
      <div className={cn('space-y-2 rounded-md border p-3', retorno.vencido && 'border-destructive/40 bg-destructive/5')}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 font-medium">
            <CalendarClock className="size-4 text-muted-foreground" />
            Previsto para {formatarData(retorno.data_prevista)}
          </p>
          <BadgeStatusRetorno retorno={retorno} />
        </div>
        {retorno.agendamento_retorno && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <CalendarCheck2 className="size-3.5" /> Agendado para {formatarDataHora(retorno.agendamento_retorno.inicio)}
          </p>
        )}
        {retorno.convite_enviado_em && retorno.status === 'lembrado' && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <MessageCircle className="size-3.5" /> Convite enviado em {formatarDataHora(retorno.convite_enviado_em)}
          </p>
        )}
        {retorno.observacao && <p className="rounded bg-muted/60 p-2 text-xs whitespace-pre-wrap">{retorno.observacao}</p>}
        {podeAlterar && (
          <div className="flex flex-wrap gap-2 pt-1">
            {aberto && (
              <>
                <Button variant="outline" size="xs" onClick={() => setEditando(true)}>
                  <Pencil /> Alterar
                </Button>
                <Button variant="ghost" size="xs" onClick={() => mudar('cancelado')} disabled={mudarStatus.isPending}>
                  <X /> Cancelar retorno
                </Button>
              </>
            )}
            {retorno.status === 'cancelado' && (
              <Button variant="outline" size="xs" onClick={() => mudar('pendente')} disabled={mudarStatus.isPending}>
                <RotateCcw /> Reabrir
              </Button>
            )}
            <Button asChild variant="link" size="xs" className="ml-auto px-0">
              <Link to="/retornos">Ver retornos</Link>
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <Separator />
      <div className="space-y-2">
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Repeat className="size-3.5" /> Retorno
        </p>
        {conteudo}
      </div>
    </>
  );
}

function FormularioRetorno({
  agendamento,
  retorno,
  onConcluir,
}: {
  agendamento: Agendamento;
  retorno: Retorno | null;
  onConcluir: () => void;
}) {
  const criar = useCriarRetorno();
  const editar = useEditarRetorno();
  const diaConsulta = format(new Date(agendamento.inicio), 'yyyy-MM-dd');
  const [dias, setDias] = useState<number | null>(retorno ? null : 30);
  const [data, setData] = useState(retorno?.data_prevista ?? '');
  const [observacao, setObservacao] = useState(retorno?.observacao ?? '');
  const salvando = criar.isPending || editar.isPending;

  const dataCalculada = dias ? format(addDays(parseISO(diaConsulta), dias), 'yyyy-MM-dd') : data;

  async function salvar() {
    if (!dias && !data) {
      toast.error('Escolha em quantos dias ou a data do retorno.');
      return;
    }
    if (!dias && data <= diaConsulta) {
      toast.error('A data do retorno precisa ser posterior à data da consulta.');
      return;
    }
    const prazo = dias ? { dias } : { data_prevista: data };
    try {
      if (retorno) {
        await editar.mutateAsync({ id: retorno.id, ...prazo, observacao: observacao.trim() || null });
        toast.success('Retorno atualizado.');
      } else {
        await criar.mutateAsync({ agendamento_origem_id: agendamento.id, ...prazo, observacao: observacao.trim() || null });
        toast.success('Retorno definido.');
      }
      onConcluir();
    } catch (e) {
      toast.error(mensagemDeErro(e));
    }
  }

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="space-y-1.5">
        <Label className="text-xs">Retorno em</Label>
        <div className="flex flex-wrap gap-1.5">
          {ATALHOS_DIAS.map((d) => (
            <Button
              key={d}
              type="button"
              size="xs"
              variant={dias === d ? 'default' : 'outline'}
              onClick={() => {
                setDias(d);
                setData('');
              }}
            >
              {d} dias
            </Button>
          ))}
        </div>
      </div>
      <div className="flex items-end gap-2">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor={`retorno-data-${agendamento.id}`} className="text-xs">
            Ou escolha a data
          </Label>
          <Input
            id={`retorno-data-${agendamento.id}`}
            type="date"
            min={format(addDays(parseISO(diaConsulta), 1), 'yyyy-MM-dd')}
            value={dias ? '' : data}
            onChange={(e) => {
              setData(e.target.value);
              setDias(null);
            }}
          />
        </div>
      </div>
      {dataCalculada && (
        <p className="text-xs text-muted-foreground">
          Data prevista: <strong className="text-foreground">{formatarData(dataCalculada)}</strong>
        </p>
      )}
      <Textarea
        rows={2}
        value={observacao}
        onChange={(e) => setObservacao(e.target.value)}
        placeholder="Observação (ex.: trazer resultado dos exames)"
        aria-label="Observação do retorno"
        maxLength={1000}
      />
      <div className="flex justify-end gap-2">
        {retorno && (
          <Button variant="ghost" size="sm" onClick={onConcluir} disabled={salvando}>
            Cancelar
          </Button>
        )}
        <Button size="sm" onClick={salvar} disabled={salvando}>
          {salvando && <Loader2 className="size-4 animate-spin" />}
          {retorno ? 'Salvar retorno' : 'Definir retorno'}
        </Button>
      </div>
    </div>
  );
}
