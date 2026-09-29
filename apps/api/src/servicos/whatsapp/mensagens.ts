/**
 * Templates das mensagens de WhatsApp (pt-BR). Datas sempre no fuso da clínica.
 */
import { formatInTimeZone } from 'date-fns-tz';
import { ptBR } from 'date-fns/locale';

export type DadosLembrete = {
  paciente: string;
  clinica: string;
  profissional: string;
  inicio: Date;
  fuso: string;
};

function primeiroNome(nome: string): string {
  return nome.trim().split(/\s+/)[0] ?? nome;
}

/** "terça-feira, 30/09 às 14:30" */
export function formatarDataConsulta(inicio: Date, fuso: string): string {
  return formatInTimeZone(inicio, fuso, "EEEE, dd/MM 'às' HH:mm", { locale: ptBR });
}

export function textoLembrete(d: DadosLembrete): string {
  return [
    `Olá, ${primeiroNome(d.paciente)}!`,
    '',
    `Lembrete da sua consulta na *${d.clinica}* com *${d.profissional}* amanhã, ${formatarDataConsulta(d.inicio, d.fuso)}.`,
    '',
    'Responda *1* para confirmar ou *2* para cancelar.',
  ].join('\n');
}

export function textoConfirmado(d: DadosLembrete): string {
  return `Obrigado, ${primeiroNome(d.paciente)}! Sua consulta com ${d.profissional} em ${formatarDataConsulta(d.inicio, d.fuso)} está *confirmada*. Até lá!`;
}

export function textoCancelado(d: DadosLembrete): string {
  return `Tudo bem, ${primeiroNome(d.paciente)}. Sua consulta com ${d.profissional} em ${formatarDataConsulta(d.inicio, d.fuso)} foi *cancelada*. Se quiser remarcar, entre em contato com a ${d.clinica}.`;
}

export function textoInstrucoes(): string {
  return 'Não entendi sua resposta. Responda apenas *1* para confirmar ou *2* para cancelar a consulta. Para outros assuntos, entre em contato com a clínica.';
}

/** Aviso interno para a recepção (não é enviado pelo WhatsApp). */
export function textoAvisoCancelamento(d: DadosLembrete): string {
  return `${d.paciente} cancelou pelo WhatsApp a consulta com ${d.profissional} de ${formatarDataConsulta(d.inicio, d.fuso)}.`;
}

export type RespostaPaciente = 'confirmar' | 'cancelar' | 'outra';

/** Interpreta a resposta ao lembrete: 1 = confirmar, 2 = cancelar. */
export function interpretarResposta(texto: string): RespostaPaciente {
  const t = texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[*_~.!,;:()\-"'`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (['1', '1️⃣', 'um', 'sim', 'confirmo', 'confirmar', 'confirmado', 'confirma'].includes(t)) return 'confirmar';
  if (['2', '2️⃣', 'dois', 'cancelar', 'cancelo', 'cancela', 'cancelado'].includes(t)) return 'cancelar';
  return 'outra';
}
