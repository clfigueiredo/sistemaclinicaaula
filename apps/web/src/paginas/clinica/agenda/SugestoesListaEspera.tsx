// [STUB — fase 2] DONO: módulo `lista-espera`. Contrato: docs/FASE2.md §3.
// Bloco do PainelAgendamento (agenda) exibido quando o agendamento está `cancelado` ou `faltou` e o plano tem
// `lista_espera` (admin e recepção). Sugestão: GET /lista-espera/sugestoes?agendamento_id=<id> → lista de
// pacientes compatíveis com o horário liberado, com ações "Oferecer por WhatsApp" (POST /lista-espera/:id/oferecer)
// e "Agendar" (abre o fluxo normal da agenda). Se o horário já foi ocupado, mostrar isso e não sugerir.
// Hooks em src/api/listaEspera.ts.
import type { Agendamento } from '@/api/agendamentos';

export function SugestoesListaEspera({ agendamento }: { agendamento: Agendamento }) {
  void agendamento;
  return null;
}
