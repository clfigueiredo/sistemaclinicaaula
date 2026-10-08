// E-mails transacionais do SaaS (super admin): configuração do SMTP (Resend), modelos editáveis e histórico.
// Hooks em src/api/adminEmail.ts; rotas da API em apps/api/src/modulos/admin-email/index.ts.
import { lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FileText, History, Settings } from 'lucide-react';
import { CabecalhoPagina, Carregando } from '@/componentes/comum';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/componentes/ui/tabs';

const AbaConfiguracao = lazy(() => import('./AbaConfiguracao'));
const AbaModelos = lazy(() => import('./AbaModelos'));
const AbaEnvios = lazy(() => import('./AbaEnvios'));

const ABAS = ['configuracao', 'modelos', 'envios'] as const;
type Aba = (typeof ABAS)[number];

export default function PaginaEmail() {
  const [params, setParams] = useSearchParams();
  const abaUrl = params.get('aba');
  const aba: Aba = abaUrl && (ABAS as readonly string[]).includes(abaUrl) ? (abaUrl as Aba) : 'configuracao';

  return (
    <div>
      <CabecalhoPagina
        titulo="E-mails"
        descricao="Envio automático de e-mails às clínicas: boas-vindas, redefinição de senha, pagamentos e avisos de renovação."
      />
      <Tabs value={aba} onValueChange={(v) => setParams(v === 'configuracao' ? {} : { aba: v }, { replace: true })}>
        <TabsList className="mb-4">
          <TabsTrigger value="configuracao">
            <Settings /> Configuração
          </TabsTrigger>
          <TabsTrigger value="modelos">
            <FileText /> Modelos
          </TabsTrigger>
          <TabsTrigger value="envios">
            <History /> Envios
          </TabsTrigger>
        </TabsList>
        <Suspense fallback={<Carregando />}>
          <TabsContent value="configuracao">{aba === 'configuracao' && <AbaConfiguracao />}</TabsContent>
          <TabsContent value="modelos">{aba === 'modelos' && <AbaModelos />}</TabsContent>
          <TabsContent value="envios">{aba === 'envios' && <AbaEnvios />}</TabsContent>
        </Suspense>
      </Tabs>
    </div>
  );
}
