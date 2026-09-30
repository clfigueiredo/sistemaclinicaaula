// [STUB — fase 2] DONO: módulo `retornos`. Contrato: docs/FASE2.md §5.
// Bloco do PainelAgendamento (agenda) exibido quando o agendamento está `compareceu` ou `atendido` e o
// plano tem `retorno_automatico`. Sugestão: "Retorno em [7|15|30|60|90|outro] dias" → POST /retornos
// { agendamento_origem_id, dias }; se já existir (GET /retornos/agendamento/:id), mostrar a data prevista
// e o status, com opção de alterar (PUT) ou cancelar. Hooks em src/api/retornos.ts.
import type { Agendamento } from '@/api/agendamentos';

export function DefinirRetorno({ agendamento, podeAlterar }: { agendamento: Agendamento; podeAlterar: boolean }) {
  void agendamento;
  void podeAlterar;
  return null;
}
