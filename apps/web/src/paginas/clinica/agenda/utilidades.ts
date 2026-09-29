// Utilidades da agenda: estilos de status, datas locais e hook de tela pequena.
import { useSyncExternalStore } from 'react';
import { format } from 'date-fns';
import type { StatusAgendamento } from '@/api/tipos';

/** Estilo visual de cada status (legenda + eventos do calendário). */
export const ESTILO_STATUS: Record<StatusAgendamento, { ponto: string; evento: string[]; descricao: string }> = {
  agendado: { ponto: 'bg-primary', evento: [], descricao: 'Aguardando confirmação' },
  confirmado: { ponto: 'bg-success', evento: ['font-semibold'], descricao: 'Paciente confirmou' },
  compareceu: { ponto: 'bg-warning', evento: ['ring-2', 'ring-warning', 'ring-inset'], descricao: 'Na clínica' },
  atendido: { ponto: 'bg-muted-foreground', evento: ['opacity-55'], descricao: 'Atendimento concluído' },
  faltou: { ponto: 'bg-destructive', evento: ['opacity-45', 'italic'], descricao: 'Não compareceu' },
  cancelado: { ponto: 'bg-destructive/60', evento: ['opacity-35', 'line-through'], descricao: 'Cancelado' },
};

/** Data local no formato yyyy-MM-dd (para inputs e para a API de disponibilidade). */
export function diaLocal(d: Date): string {
  return format(d, 'yyyy-MM-dd');
}

/** Hora local HH:mm. */
export function horaLocal(d: Date): string {
  return format(d, 'HH:mm');
}

/** Monta um instante (ISO/UTC) a partir de data e hora locais do navegador. */
export function instante(dia: string, hora: string): Date {
  return new Date(`${dia}T${hora}:00`);
}

const consultaTelaPequena = '(max-width: 767px)';

function assinar(callback: () => void) {
  const mq = window.matchMedia(consultaTelaPequena);
  mq.addEventListener('change', callback);
  return () => mq.removeEventListener('change', callback);
}

/** true em telas de celular (< 768px). */
export function useTelaPequena(): boolean {
  return useSyncExternalStore(
    assinar,
    () => window.matchMedia(consultaTelaPequena).matches,
    () => false,
  );
}

/** Tipos consumidos de outros módulos (contratos combinados). */
export type PacienteResumo = {
  id: string;
  nome: string;
  cpf: string | null;
  nascimento: string | null;
  telefone: string | null;
  whatsapp: string | null;
  convenio_id: string | null;
  aceita_whatsapp: boolean;
};

export type ConvenioResumo = { id: string; nome: string; ativo: boolean };
