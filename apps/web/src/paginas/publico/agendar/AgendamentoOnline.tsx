// [STUB — fase 2] DONO: módulo `agendamento-online`. Contrato: docs/FASE2.md §2.
// Página PÚBLICA /agendar/:slug (sem login; também abre para quem está logado). Fluxo: profissional →
// dia/horário livre (GET /publico/clinicas/:slug/disponibilidade) → dados (nome, WhatsApp, e-mail, CPF
// opcional, consentimento de WhatsApp, honeypot `website` escondido) → POST /publico/clinicas/:slug/solicitacoes
// → tela "solicitação enviada, aguarde a confirmação". Layout próprio, mobile first. Hooks em src/api/agendamentoOnline.ts.
import { useParams } from 'react-router-dom';
import { EstadoVazio, Logo } from '@/componentes/comum';

export default function PaginaAgendamentoOnline() {
  const { slug = '' } = useParams();
  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex h-14 max-w-3xl items-center px-4">
          <Logo />
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-10">
        <EstadoVazio titulo="Agendamento online" descricao={`Em construção (${slug}).`} />
      </main>
    </div>
  );
}
