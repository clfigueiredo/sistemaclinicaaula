/**
 * Peças compartilhadas da cobrança do SaaS (painel super admin e faturas da clínica).
 */
import { useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Copy } from 'lucide-react';
import { toast } from 'sonner';
import {
  ROTULOS_STATUS_COBRANCA,
  type ProvedorPagamento,
  type StatusCobranca,
} from '@/api/tipos';
import { Badge } from '@/componentes/ui/badge';
import { Button } from '@/componentes/ui/button';
import { cn } from '@/lib/utils';

const CORES_STATUS_COBRANCA: Record<StatusCobranca, string> = {
  pendente: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  paga: 'border-success/30 bg-success/10 text-success',
  vencida: 'border-warning/40 bg-warning/15 text-amber-700 dark:text-amber-300',
  cancelada: 'border-border bg-muted text-muted-foreground',
  estornada: 'border-destructive/30 bg-destructive/10 text-destructive',
};

export function BadgeStatusCobranca({ status, className }: { status: StatusCobranca; className?: string }) {
  return (
    <Badge variant="outline" className={cn(CORES_STATUS_COBRANCA[status], className)}>
      {ROTULOS_STATUS_COBRANCA[status]}
    </Badge>
  );
}

/** Identidade visual mínima de cada gateway (sem imagens de terceiros). */
export const VISUAL_GATEWAY: Record<ProvedorPagamento, { sigla: string; cor: string; site: string }> = {
  asaas: { sigla: 'as', cor: '#1D4ED8', site: 'asaas.com' },
  stripe: { sigla: 'S', cor: '#635BFF', site: 'stripe.com' },
  mercado_pago: { sigla: 'mp', cor: '#00A6E0', site: 'mercadopago.com.br' },
};

export function LogoGateway({ provedor, className }: { provedor: ProvedorPagamento; className?: string }) {
  const v = VISUAL_GATEWAY[provedor];
  return (
    <span
      className={cn('grid size-10 shrink-0 place-items-center rounded-lg text-base font-bold text-white select-none', className)}
      style={{ backgroundColor: v.cor }}
      aria-hidden
    >
      {v.sigla}
    </span>
  );
}

export async function copiarTexto(texto: string, sucesso = 'Copiado para a área de transferência.') {
  try {
    await navigator.clipboard.writeText(texto);
    toast.success(sucesso);
    return true;
  } catch {
    toast.error('Não foi possível copiar. Selecione o texto e copie manualmente.');
    return false;
  }
}

export function BotaoCopiar({ texto, rotulo = 'Copiar', mensagem }: { texto: string; rotulo?: string; mensagem?: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={async () => {
        if (await copiarTexto(texto, mensagem)) {
          setCopiado(true);
          setTimeout(() => setCopiado(false), 2000);
        }
      }}
    >
      {copiado ? <Check className="text-success" /> : <Copy />}
      {copiado ? 'Copiado' : rotulo}
    </Button>
  );
}

export function Paginacao({
  pagina,
  total,
  porPagina,
  rotulo,
  aoMudar,
}: {
  pagina: number;
  total: number;
  porPagina: number;
  rotulo: [string, string];
  aoMudar: (pagina: number) => void;
}) {
  const totalPaginas = Math.max(1, Math.ceil(total / porPagina));
  return (
    <div className="mt-4 flex flex-col items-center justify-between gap-2 text-sm text-muted-foreground sm:flex-row">
      <span>
        {total} {total === 1 ? rotulo[0] : rotulo[1]}
        {totalPaginas > 1 && ` · página ${pagina} de ${totalPaginas}`}
      </span>
      {totalPaginas > 1 && (
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={pagina <= 1} onClick={() => aoMudar(pagina - 1)}>
            <ChevronLeft /> Anterior
          </Button>
          <Button variant="outline" size="sm" disabled={pagina >= totalPaginas} onClick={() => aoMudar(pagina + 1)}>
            Próxima <ChevronRight />
          </Button>
        </div>
      )}
    </div>
  );
}

/** 'YYYY-MM-DD' de hoje (fuso do navegador) + n dias. */
export function dataIsoMaisDias(dias = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
