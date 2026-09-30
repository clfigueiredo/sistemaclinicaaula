// Diálogo "Marcar como agendado": vincula o retorno a um agendamento futuro do paciente (validado no servidor)
// ou marca como agendado sem vínculo (ex.: agendado em outro lugar).
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { CalendarPlus, Loader2 } from 'lucide-react';
import { mensagemDeErro } from '@/api/cliente';
import { useConsultasPaciente } from '@/api/pacientes';
import { useMudarStatusRetorno, type Retorno } from '@/api/retornos';
import { ROTULOS_STATUS_AGENDAMENTO } from '@/api/tipos';
import { Carregando } from '@/componentes/comum';
import { Button } from '@/componentes/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/componentes/ui/dialog';
import { formatarData, formatarDataHora } from '@/lib/formatos';
import { cn } from '@/lib/utils';

const SEM_VINCULO = '__sem__';

export function MarcarAgendado({ retorno, onFechar }: { retorno: Retorno | null; onFechar: () => void }) {
  return (
    <Dialog open={!!retorno} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="sm:max-w-lg">{retorno && <Conteudo retorno={retorno} onFechar={onFechar} />}</DialogContent>
    </Dialog>
  );
}

function Conteudo({ retorno, onFechar }: { retorno: Retorno; onFechar: () => void }) {
  const consultas = useConsultasPaciente(retorno.paciente_id);
  const mudar = useMudarStatusRetorno();
  const candidatos = (consultas.data ?? [])
    .filter(
      (c) =>
        c.id !== retorno.agendamento_origem_id &&
        c.inicio > retorno.agendamento_origem.inicio &&
        c.status !== 'cancelado' &&
        c.status !== 'faltou',
    )
    .sort((a, b) => a.inicio.localeCompare(b.inicio));
  const [escolhido, setEscolhido] = useState<string | null>(null);
  const selecionado = escolhido ?? candidatos[0]?.id ?? SEM_VINCULO;

  async function confirmar() {
    try {
      await mudar.mutateAsync({
        id: retorno.id,
        status: 'agendado',
        agendamento_retorno_id: selecionado === SEM_VINCULO ? null : selecionado,
      });
      toast.success('Retorno marcado como agendado.');
      onFechar();
    } catch (e) {
      toast.error(mensagemDeErro(e));
    }
  }

  const opcao = (id: string, titulo: string, detalhe?: string) => (
    <label
      key={id}
      className={cn(
        'flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm hover:bg-accent',
        selecionado === id && 'border-primary bg-primary/5',
      )}
    >
      <input
        type="radio"
        name="agendamento-retorno"
        className="mt-1 accent-[var(--primary)]"
        checked={selecionado === id}
        onChange={() => setEscolhido(id)}
      />
      <span>
        <span className="font-medium">{titulo}</span>
        {detalhe && <span className="block text-xs text-muted-foreground">{detalhe}</span>}
      </span>
    </label>
  );

  return (
    <>
      <DialogHeader>
        <DialogTitle>Marcar retorno como agendado</DialogTitle>
        <DialogDescription>
          {retorno.paciente.nome} · retorno previsto para {formatarData(retorno.data_prevista)} com {retorno.profissional.nome}.
        </DialogDescription>
      </DialogHeader>
      {consultas.isLoading ? (
        <Carregando />
      ) : (
        <div className="max-h-[50vh] space-y-2 overflow-y-auto">
          {candidatos.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhum agendamento deste paciente depois da consulta de origem.{' '}
              <Link to="/agenda" className="text-primary underline-offset-4 hover:underline">
                Abrir a agenda
              </Link>{' '}
              para agendar.
            </p>
          )}
          {candidatos.map((c) =>
            opcao(
              c.id,
              formatarDataHora(c.inicio),
              `${c.profissional?.nome ?? 'Profissional'} · ${ROTULOS_STATUS_AGENDAMENTO[c.status]}`,
            ),
          )}
          {opcao(SEM_VINCULO, 'Sem vincular agendamento', 'Ex.: o paciente agendou por outro canal.')}
        </div>
      )}
      <DialogFooter className="gap-2">
        <Button variant="outline" onClick={onFechar}>
          Cancelar
        </Button>
        <Button onClick={confirmar} disabled={mudar.isPending || consultas.isLoading}>
          {mudar.isPending ? <Loader2 className="size-4 animate-spin" /> : <CalendarPlus className="size-4" />}
          Marcar como agendado
        </Button>
      </DialogFooter>
    </>
  );
}
