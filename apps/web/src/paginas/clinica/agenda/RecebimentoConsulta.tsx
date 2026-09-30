// [STUB — fase 2] DONO: módulo `financeiro`. Contrato: docs/FASE2.md §1 (recebimento por consulta).
// Bloco do PainelAgendamento (agenda) exibido para PAPEIS_ROTA.recebimentoConsulta (admin, recepção) quando o
// plano tem `financeiro` e o agendamento NÃO está cancelado. Sugestão: mostrar o total já recebido
// (GET /financeiro/recebimentos/agendamento/:id) e o botão "Registrar recebimento" (valor, forma de pagamento,
// conta) → POST /financeiro/recebimentos. Hooks em src/api/financeiro.ts.
import type { Agendamento } from '@/api/agendamentos';

export function RecebimentoConsulta({ agendamento }: { agendamento: Agendamento }) {
  void agendamento;
  return null;
}
