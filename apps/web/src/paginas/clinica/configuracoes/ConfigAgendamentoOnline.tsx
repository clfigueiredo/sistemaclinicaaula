// [STUB — fase 2] DONO: módulo `agendamento-online`. Contrato: docs/FASE2.md §2.
// Card da página Configurações (somente admin, plano com `agendamento_online`): endereço público
// (`me.clinica.slug` → link `${location.origin}/agendar/<slug>`, editar via useEditarClinica({ slug }) —
// PUT /me/clinica, 409 registro_duplicado = endereço em uso), ativar/desativar, antecedência mínima, dias
// à frente, mensagem de boas-vindas, máximo de pendentes por telefone e profissionais visíveis
// (GET/PUT /agendamento-online/configuracao). Hooks em src/api/agendamentoOnline.ts.
export default function ConfigAgendamentoOnline() {
  return null;
}
