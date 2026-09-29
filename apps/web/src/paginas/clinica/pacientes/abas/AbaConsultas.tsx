// Aba "Consultas" da ficha: histórico de agendamentos do paciente (GET /agendamentos?pacienteId= — módulo agenda).
import { CalendarDays } from 'lucide-react';
import { ErroApi, mensagemDeErro } from '@/api/cliente';
import { useConsultasPaciente } from '@/api/pacientes';
import { ROTULOS_STATUS_AGENDAMENTO, type StatusAgendamento } from '@/api/tipos';
import { Carregando, EstadoVazio } from '@/componentes/comum';
import { Badge } from '@/componentes/ui/badge';
import { Card } from '@/componentes/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/componentes/ui/table';
import { formatarDataHora } from '@/lib/formatos';
import { cn } from '@/lib/utils';

const COR_STATUS: Record<StatusAgendamento, string> = {
  agendado: 'bg-secondary text-secondary-foreground',
  confirmado: 'bg-primary/15 text-primary',
  compareceu: 'bg-primary/15 text-primary',
  atendido: 'bg-success/15 text-success',
  cancelado: 'bg-muted text-muted-foreground line-through',
  faltou: 'bg-destructive/15 text-destructive',
};

export default function AbaConsultas({ pacienteId }: { pacienteId: string }) {
  const { data, isLoading, error } = useConsultasPaciente(pacienteId);

  if (isLoading) return <Carregando />;
  if (error) {
    const indisponivel = error instanceof ErroApi && [404, 501].includes(error.status);
    return (
      <EstadoVazio
        icone={<CalendarDays className="size-5" />}
        titulo={indisponivel ? 'Histórico indisponível' : 'Não foi possível carregar as consultas'}
        descricao={indisponivel ? 'O histórico de consultas ainda não está disponível.' : mensagemDeErro(error)}
      />
    );
  }
  if (!data || data.length === 0) {
    return (
      <EstadoVazio
        icone={<CalendarDays className="size-5" />}
        titulo="Nenhuma consulta"
        descricao="Os agendamentos deste paciente aparecerão aqui."
      />
    );
  }

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Data e hora</TableHead>
            <TableHead>Profissional</TableHead>
            <TableHead className="hidden sm:table-cell">Tipo</TableHead>
            <TableHead className="text-right">Situação</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((c) => (
            <TableRow key={c.id}>
              <TableCell className="whitespace-nowrap">{formatarDataHora(c.inicio)}</TableCell>
              <TableCell>
                <span className="inline-flex items-center gap-2">
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: c.profissional?.cor_agenda ?? 'var(--muted-foreground)' }}
                    aria-hidden
                  />
                  {c.profissional?.nome ?? '—'}
                </span>
              </TableCell>
              <TableCell className="hidden sm:table-cell">
                {c.tipo === 'convenio' ? (c.convenio?.nome ?? 'Convênio') : 'Particular'}
              </TableCell>
              <TableCell className="text-right">
                <Badge className={cn('border-0', COR_STATUS[c.status])}>
                  {ROTULOS_STATUS_AGENDAMENTO[c.status] ?? c.status}
                </Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
