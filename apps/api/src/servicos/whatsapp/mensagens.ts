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

// ============================================================================
// Fase 2 do produto — templates usados por outros módulos com enfileirarMensagem (./envio.ts).
// Tipo de mensagem (TipoMensagem) correspondente indicado em cada função.
// ============================================================================

/**
 * "30/09/2026" de uma coluna `@db.Date` (data_prevista, vencimento…). O Prisma devolve essas datas como
 * meia-noite UTC, então formatamos em UTC (formatar no fuso da clínica mostraria o dia anterior).
 */
export function formatarDataSemHora(data: Date): string {
  return formatInTimeZone(data, 'UTC', 'dd/MM/yyyy');
}

/** tipo `agendamento_confirmado` — solicitação de agendamento online APROVADA. */
export function textoAgendamentoOnlineConfirmado(d: DadosLembrete & { endereco?: string | null }): string {
  return [
    `Olá, ${primeiroNome(d.paciente)}!`,
    '',
    `Sua consulta na *${d.clinica}* com *${d.profissional}* está *agendada* para ${formatarDataConsulta(d.inicio, d.fuso)}.`,
    ...(d.endereco ? ['', `Endereço: ${d.endereco}`] : []),
    '',
    'Se precisar remarcar ou cancelar, fale com a clínica. Até lá!',
  ].join('\n');
}

/** tipo `agendamento_recusado` — solicitação de agendamento online RECUSADA (motivo opcional). */
export function textoAgendamentoOnlineRecusado(d: {
  paciente: string;
  clinica: string;
  inicio: Date;
  fuso: string;
  motivo?: string | null;
  linkAgendamento?: string | null;
}): string {
  return [
    `Olá, ${primeiroNome(d.paciente)}.`,
    '',
    `Infelizmente não foi possível confirmar o horário solicitado na *${d.clinica}* (${formatarDataConsulta(d.inicio, d.fuso)}).`,
    ...(d.motivo ? ['', `Motivo: ${d.motivo}`] : []),
    '',
    d.linkAgendamento
      ? `Você pode escolher outro horário em ${d.linkAgendamento} ou falar com a clínica.`
      : 'Entre em contato com a clínica para escolher outro horário.',
  ].join('\n');
}

/** tipo `oferta_horario` — horário vago oferecido a paciente da lista de espera. */
export function textoOfertaHorario(d: DadosLembrete & { telefoneClinica?: string | null }): string {
  return [
    `Olá, ${primeiroNome(d.paciente)}!`,
    '',
    `Abriu um horário na *${d.clinica}* com *${d.profissional}*: ${formatarDataConsulta(d.inicio, d.fuso)}.`,
    '',
    d.telefoneClinica
      ? `Se tiver interesse, fale com a clínica pelo ${d.telefoneClinica} o quanto antes — o horário é de quem confirmar primeiro.`
      : 'Se tiver interesse, fale com a clínica o quanto antes — o horário é de quem confirmar primeiro.',
  ].join('\n');
}

/** tipo `convite_retorno` — convite para agendar o retorno. */
export function textoConviteRetorno(d: {
  paciente: string;
  clinica: string;
  profissional: string;
  /** Coluna @db.Date (meia-noite UTC). */
  dataPrevista: Date;
  linkAgendamento?: string | null;
}): string {
  return [
    `Olá, ${primeiroNome(d.paciente)}!`,
    '',
    `Está chegando a data do seu retorno com *${d.profissional}* na *${d.clinica}* (previsto para ${formatarDataSemHora(d.dataPrevista)}).`,
    '',
    d.linkAgendamento
      ? `Agende pelo link ${d.linkAgendamento} ou fale com a clínica.`
      : 'Fale com a clínica para agendar o melhor horário.',
  ].join('\n');
}
