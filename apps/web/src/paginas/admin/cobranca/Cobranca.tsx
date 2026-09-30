// Cobrança automática do SaaS (super admin): gateways, cobranças das clínicas e log de webhooks.
// Contrato: docs/FASE2.md §7. Hooks em src/api/adminCobranca.ts.
import { lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CreditCard, Receipt, Webhook } from 'lucide-react';
import { CabecalhoPagina, Carregando } from '@/componentes/comum';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/componentes/ui/tabs';

const AbaGateways = lazy(() => import('./AbaGateways'));
const AbaCobrancas = lazy(() => import('./AbaCobrancas'));
const AbaEventos = lazy(() => import('./AbaEventos'));

const ABAS = ['gateways', 'cobrancas', 'eventos'] as const;
type Aba = (typeof ABAS)[number];

export default function PaginaCobranca() {
  const [params, setParams] = useSearchParams();
  const abaUrl = params.get('aba') as Aba | null;
  const aba: Aba = abaUrl && ABAS.includes(abaUrl) ? abaUrl : 'gateways';

  return (
    <div>
      <CabecalhoPagina
        titulo="Cobrança"
        descricao="Gateways de pagamento (Asaas, Stripe, Mercado Pago), mensalidades das clínicas e notificações recebidas."
      />
      <Tabs value={aba} onValueChange={(v) => setParams(v === 'gateways' ? {} : { aba: v }, { replace: true })}>
        <TabsList className="mb-4">
          <TabsTrigger value="gateways">
            <CreditCard /> Gateways
          </TabsTrigger>
          <TabsTrigger value="cobrancas">
            <Receipt /> Cobranças
          </TabsTrigger>
          <TabsTrigger value="eventos">
            <Webhook /> Eventos
          </TabsTrigger>
        </TabsList>
        <Suspense fallback={<Carregando />}>
          <TabsContent value="gateways">{aba === 'gateways' && <AbaGateways />}</TabsContent>
          <TabsContent value="cobrancas">{aba === 'cobrancas' && <AbaCobrancas />}</TabsContent>
          <TabsContent value="eventos">{aba === 'eventos' && <AbaEventos />}</TabsContent>
        </Suspense>
      </Tabs>
    </div>
  );
}
