// Gateways de pagamento do SaaS (super admin) e log de webhooks. As cobranças ficam em /admin/cobrancas.
// Contrato: docs/FASE2.md §7. Hooks em src/api/adminCobranca.ts.
import { lazy, Suspense } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { CreditCard, Webhook } from 'lucide-react';
import { CabecalhoPagina, Carregando } from '@/componentes/comum';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/componentes/ui/tabs';

const AbaGateways = lazy(() => import('./AbaGateways'));
const AbaEventos = lazy(() => import('./AbaEventos'));

const ABAS = ['gateways', 'eventos'] as const;
type Aba = (typeof ABAS)[number];

export default function PaginaCobranca() {
  const [params, setParams] = useSearchParams();
  const abaUrl = params.get('aba');
  // Links antigos (?aba=cobrancas): a lista de cobranças virou página própria.
  if (abaUrl === 'cobrancas') {
    const p = new URLSearchParams(params);
    p.delete('aba');
    return <Navigate to={`/admin/cobrancas${p.size ? `?${p}` : ''}`} replace />;
  }
  const aba: Aba = abaUrl && (ABAS as readonly string[]).includes(abaUrl) ? (abaUrl as Aba) : 'gateways';

  return (
    <div>
      <CabecalhoPagina
        titulo="Gateways de pagamento"
        descricao="Asaas, Stripe ou Mercado Pago: credenciais, gateway ativo e notificações (webhooks) recebidas."
      />
      <Tabs value={aba} onValueChange={(v) => setParams(v === 'gateways' ? {} : { aba: v }, { replace: true })}>
        <TabsList className="mb-4">
          <TabsTrigger value="gateways">
            <CreditCard /> Gateways
          </TabsTrigger>
          <TabsTrigger value="eventos">
            <Webhook /> Eventos
          </TabsTrigger>
        </TabsList>
        <Suspense fallback={<Carregando />}>
          <TabsContent value="gateways">{aba === 'gateways' && <AbaGateways />}</TabsContent>
          <TabsContent value="eventos">{aba === 'eventos' && <AbaEventos />}</TabsContent>
        </Suspense>
      </Tabs>
    </div>
  );
}
