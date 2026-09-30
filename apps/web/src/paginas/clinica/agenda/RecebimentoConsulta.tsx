// Bloco "Pagamento" do PainelAgendamento (DONO: módulo financeiro — docs/FASE2.md §1).
// Exibido para admin/recepção com o recurso `financeiro` quando o agendamento não está cancelado.
// Mostra o total já recebido, permite recebimento parcial/complementar (entrada no caixa) e, em consulta de
// convênio, lançar "a receber do convênio" (título em Contas a receber).
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { CheckCircle2, Clock3, Loader2, Plus, Receipt, Wallet } from 'lucide-react';
import type { Agendamento } from '@/api/agendamentos';
import {
  useContasFinanceiras,
  useLancarAReceberConvenio,
  useRecebimentosAgendamento,
  useRegistrarRecebimento,
} from '@/api/financeiro';
import { ROTULOS_FORMA_PAGAMENTO, type FormaPagamento } from '@/api/tipos';
import { Button } from '@/componentes/ui/button';
import { Input } from '@/componentes/ui/input';
import { Separator } from '@/componentes/ui/separator';
import { formatarMoeda } from '@/lib/formatos';
import { cn } from '@/lib/utils';
import {
  BadgeStatusTitulo,
  Campo,
  InputValor,
  SelectConta,
  SelectForma,
  formatarDataCurta,
  hojeIso,
  lerValor,
  mesDe,
  toastErro,
} from '../financeiro/comum';

type Modo = 'caixa' | 'convenio' | null;

export function RecebimentoConsulta({ agendamento }: { agendamento: Agendamento }) {
  const q = useRecebimentosAgendamento(agendamento.id);
  const [modo, setModo] = useState<Modo>(null);
  const ehConvenio = agendamento.tipo === 'convenio';
  const total = Number(q.data?.total ?? 0);
  const efetivos = (q.data?.itens ?? []).filter((m) => m.tipo === 'entrada' && !m.estornada && m.origem !== 'estorno');
  const titulos = (q.data?.titulos ?? []).filter((t) => t.status !== 'cancelado');
  const aReceber = titulos.filter((t) => t.status === 'aberto').reduce((s, t) => s + Number(t.valor), 0);

  return (
    <div className="space-y-3">
      <Separator />
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <Wallet className="size-4 text-muted-foreground" /> Pagamento
        </h3>
        {q.data &&
          (total > 0 ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-xs font-medium text-success">
              <CheckCircle2 className="size-3" /> Recebido {formatarMoeda(total)}
            </span>
          ) : aReceber > 0 ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
              <Clock3 className="size-3" /> A receber do convênio
            </span>
          ) : (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">Não pago</span>
          ))}
      </div>

      {q.isLoading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> Carregando…
        </p>
      ) : q.isError ? (
        <p className="text-sm text-destructive">Não foi possível carregar os pagamentos.</p>
      ) : (
        <>
          {(efetivos.length > 0 || titulos.length > 0) && (
            <ul className="space-y-1.5 text-sm">
              {efetivos.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-2 rounded-md bg-muted/50 px-2.5 py-1.5">
                  <span className="min-w-0 truncate">
                    {formatarDataCurta(m.data)} · {ROTULOS_FORMA_PAGAMENTO[m.forma_pagamento]}
                    <span className="text-muted-foreground"> · {m.conta.nome}</span>
                  </span>
                  <span className="shrink-0 font-medium text-success tabular-nums">{formatarMoeda(m.valor)}</span>
                </li>
              ))}
              {titulos.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-2 rounded-md border border-dashed px-2.5 py-1.5">
                  <span className="min-w-0 truncate">
                    {t.fornecedor ?? 'Convênio'} · vence {formatarDataCurta(t.vencimento)}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <BadgeStatusTitulo status={t.status_exibicao} />
                    <span className="font-medium tabular-nums">{formatarMoeda(t.valor)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}

          {modo === 'caixa' ? (
            <FormRecebimento agendamento={agendamento} aoFechar={() => setModo(null)} jaRecebido={total} />
          ) : modo === 'convenio' ? (
            <FormConvenio agendamento={agendamento} aoFechar={() => setModo(null)} />
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant={total > 0 ? 'outline' : 'default'} onClick={() => setModo('caixa')}>
                <Plus className="size-4" />
                {total > 0 ? 'Recebimento complementar' : 'Registrar recebimento'}
              </Button>
              {ehConvenio && (
                <Button size="sm" variant="outline" onClick={() => setModo('convenio')}>
                  <Receipt className="size-4" /> A receber do convênio
                </Button>
              )}
            </div>
          )}
          {titulos.length > 0 && (
            <p className="text-xs text-muted-foreground">
              A baixa do valor do convênio é feita em{' '}
              <Link to="/financeiro/contas-receber" className="text-primary underline-offset-4 hover:underline">
                Contas a receber
              </Link>
              .
            </p>
          )}
        </>
      )}
    </div>
  );
}

function FormRecebimento({
  agendamento,
  jaRecebido,
  aoFechar,
}: {
  agendamento: Agendamento;
  jaRecebido: number;
  aoFechar: () => void;
}) {
  const registrar = useRegistrarRecebimento();
  const contas = useContasFinanceiras();
  const [valor, setValor] = useState('');
  const [forma, setForma] = useState<string>(agendamento.tipo === 'convenio' ? 'convenio' : 'pix');
  const [conta, setConta] = useState('');
  const [data, setData] = useState(hojeIso());
  const [erros, setErros] = useState<Record<string, string>>({});
  const contaEfetiva = conta || contas.data?.find((c) => c.ativo)?.id || '';

  async function salvar() {
    const e: Record<string, string> = {};
    const v = lerValor(valor);
    if (!(v > 0)) e.valor = 'Informe o valor.';
    if (!contaEfetiva) e.conta = 'Escolha a conta.';
    if (!data || data > hojeIso()) e.data = 'Data até hoje.';
    setErros(e);
    if (Object.keys(e).length) return;
    try {
      await registrar.mutateAsync({
        agendamento_id: agendamento.id,
        valor: v,
        forma_pagamento: forma as FormaPagamento,
        conta_financeira_id: contaEfetiva,
        data,
      });
      toast.success('Recebimento registrado.', {
        description: `${formatarMoeda(v)} · total recebido ${formatarMoeda(jaRecebido + v)}.`,
      });
      aoFechar();
    } catch (err) {
      toastErro(err);
    }
  }

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="grid grid-cols-2 gap-3">
        <Campo rotulo="Valor" htmlFor="rc-valor" erro={erros.valor}>
          <InputValor id="rc-valor" valor={valor} onChange={setValor} autoFocus invalido={!!erros.valor} />
        </Campo>
        <Campo rotulo="Data" htmlFor="rc-data" erro={erros.data}>
          <Input id="rc-data" type="date" value={data} max={hojeIso()} onChange={(e) => setData(e.target.value)} />
        </Campo>
        <Campo rotulo="Forma">
          <SelectForma valor={forma} onChange={setForma} />
        </Campo>
        <Campo rotulo="Conta" erro={erros.conta}>
          <SelectConta valor={contaEfetiva} onChange={setConta} somenteAtivas />
        </Campo>
      </div>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={aoFechar} disabled={registrar.isPending}>
          Cancelar
        </Button>
        <Button size="sm" onClick={salvar} disabled={registrar.isPending}>
          {registrar.isPending && <Loader2 className="size-4 animate-spin" />}
          Registrar
        </Button>
      </div>
    </div>
  );
}

function FormConvenio({ agendamento, aoFechar }: { agendamento: Agendamento; aoFechar: () => void }) {
  const lancar = useLancarAReceberConvenio();
  const [valor, setValor] = useState('');
  const [vencimento, setVencimento] = useState(() => mesDe(hojeIso(), 1).fim);
  const [obs, setObs] = useState('');
  const [erros, setErros] = useState<Record<string, string>>({});

  async function salvar() {
    const e: Record<string, string> = {};
    const v = lerValor(valor);
    if (!(v > 0)) e.valor = 'Informe o valor.';
    if (!vencimento) e.vencimento = 'Informe a previsão.';
    setErros(e);
    if (Object.keys(e).length) return;
    try {
      await lancar.mutateAsync({ agendamento_id: agendamento.id, valor: v, vencimento, observacoes: obs.trim() || null });
      toast.success('Lançado em Contas a receber.', { description: agendamento.convenio?.nome });
      aoFechar();
    } catch (err) {
      toastErro(err);
    }
  }

  return (
    <div className={cn('space-y-3 rounded-lg border p-3')}>
      <p className="text-xs text-muted-foreground">
        Cria um título a receber de {agendamento.convenio?.nome ?? 'convênio'}. Quando o convênio pagar, dê baixa em Contas a
        receber — o valor entra no caixa e no repasse do profissional.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Campo rotulo="Valor" htmlFor="rcv-valor" erro={erros.valor}>
          <InputValor id="rcv-valor" valor={valor} onChange={setValor} autoFocus invalido={!!erros.valor} />
        </Campo>
        <Campo rotulo="Previsão de pagamento" htmlFor="rcv-venc" erro={erros.vencimento}>
          <Input id="rcv-venc" type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)} />
        </Campo>
      </div>
      <Campo rotulo="Observação (ex.: nº da guia)" htmlFor="rcv-obs">
        <Input id="rcv-obs" value={obs} maxLength={500} onChange={(e) => setObs(e.target.value)} />
      </Campo>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={aoFechar} disabled={lancar.isPending}>
          Cancelar
        </Button>
        <Button size="sm" onClick={salvar} disabled={lancar.isPending}>
          {lancar.isPending && <Loader2 className="size-4 animate-spin" />}
          Lançar a receber
        </Button>
      </div>
    </div>
  );
}
